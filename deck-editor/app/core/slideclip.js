/* ============================================================
   slideclip.js - copy / cut / paste of whole slides from the
   slide strip, within a deck and between decks.

   A copy puts the slides' markup on the system clipboard as
   text/html inside a wrapper carrying SLIDE_MARK (so a paste in
   another browser tab or window gets it too), and keeps the same
   payload in memory and in localStorage: the memory copy serves
   an editor that has no clipboard access, and survives the deck
   being swapped for another one in the same page (the Decks
   drawer, an in-app tab), the localStorage copy a second tab.

   A paste into another deck has to make the slides stand on their
   own there:
   - Pictures, videos, poster images and url(...) backgrounds with
     a relative address were relative to the source deck's folder.
     When the folders differ, each file is fetched from the source
     deck and uploaded into the target deck's assets/ (the same
     /api/upload a dropped picture uses), so the pasted slides
     keep working when either deck is moved or the other deleted.
     A file the upload refuses (a type it does not take) or that
     cannot be fetched is instead addressed relative to the target
     deck's folder, which works as long as both stay where they are.
   - Per-element CSS (data-css) and animation presets (data-anim)
     live on the elements as attributes and travel with them; the
     deck's style blocks are rebuilt from them on save. Only the
     element identity (data-id) needs care: a pasted element that
     takes the id of an unrelated element with CSS of its own
     would share its rules, so it is given a fresh one, the same
     for every element of the pasted slides that shared it (the
     morph links between them survive).
   - id attributes that the target deck already uses are renamed,
     with the references to them in the pasted slides.
   Pasting into the deck the slides came from is a duplicate:
   data-id stays, so a morph between the original and the copy
   works, as it does for Duplicate.
   ============================================================ */
import { uniqueId } from './dom.js';

export const SLIDE_MARK = 'data-deck-editor-slides';
const STORE_KEY = 'deck-editor-slide-clip';
/* Kept for the life of the page, across decks opened in it. */
let memory = null;

const ATTRS = [['img, source, video, audio, track, embed, input', 'src'], ['video', 'poster'], ['object', 'data'], ['image, use, feImage', 'href'], ['image, use, feImage', 'xlink:href'], ['a', 'href']];
const RELATIVE = (v) => !!v && !/^([a-z][a-z0-9+.-]*:|\/|#|\?)/i.test(v.trim());
const dirOf = (file) => (file && file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
const deckBase = (dir) => location.origin + '/deck/' + (dir ? dir.split('/').map(encodeURIComponent).join('/') + '/' : '');

/* A slide copied for the clipboard or a duplicate: editor residue off, charts that belong to the
   deck's script emptied (the script draws them again). */
export function cleanSlideClone(clone) {
    clone.classList.remove('active', 'visible');
    clone.removeAttribute('contenteditable');
    clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
    clone.querySelectorAll('[spellcheck]').forEach(n => n.removeAttribute('spellcheck'));
    clone.querySelectorAll('[data-fig]').forEach(h => {
        h.innerHTML = '';
        if (h.dataset.edClass != null) { h.className = h.dataset.edClass; delete h.dataset.edClass; }
        else h.classList.remove('js-plotly-plot', 'plotly-graph-div');
    });
    return clone;
}

/* Every address in `root` that is relative, as { get, set } pairs (attributes, srcset entries,
   url(...) in style attributes and <style> text). */
function relativeRefs(root) {
    const refs = [];
    const nodes = (sel) => [...(root.matches && root.matches(sel) ? [root] : []), ...root.querySelectorAll(sel)];
    for (const [sel, attr] of ATTRS) {
        if (attr === 'href' && sel === 'a') continue;                      // links go where they go: not assets
        for (const n of nodes(sel)) {
            const v = n.getAttribute(attr);
            if (RELATIVE(v)) refs.push({ value: v.trim(), set: (nv) => n.setAttribute(attr, nv) });
        }
    }
    for (const n of nodes('img[srcset], source[srcset]')) {
        const parts = n.getAttribute('srcset').split(',').map(p => p.trim()).filter(Boolean).map(p => { const [u, ...d] = p.split(/\s+/); return { u, d }; });
        parts.forEach(p => { if (RELATIVE(p.u)) refs.push({ value: p.u, set: (nv) => { p.u = nv; n.setAttribute('srcset', parts.map(x => [x.u, ...x.d].join(' ')).join(', ')); } }); });
    }
    const inCss = (text, write) => {
        const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
        let m, out = text, found = false;
        const hits = [];
        while ((m = re.exec(text))) if (RELATIVE(m[2])) hits.push(m[2].trim());
        for (const v of new Set(hits)) {
            found = true;
            refs.push({ value: v, set: (nv) => { out = out.split(v).join(nv); write(out); } });
        }
        return found;
    };
    for (const n of nodes('[style*="url("]')) inCss(n.getAttribute('style'), (t) => n.setAttribute('style', t));
    for (const n of nodes('style')) inCss(n.textContent, (t) => { n.textContent = t; });
    return refs;
}

/* `target` as a path relative to the folder `fromBase` (both absolute, encoded, ending in a slash for folders). */
function relativeTo(fromBase, target) {
    const a = new URL(fromBase).pathname.split('/').filter(Boolean), b = new URL(target).pathname.split('/').filter(Boolean);
    let i = 0;
    while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
    return '../'.repeat(a.length - i) + b.slice(i).join('/');
}

export class SlideClip {
    constructor(strip) {
        this.strip = strip;
        this.app = strip.app;
        this.deck = strip.deck;
        this.history = strip.history;
    }

    /* ------------------------------------------------------------
       Copy
       ------------------------------------------------------------ */
    payload(slides) {
        const box = document.createElement('div');
        box.setAttribute(SLIDE_MARK, '1');
        box.setAttribute('data-dir', dirOf(this.deck.file));
        for (const s of slides) {
            const c = cleanSlideClone(s.cloneNode(true));
            // The page counter text and the like are the deck's: only the slide itself is carried.
            box.appendChild(c);
        }
        const text = slides.map(s => this.deck.slideLabel(s)).join('\n');
        return { html: box.outerHTML, text, count: slides.length };
    }

    copy(slides = this.strip.selectedSlides()) {
        if (!slides.length) return false;
        const p = this.payload(slides);
        memory = p;
        try { localStorage.setItem(STORE_KEY, JSON.stringify({ html: p.html, text: p.text, count: p.count })); } catch (e) { /* too big, or storage off */ }
        this.app.editops.writeClipboard(p.html, p.text);
        this.app.toast(slides.length === 1 ? 'Slide copied' : `${slides.length} slides copied`, { ms: 1400 });
        return true;
    }

    cut(slides = this.strip.selectedSlides()) {
        if (!slides.length) return false;
        if (slides.length >= this.deck.slides.length) { this.app.toast('A deck needs at least one slide'); return false; }
        this.copy(slides);
        this.strip.deleteSlides(slides, 'Cut slides');
        return true;
    }

    /* ------------------------------------------------------------
       Paste
       ------------------------------------------------------------ */
    stored() {
        if (memory) return memory.html;
        try { const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); if (v && v.html) return v.html; } catch (e) { /* ignore */ }
        return '';
    }

    /* From the browser's paste event. Returns true when the event was ours (slides on the
       clipboard, or the strip is the active context and the clipboard holds nothing else). */
    onPaste(e) {
        const data = e.clipboardData;
        const html = data ? data.getData('text/html') : '';
        if (html && html.includes(SLIDE_MARK)) { this.paste(html); return true; }
        if (!this.strip.isContext()) return false;
        const other = html || (data && ((data.getData('text/plain') || '').trim() || (data.files && data.files.length)));
        if (other) return false;                         // something else was copied since: the canvas paste decides
        const mem = this.stored();
        if (!mem) return false;
        this.paste(mem);
        return true;
    }

    /* Paste from a menu: the system clipboard where the browser lets us read it, else the last copy. */
    async pasteFromMenu() {
        let html = '';
        try {
            for (const it of await navigator.clipboard.read()) {
                if (it.types.includes('text/html')) html = await (await it.getType('text/html')).text();
            }
        } catch (e) { /* no permission: the memory copy */ }
        if (!html.includes(SLIDE_MARK)) html = this.stored();
        if (!html) { this.app.toast('Copy a slide first'); return false; }
        return this.paste(html);
    }

    async paste(html, after = null) {
        if (!this.deck.isOpen || this._busy) return false;
        const box = new DOMParser().parseFromString(html, 'text/html').querySelector(`[${SLIDE_MARK}]`);
        if (!box) return false;
        const pasted = Array.from(box.children).filter(n => n.classList && n.classList.contains('slide'));
        if (!pasted.length) return false;
        this._busy = true;
        try {
            const srcDir = box.getAttribute('data-dir') || '';
            const tgtDir = dirOf(this.deck.file);
            // Where they go: after the last selected slide (the current one without a selection).
            const sel = after ? [after] : this.strip.selectedSlides();
            const anchor = sel[sel.length - 1] || this.deck.currentSlide;
            if (srcDir !== tgtDir) await this._carryAssets(pasted, srcDir, tgtDir);
            const doc = this.deck.doc;
            const nodes = pasted.map(s => doc.importNode(s, true));
            this._unclash(nodes);
            const ref = anchor ? anchor.nextSibling : null;
            const at = anchor ? this.deck.slides.indexOf(anchor) + 1 : this.deck.slides.length;
            this.history.begin(nodes.length === 1 ? 'Paste slide' : 'Paste slides');
            for (const n of nodes) this.history.insert(n, this.deck.stage, ref, 'Paste slide');
            this.history.end();
            this.strip._notifyDeck();
            this.strip.setSelection(nodes);
            this.deck.goTo(at);
            this.app.toast(nodes.length === 1 ? 'Slide pasted' : `${nodes.length} slides pasted`, { ms: 1600 });
            return true;
        } catch (err) {
            this.app.toast('Paste failed: ' + err.message, { error: true });
            return false;
        } finally { this._busy = false; }
    }

    /* Make the relative addresses in `slides` (parsed from the clipboard, not yet in the deck)
       resolve from the target deck's folder: upload the files into its assets/, else re-address them. */
    async _carryAssets(slides, srcDir, tgtDir) {
        const srcBase = deckBase(srcDir), tgtBase = deckBase(tgtDir);
        const done = new Map();            // absolute source URL -> address for the target deck
        const carry = async (value) => {
            const m = /^([^?#]*)([?#].*)?$/.exec(value);
            let abs;
            try { abs = new URL(m[1], srcBase); } catch (e) { return value; }
            if (!abs.pathname.startsWith('/deck/')) return value;
            if (!done.has(abs.href)) {
                let rel = null;
                try {
                    const res = await fetch(abs.href);
                    if (res.ok) {
                        const name = decodeURIComponent(abs.pathname.split('/').pop());
                        const blob = await res.blob();
                        const up = await this.app.api.upload(tgtDir, [new File([blob], name, { type: blob.type })]);
                        if (up.files && up.files[0]) rel = up.files[0].split('/').map(encodeURIComponent).join('/');
                    }
                } catch (e) { /* refused or gone: address it in place below */ }
                done.set(abs.href, rel || relativeTo(tgtBase, abs.href));
            }
            return done.get(abs.href) + (m[2] || '');
        };
        for (const s of slides) {
            for (const r of relativeRefs(s)) r.set(await carry(r.value));
        }
    }

    /* Ids that the deck already has are renamed (with the references in the slides); a data-id
       that another element of the deck holds with different CSS of its own gets a fresh one. */
    _unclash(nodes) {
        const doc = this.deck.doc;
        const taken = new Set(Array.from(doc.querySelectorAll('[id]')).map(n => n.id));
        const ids = new Map();
        for (const s of nodes) {
            for (const n of [s, ...s.querySelectorAll('[id]')]) {
                const id = n.getAttribute('id'); if (!id) continue;
                if (taken.has(id) || ids.has(id)) {
                    let k = 2; while (taken.has(id + '-' + k)) k++;
                    ids.set(id, id + '-' + k); taken.add(id + '-' + k);
                    n.setAttribute('id', id + '-' + k);
                    // References to it from inside the same slide.
                    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    for (const r of [s, ...s.querySelectorAll('*')]) for (const a of Array.from(r.attributes)) {
                        if (a.name === 'id') continue;
                        if (/^(href|xlink:href)$/.test(a.name) && a.value === '#' + id) r.setAttribute(a.name, '#' + id + '-' + k);
                        else if (a.name === 'for' && a.value === id) r.setAttribute('for', id + '-' + k);
                        else if (/^(style|fill|stroke|clip-path|mask|filter|marker-start|marker-end|marker-mid)$/.test(a.name)) r.setAttribute(a.name, a.value.replace(new RegExp('url\\(\\s*([\'"]?)#' + esc + '\\1\\s*\\)', 'g'), `url($1#${id}-${k}$1)`));
                        else if (/^aria-(labelledby|describedby|controls)$/.test(a.name)) r.setAttribute(a.name, a.value.split(/\s+/).map(x => x === id ? id + '-' + k : x).join(' '));
                    }
                } else taken.add(id);
            }
        }
        // Element identities for morphing / element CSS.
        const holders = new Map();
        for (const n of doc.querySelectorAll('.deck-stage [data-id]')) holders.set(n.getAttribute('data-id'), (holders.get(n.getAttribute('data-id')) || []).concat(n));
        const remap = new Map();
        for (const s of nodes) for (const n of s.querySelectorAll('[data-id]')) {
            const id = n.getAttribute('data-id');
            const other = holders.get(id);
            if (!other) continue;
            const mine = n.getAttribute('data-css') || '';
            if (!other.some(o => (o.getAttribute('data-css') || '') !== mine)) continue;     // the same look: harmless, and a morph link
            if (!remap.has(id)) remap.set(id, uniqueId(doc) + '-p' + (remap.size + 1));
            n.setAttribute('data-id', remap.get(id));
        }
        // uniqueId counts the deck's elements, so the suffix keeps several remaps of one paste apart.
    }
}
