/* ============================================================
   guides.js - rulers along the canvas and the guides a deck keeps.

   The rulers are drawn in the editor's document, over the canvas,
   in stage pixels: they follow the zoom, the scroll and the slide
   size. Dragging from a ruler makes a guide; dragging a guide onto
   a ruler (or off the stage) removes it. Guides belong to the deck,
   not to the editor: they are saved on the stage as
       data-guides="x:960,y:540"
   so they travel with the file and are undone like any other change.
   The deck itself ignores the attribute.

   Moving and resizing snap to them, through snapLines() in
   transform.js, which takes them as extra lines.
   ============================================================ */

const ATTR = 'data-guides';

export function readGuides(stage) {
    const out = { xs: [], ys: [] };
    if (!stage) return out;
    for (const part of (stage.getAttribute(ATTR) || '').split(/[,\s]+/)) {
        const m = /^([xy]):(-?\d+(?:\.\d+)?)$/.exec(part.trim());
        if (m) out[m[1] === 'x' ? 'xs' : 'ys'].push(+m[2]);
    }
    out.xs.sort((a, b) => a - b); out.ys.sort((a, b) => a - b);
    return out;
}
export function guidesText(g) {
    return [...g.xs.map(v => 'x:' + round(v)), ...g.ys.map(v => 'y:' + round(v))].join(',');
}
function round(v) { return Math.round(v * 10) / 10; }

/* A step for the ruler's numbers: about one every 80 screen pixels, in 1-2-5 steps. */
function tickStep(scale) {
    const want = 80 / (scale || 1);
    const pow = Math.pow(10, Math.floor(Math.log10(want)));
    for (const m of [1, 2, 5, 10]) if (pow * m >= want) return pow * m;
    return pow * 10;
}

export class Rulers {
    constructor(app, { wrap, canvas }) {
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.wrap = wrap;                 // #stageWrap: the rulers sit on its edges
        this.canvas = canvas;
        this.on = false;
        this.drag = null;
        this.el = document.createElement('div');
        this.el.className = 'rulers';
        this.el.hidden = true;
        this.el.innerHTML = '<div class="ruler ruler-x"><canvas></canvas></div><div class="ruler ruler-y"><canvas></canvas></div><div class="ruler-corner" title="Guides: drag one out of a ruler, drag it back to remove it"></div><div class="guide-layer"></div>';
        wrap.appendChild(this.el);
        this.xCanvas = this.el.querySelector('.ruler-x canvas');
        this.yCanvas = this.el.querySelector('.ruler-y canvas');
        this.layer = this.el.querySelector('.guide-layer');
        this.el.addEventListener('pointerdown', (e) => this._down(e));
        this.el.addEventListener('pointermove', (e) => this._move(e));
        this.el.addEventListener('pointerup', (e) => this._up(e));
        this.el.addEventListener('dblclick', (e) => {
            const g = e.target.closest('[data-guide]');
            if (g) this.remove(g.dataset.axis, +g.dataset.at);
        });
        this.deck.addEventListener('ready', () => this.draw());
        this.deck.addEventListener('overrides', () => this.draw());
        window.addEventListener('editor:zoom', () => this.draw());
        window.addEventListener('resize', () => this.draw());
        canvas.addEventListener('scroll', () => this.draw());
    }

    setOn(on) {
        this.on = !!on;
        this.el.hidden = !this.on;
        document.documentElement.dataset.rulers = this.on ? 'on' : 'off';
        if (this.on) this.draw();
    }

    get guides() { return readGuides(this.deck.stage); }

    /* Every guide, as snap lines. */
    lines() { return this.on ? this.guides : { xs: [], ys: [] }; }

    _write(g, label) {
        const text = guidesText(g);
        this.history.attr(this.deck.stage, ATTR, text || null, label);
        this.draw();
    }
    add(axis, at) {
        const g = this.guides;
        const list = axis === 'x' ? g.xs : g.ys;
        at = Math.max(0, Math.min(axis === 'x' ? this.deck.stageW : this.deck.stageH, round(at)));
        if (list.some(v => Math.abs(v - at) < 0.5)) return;
        list.push(at);
        this._write(g, 'Add guide');
    }
    remove(axis, at) {
        const g = this.guides;
        const key = axis === 'x' ? 'xs' : 'ys';
        g[key] = g[key].filter(v => Math.abs(v - at) > 0.5);
        this._write(g, 'Remove guide');
    }
    clear() {
        if (!this.deck.stage || !this.deck.stage.hasAttribute(ATTR)) return false;
        this._write({ xs: [], ys: [] }, 'Clear guides');
        return true;
    }
    /* Guides where the selection's edges and centres are (or the slide's thirds when nothing is selected). */
    addForSelection() {
        const items = this.app.selection.items;
        const g = this.guides;
        if (items.length) {
            for (const el of items) {
                const r = this.app.selection.rectOf(el);
                for (const v of [r.x, r.x + r.w / 2, r.x + r.w]) if (!g.xs.some(u => Math.abs(u - v) < 0.5)) g.xs.push(round(v));
                for (const v of [r.y, r.y + r.h / 2, r.y + r.h]) if (!g.ys.some(u => Math.abs(u - v) < 0.5)) g.ys.push(round(v));
            }
        } else {
            const W = this.deck.stageW, H = this.deck.stageH;
            for (const v of [W / 3, 2 * W / 3]) if (!g.xs.some(u => Math.abs(u - v) < 0.5)) g.xs.push(round(v));
            for (const v of [H / 3, 2 * H / 3]) if (!g.ys.some(u => Math.abs(u - v) < 0.5)) g.ys.push(round(v));
        }
        this._write(g, 'Add guides');
    }

    /* ---------- drawing ---------- */
    draw() {
        if (!this.on || !this.deck.isOpen) return;
        const k = this.deck.scale, W = this.deck.stageW, H = this.deck.stageH;
        const w = Math.round(W * k), h = Math.round(H * k);
        this._ticks(this.xCanvas, 'x', w, k, W);
        this._ticks(this.yCanvas, 'y', h, k, H);
        const g = this.guides;
        this.layer.innerHTML = [
            ...g.xs.map(v => `<i data-guide data-axis="x" data-at="${v}" class="guide v" style="left:${v * k}px" title="${v} px — drag to move, double-click to remove"></i>`),
            ...g.ys.map(v => `<i data-guide data-axis="y" data-at="${v}" class="guide h" style="top:${v * k}px" title="${v} px — drag to move, double-click to remove"></i>`),
        ].join('');
    }
    _ticks(canvas, axis, lengthPx, k, stageLen) {
        const dpr = window.devicePixelRatio || 1, thick = 20;
        const long = axis === 'x' ? lengthPx : thick, cross = axis === 'x' ? thick : lengthPx;
        canvas.width = Math.max(1, Math.round(long * dpr)); canvas.height = Math.max(1, Math.round(cross * dpr));
        canvas.style.width = long + 'px'; canvas.style.height = cross + 'px';
        const c = canvas.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        const cs = getComputedStyle(document.documentElement);
        const bg = cs.getPropertyValue('--bg-2').trim() || '#fff', ink = cs.getPropertyValue('--ink-3').trim() || '#888', line = cs.getPropertyValue('--line-2').trim() || '#ccc';
        c.clearRect(0, 0, long, cross);
        c.fillStyle = bg; c.fillRect(0, 0, long, cross);
        c.strokeStyle = line; c.fillStyle = ink;
        c.font = '9px system-ui, sans-serif'; c.textBaseline = 'top';
        const step = tickStep(k), small = step / 5;
        c.beginPath();
        for (let v = 0; v <= stageLen + 0.001; v += small) {
            const p = Math.round(v * k) + 0.5;
            const big = Math.abs(v / step - Math.round(v / step)) < 1e-6;
            if (axis === 'x') { c.moveTo(p, big ? 6 : 13); c.lineTo(p, thick); }
            else { c.moveTo(big ? 6 : 13, p); c.lineTo(thick, p); }
            if (big && v > 0) {
                const label = String(Math.round(v));
                if (axis === 'x') c.fillText(label, p + 3, 3);
                else { c.save(); c.translate(3, p + 3); c.rotate(-Math.PI / 2); c.textAlign = 'right'; c.fillText(label, 0, 0); c.restore(); }
            }
        }
        c.stroke();
    }

    /* ---------- dragging ---------- */
    _at(e, axis) {
        const r = this.wrap.getBoundingClientRect(), k = this.deck.scale;
        return axis === 'x' ? (e.clientX - r.left) / k : (e.clientY - r.top) / k;
    }
    _down(e) {
        if (e.button !== 0 || !this.deck.isOpen) return;
        const guide = e.target.closest('[data-guide]');
        const ruler = e.target.closest('.ruler');
        if (!guide && !ruler) return;
        e.preventDefault();
        this.el.setPointerCapture(e.pointerId);
        const axis = guide ? guide.dataset.axis : (ruler.classList.contains('ruler-x') ? 'y' : 'x');   // the top ruler drops a horizontal guide
        this.drag = { axis, from: guide ? +guide.dataset.at : null, at: this._at(e, axis) };
        if (guide) guide.classList.add('dragging');
        this._ghost(axis, this.drag.at);
    }
    _move(e) {
        if (!this.drag) return;
        this.drag.at = this._at(e, this.drag.axis);
        this._ghost(this.drag.axis, this.drag.at);
    }
    _up(e) {
        const d = this.drag;
        if (!d) return;
        this.drag = null;
        try { this.el.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
        this._ghost(null);
        const max = d.axis === 'x' ? this.deck.stageW : this.deck.stageH;
        const off = d.at < -4 || d.at > max + 4;              // dropped outside the slide: gone
        this.history.begin(d.from === null ? 'Add guide' : off ? 'Remove guide' : 'Move guide');
        if (d.from !== null) this.remove(d.axis, d.from);
        if (!off) this.add(d.axis, d.at);
        this.history.end();
        this.app.selection.refresh();
    }
    _ghost(axis, at) {
        let g = this.el.querySelector('.guide-ghost');
        if (!axis) { if (g) g.remove(); this.el.querySelectorAll('.dragging').forEach(n => n.classList.remove('dragging')); return; }
        if (!g) { g = document.createElement('i'); g.className = 'guide-ghost'; this.el.appendChild(g); }
        const k = this.deck.scale;
        g.className = 'guide-ghost ' + (axis === 'x' ? 'v' : 'h');
        if (axis === 'x') { g.style.left = at * k + 'px'; g.style.top = '0'; }
        else { g.style.top = at * k + 'px'; g.style.left = '0'; }
        g.dataset.at = Math.round(at);
    }
}
