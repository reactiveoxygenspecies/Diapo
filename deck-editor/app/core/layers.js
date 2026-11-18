/* ============================================================
   layers.js - the Layers list: the current slide's elements, front
   to back, docked above the properties panel.

   It lists what the canvas would let you select (selection.pick()),
   not every tag: a plain wrapper such as the slide's content box is
   passed through and what is in it listed, a group is a row that
   opens onto its children, a chart or a picture is one row. Order is
   the stacking order editops.js works on (z-index, then document
   order), front first. The master layer (the footer, elements on
   every slide) is a folded section at the bottom.

   The list holds no state of its own about the deck: selection,
   hide, lock, rename and reorder all go through the same code the
   canvas and the panel use, so each is one undo step and the list
   only follows (history changes, slide changes, deck tabs). A
   redraw is deferred a moment and skipped when the rows come out as
   before, so a slide with a hundred elements stays cheap.
   ============================================================ */
import { describe, nameOf, isLocked, isMeaningful, isLayoutUnit, DRAWN, css } from './dom.js';

const SKIP = 'script, style, template, link, meta, noscript, .notes, [data-ed-ground]';
/* Elements that are one thing whatever is inside them. */
const WHOLE = DRAWN + ', [data-svg], [data-crop], [data-line], [data-fa], img, picture, video, audio, canvas, iframe, object, table, svg';
const DRAG_PX = 4;

const svg = (d) => `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
    text: svg('<path d="M3 4h10M8 4v9M6 13h4"/>'),
    picture: svg('<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="7" r="1.2"/><path d="M2.5 12l3.5-3 3 2.5 2-1.5 2.5 2"/>'),
    shape: svg('<path d="M8 2.5l5.5 10h-11z"/>'),
    line: svg('<path d="M3 13L13 3"/><circle cx="3" cy="13" r="1"/><circle cx="13" cy="3" r="1"/>'),
    chart: svg('<path d="M3 13V3M3 13h10"/><path d="M6 13V9M9 13V6M12 13v-3"/>'),
    equation: svg('<path d="M12 3.5H5l4 4.5-4 4.5h7"/>'),
    structure: svg('<path d="M8 2l5 3v6l-5 3-5-3V5z"/>'),
    table: svg('<rect x="2.5" y="3" width="11" height="10" rx="1"/><path d="M2.5 7h11M2.5 10h11M7 3v10"/>'),
    group: svg('<rect x="2.5" y="2.5" width="7" height="7" rx="1"/><rect x="6.5" y="6.5" width="7" height="7" rx="1"/>'),
    icon: svg('<path d="M8 2.5l1.7 3.6 3.8.5-2.8 2.7.7 3.9L8 11.3 4.6 13.2l.7-3.9L2.5 6.6l3.8-.5z"/>'),
    box: svg('<rect x="2.5" y="3.5" width="11" height="9" rx="1" stroke-dasharray="2 2"/>'),
};
const EYE = svg('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>');
const EYE_OFF = svg('<path d="M1.5 8S4 3.5 8 3.5c1 0 1.9.3 2.7.7M14.5 8S12 12.5 8 12.5c-1 0-1.9-.3-2.7-.7M2.5 13.5l11-11"/>');
const LOCK = svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>');
const UNLOCK = svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/><path d="M5.5 7V5a2.5 2.5 0 014.8-1"/>');
const TWIST = svg('<path d="M6 3.5l4.5 4.5L6 12.5"/>');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* What kind of thing an element is, for its icon: from the words the panel uses for it. */
export function kindOf(el) {
    const tag = el.tagName.toLowerCase();
    if (el.hasAttribute('data-group')) return 'group';
    if (tag === 'table') return 'table';
    if (/^(video|audio|iframe|picture|canvas|object)$/.test(tag)) return 'picture';
    const role = describe(el).role;
    if (/chart/.test(role)) return 'chart';
    if (role === 'equation') return 'equation';
    if (role === 'structure') return 'structure';
    if (role === 'line') return 'line';
    if (/^icon /.test(role)) return 'icon';
    if (/^(image|inline SVG)/.test(role)) return 'picture';
    if (role === 'shape') return 'shape';
    if (role === 'box') return 'box';
    return 'text';
}

export class Layers {
    /* host: { setOpen(on), setHeight(px, final) } - what the editor keeps (the panel options). */
    constructor(app, { pane, host }) {
        this.app = app;
        this.deck = app.deck;
        this.selection = app.selection;
        this.history = app.history;
        this.host = host;
        this.pane = pane;
        this.bar = pane.querySelector('.layers-bar');
        this.toggleBtn = pane.querySelector('#btnLayers');
        this.countEl = pane.querySelector('.layers-count');
        this.body = pane.querySelector('.layers-body');
        this.list = pane.querySelector('#layersList');
        this.grip = pane.querySelector('.layers-grip');
        this.isOpen = false;
        this.rows = [];               // what the list shows, in order: { el, depth, group, open, section }
        this.opened = new WeakSet();  // groups the user opened
        this.footerOpen = false;
        this.cur = null;              // the row the arrow keys are on
        this.anchor = null;           // where a Shift+click range starts
        this.renaming = null;
        this._html = '';
        this._timer = 0;
        this._bind();
    }

    /* ------------------------------------------------------------
       Opening and following the deck
       ------------------------------------------------------------ */
    setOpen(on) {
        on = !!on;
        const was = this.isOpen;
        this.isOpen = on;
        this.pane.classList.toggle('open', on);
        this.body.hidden = !on;
        this.toggleBtn.setAttribute('aria-expanded', String(on));
        if (on && !was) { this._html = ''; this.render(); }
    }
    focus() { this.list.focus({ preventScroll: true }); }

    _bind() {
        this.toggleBtn.addEventListener('click', () => this.host.setOpen(!this.isOpen));
        const again = () => this.schedule();
        // The deck changed under us: any command, undo and redo, another slide, another deck tab,
        // a slide added or removed (the strip), a new deck opened.
        this.history.addEventListener('change', again);
        this.deck.addEventListener('slide', again);
        this.deck.addEventListener('ready', again);
        if (this.app.strip) this.app.strip.addEventListener('structure', again);
        window.addEventListener('editor:open', again);
        this.selection.addEventListener('change', () => this._follow());

        const list = this.list;
        list.addEventListener('click', (e) => this._click(e));
        list.addEventListener('dblclick', (e) => {
            const name = e.target.closest('.lr-name');
            const row = name && name.closest('.layer-row');
            if (row) this.rename(this.rows[+row.dataset.i].el);
        });
        list.addEventListener('pointerdown', (e) => this._down(e));
        list.addEventListener('pointermove', (e) => this._move(e));
        list.addEventListener('pointerup', (e) => this._up(e));
        list.addEventListener('pointercancel', (e) => this._up(e, true));
        // Pointing at a row points at the element on the canvas.
        list.addEventListener('pointerover', (e) => {
            const row = e.target.closest('.layer-row');
            const el = row && this.rows[+row.dataset.i] && this.rows[+row.dataset.i].el;
            this.selection.showHover(el && !this._hidden(el) && !this.drag ? el : null);
        });
        list.addEventListener('pointerleave', () => this.selection.showHover(null));

        // The grip under the list resizes it.
        this.grip.addEventListener('dblclick', () => this.host.setHeight(null, true));
        this.grip.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this.grip.setPointerCapture(e.pointerId);
            const y0 = e.clientY, h0 = this.body.getBoundingClientRect().height;
            const move = (ev) => this.host.setHeight(h0 + ev.clientY - y0, false);
            const up = () => { this.host.setHeight(this.body.getBoundingClientRect().height, true); this.grip.removeEventListener('pointermove', move); this.grip.removeEventListener('pointerup', up); this.grip.removeEventListener('pointercancel', up); };
            this.grip.addEventListener('pointermove', move); this.grip.addEventListener('pointerup', up); this.grip.addEventListener('pointercancel', up);
        });
    }

    schedule() {
        if (!this.isOpen || this._timer) return;
        this._timer = setTimeout(() => { this._timer = 0; this.render(); }, 60);
    }

    /* ------------------------------------------------------------
       Which rows, in which order
       ------------------------------------------------------------ */
    _hidden(el) { return !!(el.closest && el.closest('[data-hidden]')); }

    /* A plain wrapper: not something in itself, with a unit of its own inside it. */
    _wraps(el) {
        if (isMeaningful(el)) return false;
        for (const d of el.querySelectorAll('*')) if (this.selection.pick(d) === d) return true;
        return false;
    }
    /* The elements in `kids`, in document order, with plain wrappers passed through. */
    _collect(kids, out, inGroup = false) {
        for (const c of kids) {
            if (c.nodeType !== 1 || c.matches(SKIP)) continue;
            if (c.hasAttribute('data-group') || c.matches(WHOLE)) { out.push(c); continue; }
            // Inside a group the canvas picks the group, so the pick says nothing about its parts:
            // anything meaningful or laid out as a box of its own is a row.
            if (inGroup) { if (isMeaningful(c) || isLayoutUnit(c)) out.push(c); else this._collect(c.children, out, true); continue; }
            const u = this.selection.pick(c);
            if (u === c && !this._wraps(c)) { out.push(c); continue; }
            this._collect(c.children, out);
        }
        return out;
    }
    /* Front first: by z-index, then document order, as the layer commands order them. */
    _ordered(els) {
        return els.map((el, i) => { const z = parseInt(css(el).zIndex, 10); return { el, z: isNaN(z) ? 0 : z, i }; })
            .sort((a, b) => b.z - a.z || b.i - a.i).map(x => x.el);
    }
    _rowsOf(els, depth, section, out) {
        for (const el of this._ordered(els)) {
            const group = el.hasAttribute('data-group') && !!el.firstElementChild;
            const open = group && this.opened.has(el);
            out.push({ el, depth, group, open, section });
            if (open) this._rowsOf(this._collect(el.children, [], true), depth + 1, section, out);
        }
        return out;
    }
    _build() {
        const d = this.deck, slide = d.currentSlide;
        if (!d.isOpen || !slide) return { rows: [], footer: [] };
        // Something selected inside a closed group opens it, so the row can be seen.
        for (const el of this.selection.items) for (let g = el.parentElement; g && g !== slide; g = g.parentElement) if (g.hasAttribute('data-group')) this.opened.add(g);
        return {
            rows: this._rowsOf(this._collect(slide.children, []), 0, 'slide', []),
            footer: this._rowsOf(this._collect(d.masterElements, []), 0, 'footer', []),
        };
    }

    /* ------------------------------------------------------------
       Drawing
       ------------------------------------------------------------ */
    render() {
        if (!this.isOpen || this.renaming || this.drag) return;
        const { rows, footer } = this._build();
        this.rows = [...rows, ...(this.footerOpen ? footer : [])];
        const row = (r, i) => {
            const el = r.el, hidden = el.hasAttribute('data-hidden'), locked = el.hasAttribute('data-locked');
            const name = nameOf(el);
            return `<div class="layer-row${this._hidden(el) ? ' is-hidden' : ''}${isLocked(el) ? ' is-locked' : ''}" role="option" id="lr-${i}" data-i="${i}" data-kind="${kindOf(el)}" style="--depth:${r.depth}" title="${esc(name)}">`
                + (r.group ? `<button type="button" class="lr-twist${r.open ? ' open' : ''}" tabindex="-1" aria-label="${r.open ? 'Close' : 'Open'} the group" title="${r.open ? 'Close' : 'Open'} the group">${TWIST}</button>` : '<span class="lr-twist-gap"></span>')
                + `<span class="lr-ico">${ICONS[kindOf(el)]}</span><span class="lr-name">${esc(name)}</span>`
                + `<button type="button" class="lr-btn lr-lock${isLocked(el) ? ' on' : ''}" tabindex="-1" aria-label="${isLocked(el) ? 'Unlock' : 'Lock'}" aria-pressed="${isLocked(el)}" title="${locked ? 'Locked: click to unlock' : isLocked(el) ? 'Locked by the group it is in' : 'Lock: a click on the slide passes it by'}">${isLocked(el) ? LOCK : UNLOCK}</button>`
                + `<button type="button" class="lr-btn lr-eye${hidden ? ' on' : ''}" tabindex="-1" aria-label="${hidden ? 'Show' : 'Hide'}" aria-pressed="${hidden}" title="${hidden ? 'Hidden in the editor: click to show it' : 'Hide: kept in the file'}">${hidden ? EYE_OFF : EYE}</button>`
                + '</div>';
        };
        let html = rows.map((r, i) => row(r, i)).join('');
        if (!rows.length) html = `<div class="layers-empty">${this.deck.isOpen ? 'Nothing on this slide yet.' : 'No deck open.'}</div>`;
        if (footer.length) html += `<div class="layer-sec${this.footerOpen ? ' open' : ''}" role="button" tabindex="-1" data-sec="footer" title="Elements shown on every slide (the footer, a page number, a logo)"><span class="lr-twist">${TWIST}</span>On every slide <span class="lr-count">${footer.length}</span></div>`;
        if (this.footerOpen) html += footer.map((r, i) => row(r, rows.length + i)).join('');
        this.countEl.textContent = rows.length + footer.length ? String(rows.length + footer.length) : '';
        if (html !== this._html) { this.list.innerHTML = html; this._html = html; }
        this._state();
    }

    /* Selection and the arrow-key row, on the rows that are there. */
    _state() {
        const sel = this.selection;
        let activeId = '';
        this.list.querySelectorAll('.layer-row').forEach((n) => {
            const r = this.rows[+n.dataset.i];
            const on = !!r && sel.has(r.el), cur = !!r && r.el === this.cur;
            n.classList.toggle('sel', on);
            n.classList.toggle('cur', cur);
            n.setAttribute('aria-selected', String(on));
            if (cur) activeId = n.id;
        });
        if (activeId) this.list.setAttribute('aria-activedescendant', activeId); else this.list.removeAttribute('aria-activedescendant');
    }
    /* The canvas selection changed: show it, and bring its row into view. */
    _follow() {
        if (!this.isOpen) return;
        const p = this.selection.primary;
        if (p) { this.cur = p; this.anchor = this.anchor || p; }
        // Something new in a closed group or the footer section needs its row drawn.
        const missing = p && !this.rows.some(r => r.el === p);
        if (missing) {
            if (p && !this._inSlide(p)) this.footerOpen = true;
            this._html = '';
            this.render();
        } else this._state();
        const n = p && this._rowNode(p);
        if (n) this._reveal(n);
    }
    _inSlide(el) { const s = this.deck.currentSlide; return !!s && s.contains(el); }
    _rowNode(el) {
        const i = this.rows.findIndex(r => r.el === el);
        return i < 0 ? null : this.list.querySelector(`.layer-row[data-i="${i}"]`);
    }
    _reveal(n) {
        const l = this.list, top = n.offsetTop, bottom = top + n.offsetHeight;      // the list is the scroller, and the rows' offset parent
        if (top < l.scrollTop) l.scrollTop = top; else if (bottom > l.scrollTop + l.clientHeight) l.scrollTop = bottom - l.clientHeight;
    }

    /* ------------------------------------------------------------
       Clicks: select, open, hide, lock
       ------------------------------------------------------------ */
    _click(e) {
        if (this._justDragged) return;
        const sec = e.target.closest('.layer-sec');
        if (sec) { this.footerOpen = !this.footerOpen; this._html = ''; this.render(); return; }
        const rowNode = e.target.closest('.layer-row');
        if (!rowNode) return;
        const r = this.rows[+rowNode.dataset.i]; if (!r) return;
        const el = r.el;
        this.focus();
        if (e.target.closest('.lr-twist')) { r.open ? this.opened.delete(el) : this.opened.add(el); this._html = ''; this.render(); return; }
        if (e.target.closest('.lr-eye')) { this.toggleHidden(el); return; }
        if (e.target.closest('.lr-lock')) { this.toggleLock(el); return; }
        this.pick(r, e);
    }
    /* Click or Enter on a row: select it; Ctrl adds or removes it, Shift takes the rows between. */
    pick(r, e) {
        const el = r.el;
        this.app.textEdit.commit();
        this.cur = el;
        if (this._hidden(el)) { this._state(); return; }           // nothing on the canvas to select
        if (e.ctrlKey || e.metaKey) { this.selection.toggle(el); this.anchor = el; }
        else if (e.shiftKey && this.anchor && this.rows.some(x => x.el === this.anchor)) {
            const a = this.rows.findIndex(x => x.el === this.anchor), b = this.rows.findIndex(x => x === r);
            this.selection.set(this.rows.slice(Math.min(a, b), Math.max(a, b) + 1).map(x => x.el).filter(x => !this._hidden(x)));
        } else { this.selection.select(el); this.anchor = el; }
        this._state();
    }
    /* The eye and the lock use the panel's Hide and Lock (selection.js): one undo step each. */
    toggleHidden(el) {
        if (el.hasAttribute('data-hidden')) this.selection.unhide([el]); else this.selection.hide([el]);
        this.app.inspector.sync();
    }
    toggleLock(el) {
        this.selection.lock(!isLocked(el), [el]);
        this.app.inspector.sync();
    }

    /* ------------------------------------------------------------
       Rename (the panel's name field: data-name)
       ------------------------------------------------------------ */
    rename(el) {
        const n = this._rowNode(el); if (!n || this.renaming) return;
        const nameEl = n.querySelector('.lr-name');
        const input = document.createElement('input');
        input.type = 'text'; input.className = 'lr-rename'; input.spellcheck = false;
        input.value = describe(el).name; input.placeholder = nameOf(el);
        input.setAttribute('aria-label', 'Name');
        nameEl.replaceWith(input);
        this.renaming = { el, input };
        input.focus(); input.select();
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.endRename(true); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.endRename(false); }
        });
        input.addEventListener('blur', () => this.endRename(true));
    }
    endRename(commit) {
        const r = this.renaming; if (!r) return false;
        this.renaming = null;
        if (commit) {
            const v = r.input.value.trim();
            if (v !== describe(r.el).name) {
                this.history.begin('Rename');
                this.history.attr(r.el, 'data-name', v || null, 'Rename');
                this.history.end();
                this.app.inspector.sync();
            }
        }
        this._html = '';
        this.render();
        this.focus();
        return true;
    }

    /* ------------------------------------------------------------
       Drag a row to change the stacking order
       ------------------------------------------------------------ */
    _down(e) {
        if (e.button !== 0 || this.renaming) return;
        const rowNode = e.target.closest('.layer-row');
        if (!rowNode || e.target.closest('.lr-btn, .lr-twist, input')) return;
        this.press = { i: +rowNode.dataset.i, x: e.clientX, y: e.clientY, id: e.pointerId };
    }
    _move(e) {
        const p = this.press; if (!p) return;
        if (!this.drag) {
            if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_PX) return;
            const r = this.rows[p.i]; if (!r) { this.press = null; return; }
            this.drag = { r, target: null, above: true };
            this.list.setPointerCapture(p.id);
            this.list.classList.add('dragging');
            const n = this.list.querySelector(`.layer-row[data-i="${p.i}"]`); if (n) n.classList.add('drag-src');
            this.selection.showHover(null);
        }
        this._mark(e);
    }
    /* Which row the pointer is on, and whether the drop would go above it or below it. */
    _mark(e) {
        const d = this.drag;
        this.list.querySelectorAll('.drop-above, .drop-below, .no-drop').forEach(n => n.classList.remove('drop-above', 'drop-below', 'no-drop'));
        d.target = null;
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const n = hit && hit.closest && hit.closest('.layer-row');
        if (!n || !this.list.contains(n)) return;
        const t = this.rows[+n.dataset.i];
        if (!t || t === d.r) return;
        // Only siblings are ordered against each other; a row of another container or section cannot be.
        if (t.el.parentElement !== d.r.el.parentElement || t.section !== d.r.section) { n.classList.add('no-drop'); return; }
        const b = n.getBoundingClientRect();
        d.above = e.clientY < b.top + b.height / 2;
        d.target = t;
        n.classList.add(d.above ? 'drop-above' : 'drop-below');
    }
    _up(e, cancelled = false) {
        const p = this.press; this.press = null;
        const d = this.drag; this.drag = null;
        if (!p || !d) return;
        try { this.list.releasePointerCapture(p.id); } catch (err) { /* already released */ }
        this.list.classList.remove('dragging');
        this.list.querySelectorAll('.drop-above, .drop-below, .no-drop, .drag-src').forEach(n => n.classList.remove('drop-above', 'drop-below', 'no-drop', 'drag-src'));
        // The click that ends a drag is not a click on the row.
        this._justDragged = true;
        setTimeout(() => { this._justDragged = false; }, 0);
        if (cancelled || !d.target) { this.render(); return; }
        this.app.textEdit.commit();
        this.app.editops.layerTo(d.r.el, d.target.el, d.above);
        this.render();
    }
    cancelDrag() {
        if (!this.drag) return false;
        this._up(null, true);
        return true;
    }

    /* ------------------------------------------------------------
       Keys, while the list has the focus (editor.js hands them over)
       ------------------------------------------------------------ */
    handleKey(e) {
        if (this.renaming || e.ctrlKey || e.metaKey || e.altKey) return false;
        const k = e.key;
        const at = () => Math.max(0, this.rows.findIndex(r => r.el === this.cur));
        const go = (i) => {
            if (!this.rows.length) return;
            const r = this.rows[Math.max(0, Math.min(this.rows.length - 1, i))];
            this.cur = r.el;
            this._state();
            const n = this._rowNode(r.el); if (n) this._reveal(n);
        };
        if (k === 'ArrowDown') { go(at() + 1); return true; }
        if (k === 'ArrowUp') { go(at() - 1); return true; }
        if (k === 'Home') { go(0); return true; }
        if (k === 'End') { go(this.rows.length - 1); return true; }
        const r = this.rows[at()];
        if (k === 'ArrowRight' || k === 'ArrowLeft') {
            if (r && r.group && (k === 'ArrowRight') !== r.open) { k === 'ArrowRight' ? this.opened.add(r.el) : this.opened.delete(r.el); this._html = ''; this.render(); }
            return true;
        }
        if (k === 'Enter' || k === ' ') { if (r && this.cur) this.pick(r, e); return true; }
        if (k === 'F2') { if (r) this.rename(r.el); return true; }
        if (k === 'Delete' || k === 'Backspace') { if (this.selection.items.length) this.app.editops.remove(); return true; }
        return false;
    }
}
