/* ============================================================
   slides.js - the slide strip: thumbnails, navigation and the
   slide-level operations (add, duplicate, delete, reorder, skip).

   Thumbnails are tiny srcdoc iframes: the deck's own <head> (its
   CSS, minus scripts) with a <base> to the deck folder, and one
   slide forced visible and scaled down. They therefore use the
   real fonts and images. Charts and other script-generated content
   show as a placeholder. The current slide's thumbnail is rebuilt
   from the live DOM after edits; the others only when the deck's
   structure changes. Thumbnails are created lazily as they scroll
   into view.
   ============================================================ */
import { LAYOUTS, layoutById, buildSlide, sketchHtml, applyTypeFallback } from './layouts.js';
import { Deck } from './document.js';
import { SlideClip, cleanSlideClone } from './slideclip.js';

const LAST_LAYOUT_KEY = 'deck-editor-last-layout';

/* Resource addresses in a copy of deck markup (thumbnails, deck previews) made absolute
   against `base`. A <base> alone is not enough in a srcdoc frame: the browsers' early
   resource scanners (Chrome's with a relative <base>, Firefox's with any) fetch the
   pictures from the editor's root first, a 404 for each. Frames are left as they are. */
const URL_ATTRS = [['img, source, video, audio, track, embed, input', 'src'], ['video', 'poster'], ['link', 'href'], ['object', 'data'], ['image, use, feImage', 'href'], ['image, use, feImage', 'xlink:href']];
export function absoluteUrls(root, base) {
    const abs = (v) => { try { return new URL(v, base).href; } catch { return v; } };
    const all = (sel) => [...(root.matches && root.matches(sel) ? [root] : []), ...root.querySelectorAll(sel)];   // the root too: a master <img>
    for (const [sel, attr] of URL_ATTRS) {
        all(sel).forEach(n => {
            const v = n.getAttribute(attr);
            if (v && !/^(data:|blob:|#)/i.test(v.trim())) n.setAttribute(attr, abs(v.trim()));
        });
    }
    all('img[srcset], source[srcset]').forEach(n => {
        const v = n.getAttribute('srcset');
        if (v && !/^\s*data:/i.test(v)) n.setAttribute('srcset', v.split(',').map(part => {
            const [u, ...d] = part.trim().split(/\s+/);
            return u ? [abs(u), ...d].join(' ') : part;
        }).join(', '));
    });
    return root;
}

/* Stylesheets from other origins (Google Fonts above all) block a frame's first paint until the
   other server answers: with a slow or blocked network every thumbnail stayed blank (white) for as
   long as that took, or for good. They are taken out of the copy of the head (links, and @import
   rules in its <style> blocks) and their addresses returned; addExternalCss() puts them back once
   the frame has drawn, where they only change the fonts when they arrive. */
export function takeExternalCss(root) {
    const urls = [];
    const external = (v) => { try { return new URL(v, location.href).origin !== location.origin && /^https?:/i.test(new URL(v, location.href).protocol); } catch { return false; } };
    root.querySelectorAll('link[rel~="stylesheet"][href]').forEach(l => {
        const h = l.getAttribute('href');
        if (external(h)) { urls.push(h); l.remove(); }
    });
    root.querySelectorAll('style').forEach(st => {
        st.textContent = st.textContent.replace(/@import\s+(?:url\(\s*)?["']?(https?:[^"')\s;]+)["']?\s*\)?[^;]*;/gi, (m, u) => { urls.push(u); return ''; });
    });
    return urls;
}
export function addExternalCss(doc, urls) {
    if (!doc || !doc.head) return;
    for (const u of urls) {
        if ([...doc.head.querySelectorAll('link[data-ext]')].some(l => l.getAttribute('href') === u)) continue;
        const l = doc.createElement('link');
        l.rel = 'stylesheet'; l.href = u; l.setAttribute('data-ext', '');
        doc.head.appendChild(l);
    }
}

export const THUMB_CSS = `
html, body { margin: 0; overflow: hidden; background: transparent; }
body { pointer-events: none; }
.deck-viewport { position: static; overflow: visible; background: transparent; }
.deck-stage { position: absolute; left: 0; top: 0; transform: none !important; }
.slide { visibility: visible !important; opacity: 1 !important; }
.slide *, .slide { transition: none !important; animation: none !important; }
[data-fig] { background: repeating-linear-gradient(135deg, rgba(0,0,0,0.05) 0 12px, rgba(0,0,0,0.10) 12px 24px); }
.deck-controls, .notes, [data-hidden] { display: none !important; }
[data-placeholder] { display: flex !important; }
[data-fragment] { opacity: 1 !important; }
.deck-overview { display: none !important; }
`;

export class SlideStrip extends EventTarget {
    constructor(app, { list, addButton }) {
        super();
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.list = list;
        this.addButton = addButton;
        this.items = new Map();        // slide element -> strip item
        this.collapsed = new Set();    // section names folded in the strip (editor state only)
        this.headHtml = '';
        this.thumbW = 180;
        this.observer = null;
        this._refreshTimer = 0;
        this.sel = new Set();          // slides picked in the strip (Ctrl / Shift + click); empty = the current slide alone
        this.ctx = false;              // the strip, not the canvas, was last clicked: it owns Delete, Ctrl+C / X / V
        this.clip = new SlideClip(this);
        this._bind();
    }

    /* ------------------------------------------------------------
       Building
       ------------------------------------------------------------ */
    _bind() {
        this.deck.addEventListener('ready', () => this.rebuild());
        this.deck.addEventListener('deckcss', () => { if (this.deck.isOpen) this.rebuild(); });   // the deck's own CSS changed: thumbnails load it afresh
        this.deck.addEventListener('slide', () => this.highlight());
        this.deck.addEventListener('mutate', (e) => this._onMutate(e.detail));
        this.addButton.addEventListener('click', () => this.showLayoutPicker());
        new ResizeObserver(() => { this._resizeThumbs(); this._fillSoon(); }).observe(this.list);
        this.list.addEventListener('scroll', () => this._fillSoon(), { passive: true });

        // Navigation happens on pointerup in _bindDrag(): the drag code takes pointer
        // capture on the list, which makes click events land on the list, not the item.
        this.list.addEventListener('contextmenu', (e) => {
            const it = e.target.closest('.strip-item'); if (!it) return;
            e.preventDefault();
            this.ctx = true;
            if (!this.sel.has(it._slide)) { this.sel.clear(); this.deck.goTo(this.indexOf(it)); }   // a right-click inside the picked slides keeps them
            this._menu(it, e.clientX, e.clientY);
        });
        this._bindDrag();
        document.addEventListener('pointerdown', (e) => {
            if (!e.target.closest('.strip-menu')) this._closeMenu();
            this.ctx = !!(e.target.closest && e.target.closest('#stripList, .strip-menu'));
        }, true);
        this.deck.addEventListener('ready', () => {
            this.sel.clear();
            this.deck.doc.addEventListener('pointerdown', () => { this.ctx = false; }, true);
        });
        this.deck.addEventListener('slide', () => { if (this.sel.size && !this.sel.has(this.deck.currentSlide)) this.sel.clear(); this.highlight(); });
        document.addEventListener('pointerdown', (e) => { if (this.picker && !e.target.closest('.layout-picker') && e.target !== this.addButton) this.closeLayoutPicker(); }, true);
    }

    /* The deck's head, cleaned for thumbnails, computed once per open. */
    _head() {
        if (this.headHtml) return this.headHtml;
        const src = this.deck.sourceWithDeckStyles() || '';     // with the Theme > Deck CSS edits
        const m = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(src);
        let head = m ? m[1] : '';
        head = head.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<title>[\s\S]*?<\/title>/gi, '')
            .replace(/<style id="deck-editor-(fonts|overrides)">[\s\S]*?<\/style>/gi, '');   // the live blocks are added per thumbnail
        const dir = this.deck.file.includes('/') ? this.deck.file.slice(0, this.deck.file.lastIndexOf('/') + 1) : '';
        // Absolute, and the addresses in the markup too (absoluteUrls).
        this.baseHref = `${location.origin}/deck/${dir.split('/').map(encodeURIComponent).join('/')}`;
        const t = document.createElement('template'); t.innerHTML = head;
        absoluteUrls(t.content, this.baseHref);
        this.extCss = takeExternalCss(t.content);
        head = t.innerHTML;
        this.headHtml = `<base href="${this.baseHref}">` + head + `<style>${THUMB_CSS}</style>`;
        return this.headHtml;
    }

    rebuild() {
        this.headHtml = '';
        this.items = new Map();
        this.list.innerHTML = '';
        if (this.observer) this.observer.disconnect();
        clearTimeout(this._refreshTimer); this._dirty = new Set(); this._refreshAllPending = false;
        this.observer = new IntersectionObserver((entries) => {
            // One slide that cannot be drawn must not cost the rest of the batch their thumbnails: an
            // observer reports a change once, so an entry skipped here would stay blank for good.
            for (const en of entries) if (en.isIntersecting) this._tryThumb(en.target);
        }, { root: this.list, rootMargin: '200px 0px' });
        if (!this.deck.isOpen) return;
        for (const slide of this.deck.slides) this.list.appendChild(this._item(slide));
        this._resizeThumbs();
        this.highlight();
        this.renumber();
        this._fillSoon();
    }

    /* The observer is the cheap way to find the items in view, the sweep below the safety net: it
       draws every item in or near the list's visible part that has no thumbnail yet. It runs after
       scrolling and resizing settle, so a missed or swallowed notification (a panel that was hidden
       or zero-sized, a thumbnail that threw, a rebuild in between) costs a moment, not a blank. */
    _fillSoon() {
        if (this._fillTimer) return;
        this._fillTimer = setTimeout(() => { this._fillTimer = 0; this._fillVisible(); }, 120);
    }
    _fillVisible() {
        if (!this.deck.isOpen || !this.list.clientHeight) return;
        const r = this.list.getBoundingClientRect(), pad = 200;
        let missing = false;
        for (const it of this.itemList()) {
            if (it.hidden || it.querySelector('iframe')) continue;
            const b = it.getBoundingClientRect();
            if (!b.height || b.bottom < r.top - pad || b.top > r.bottom + pad) continue;
            missing = true;
            this._tryThumb(it);
        }
        if (missing) this._fillSoon();          // one that failed (a deck still loading) is tried again
    }
    _tryThumb(it, force = false, hard = false) {
        try { this._ensureThumb(it, force, hard); }
        catch (err) { console.warn('thumbnail failed', err); }
    }

    _item(slide) {
        const it = document.createElement('div');
        it.className = 'strip-item';
        it.innerHTML = `<span class="n"></span><div class="thumb"><div class="thumb-hit"></div><span class="thumb-label"></span></div>`;
        it.querySelector('.thumb-label').textContent = this.deck.slideLabel(slide);
        it.classList.toggle('skipped', slide.hasAttribute('data-skip'));
        this.items.set(slide, it);
        it._slide = slide;
        this.observer.observe(it);
        return it;
    }

    /* Create (or recreate) the thumbnail iframe of one item from the live slide. */
    _ensureThumb(it, force = false, hard = false) {
        const thumb = it.querySelector('.thumb');
        let frame = thumb.querySelector('iframe');
        if (frame && !force) return;
        const slide = it._slide;
        const doc = this.deck.doc;               // null while another deck is loading
        if (!slide || !doc || !doc.contains(slide)) return;
        const clone = slide.cloneNode(true);
        clone.classList.add('active', 'visible');
        clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
        const live = ['deck-editor-fonts', 'deck-editor-overrides'].map(id => { const st = doc.getElementById(id); return st ? st.outerHTML : ''; }).join('');
        // The master layer (footer, page counter) goes into every thumbnail, numbered for its slide.
        const idx = this.deck.slides.indexOf(slide), total = this.deck.slides.length;
        const head = this._head();
        absoluteUrls(clone, this.baseHref);
        const master = this.deck.masterElements.map(m => { const c = m.cloneNode(true); Deck.stampCounter(c, idx + 1, total); return absoluteUrls(c, this.baseHref).outerHTML; }).join('');
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${head}${live}</head><body><div class="deck-viewport"><main class="deck-stage">${clone.outerHTML}${master}</main></div></body></html>`;
        if (!frame) {
            frame = document.createElement('iframe');
            frame.className = 'thumb-frame';
            frame.setAttribute('tabindex', '-1');
            frame.setAttribute('aria-hidden', 'true');
            // No scripts in a thumbnail: it is a copy of deck markup inside the editor's own origin,
            // where an inline handler in a slide would run with the editor's rights.
            frame.setAttribute('sandbox', 'allow-same-origin');
            thumb.prepend(frame);
            this._sizeFrame(frame);
            this._watchFrame(it, frame);
            frame.srcdoc = html;
        } else if (!hard && frame.contentDocument && frame.contentDocument.querySelector('.deck-stage')) {
            // Cheap refresh: swap the slide markup (and the editor's live style blocks) without reloading the deck's CSS.
            frame.contentDocument.querySelector('.deck-stage').innerHTML = clone.outerHTML + master;
            for (const id of ['deck-editor-fonts', 'deck-editor-overrides']) {
                const src = this.deck.doc.getElementById(id), dst = frame.contentDocument.getElementById(id);
                if (src && dst) { if (dst.textContent !== src.textContent) dst.textContent = src.textContent; }
                else if (src && !dst) frame.contentDocument.head.appendChild(frame.contentDocument.importNode(src, true));
                else if (!src && dst) dst.remove();
            }
        } else {
            frame.srcdoc = html;
            this._watchFrame(it, frame);
        }
        it.querySelector('.thumb-label').textContent = this.deck.slideLabel(slide);
    }

    /* After its load: has the thumbnail really drawn? A stylesheet or picture the server dropped under
       load (a burst of requests from many frames at once) leaves it unstyled or empty, and nothing
       would ever retry. Look at the frame once it has loaded, and again after a quiet spell if it
       never did; a damaged one is loaded afresh (a few times, with a growing pause). */
    _watchFrame(it, frame) {
        clearTimeout(frame._watch);
        const check = () => {
            clearTimeout(frame._watch);
            if (!frame.isConnected || this.items.get(it._slide) !== it) return;
            let bad = true;
            try {
                const d = frame.contentDocument;
                if (d && d.URL === 'about:srcdoc' && d.readyState !== 'loading' && d.querySelector('.slide')) {
                    addExternalCss(d, this.extCss || []);          // after the first paint, so a slow server cannot hold it up
                    bad = [...d.querySelectorAll('link[rel~="stylesheet"]:not([data-ext])')].some(l => !l.sheet)
                        || [...d.images].some(i => i.complete && !i.naturalWidth && i.getAttribute('src') && !/\.svg(\?|$)/i.test(i.src));
                    if (!bad) frame._tries = 0;
                } else if (d && d.URL !== 'about:srcdoc') { frame._watch = setTimeout(check, 8000); return; }     // the blank document that precedes srcdoc: the real load follows
            } catch (e) { bad = true; }
            if (!bad) return;
            const n = frame._tries = (frame._tries || 0) + 1;
            if (n > 4) return;
            frame._watch = setTimeout(() => { if (frame.isConnected && this.items.get(it._slide) === it) this._tryThumb(it, true, true); }, 400 * n * n);
        };
        if (!frame._hooked) { frame._hooked = true; frame.addEventListener('load', check); }
        frame._watch = setTimeout(check, 8000);
    }

    _sizeFrame(frame) {
        const w = this.deck.stageW, h = this.deck.stageH, k = this.thumbW / w;
        frame.style.width = w + 'px';
        frame.style.height = h + 'px';
        frame.style.transform = `scale(${k})`;
    }
    _resizeThumbs() {
        const first = this.list.querySelector('.thumb');
        if (!first) return;
        const w = first.clientWidth;
        if (!w || w === this.thumbW) return;
        this.thumbW = w;
        this.list.querySelectorAll('.thumb-frame').forEach(f => this._sizeFrame(f));
    }

    /* Refresh the current slide's thumbnail shortly after the last change. */
    _onMutate(records) {
        const structural = records.some(r => r.type === 'childList' && r.target === this.deck.stage && Array.from(r.addedNodes).concat(Array.from(r.removedNodes)).some(n => n.classList && n.classList.contains('slide')));
        // A change in the master layer (outside every slide) shows in every thumbnail.
        const inSlide = (n) => n.closest ? n.closest('.slide') : (n.parentElement && n.parentElement.closest('.slide'));
        // Slides other than the current one change too (undo, redo, a paste elsewhere): remember which, so
        // their thumbnails are redrawn rather than left showing the old picture. Navigation only toggles classes.
        if (!this._dirty) this._dirty = new Set();
        for (const r of records) {
            if (!r.target) continue;
            const sl = inSlide(r.target);
            if (sl && !(r.type === 'attributes' && r.attributeName === 'class')) this._dirty.add(sl);
        }
        if (structural) this.syncStructure();
        else if (records.some(r => r.target && r.target !== this.deck.stage && !inSlide(r.target))) this._refreshAllPending = true;
        clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => {
            const dirty = this._dirty; this._dirty = new Set();
            if (this._refreshAllPending || dirty.size > 8) { this._refreshAllPending = false; this.refreshAll(); return; }
            this.refreshCurrent();
            for (const sl of dirty) if (sl !== this.deck.currentSlide) { const it = this.items.get(sl); if (it && it.querySelector('iframe')) this._tryThumb(it, true); }
        }, 400);
    }
    refreshCurrent() {
        const slide = this.deck.currentSlide;
        const it = this.items.get(slide);
        if (it && it.querySelector('iframe')) this._tryThumb(it, true);
    }
    refreshAll() {
        for (const it of this.itemList()) if (it.querySelector('iframe')) this._tryThumb(it, true);
    }

    /* After add/delete/reorder: make the strip match the stage's slide order, keeping existing thumbs. */
    syncStructure() {
        const slides = this.deck.slides;
        const seen = new Set();
        const want = slides.map(slide => { seen.add(slide); return this.items.get(slide) || this._item(slide); });
        for (const [slide, it] of this.items) if (!seen.has(slide)) { it.remove(); this.observer.unobserve(it); this.items.delete(slide); }
        // Moving an item takes its frame out of the document and puts it back, which reloads the
        // thumbnail. Leave in place the longest run of items that is already in order and move only the
        // others: sending one slide to the end must not reload every thumbnail between (a burst of
        // requests, and blanks while they load).
        const at = new Map(this.itemList().map((it, i) => [it, i]));
        const pos = want.map(it => at.has(it) ? at.get(it) : -1);
        const tails = [], prevIdx = new Array(pos.length).fill(-1);       // longest increasing run of pos, patience style
        pos.forEach((p, i) => {
            if (p < 0) return;
            let lo = 0, hi = tails.length;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (pos[tails[mid]] < p) lo = mid + 1; else hi = mid; }
            if (lo) prevIdx[i] = tails[lo - 1];
            tails[lo] = i;
        });
        const stay = new Set();
        for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prevIdx[i]) stay.add(i);
        let moved = false, next = null;
        for (let i = want.length - 1; i >= 0; i--) {
            if (!stay.has(i)) { this.list.insertBefore(want[i], next); moved = true; }
            next = want[i];
        }
        if (moved) this._sectionsSig = null;            // the headers are laid out again around the moved items
        this.renumber();
        this._fillSoon();
        this.highlight();
        this.dispatchEvent(new CustomEvent('structure'));
    }

    /* Strip items in order (section headers are not items). */
    itemList() { return Array.from(this.list.querySelectorAll(':scope > .strip-item')); }

    renumber() {
        this.itemList().forEach((it, i) => {
            it.querySelector('.n').textContent = i + 1;
            it.classList.toggle('skipped', it._slide.hasAttribute('data-skip'));
        });
        this._sections();
    }

    /* Section headers: a slide with data-section starts one. Clicking a header folds the
       slides up to the next header (in the strip only; nothing in the deck changes). */
    _sections() {
        // Rebuild only when something about the sections changed (a rebuild mid-click would swallow the click).
        const sig = this.itemList().map(it => (it._slide.getAttribute('data-section') || '') + (it.classList.contains('current') ? '*' : '')).join('|') + '#' + [...this.collapsed].join('|');
        if (sig === this._sectionsSig) return;
        this._sectionsSig = sig;
        this.list.querySelectorAll(':scope > .strip-section').forEach(h => h.remove());
        let current = null, header = null, count = 0;
        for (const it of this.itemList()) {
            const name = it._slide.getAttribute('data-section');
            if (name) {
                current = name; count = 0;
                header = document.createElement('div');
                header.className = 'strip-section' + (this.collapsed.has(name) ? ' folded' : '');
                header.innerHTML = `<span class="chev">&#9662;</span><span class="name"></span><span class="count"></span>`;
                header.querySelector('.name').textContent = name;
                header.title = 'Click to fold or unfold this section';
                header.addEventListener('click', () => { if (this.collapsed.has(name)) this.collapsed.delete(name); else this.collapsed.add(name); this._sections(); });
                this.list.insertBefore(header, it);
            }
            it.hidden = !!(current && this.collapsed.has(current)) && !it.classList.contains('current');
            if (header) header.querySelector('.count').textContent = ++count;
        }
    }
    highlight() {
        const cur = this.deck.currentSlide;
        for (const [slide, it] of this.items) { it.classList.toggle('current', slide === cur); it.classList.toggle('picked', this.sel.size > 0 && this.sel.has(slide)); }
        if (this.collapsed.size) this._sections();          // the current slide stays visible inside a folded section
        const c = this.items.get(cur);
        if (c) c.scrollIntoView({ block: 'nearest' });
    }
    indexOf(it) { return this.itemList().indexOf(it); }

    /* ------------------------------------------------------------
       Slide operations (all through history)
       ------------------------------------------------------------ */
    _notifyDeck() {
        // Decks that cache their slide list can listen for this and re-read it.
        this.deck.doc.dispatchEvent(new this.deck.win.CustomEvent('deck:slides-changed', { detail: this.deck.slides.length }));
    }

    /* A new slide after `after`, built from a layout (layouts.js); 'blank' by default. */
    addSlide(after = this.deck.current, layoutId = 'blank') {
        if (!this.deck.isOpen) return;
        const slides = this.deck.slides;
        const layout = layoutById(layoutId);
        const section = buildSlide(this.deck.doc, layout, this.app.insert.defaults(), { w: this.deck.stageW, h: this.deck.stageH });
        const ref = slides[after] ? slides[after].nextSibling : null;
        this.history.begin('Add slide');
        this.history.insert(section, this.deck.stage, ref, 'Add slide');
        applyTypeFallback(section, this.history);          // once it is in the deck, so its CSS can be measured
        this.history.end();
        this._notifyDeck();
        this.deck.goTo(after + 1);
        try { localStorage.setItem(LAST_LAYOUT_KEY, layout.id); } catch (e) { /* ignore */ }
        this.app.toast(layout.id === 'blank' ? 'Blank slide added' : `Slide added: ${layout.label}`);
        return section;
    }

    /* ------------------------------------------------------------
       Layout picker: a grid of sketches; click or Enter adds the
       slide after `after`, Esc closes, arrows move.
       ------------------------------------------------------------ */
    showLayoutPicker(after = this.deck.current, anchor = this.addButton) {
        if (!this.deck.isOpen) return;
        this.closeLayoutPicker();
        let last = 'blank';
        try { last = localStorage.getItem(LAST_LAYOUT_KEY) || 'blank'; } catch (e) { /* ignore */ }
        const pick = document.createElement('div');
        pick.className = 'layout-picker';
        pick.setAttribute('role', 'dialog'); pick.setAttribute('aria-modal', 'true'); pick.setAttribute('aria-label', 'New slide layouts');
        pick.setAttribute('role', 'dialog');
        pick.innerHTML = `<div class="layout-head">New slide after ${after + 1} <span class="insp-hint">Enter adds, Esc closes</span></div><div class="layout-grid">` +
            LAYOUTS.map(l => `<button class="layout-tile${l.id === last ? ' on' : ''}" data-layout="${l.id}" title="${l.label}">${sketchHtml(l)}<span>${l.label}</span></button>`).join('') + '</div>';
        const r = anchor.getBoundingClientRect();
        pick.style.left = Math.min(r.left, innerWidth - 440) + 'px';
        pick.style.top = Math.min(r.bottom + 6, innerHeight - 420) + 'px';
        document.body.appendChild(pick);
        this.picker = pick;
        const tiles = Array.from(pick.querySelectorAll('.layout-tile'));
        const choose = (id) => { this.closeLayoutPicker(); this.addSlide(after, id); };
        pick.addEventListener('click', (e) => { const t = e.target.closest('.layout-tile'); if (t) choose(t.dataset.layout); });
        pick.addEventListener('keydown', (e) => {
            const i = tiles.indexOf(document.activeElement);
            const cols = 3;
            let j = null;
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeLayoutPicker(); return; }
            if (e.key === 'ArrowRight') j = Math.min(tiles.length - 1, Math.max(0, i) + 1);
            if (e.key === 'ArrowLeft') j = Math.max(0, i - 1);
            if (e.key === 'ArrowDown') j = Math.min(tiles.length - 1, Math.max(0, i) + cols);
            if (e.key === 'ArrowUp') j = Math.max(0, i - cols);
            if (j !== null) { e.preventDefault(); e.stopPropagation(); tiles[j].focus(); }
        });
        (tiles.find(t => t.classList.contains('on')) || tiles[0]).focus();
    }
    closeLayoutPicker() {
        if (this.picker) { this.picker.remove(); this.picker = null; }
    }

    duplicateSlide(index = this.deck.current) {
        const slides = this.deck.slides;
        const src = slides[index]; if (!src) return;
        const clone = cleanSlideClone(src.cloneNode(true));                       // charts belong to the deck's script
        clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));      // ids must stay unique
        this.history.insert(clone, this.deck.stage, src.nextSibling, 'Duplicate slide');
        this._notifyDeck();
        this.deck.goTo(index + 1);
    }

    deleteSlide(index = this.deck.current) {
        const s = this.deck.slides[index]; if (!s) return;
        this.deleteSlides([s], 'Delete slide');
    }

    /* The slides picked in the strip, in deck order; the current slide when none is picked. */
    selectedSlides() {
        const all = this.deck.slides;
        const picked = all.filter(s => this.sel.has(s));
        if (picked.length) return picked;
        const cur = this.deck.currentSlide;
        return cur ? [cur] : [];
    }
    setSelection(slides) {
        this.sel = new Set(slides.length > 1 ? slides : []);       // one slide is just the current one
        this.highlight();
    }
    /* The strip, not the canvas, is what keys act on: it was the last thing clicked, and no
       element is picked on the canvas or being typed into. */
    isContext() {
        return this.ctx && this.deck.isOpen && !this.app.preview && !this.app.textEdit.active && !this.app.selection.items.length;
    }
    deleteSelected() {
        const slides = this.selectedSlides();
        if (!slides.length) return false;
        this.deleteSlides(slides, slides.length === 1 ? 'Delete slide' : 'Delete slides');
        return true;
    }

    /* Delete slides as one undo step; a deck keeps at least one. The slide that takes the
       current place is the one that followed the first deleted (the last, if none did). */
    deleteSlides(list, label = 'Delete slides') {
        const slides = this.deck.slides;
        const doomed = slides.filter(s => list.includes(s));
        if (!doomed.length) return;
        if (doomed.length >= slides.length) { this.app.toast('A deck needs at least one slide'); return; }
        const first = slides.indexOf(doomed[0]);
        const wasCurrent = doomed.includes(this.deck.currentSlide);
        this.history.begin(label);
        for (const s of doomed) this.history.remove(s, label);
        this.history.end();
        this.sel.clear();
        this._notifyDeck();
        if (wasCurrent) this.deck._forceSlide(Math.min(first, this.deck.slides.length - 1));
        else this.highlight();
    }

    _pick(index, range) {
        const slides = this.deck.slides, s = slides[index]; if (!s) return;
        if (range) {
            const a = this._anchor != null && slides[this._anchor] ? this._anchor : this.deck.current;
            const [lo, hi] = a < index ? [a, index] : [index, a];
            this.sel = new Set(slides.slice(lo, hi + 1));
        } else {
            if (!this.sel.size && this.deck.currentSlide) this.sel.add(this.deck.currentSlide);
            if (this.sel.has(s)) this.sel.delete(s); else this.sel.add(s);
            this._anchor = index;
            if (this.sel.size === 1 && this.sel.has(this.deck.currentSlide)) this.sel.clear();
        }
        this.highlight();
    }

    moveSlide(from, to) {
        const slides = this.deck.slides;
        if (from === to || !slides[from] || to < 0 || to >= slides.length) return;
        const s = slides[from];
        const ref = to > from ? slides[to].nextSibling : slides[to];
        this.history.move(s, this.deck.stage, ref, 'Move slide');
        this._notifyDeck();
        this.highlight();
    }

    toggleSkip(index = this.deck.current) {
        const s = this.deck.slides[index]; if (!s) return;
        this.history.attr(s, 'data-skip', s.hasAttribute('data-skip') ? null : '1', 'Skip slide');
        this.renumber();
    }

    /* ------------------------------------------------------------
       Context menu
       ------------------------------------------------------------ */
    _menu(it, x, y) {
        this._closeMenu();
        const i = this.indexOf(it), n = this.itemList().length;
        const picked = this.selectedSlides().length;
        const skipped = it._slide.hasAttribute('data-skip');
        const menu = document.createElement('div');
        menu.className = 'strip-menu';
        menu.innerHTML = `
            <button data-a="new">New slide after this...</button>
            <button data-a="dup">Duplicate</button>
            <button data-a="del" ${n <= picked ? 'disabled' : ''}>${picked > 1 ? `Delete ${picked} slides` : 'Delete'}</button>
            <hr>
            <button data-a="copy">${picked > 1 ? `Copy ${picked} slides` : 'Copy slide'}</button>
            <button data-a="cut" ${n <= picked ? 'disabled' : ''}>${picked > 1 ? `Cut ${picked} slides` : 'Cut slide'}</button>
            <button data-a="paste">Paste slides after this</button>
            <hr>
            <button data-a="up" ${i === 0 ? 'disabled' : ''}>Move up</button>
            <button data-a="down" ${i === n - 1 ? 'disabled' : ''}>Move down</button>
            <button data-a="top" ${i === 0 ? 'disabled' : ''}>Move to top</button>
            <button data-a="bottom" ${i === n - 1 ? 'disabled' : ''}>Move to bottom</button>
            <hr>
            <button data-a="skip">${skipped ? 'Include in presentation' : 'Skip in presentation'}</button>
            <hr>
            <button data-a="section">${it._slide.hasAttribute('data-section') ? 'Rename section...' : 'Start a section here...'}</button>
            ${it._slide.hasAttribute('data-section') ? '<button data-a="unsection">Remove section</button>' : ''}`;
        menu.style.left = Math.min(x, innerWidth - 200) + 'px';
        menu.style.top = Math.min(y, innerHeight - 340) + 'px';
        document.body.appendChild(menu);
        menu.addEventListener('click', (e) => {
            const a = e.target.closest('[data-a]'); if (!a) return;
            this._closeMenu();
            switch (a.dataset.a) {
                case 'new': this.showLayoutPicker(i, it); break;
                case 'dup': this.duplicateSlide(i); break;
                case 'del': this.deleteSelected(); break;
                case 'copy': this.clip.copy(); break;
                case 'cut': this.clip.cut(); break;
                case 'paste': this.clip.pasteFromMenu(); break;
                case 'up': this.moveSlide(i, i - 1); break;
                case 'down': this.moveSlide(i, i + 1); break;
                case 'top': this.moveSlide(i, 0); break;
                case 'bottom': this.moveSlide(i, n - 1); break;
                case 'skip': this.toggleSkip(i); break;
                case 'section': { const name = prompt('Section name:', it._slide.getAttribute('data-section') || ''); if (name === null) break; this.history.attr(it._slide, 'data-section', name.trim() || null, name.trim() ? 'Start section' : 'Remove section'); this.syncStructure(); this.app.inspector.sync(); break; }
                case 'unsection': this.history.attr(it._slide, 'data-section', null, 'Remove section'); this.syncStructure(); this.app.inspector.sync(); break;
            }
        });
    }
    _closeMenu() { document.querySelectorAll('.strip-menu').forEach(m => m.remove()); }

    /* ------------------------------------------------------------
       Reorder by dragging a thumbnail
       ------------------------------------------------------------ */
    _bindDrag() {
        let drag = null;
        this.list.addEventListener('pointerdown', (e) => {
            const it = e.target.closest('.strip-item');
            if (!it || e.button !== 0) return;
            drag = { it, from: this.indexOf(it), y0: e.clientY, moved: false, to: null };
            this.list.setPointerCapture(e.pointerId);
        });
        this.list.addEventListener('pointermove', (e) => {
            if (!drag) return;
            if (!drag.moved && Math.abs(e.clientY - drag.y0) < 6) return;
            drag.moved = true;
            drag.it.classList.add('dragging');
            // Insertion point: before the first item whose middle is below the pointer.
            const items = this.itemList();
            let to = items.length;
            for (let i = 0; i < items.length; i++) {
                const r = items[i].getBoundingClientRect();
                if (e.clientY < r.top + r.height / 2) { to = i; break; }
            }
            drag.to = to;
            items.forEach((x, i) => { x.classList.toggle('drop-before', i === to); x.classList.toggle('drop-after', to === items.length && i === items.length - 1); });
        });
        const end = (e) => {
            if (!drag) return;
            const d = drag; drag = null;
            try { this.list.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            this.list.querySelectorAll('.dragging, .drop-before, .drop-after').forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-after'));
            if (!d.moved) {
                // Ctrl / Cmd toggles a slide in the picked ones, Shift picks the run from the current slide.
                if (e.ctrlKey || e.metaKey || e.shiftKey) { this._pick(d.from, e.shiftKey); return; }
                this.sel.clear(); this.highlight();
                this.deck.goTo(d.from); return;                   // a plain press: go to that slide
            }
            if (d.to === null) return;
            let to = d.to;
            if (to > d.from) to -= 1;
            if (to !== d.from) this.moveSlide(d.from, to);
        };
        this.list.addEventListener('pointerup', end);
        this.list.addEventListener('pointercancel', end);
    }
}
