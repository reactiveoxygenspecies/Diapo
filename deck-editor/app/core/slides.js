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
        this._bind();
    }

    /* ------------------------------------------------------------
       Building
       ------------------------------------------------------------ */
    _bind() {
        this.deck.addEventListener('ready', () => this.rebuild());
        this.deck.addEventListener('slide', () => this.highlight());
        this.deck.addEventListener('mutate', (e) => this._onMutate(e.detail));
        this.addButton.addEventListener('click', () => this.showLayoutPicker());
        new ResizeObserver(() => this._resizeThumbs()).observe(this.list);

        // Navigation happens on pointerup in _bindDrag(): the drag code takes pointer
        // capture on the list, which makes click events land on the list, not the item.
        this.list.addEventListener('contextmenu', (e) => {
            const it = e.target.closest('.strip-item'); if (!it) return;
            e.preventDefault();
            this.deck.goTo(this.indexOf(it));
            this._menu(it, e.clientX, e.clientY);
        });
        this._bindDrag();
        document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.strip-menu')) this._closeMenu(); }, true);
        document.addEventListener('pointerdown', (e) => { if (this.picker && !e.target.closest('.layout-picker') && e.target !== this.addButton) this.closeLayoutPicker(); }, true);
    }

    /* The deck's head, cleaned for thumbnails, computed once per open. */
    _head() {
        if (this.headHtml) return this.headHtml;
        const src = this.deck.source || '';
        const m = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(src);
        let head = m ? m[1] : '';
        head = head.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<title>[\s\S]*?<\/title>/gi, '')
            .replace(/<style id="deck-editor-(fonts|overrides)">[\s\S]*?<\/style>/gi, '');   // the live blocks are added per thumbnail
        const dir = this.deck.file.includes('/') ? this.deck.file.slice(0, this.deck.file.lastIndexOf('/') + 1) : '';
        // Absolute, and the addresses in the markup too (absoluteUrls).
        this.baseHref = `${location.origin}/deck/${dir.split('/').map(encodeURIComponent).join('/')}`;
        const t = document.createElement('template'); t.innerHTML = head;
        absoluteUrls(t.content, this.baseHref);
        head = t.innerHTML;
        this.headHtml = `<base href="${this.baseHref}">` + head + `<style>${THUMB_CSS}</style>`;
        return this.headHtml;
    }

    rebuild() {
        this.headHtml = '';
        this.items = new Map();
        this.list.innerHTML = '';
        if (this.observer) this.observer.disconnect();
        this.observer = new IntersectionObserver((entries) => {
            for (const en of entries) if (en.isIntersecting) this._ensureThumb(en.target);
        }, { root: this.list, rootMargin: '200px 0px' });
        if (!this.deck.isOpen) return;
        for (const slide of this.deck.slides) this.list.appendChild(this._item(slide));
        this._resizeThumbs();
        this.highlight();
        this.renumber();
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
    _ensureThumb(it, force = false) {
        const thumb = it.querySelector('.thumb');
        let frame = thumb.querySelector('iframe');
        if (frame && !force) return;
        const slide = it._slide;
        if (!slide || !this.deck.doc.contains(slide)) return;
        const clone = slide.cloneNode(true);
        clone.classList.add('active', 'visible');
        clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
        const live = ['deck-editor-fonts', 'deck-editor-overrides'].map(id => { const st = this.deck.doc.getElementById(id); return st ? st.outerHTML : ''; }).join('');
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
            frame.srcdoc = html;
        } else if (frame.contentDocument && frame.contentDocument.querySelector('.deck-stage')) {
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
        }
        it.querySelector('.thumb-label').textContent = this.deck.slideLabel(slide);
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
        if (structural) { this.syncStructure(); return; }
        // A change in the master layer (outside every slide) shows in every thumbnail.
        const inSlide = (n) => n.closest ? n.closest('.slide') : (n.parentElement && n.parentElement.closest('.slide'));
        const t = records.some(r => r.target && r.target !== this.deck.stage && !inSlide(r.target));
        if (t) this._refreshAllPending = true;
        clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => { if (this._refreshAllPending) { this._refreshAllPending = false; this.refreshAll(); } else this.refreshCurrent(); }, 400);
    }
    refreshCurrent() {
        const slide = this.deck.currentSlide;
        const it = this.items.get(slide);
        if (it && it.querySelector('iframe')) this._ensureThumb(it, true);
    }
    refreshAll() {
        for (const it of this.itemList()) if (it.querySelector('iframe')) this._ensureThumb(it, true);
    }

    /* After add/delete/reorder: make the strip match the stage's slide order, keeping existing thumbs. */
    syncStructure() {
        const slides = this.deck.slides;
        const seen = new Set();
        let prev = null;
        for (const slide of slides) {
            let it = this.items.get(slide);
            if (!it) it = this._item(slide);
            seen.add(slide);
            const want = prev ? prev.nextSibling : this.list.firstChild;
            if (it !== want) this.list.insertBefore(it, want);
            prev = it;
        }
        for (const [slide, it] of this.items) if (!seen.has(slide)) { it.remove(); this.observer.unobserve(it); this.items.delete(slide); }
        this.renumber();
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
        for (const [slide, it] of this.items) it.classList.toggle('current', slide === cur);
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
        const clone = src.cloneNode(true);
        clone.classList.remove('active', 'visible');
        clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
        clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));      // ids must stay unique
        clone.querySelectorAll('[data-fig]').forEach(h => {                       // charts belong to the deck's script
            h.innerHTML = '';
            if (h.dataset.edClass != null) { h.className = h.dataset.edClass; delete h.dataset.edClass; }
            else h.classList.remove('js-plotly-plot', 'plotly-graph-div');
        });
        this.history.insert(clone, this.deck.stage, src.nextSibling, 'Duplicate slide');
        this._notifyDeck();
        this.deck.goTo(index + 1);
    }

    deleteSlide(index = this.deck.current) {
        const slides = this.deck.slides;
        if (slides.length <= 1) { this.app.toast('A deck needs at least one slide'); return; }
        const s = slides[index]; if (!s) return;
        const wasCurrent = index === this.deck.current;
        this.history.remove(s, 'Delete slide');
        this._notifyDeck();
        if (wasCurrent) {
            const next = Math.min(index, this.deck.slides.length - 1);
            this.deck._forceSlide(next);
        }
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
        const skipped = it._slide.hasAttribute('data-skip');
        const menu = document.createElement('div');
        menu.className = 'strip-menu';
        menu.innerHTML = `
            <button data-a="new">New slide after this...</button>
            <button data-a="dup">Duplicate</button>
            <button data-a="del" ${n <= 1 ? 'disabled' : ''}>Delete</button>
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
        menu.style.top = Math.min(y, innerHeight - 260) + 'px';
        document.body.appendChild(menu);
        menu.addEventListener('click', (e) => {
            const a = e.target.closest('[data-a]'); if (!a) return;
            this._closeMenu();
            switch (a.dataset.a) {
                case 'new': this.showLayoutPicker(i, it); break;
                case 'dup': this.duplicateSlide(i); break;
                case 'del': this.deleteSlide(i); break;
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
            if (!d.moved) { this.deck.goTo(d.from); return; }     // a plain press: go to that slide
            if (d.to === null) return;
            let to = d.to;
            if (to > d.from) to -= 1;
            if (to !== d.from) this.moveSlide(d.from, to);
        };
        this.list.addEventListener('pointerup', end);
        this.list.addEventListener('pointercancel', end);
    }
}
