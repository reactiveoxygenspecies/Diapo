/* ============================================================
   editops.js - copy / cut / paste, delete, group / ungroup and
   layer order for the selection, plus the element context menu.

   Clipboard: a copy puts the selected elements' markup (with a
   marker) on the system clipboard as text/html, and keeps it in
   memory too. A paste comes in through the browser's own paste
   event (which carries the data without any permission prompt):
   our markup is re-inserted on the current slide; image files from
   the clipboard are uploaded and inserted; other text becomes a
   text box. Pasting onto the slide the copy came from offsets the
   copies a little so they do not hide the originals.

   Layer order works with z-index among siblings: front / back go
   past every sibling, forward / backward step past the next one
   in stacking order. Grouping wraps sibling elements in one
   absolutely positioned <div data-group> sized to their common box;
   ungrouping puts the children back with the group's offset added.
   Everything is one undo step.
   ============================================================ */
import { getOffset, setOffset, afterResize } from './transform.js';
import { css, isMaster, MASTER_SELECTOR, ensureUniqueIds, isShape } from './dom.js';

const MARK = 'data-deck-editor-clip';
/* The look copy style carries (the properties the panel's Colour, Text and Box sections set). */
const STYLE_PROPS = ['color', 'background-color', 'background-image', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius', 'box-shadow', 'opacity', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform', 'text-align', 'text-decoration-line'];

export class EditOps {
    constructor(app) {
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.selection = app.selection;
        this.clip = null;          // { html, file, slideIndex, rects } of the last copy made here
        this._bind();
    }

    /* ------------------------------------------------------------
       Clipboard
       ------------------------------------------------------------ */
    _bind() {
        // The copy event fires from execCommand('copy') below and carries our data; the paste
        // event fires from Ctrl+V in whichever document has focus (editor or deck).
        const onCopy = (e) => {
            if (!this.pending) return;
            e.preventDefault();
            e.clipboardData.setData('text/html', this.pending.html);
            e.clipboardData.setData('text/plain', this.pending.text);
            this.pending = null;
        };
        const onPaste = (e) => {
            if (e.defaultPrevented || this.app.textEdit.active || this.app.preview || !this.deck.isOpen) return;
            // A field in the editor's panels (a colour code, a size) takes the paste itself.
            const a = e.target && e.target.ownerDocument ? e.target.ownerDocument.activeElement : null;
            if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
            if (this.paste(e.clipboardData)) e.preventDefault();
        };
        document.addEventListener('copy', onCopy);
        document.addEventListener('paste', onPaste);
        this.deck.addEventListener('ready', () => {
            this.deck.doc.addEventListener('copy', onCopy);
            this.deck.doc.addEventListener('paste', onPaste);
        });
    }

    /* A copy of an element that lands exactly where the original is. An element the deck
       lays out in flow (a heading in a flex column, a list item) cannot simply get a
       sibling: that reflows the original and everything after it. Its copy is therefore
       taken out of the flow: absolutely positioned at the original's rect (relative to
       `container`, the element it will be put into), same width, no margins, the deck's
       move offset folded into left / top. Free (absolutely positioned) elements are
       cloned as they are. Ids and editing residue are dropped. */
    cloneInPlace(el, container = el.parentElement) {
        const c = el.cloneNode(true);
        c.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
        c.removeAttribute('id'); c.removeAttribute('contenteditable'); c.removeAttribute('spellcheck');
        c.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
        const pos = css(el).position;
        if (!/absolute|fixed/.test(pos) || container !== el.parentElement) {
            const r = this.deck.stageRect(el), o = this._origin(container), off = getOffset(el);
            c.style.position = 'absolute';
            c.style.left = round(r.x - o.x) + 'px';
            c.style.top = round(r.y - o.y) + 'px';
            c.style.right = ''; c.style.bottom = ''; c.style.margin = '0';
            if (!c.style.width) c.style.width = round(r.w) + 'px';
            c.style.removeProperty('--dx'); c.style.removeProperty('--dy'); c.style.translate = '';
            if (off.r) setOffset(c, 0, 0, off.r);
        }
        return c;
    }

    /* Markup of the selection, cleaned of editor residue, with a marker so a paste knows it is
       ours. Copies are made relative to the slide, where a paste puts them. */
    _markup(items) {
        const slide = this.deck.currentSlide;
        return `<div ${MARK}="1">${items.map(el => this.cloneInPlace(el, slide).outerHTML).join('')}</div>`;
    }

    copy(items = this.selection.items) {
        if (!items.length) return false;
        const html = this._markup(items);
        const text = items.map(el => (el.textContent || '').trim()).filter(Boolean).join('\n');
        this.clip = { html, text, file: this.deck.file, slideIndex: this.deck.current, pastes: 0 };
        this.pending = { html, text };
        // execCommand('copy') fires the copy event above in the focused document; without focus
        // (or in a browser that refuses), the in-memory copy still serves this editor.
        let ok = false;
        try { ok = (this.deck.doc.hasFocus() ? this.deck.doc : document).execCommand('copy'); } catch (err) { ok = false; }
        if (!ok && navigator.clipboard && navigator.clipboard.write) {
            try {
                navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]).catch(() => {});
            } catch (err) { /* ignore */ }
        }
        this.pending = null;
        this.app.toast(items.length === 1 ? 'Copied' : `Copied ${items.length} elements`, { ms: 1200 });
        return true;
    }

    /* Copy style / paste style: the look of one element (colours, border, corners, shadow,
       opacity, type, padding: what the panel sets, not where it is or how big) carried to others.
       What is copied is the computed look; what is written is only what differs on the target,
       inline, so a paste onto an element that already looks the same changes nothing. */
    copyStyle(el = this.selection.primary) {
        if (!el) return false;
        const cs = css(el), look = {};
        for (const p of STYLE_PROPS) look[p] = cs.getPropertyValue(p);
        this.styleClip = { look, shape: isShape(el) };
        return true;
    }
    pasteStyle(items = this.selection.items) {
        if (!this.styleClip || !items.length) return false;
        const { look } = this.styleClip;
        this.history.begin('Paste style');
        for (const el of items) {
            if (isShape(el)) continue;
            const cs = css(el), changes = [];
            for (const p of STYLE_PROPS) if (cs.getPropertyValue(p) !== look[p]) changes.push([p, look[p]]);
            if (changes.length) this.history.style(el, () => { for (const [p, v] of changes) el.style.setProperty(p, v); }, { label: 'Paste style' });
        }
        this.history.end();
        this.selection.refresh();
        return true;
    }

    cut() {
        if (!this.selection.items.length) return false;
        this.copy();
        this.remove('Cut');
        return true;
    }

    /* Paste from a clipboardData (the paste event) or, without one, from the in-memory copy.
       Returns true when something was pasted. */
    paste(data = null) {
        const slide = this.deck.currentSlide; if (!slide) return false;
        let html = data ? data.getData('text/html') : '';
        if (!html || !html.includes(MARK)) {
            // Not ours: images from the clipboard become uploads, a URL an image or embed, text a text box.
            const files = data ? Array.from(data.files || []).filter(f => /^(image|video)\//.test(f.type)) : [];
            if (files.length) { this.app.insert.upload(files).then(r => this.app.toast(`${r.files.length} file(s) pasted into assets/`)).catch(err => this.app.toast('Paste failed: ' + err.message, { error: true })); return true; }
            const text = data ? (data.getData('text/plain') || '').trim() : '';
            if (text) {
                if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|avif)(\?\S*)?$/i.test(text)) this.app.insert.image(text);
                else if (/^https?:\/\/\S+$/i.test(text) && /youtube\.com|youtu\.be|vimeo\.com/i.test(text)) this.app.insert.embed(text);
                else { const el = this.app.insert.text(text); this.app.textEdit.commit(); this.selection.select(el); }
                return true;
            }
            if (!this.clip) return false;
            html = this.clip.html;                        // the copy event never ran (no focus): use memory
        }
        const box = new DOMParser().parseFromString(html, 'text/html').querySelector(`[${MARK}]`);
        if (!box) return false;
        // Pasting where the copy came from steps the copies aside, a little further each time.
        const sameSlide = this.clip && this.clip.file === this.deck.file && this.clip.slideIndex === this.deck.current && this.clip.html === html;
        const step = sameSlide ? 24 * (++this.clip.pastes) : 0;
        const doc = this.deck.doc, pasted = [];
        this.history.begin('Paste');
        for (const src of Array.from(box.children)) {
            const el = doc.importNode(src, true);
            el.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
            el.removeAttribute('id');
            ensureUniqueIds(el, slide);
            if (step) { const o = getOffset(el); setOffset(el, o.x + step, o.y + step); }
            this.history.insert(el, slide, null, 'Paste');
            pasted.push(el);
        }
        this.history.end();
        this.selection.set(pasted);
        pasted.forEach(afterResize);
        return pasted.length > 0;
    }

    /* Paste started from a menu (no paste event): read the clipboard when the browser
       allows it (Chrome asks once), else paste the last copy made in this editor. */
    async pasteFromMenu() {
        try {
            const items = await navigator.clipboard.read();
            const data = { files: [], types: {} };
            for (const it of items) {
                for (const type of it.types) {
                    const blob = await it.getType(type);
                    if (/^(image|video)\//.test(type)) data.files.push(new File([blob], 'pasted.' + type.split('/')[1].replace('jpeg', 'jpg'), { type }));
                    else if (type === 'text/html' || type === 'text/plain') data.types[type] = await blob.text();
                }
            }
            data.getData = (t) => data.types[t] || '';
            return this.paste(data);
        } catch (err) {
            return this.paste(null);
        }
    }

    /* ------------------------------------------------------------
       Delete (for real; Hide stays available in the panel and the menu)
       ------------------------------------------------------------ */
    remove(label = 'Delete') {
        const items = this.selection.items.slice();
        if (!items.length) return false;
        this.app.textEdit.commit();
        this.history.begin(label);
        for (const el of items) this.history.remove(el, label);
        this.history.end();
        this.selection.clear();
        return true;
    }

    /* ------------------------------------------------------------
       Layer order
       ------------------------------------------------------------ */
    /* Siblings of `el` in stacking order: by effective z-index, then document order. A
       stage-level element of the master layer stacks against the other master elements only:
       the slides are not its peers, and it must never go under the active one. */
    _stack(el) {
        let sibs = Array.from(el.parentElement.children).filter(s => s.nodeType === 1);
        if (isMaster(el) && el.parentElement === this.deck.stage) sibs = sibs.filter(s => s.matches(MASTER_SELECTOR));
        const z = (s) => { const v = parseInt(css(s).zIndex, 10); return isNaN(v) ? 0 : v; };
        return sibs.map((s, i) => ({ el: s, z: z(s), i })).sort((a, b) => a.z - b.z || a.i - b.i);
    }
    layer(how) {
        const items = this.selection.items.slice();
        if (!items.length) return;
        const labels = { front: 'Bring to front', back: 'Send to back', forward: 'Bring forward', backward: 'Send backward' };
        const abs = (el) => /absolute|fixed/.test(css(el).position);
        const setZ = (el, z) => this.history.style(el, () => {
            if (css(el).position === 'static') el.style.position = 'relative';
            el.style.zIndex = String(z);
        }, { label: labels[how] });
        // Going under something at z 0 must not mean a negative z-index: that paints the
        // element behind its parent's background (a card, the slide when it makes no stacking
        // context) and it vanishes. A free element takes the same z and an earlier place in the
        // document instead; equal z among positioned siblings stacks in document order.
        const under = (el, mine, target, before) => {
            if (target.z - 1 >= 0 || !abs(el)) { setZ(el, target.z - 1); return; }
            if (target.z !== mine) setZ(el, target.z);
            this.history.move(el, el.parentElement, before, labels[how]);
        };
        this.history.begin(labels[how]);
        for (const el of items) {
            const stack = this._stack(el);
            const idx = stack.findIndex(s => s.el === el);
            if (idx < 0) continue;
            const mine = stack[idx].z;
            if (how === 'front') {
                if (idx === stack.length - 1) continue;
                const top = stack[stack.length - 1];
                // Equal z among free elements: last in document order is on top, no z-index needed.
                if (top.z === mine && abs(el) && stack.every(s => s.z === mine && abs(s.el))) this.history.move(el, el.parentElement, top.el.nextSibling, labels[how]);
                else setZ(el, Math.max(...stack.map(s => s.z)) + 1);
            } else if (how === 'back') {
                if (idx === 0) continue;
                const bottom = stack[0];
                if (bottom.z === mine && abs(el) && stack.every(s => s.z === mine && abs(s.el))) this.history.move(el, el.parentElement, bottom.el, labels[how]);
                else under(el, mine, bottom, bottom.el);
            } else if (how === 'forward') {
                const next = stack[idx + 1]; if (!next) continue;
                if (next.z === mine && abs(el) && abs(next.el)) this.history.move(el, el.parentElement, next.el.nextSibling, labels[how]);
                else setZ(el, next.z + 1);
            } else if (how === 'backward') {
                const prev = stack[idx - 1]; if (!prev) continue;
                if (prev.z === mine && abs(el) && abs(prev.el)) this.history.move(el, el.parentElement, prev.el, labels[how]);
                else under(el, mine, prev, prev.el);
            }
        }
        this.history.end();
        this.selection.refresh();
    }

    /* ------------------------------------------------------------
       Group / ungroup
       ------------------------------------------------------------ */
    group() {
        const items = this.selection.items.slice();
        if (items.length < 2) { this.app.toast('Select two or more elements to group'); return null; }
        const parent = items[0].parentElement;
        if (items.some(el => el.parentElement !== parent)) { this.app.toast('Elements must sit in the same container to be grouped'); return null; }
        const rects = items.map(el => this.deck.stageRect(el));
        const pr = this._origin(parent);                  // the parent's own place on the stage
        const g = { x: Math.min(...rects.map(r => r.x)), y: Math.min(...rects.map(r => r.y)) };
        g.w = Math.max(...rects.map(r => r.x + r.w)) - g.x;
        g.h = Math.max(...rects.map(r => r.y + r.h)) - g.y;
        const doc = this.deck.doc;
        const wrap = doc.createElement('div');
        wrap.setAttribute('data-group', '');
        wrap.style.cssText = `position:absolute; left:${round(g.x - pr.x)}px; top:${round(g.y - pr.y)}px; width:${round(g.w)}px; height:${round(g.h)}px;`;
        // Keep document order inside the group; the group takes the place of the first member.
        const ordered = Array.from(parent.children).filter(c => items.includes(c));
        this.history.begin('Group');
        this.history.insert(wrap, parent, ordered[0], 'Group');
        ordered.forEach((el, k) => {
            const r = rects[items.indexOf(el)];
            this.history.style(el, () => {
                const o = getOffset(el);
                el.style.position = 'absolute';
                el.style.left = round(r.x - g.x) + 'px';
                el.style.top = round(r.y - g.y) + 'px';
                el.style.right = ''; el.style.bottom = ''; el.style.margin = '0';
                if (!el.style.width && r.w) el.style.width = round(r.w) + 'px';
                setOffset(el, 0, 0, o.r);
            }, { label: 'Group' });
            this.history.move(el, wrap, null, 'Group');
        });
        this.history.end();
        this.selection.select(wrap);
        return wrap;
    }

    /* Stage position of a container's padding box (what absolute children measure from). */
    _origin(container) {
        if (!container || container.classList.contains('slide') || container.classList.contains('deck-stage')) return { x: 0, y: 0 };
        const r = this.deck.stageRect(container), cs = css(container);
        return { x: r.x + (parseFloat(cs.borderLeftWidth) || 0), y: r.y + (parseFloat(cs.borderTopWidth) || 0) };
    }

    ungroup() {
        const groups = this.selection.items.filter(el => el.hasAttribute('data-group') && el.tagName === 'DIV' && !el.matches('ul, ol, table, pre'));
        if (!groups.length) { this.app.toast('Select a group to ungroup'); return null; }
        const out = [];
        this.history.begin('Ungroup');
        for (const g of groups) {
            const parent = g.parentElement;
            // Each child: where it is on the stage, and the look it has inside the group (the
            // deck's CSS may give it through the group: `.stack .card { ... }`), both kept.
            const info = Array.from(g.children).map(el => ({ el, r: this.deck.stageRect(el), o: getOffset(el), look: captureLook(el) }));
            for (const { el, o } of info) {
                this.history.style(el, () => {
                    el.style.position = 'absolute';
                    el.style.right = ''; el.style.bottom = ''; el.style.margin = '0';
                    setOffset(el, 0, 0, o.r);
                }, { label: 'Ungroup' });
                this.history.move(el, parent, g, 'Ungroup');
            }
            this.history.remove(g, 'Ungroup');
            // Only now is the container where it will stay (the group may have been what sized
            // and placed it): the children are put back on their stage positions from there.
            const pr = this._origin(parent);
            for (const { el, r, look } of info) {
                this.history.style(el, () => {
                    el.style.left = round(r.x - pr.x) + 'px';
                    el.style.top = round(r.y - pr.y) + 'px';
                }, { label: 'Ungroup' });
                keepLook(look, (node, fn) => this.history.style(node, fn, { label: 'Ungroup' }));
                out.push(el);
            }
        }
        this.history.end();
        this.selection.set(out);
        return out;
    }
}

function round(v) { return Math.round(v * 10) / 10; }

/* What an element looks like, so it can keep that look after it is moved out of the
   container whose CSS gave it (`.stack .card { width; background }` no longer matches once
   the card has left .stack). captureLook records the computed values of the properties that
   make up appearance and layout, for the element and everything inside it; keepLook, after
   the move, writes inline only the ones that changed. Position and transform are not among
   them: the caller sets those. */
const LOOK_PROPS = [
    'display', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'box-sizing',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
    'color', 'opacity', 'box-shadow', 'overflow', 'z-index',
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'text-transform', 'text-align', 'text-decoration-line', 'white-space',
    'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'flex-grow', 'flex-shrink', 'flex-basis',
    'object-fit', 'fill', 'stroke',
];
function captureLook(el) {
    const nodes = [el, ...el.querySelectorAll('*')].filter(n => n.namespaceURI !== 'http://www.w3.org/2000/svg' || n === el);
    return nodes.map(node => { const cs = css(node); return { node, values: LOOK_PROPS.map(p => cs.getPropertyValue(p)) }; });
}
function keepLook(look, style) {
    for (const { node, values } of look) {
        if (!node.isConnected) continue;
        const cs = css(node);
        const changed = LOOK_PROPS.map((p, i) => [p, values[i]]).filter(([p, v], i) => cs.getPropertyValue(p) !== v && !node.style.getPropertyValue(p));
        if (changed.length) style(node, () => { for (const [p, v] of changed) node.style.setProperty(p, v); });
    }
}

