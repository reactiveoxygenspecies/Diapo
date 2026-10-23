/* ============================================================
   selection.js - what is selected, and the mouse work on the canvas.

   All pointer events land on #overlay, a transparent layer in the
   editor document that covers the deck iframe. Hit testing asks the
   deck document what is under the pointer (elementFromPoint in the
   iframe's own coordinates), then walks up to the element the user
   most likely means (see pick()). Selection boxes, handles, guides
   and the marquee are drawn on the overlay in screen pixels; all
   geometry is computed in stage pixels (1920x1080) and converted
   through the stage's scale, never via offsetX.
   ============================================================ */
import { isElement, isMeaningful, isShape, svgHostOf, textBlocks, mediaBlocks, isLayoutUnit, slideOf, css, isMaster, ensureUniqueIds, isLocked, DRAWN } from './dom.js';
import { getOffset, setOffset, setRotation, resizeMode, applySize, afterResize, snapLines, snapBox, usesVars } from './transform.js';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const DRAG_THRESHOLD = 3;          // screen px before a press becomes a drag
const SNAP_PX = 6;                 // screen px
const COMPOSITE_MAX_AREA = 0.4;    // a composite may cover at most this share of the slide

export class Selection extends EventTarget {
    constructor(app, { overlay, wrap, canvas }) {
        super();
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.overlay = overlay;
        this.wrap = wrap;
        this.canvas = canvas;
        this.items = [];
        this.hover = null;
        this.drag = null;
        this.space = false;
        this.enabled = true;
        this._raf = 0;
        this._buildOverlay();
        this._bind();
    }

    get primary() { return this.items[this.items.length - 1] || null; }
    get single() { return this.items.length === 1 ? this.items[0] : null; }
    has(el) { return this.items.includes(el); }

    /* ------------------------------------------------------------
       Overlay DOM
       ------------------------------------------------------------ */
    _buildOverlay() {
        const o = this.overlay;
        o.innerHTML = `
            <div class="ov-hover" hidden></div>
            <div class="ov-boxes"></div>
            <div class="ov-main" hidden>
                ${HANDLES.map(h => `<i class="ov-h" data-h="${h}"></i>`).join('')}
                <i class="ov-rot" data-h="rot" title="Drag to rotate (Shift: 15 degree steps)"></i>
            </div>
            <div class="ov-guides"></div>
            <div class="ov-marquee" hidden></div>`;
        this.el = {
            hover: o.querySelector('.ov-hover'),
            boxes: o.querySelector('.ov-boxes'),
            main: o.querySelector('.ov-main'),
            guides: o.querySelector('.ov-guides'),
            marquee: o.querySelector('.ov-marquee'),
        };
    }

    /* Let pointer events reach the deck (text editing) or take them back. While they do, the
       empty ground of a large master element (see elementAt) is marked so it does not catch
       them either: a click in the text being edited must place the caret, not land on the
       layer over it. The mark is an attribute the observer ignores; save strips it. */
    setPassthrough(on) {
        this.overlay.classList.toggle('passthrough', on);
        if (on) this.showHover(null);
        const doc = this.deck.doc;
        if (!doc) return;
        doc.querySelectorAll('[data-ed-ground]').forEach(el => el.removeAttribute('data-ed-ground'));
        if (!on) return;
        for (const root of this.deck.masterElements) {
            for (const el of [root, ...root.querySelectorAll('*')]) if (this.isGround(el)) el.setAttribute('data-ed-ground', '');
        }
    }
    /* A master element that is only ground: large and not meaningful in itself. */
    isGround(el) {
        if (!isMaster(el) || isMeaningful(el)) return false;
        const r = this.rectOf(el);
        return r.w * r.h > this.deck.stageW * this.deck.stageH * 0.6;
    }

    /* ------------------------------------------------------------
       Geometry
       ------------------------------------------------------------ */
    /* Overlay pixels for a stage-space rect. */
    toOverlay(r) {
        const s = this.deck.stage.getBoundingClientRect(), k = this.deck.scale;
        return { x: s.left + r.x * k, y: s.top + r.y * k, w: r.w * k, h: r.h * k };
    }
    /* Stage coordinates for a point given in the editor's client space. */
    toStage(clientX, clientY) {
        const w = this.wrap.getBoundingClientRect(), s = this.deck.stage.getBoundingClientRect(), k = this.deck.scale;
        return { x: (clientX - w.left - s.left) / k, y: (clientY - w.top - s.top) / k };
    }
    /* The deck element under a point given in the editor's client space. A locked element is
       passed by (the click goes to what is under it) unless `locked` is true. */
    elementAt(clientX, clientY, { locked = false } = {}) {
        const w = this.wrap.getBoundingClientRect();
        const x = clientX - w.left, y = clientY - w.top;
        // Master elements sit over the slide and are clickable while editing. A large one
        // (a full-stage layer holding a header and a footer, a vignette) must not swallow
        // the click when the point is on its empty ground: the click goes through to the
        // slide, and the layer's own contents (the prints, a logo) stay clickable.
        const stack = this.deck.doc.elementsFromPoint(x, y);
        for (const el of stack) {
            if (!isElement(el)) continue;
            if (this.isGround(el)) continue;
            if (!locked && isLocked(el)) continue;
            return el;
        }
        return null;
    }
    /* The element a pointer event means: the exact one under the cursor with Ctrl held, else
       the pick (see below), unless something selected sits inside that pick and under the
       cursor: an element picked exactly before stays the target, so a plain press on it moves
       it and not the group it is in. */
    pickAt(e) {
        const exact = e.ctrlKey || e.metaKey;
        const target = this.elementAt(e.clientX, e.clientY, { locked: exact });
        const el = this.pick(target, exact);
        if (!el || exact) return el;
        return this.items.find(i => i !== el && el.contains(i) && i.contains(target)) || el;
    }
    rectOf(el) { return this.deck.stageRect(el); }
    unionRect(els) {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (const el of els) { const r = this.rectOf(el); x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); }
        return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }

    /* ------------------------------------------------------------
       pick(): from the element under the pointer to the element the
       user means.
         - inside a chart host: the host
         - inside inline SVG: the SVG (or its [data-svg] host); a
           shape only with exact = true (Ctrl+click)
         - otherwise the first meaningful element, then upgraded to
           an enclosing composite: a layout unit that groups at most
           one text block and one image (dot + label, image + caption,
           figure wrapper) and covers under 40% of the slide.
           data-group always wins.
       ------------------------------------------------------------ */
    pick(target, exact = false) {
        if (!target) return null;
        // The scope is the active slide, or the stage for an element of the master layer.
        let slide = slideOf(target);
        if (slide && !slide.classList.contains('active')) return null;
        if (!slide) { if (!isMaster(target)) return null; slide = this.deck.stage; }
        if (target === slide) return null;
        const fig = target.closest(DRAWN);
        if (fig) return fig;
        const crop = target.closest('[data-crop]');                 // a cropped picture: the box, Ctrl+click the picture
        if (crop) return exact ? target : crop;
        if (isShape(target)) return exact ? target : svgHostOf(target);
        if (exact) return target;
        if (target.tagName.toLowerCase() === 'svg') target = svgHostOf(target) || target;
        // A group (a list, a table, an authored data-group) is always picked as a whole.
        const group = target.closest('[data-group]');
        if (group && group !== slide && slide.contains(group)) return group;

        let best = null;
        const slideArea = this.deck.stageW * this.deck.stageH;
        // A composite groups at most one text block and one image and is not most of the slide.
        const composite = (a) => {
            const t = textBlocks(a).length, m = mediaBlocks(a).length;
            if (t > 1 || m > 1 || t + m === 0) return false;
            const r = this.rectOf(a);
            return r.w * r.h <= slideArea * COMPOSITE_MAX_AREA;
        };
        for (let a = target; a && a !== slide; a = a.parentElement) {
            if (a.hasAttribute('data-group')) return a;
            if (!best) {
                // First stop: the element itself if meaningful, or (for a decoration such as a
                // dot or a bar) the composite that gives it meaning.
                if (isMeaningful(a) || (isLayoutUnit(a) && composite(a))) best = a;
                continue;
            }
            if (!isLayoutUnit(a)) continue;
            if (!composite(a)) break;
            best = a;
        }
        if (!best) {
            // Nothing meaningful on the way up (a bare decorative div): take the innermost layout unit.
            for (let a = target; a && a !== slide; a = a.parentElement) if (isLayoutUnit(a)) return a;
            return null;
        }
        return best;
    }

    /* Every selectable unit on the current slide (used by marquee and snapping). */
    unitsOnSlide(slide) {
        const out = new Set();
        for (const el of slide.querySelectorAll('*')) {
            if (!isMeaningful(el) && !isLayoutUnit(el)) continue;
            const u = this.pick(el);
            if (u) out.add(u);
        }
        return Array.from(out);
    }

    /* ------------------------------------------------------------
       Selection state
       ------------------------------------------------------------ */
    set(list) {
        const next = list.filter(isElement);
        if (next.length === this.items.length && next.every((e, i) => e === this.items[i])) return;
        this.items = next;
        this.refresh();
        this.dispatchEvent(new CustomEvent('change', { detail: this.items }));
    }
    select(el) { this.set(el ? [el] : []); }
    add(el) { if (el && !this.has(el)) this.set([...this.items, el]); }
    toggle(el) { if (!el) return; this.has(el) ? this.set(this.items.filter(e => e !== el)) : this.add(el); }
    clear() { this.set([]); }

    selectParent() {
        const el = this.primary; if (!el) return;
        const p = el.parentElement;
        if (p && !p.matches('.slide, .deck-stage')) this.select(p);
    }
    selectChild() {
        const el = this.primary; if (!el) return;
        const c = Array.from(el.children).find(isMeaningful) || el.firstElementChild;
        if (c) this.select(c);
    }
    selectSibling(dir) {
        const el = this.primary; if (!el) return;
        const sibs = Array.from(el.parentElement.children);
        const i = sibs.indexOf(el);
        this.select(sibs[(i + dir + sibs.length) % sibs.length]);
    }

    /* Drop elements that left the document (undo of an insert, slide change). */
    prune() {
        const live = this.items.filter(el => this.deck.doc.contains(el) && (slideOf(el) ? slideOf(el).classList.contains('active') : isMaster(el)));
        if (live.length !== this.items.length) this.set(live); else this.refresh();
    }

    /* ------------------------------------------------------------
       Drawing
       ------------------------------------------------------------ */
    scheduleRefresh() {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => { this._raf = 0; this.refresh(); });
    }
    refresh() {
        if (!this.deck.isOpen) { this.el.boxes.innerHTML = ''; this.el.main.hidden = true; return; }
        const boxes = this.items.map(el => this.toOverlay(this.rectOf(el)));
        this.el.boxes.innerHTML = boxes.map(b => `<div class="ov-box" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"></div>`).join('');
        const main = this.el.main;
        if (!this.items.length) { main.hidden = true; return; }
        const u = this.toOverlay(this.unionRect(this.items));
        Object.assign(main.style, { left: u.x + 'px', top: u.y + 'px', width: u.w + 'px', height: u.h + 'px' });
        const single = this.single;
        const mode = this.items.every(isLocked) ? 'locked' : single ? resizeMode(single) : 'multi';
        main.dataset.mode = mode;
        main.hidden = false;
        this.dispatchEvent(new CustomEvent('refresh'));
    }
    showHover(el) {
        if (el === this.hover) return;
        this.hover = el;
        if (!el || this.has(el)) { this.el.hover.hidden = true; return; }
        const b = this.toOverlay(this.rectOf(el));
        Object.assign(this.el.hover.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
        this.el.hover.hidden = false;
    }
    showGuides(gx, gy) {
        const s = this.deck.stage.getBoundingClientRect(), k = this.deck.scale;
        let html = '';
        if (gx !== null) html += `<div class="ov-guide v" style="left:${s.left + gx * k}px;top:${s.top}px;height:${this.deck.stageH * k}px"></div>`;
        if (gy !== null) html += `<div class="ov-guide h" style="top:${s.top + gy * k}px;left:${s.left}px;width:${this.deck.stageW * k}px"></div>`;
        this.el.guides.innerHTML = html;
    }

    /* ------------------------------------------------------------
       Pointer handling
       ------------------------------------------------------------ */
    _bind() {
        const o = this.overlay;
        o.addEventListener('pointerdown', (e) => this._down(e));
        o.addEventListener('pointermove', (e) => this._move(e));
        o.addEventListener('pointerup', (e) => this._up(e));
        o.addEventListener('pointercancel', (e) => this._up(e));
        o.addEventListener('pointerleave', () => { if (!this.drag) this.showHover(null); });
        o.addEventListener('dblclick', (e) => {
            const el = this.pickAt(e);
            if (el) { this.select(el); this.dispatchEvent(new CustomEvent('edit-text', { detail: { el, at: { clientX: e.clientX, clientY: e.clientY } } })); }
        });
        o.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (!this.enabled) return;
            const el = this.pickAt(e);
            if (el && !this.has(el)) this.select(el);
            if (!el) this.clear();
            this.dispatchEvent(new CustomEvent('menu', { detail: { x: e.clientX, y: e.clientY, el } }));
        });

        this.deck.addEventListener('mutate', () => this.scheduleRefresh());
        this.deck.addEventListener('slide', () => { this.showHover(null); this.prune(); });
        this.deck.addEventListener('ready', () => {
            this.items = []; this.refresh();
            this.deck.doc.addEventListener('transitionend', () => this.scheduleRefresh());
        });
        this.history.addEventListener('step', () => this.prune());
        window.addEventListener('editor:zoom', () => this.scheduleRefresh());
        window.addEventListener('resize', () => this.scheduleRefresh());
    }

    _down(e) {
        if (e.button !== 0 || !this.deck.isOpen || !this.enabled) return;
        e.preventDefault();
        this.overlay.setPointerCapture(e.pointerId);
        const start = { x: e.clientX, y: e.clientY };

        if (this.space) {
            this.drag = { kind: 'pan', start, sx: this.canvas.scrollLeft, sy: this.canvas.scrollTop };
            this.overlay.classList.add('panning');
            return;
        }
        const handle = e.target.closest('.ov-h, .ov-rot');
        if (handle && this.items.length && !this.items.every(isLocked)) {
            if (handle.dataset.h === 'rot') return this._startRotate(e, start);
            if (this.single) return this._startResize(e, start, handle.dataset.h);
        }
        const el = this.pickAt(e);
        if (e.shiftKey) { this.toggle(el); return; }
        if (!el) {
            this.clear();
            this.drag = { kind: 'marquee', start, moved: false };
            return;
        }
        // Alt+drag duplicates what is dragged: the selection when the press landed on it, else the element pressed.
        const dup = e.altKey ? { items: this.has(el) ? this.items.slice() : [el] } : null;
        if (!this.has(el)) this.select(el);
        this._startMove(e, start);
        this.drag.dup = dup;
    }

    /* First movement of an Alt+drag: put copies in place and drag those, all in one undo step. */
    _duplicateForDrag(d) {
        const items = d.dup.items.filter(el => el.isConnected);
        d.dup = null;
        if (!items.length) return;
        this.history.begin('Duplicate');
        d.transaction = true;
        const clones = [];
        for (const el of items) {
            const c = this.app.editops.cloneInPlace(el);          // in flow: an absolute copy at the same spot, no reflow
            ensureUniqueIds(c, slideOf(el) || this.deck.stage);
            this.history.insert(c, el.parentNode, el.nextSibling, 'Duplicate');
            clones.push(c);
        }
        this.set(clones);
        d.items = clones;
        d.o0 = clones.map(getOffset);
        d.before = clones.map(el => el.getAttribute('style'));
        d.box0 = this.unionRect(clones);
        d.lines = snapLines(this._snapTargets(clones), { w: this.deck.stageW, h: this.deck.stageH }, this.app.rulers && this.app.rulers.lines());
    }

    _startMove(e, start) {
        const items = this.items.slice();
        if (items.every(isLocked)) return;                                  // a locked element stays where it is
        this.deck.setTransitions(false);
        this.drag = {
            kind: 'move', start, moved: false, items,
            o0: items.map(getOffset),
            before: items.map(el => el.getAttribute('style')),
            box0: this.unionRect(items),
            lines: snapLines(this._snapTargets(items), { w: this.deck.stageW, h: this.deck.stageH }, this.app.rulers && this.app.rulers.lines()),
        };
        this.showHover(null);
    }

    _startResize(e, start, h) {
        const el = this.single;
        const cs = css(el);
        this.deck.setTransitions(false);
        this.drag = {
            kind: 'resize', start, h, el, moved: false,
            mode: resizeMode(el),
            r0: this.rectOf(el), o0: getOffset(el),
            font0: parseFloat(cs.fontSize) || 16,
            scale0: parseFloat(el.style.scale) || 1,
            // An element the deck lays out in flow keeps its footprint while it is resized (see
            // _move), so its neighbours stay where they are: these are the margins it started with.
            flow: !/absolute|fixed/.test(cs.position) && !isShape(el) ? { right: parseFloat(cs.marginRight) || 0, bottom: parseFloat(cs.marginBottom) || 0, w: el.offsetWidth, h: el.offsetHeight } : null,
            before: el.getAttribute('style'),
        };
    }

    _startRotate(e, start) {
        const items = this.items.slice();
        const u = this.toOverlay(this.unionRect(items));
        const w = this.wrap.getBoundingClientRect();
        this.deck.setTransitions(false);
        this.drag = {
            kind: 'rotate', start, items, moved: false,
            centre: { x: w.left + u.x + u.w / 2, y: w.top + u.y + u.h / 2 },
            o0: items.map(getOffset),
            before: items.map(el => el.getAttribute('style')),
        };
    }

    _move(e) {
        const d = this.drag;
        if (!d) {
            if (!this.enabled || !this.deck.isOpen || this.space) return;
            if (e.target.closest('.ov-h, .ov-rot')) { this.showHover(null); return; }
            this.showHover(this.pickAt(e));
            return;
        }
        const k = this.deck.scale;
        const sdx = e.clientX - d.start.x, sdy = e.clientY - d.start.y;   // screen deltas
        if (!d.moved && Math.hypot(sdx, sdy) < DRAG_THRESHOLD && d.kind !== 'pan') return;
        d.moved = true;
        const dx = sdx / k, dy = sdy / k;                                  // stage deltas

        if (d.kind === 'pan') {
            this.canvas.scrollLeft = d.sx - sdx;
            this.canvas.scrollTop = d.sy - sdy;
            return;
        }
        if (d.kind === 'marquee') {
            const w = this.wrap.getBoundingClientRect();
            const x = Math.min(e.clientX, d.start.x) - w.left, y = Math.min(e.clientY, d.start.y) - w.top;
            Object.assign(this.el.marquee.style, { left: x + 'px', top: y + 'px', width: Math.abs(sdx) + 'px', height: Math.abs(sdy) + 'px' });
            this.el.marquee.hidden = false;
            return;
        }
        if (d.kind === 'move') {
            if (d.dup) this._duplicateForDrag(d);
            let mx = dx, my = dy, gx = null, gy = null;
            if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) my = 0; else mx = 0; }   // constrain to an axis
            if (!e.ctrlKey && !e.metaKey) {                                        // Ctrl: no snapping
                const moved = { x: d.box0.x + mx, y: d.box0.y + my, w: d.box0.w, h: d.box0.h };
                const s = snapBox(moved, d.lines, SNAP_PX / k);
                mx += s.dx; my += s.dy; gx = s.gx; gy = s.gy;
            }
            d.items.forEach((el, i) => setOffset(el, d.o0[i].x + mx, d.o0[i].y + my));
            this.showGuides(gx, gy);
            this.refresh();
            return;
        }
        if (d.kind === 'resize') {
            const { h, r0, el } = d;
            // Alt: the box grows about its centre, the opposite edge moving as much as the one
            // dragged. Shift on a corner keeps the aspect ratio; both together, both.
            const centred = e.altKey, m = centred ? 2 : 1;
            let w = r0.w, ht = r0.h;
            if (h.includes('e')) w = r0.w + dx * m;
            if (h.includes('s')) ht = r0.h + dy * m;
            if (h.includes('w')) w = r0.w - dx * m;
            if (h.includes('n')) ht = r0.h - dy * m;
            w = Math.max(8, w); ht = Math.max(8, ht);
            const axis = h.length === 2 ? null : (h === 'e' || h === 'w' ? 'x' : 'y');
            if (h.length === 2 && d.mode === 'box' && e.shiftKey) {            // keep the aspect ratio
                const kk = Math.max(w / r0.w, ht / r0.h); w = r0.w * kk; ht = r0.h * kk;
            }
            applySize(el, d.mode, { w, h: ht, r0, font0: d.font0, scale0: d.scale0, axis });
            // In flow, the growth is taken out of the trailing margins (a shrink put into them), so
            // the box the layout sees stays the size it was and nothing around it moves: the
            // element spills over its neighbours instead, as it would in a free-form editor.
            if (d.flow) {
                el.style.marginRight = Math.round(d.flow.right - (el.offsetWidth - d.flow.w)) + 'px';
                el.style.marginBottom = Math.round(d.flow.bottom - (el.offsetHeight - d.flow.h)) + 'px';
            }
            // Then put it where it belongs: the point opposite the handle stays where it was (the
            // centre with Alt), whichever way the element grew (a box from its top left, text from
            // its origin, a shape about its middle). Measured at the starting offset, so nothing
            // accumulates from one movement to the next.
            setOffset(el, d.o0.x, d.o0.y);
            const r = this.rectOf(el);
            const ax = centred ? 0.5 : h.includes('w') ? 1 : h.includes('e') ? 0 : 0.5;
            const ay = centred ? 0.5 : h.includes('n') ? 1 : h.includes('s') ? 0 : 0.5;
            setOffset(el, d.o0.x + (r0.x + r0.w * ax) - (r.x + r.w * ax), d.o0.y + (r0.y + r0.h * ay) - (r.y + r.h * ay));
            this.refresh();
            return;
        }
        if (d.kind === 'rotate') {
            let deg = Math.atan2(e.clientY - d.centre.y, e.clientX - d.centre.x) * 180 / Math.PI + 90;
            if (e.shiftKey) deg = Math.round(deg / 15) * 15;
            deg = ((deg + 180) % 360 + 360) % 360 - 180;
            d.items.forEach((el) => setRotation(el, deg));
            this.refresh();
        }
    }

    _up(e) {
        const d = this.drag;
        if (!d) return;
        this.drag = null;
        this.overlay.classList.remove('panning');
        this.showGuides(null, null);
        this.deck.setTransitions(true);
        try { this.overlay.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }

        if (d.kind === 'pan') return;
        if (d.kind === 'marquee') {
            this.el.marquee.hidden = true;
            if (!d.moved) return;
            const a = this.toStage(d.start.x, d.start.y), b = this.toStage(e.clientX, e.clientY);
            const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
            const slide = this.deck.currentSlide;
            const hits = this.unitsOnSlide(slide).filter(el => {
                if (isLocked(el)) return false;
                const r = this.rectOf(el);
                return r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h;
            });
            this.set(hits);
            return;
        }
        if (!d.moved) return;
        if (d.kind === 'resize') {
            afterResize(d.el);
            this._commit(d.mode === 'text' ? 'Resize text' : 'Resize', [d.el], [d.before]);
        } else {
            this._commit(d.kind === 'move' ? 'Move' : 'Rotate', d.items, d.before);
        }
        if (d.transaction) this.history.end();                 // the Alt+drag: copies plus their move, one step
        this.refresh();
    }

    /* Record the styles changed during a drag as one undo step. */
    _commit(label, items, befores) {
        const cmds = [];
        items.forEach((el, i) => {
            this.history.remember(el);
            const after = el.getAttribute('style');
            if (after !== befores[i]) cmds.push({ el, before: befores[i], after });
        });
        if (!cmds.length) return;
        this.history.begin(label);
        for (const c of cmds) this.history.push(styleStep(c.el, c.before, c.after, label));
        this.history.end();
    }

    _snapTargets(moving) {
        const slide = this.deck.currentSlide;
        return this.unitsOnSlide(slide)
            .filter(el => !moving.some(m => m === el || m.contains(el) || el.contains(m)))
            .map(el => this.rectOf(el));
    }

    /* ------------------------------------------------------------
       Keyboard actions (called from the editor's key map)
       ------------------------------------------------------------ */
    handleKey(e) {
        if (!this.deck.isOpen || !this.enabled) return false;
        const k = e.key;
        if (k === ' ') { this.space = true; this.overlay.classList.add('space'); return !this.items.length; }
        if (k === 'Escape') { if (this.items.length) { this.clear(); return true; } return false; }
        if (!this.items.length) return false;
        if (k === 'Delete' || k === 'Backspace') { this.app.editops.remove(); return true; }
        if (k === 'Tab') { this.selectSibling(e.shiftKey ? -1 : 1); return true; }
        const step = e.shiftKey ? 10 : 1;
        const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[k];
        if (nudge) { this.nudge(nudge[0], nudge[1]); return true; }
        return false;
    }
    handleKeyUp(e) {
        if (e.key === ' ') { this.space = false; this.overlay.classList.remove('space'); }
    }

    /* Repeated nudges of one element merge into a single undo step (key); a multi-selection is one transaction. */
    nudge(dx, dy) {
        if (this.items.every(isLocked)) return;
        const move = (el) => { const o = getOffset(el); this.history.style(el, () => setOffset(el, o.x + dx, o.y + dy), { label: 'Nudge', key: 'nudge' }); };
        this.deck.withoutTransitions(() => {
            if (this.items.length === 1) move(this.items[0]);
            else { this.history.begin('Nudge'); this.items.forEach(move); this.history.end(); }
        });
        this.refresh();
    }

    /* ------------------------------------------------------------
       Align and distribute. Several elements align to the box around
       the selection (or to the slide with toSlide); a single element
       always aligns to the slide. Moves are written like drags.
       ------------------------------------------------------------ */
    align(kind, { toSlide = false } = {}) {
        const items = this.items.slice();
        if (!items.length) return;
        const ref = (items.length === 1 || toSlide) ? { x: 0, y: 0, w: this.deck.stageW, h: this.deck.stageH } : this.unionRect(items);
        const moves = items.map(el => {
            const r = this.rectOf(el);
            let dx = 0, dy = 0;
            switch (kind) {
                case 'left': dx = ref.x - r.x; break;
                case 'centre': dx = (ref.x + ref.w / 2) - (r.x + r.w / 2); break;
                case 'right': dx = (ref.x + ref.w) - (r.x + r.w); break;
                case 'top': dy = ref.y - r.y; break;
                case 'middle': dy = (ref.y + ref.h / 2) - (r.y + r.h / 2); break;
                case 'bottom': dy = (ref.y + ref.h) - (r.y + r.h); break;
            }
            return { el, dx, dy };
        });
        this._applyMoves(moves, 'Align ' + kind);
    }

    /* Equal gaps between the boxes along one axis; the first and last stay put. */
    distribute(axis) {
        const items = this.items.slice();
        if (items.length < 3) { this.app.toast('Select at least three elements to distribute'); return; }
        const rects = items.map(el => ({ el, r: this.rectOf(el) }));
        const pos = axis === 'x' ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h';
        rects.sort((a, b) => a.r[pos] - b.r[pos]);
        const first = rects[0].r, last = rects[rects.length - 1].r;
        const span = (last[pos] + last[size]) - first[pos];
        const total = rects.reduce((s, x) => s + x.r[size], 0);
        const gap = (span - total) / (rects.length - 1);
        let cursor = first[pos];
        const moves = rects.map(({ el, r }) => {
            const d = cursor - r[pos];
            cursor += r[size] + gap;
            return axis === 'x' ? { el, dx: d, dy: 0 } : { el, dx: 0, dy: d };
        });
        this._applyMoves(moves, axis === 'x' ? 'Distribute horizontally' : 'Distribute vertically');
    }

    _applyMoves(moves, label) {
        const real = moves.filter(m => Math.abs(m.dx) >= 0.5 || Math.abs(m.dy) >= 0.5);
        if (!real.length) return;
        this.deck.withoutTransitions(() => {
            this.history.begin(label);
            for (const { el, dx, dy } of real) {
                const o = getOffset(el);
                this.history.style(el, () => setOffset(el, o.x + dx, o.y + dy), { label });
            }
            this.history.end();
        });
        this.refresh();
    }

    /* Hiding keeps the element in the file (display:none + data-hidden) so it can be brought back. */
    /* Lock or unlock the selection (data-locked): a locked element is passed by when clicking
       and marquee-selecting and cannot be moved or resized; Ctrl+click reaches it, and Delete,
       the panel and the Code section still work on it. */
    lock(on = true) {
        const items = this.items.slice();
        this.history.begin(on ? 'Lock' : 'Unlock');
        for (const el of items) this.history.attr(el, 'data-locked', on ? '' : null, on ? 'Lock' : 'Unlock');
        this.history.end();
        this.refresh();
    }
    hide() {
        const items = this.items.slice();
        this.history.begin('Hide');
        for (const el of items) {
            this.history.style(el, () => { el.style.display = 'none'; }, { label: 'Hide' });
            this.history.attr(el, 'data-hidden', '1', 'Hide');
        }
        this.history.end();
        this.clear();
    }
    unhideAll() {
        const slide = this.deck.currentSlide; if (!slide) return 0;
        const hidden = Array.from(slide.querySelectorAll('[data-hidden]'));
        this.history.begin('Unhide all');
        for (const el of hidden) {
            this.history.style(el, () => { el.style.display = ''; }, { label: 'Unhide' });
            this.history.attr(el, 'data-hidden', null, 'Unhide');
        }
        this.history.end();
        return hidden.length;
    }
    /* Remove every inline style the editor (or the author) put on the element. */
    resetStyles() {
        this.history.begin('Reset');
        for (const el of this.items) {
            this.history.style(el, () => el.removeAttribute('style'), { label: 'Reset' });
            afterResize(el);
        }
        this.history.end();
        this.refresh();
    }
}

/* Apply a style attribute with the deck's transitions switched off, then re-layout charts. */
function setStyleNow(el, value) {
    const root = el.ownerDocument.documentElement;
    root.classList.add('deck-no-transitions');
    if (value == null) el.removeAttribute('style'); else el.setAttribute('style', value);
    void root.offsetWidth;
    root.classList.remove('deck-no-transitions');
    afterResize(el);
}

/* A style command that never merges (drags are already one step). */
function styleStep(el, before, after, label) {
    return {
        label, el, before, after,
        undo() { setStyleNow(el, before); },
        redo() { setStyleNow(el, after); },
    };
}

export { usesVars };
