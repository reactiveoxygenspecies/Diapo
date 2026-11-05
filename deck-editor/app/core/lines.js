/* ============================================================
   lines.js - lines and arrows the editor draws: a straight or
   curved stroke between two points, with a head at either end.

   A line is one plain inline <svg>:

       <svg data-line="x1 y1 x2 y2" data-curve="cx cy"
            data-head-start="none" data-head-end="arrow" data-head-size="1"
            data-dash="dashed" stroke-width="6" stroke-linecap="round"
            style="position:absolute; left:..; top:..; width:..; height:..; color:#2f6fed">
          <path .../> ...   (the stroke, the heads, and a wide transparent
       </svg>                path that makes a thin line easy to click)

   - The points are in the svg's own pixels; its viewBox is its box, so
     the stroke never scales and the heads keep their proportions. The
     box is always the bounding box of the line and its heads (at least
     2 px), moved and aligned like any other element, so grouping,
     copying, animation and export need to know nothing about lines.
   - data-curve is the point the curve passes through half way along
     (a quadratic Bezier): the handle on the line, which is what you
     grab to bend it. No data-curve: a straight line.
   - The heads are drawn as paths from the end tangent (no <marker>, so
     nothing to keep unique when an arrow is copied). The stroke stops
     where the head's body begins, so a wide line never pokes through.
   - The colour is `color` (stroke and heads are currentColor), so the
     Colour section of the panel recolours a line like text.
   - layout() is the one place that writes a line: it draws the paths
     and fits the box round them, keeping the line where it was on the
     slide (also when the box is rotated).
   ============================================================ */
import { isLocked } from './dom.js';
import { snapLines } from './transform.js';
import { styleCmd } from './history.js';

const NS = 'http://www.w3.org/2000/svg';
const SNAP_PX = 6;                    // screen px, like moving and resizing
const DRAG_STEP = Math.PI / 12;       // Shift: 15 degrees

export const HEADS = [['none', 'None'], ['arrow', 'Arrow'], ['open', 'Open arrow'], ['triangle', 'Triangle'], ['circle', 'Circle'], ['bar', 'Bar']];
const HEAD_KEYS = HEADS.map(h => h[0]);

export function isLine(el) { return !!el && el.nodeType === 1 && typeof el.matches === 'function' && el.matches('svg[data-line]'); }

const n2 = (v) => +(+v).toFixed(2);
const nums = (s) => String(s || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function unit(v, fallback) { const l = Math.hypot(v[0], v[1]); return l < 1e-6 ? fallback : [v[0] / l, v[1] / l]; }

/* ------------------------------------------------------------
   Reading
   ------------------------------------------------------------ */
/* The geometry: end points and the optional point the curve passes through. */
export function readModel(el) {
    const p = nums(el.getAttribute('data-line'));
    if (p.length < 4 || p.slice(0, 4).some(v => !Number.isFinite(v))) return null;
    const c = nums(el.getAttribute('data-curve'));
    return { a: [p[0], p[1]], b: [p[2], p[3]], c: c.length >= 2 && c.every(Number.isFinite) ? [c[0], c[1]] : null };
}
/* How it looks: width, heads, dash, cap. */
export function readLook(el) {
    const head = (v) => HEAD_KEYS.includes(v) ? v : 'none';
    const w = parseFloat(el.getAttribute('stroke-width'));
    const cap = el.getAttribute('stroke-linecap');
    const dash = el.getAttribute('data-dash');
    return {
        w: w > 0 ? w : 4,
        start: head(el.getAttribute('data-head-start')), end: head(el.getAttribute('data-head-end')),
        hs: clamp(parseFloat(el.getAttribute('data-head-size')) || 1, 0.4, 4),
        dash: dash === 'dashed' || dash === 'dotted' ? dash : '',
        cap: cap === 'butt' || cap === 'square' ? cap : 'round',
    };
}

/* ------------------------------------------------------------
   Geometry
   ------------------------------------------------------------ */
/* The quadratic's control point: the curve passes through c at t = 0.5, so 2c - (a+b)/2. */
function control(m) {
    return m.c ? [2 * m.c[0] - (m.a[0] + m.b[0]) / 2, 2 * m.c[1] - (m.a[1] + m.b[1]) / 2] : [(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2];
}
function at(m, q, t) {
    const u = 1 - t;
    return [u * u * m.a[0] + 2 * u * t * q[0] + t * t * m.b[0], u * u * m.a[1] + 2 * u * t * q[1] + t * t * m.b[1]];
}
/* Half way along: the curve's own point, or the middle of a straight line. */
export function midpoint(m) { return m.c || [(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2]; }
/* A bend for a line that has none: a quarter of its length, to the left of its direction. */
export function defaultBend(m) {
    const d = sub(m.b, m.a), len = Math.hypot(d[0], d[1]);
    if (len < 1) return null;
    const mid = [(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2];
    return [mid[0] + d[1] / len * len * 0.25, mid[1] - d[0] / len * len * 0.25];
}
/* The centre line, untrimmed (the click target and the highlight). */
export function pathD(m) {
    const f = (p) => n2(p[0]) + ' ' + n2(p[1]);
    return m.c ? `M${f(m.a)} Q${f(control(m))} ${f(m.b)}` : `M${f(m.a)} L${f(m.b)}`;
}

/* Where along the curve, measured from one end, the distance from that end reaches `dist`: the
   parameter t, or null when the line is shorter than that. */
function paramAt(m, q, fromEnd, dist) {
    const P = fromEnd ? m.b : m.a, N = 48;
    const far = (s) => { const p = at(m, q, fromEnd ? 1 - s : s); return Math.hypot(p[0] - P[0], p[1] - P[1]); };
    for (let i = 1; i <= N; i++) {
        if (far(i / N) < dist) continue;
        let lo = (i - 1) / N, hi = i / N;
        for (let j = 0; j < 14; j++) { const mid = (lo + hi) / 2; if (far(mid) >= dist) hi = mid; else lo = mid; }
        return fromEnd ? 1 - hi : hi;
    }
    return null;
}

/* A head: its outline, how far the stroke is cut back so it does not poke through, and the points
   that bound it. The tip (or, for the circle, the far edge) is exactly on the end point. */
function headShape(type, tip, u, L, w) {
    const nn = [-u[1], u[0]];
    const P = (f, s) => [tip[0] + u[0] * f + nn[0] * s, tip[1] + u[1] * f + nn[1] * s];
    const poly = (pts, close) => 'M' + pts.map(p => n2(p[0]) + ' ' + n2(p[1])).join('L') + (close ? 'Z' : '');
    if (type === 'arrow') {             // swept back: the notch is behind the barbs
        const pts = [P(0, 0), P(-L, 0.4 * L), P(-0.72 * L, 0), P(-L, -0.4 * L)];
        return { d: poly(pts, true), fill: true, inset: 0.6 * L, pts };
    }
    if (type === 'triangle') {
        const pts = [P(0, 0), P(-L, 0.4 * L), P(-L, -0.4 * L)];
        return { d: poly(pts, true), fill: true, inset: 0.85 * L, pts };
    }
    if (type === 'open') {              // two strokes meeting at the tip; the round join reaches the end point
        const pts = [P(-0.8 * L - w / 2, 0.42 * L), P(-w / 2, 0), P(-0.8 * L - w / 2, -0.42 * L)];
        return { d: poly(pts, false), fill: false, cap: 'round', inset: w / 2, pts };
    }
    if (type === 'circle') {
        const r = 0.3 * L, c = P(-r, 0);
        return { d: `M${n2(c[0] - r)} ${n2(c[1])}a${n2(r)} ${n2(r)} 0 1 0 ${n2(2 * r)} 0a${n2(r)} ${n2(r)} 0 1 0 ${n2(-2 * r)} 0Z`, fill: true, inset: r, pts: [[c[0] - r, c[1] - r], [c[0] + r, c[1] + r]] };
    }
    if (type === 'bar') {
        const h = 0.45 * L, pts = [P(-w / 2, h), P(-w / 2, -h)];
        return { d: poly(pts, false), fill: false, cap: 'butt', inset: w / 2, pts: [P(0, h), P(0, -h), P(-w, h), P(-w, -h)] };
    }
    return null;
}

function quadExtrema(p0, q, p1) {
    const out = [];
    for (let i = 0; i < 2; i++) {
        const den = p0[i] - 2 * q[i] + p1[i];
        if (Math.abs(den) < 1e-9) continue;
        const t = (p0[i] - q[i]) / den;
        if (t > 0 && t < 1) {
            const u = 1 - t;
            out.push([u * u * p0[0] + 2 * u * t * q[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * q[1] + t * t * p1[1]]);
        }
    }
    return out;
}

/* Everything drawn for a line, in the coordinates of its model: the stroke (trimmed at the heads),
   the heads, and the points that bound them. */
function build(m, look) {
    const curved = !!m.c, q = control(m);
    const L = look.hs * Math.max(16, 4 * look.w);
    const chord = unit(sub(m.b, m.a), [1, 0]);
    const dEnd = unit(curved ? sub(m.b, q) : sub(m.b, m.a), chord);
    const dStart = unit(curved ? sub(m.a, q) : sub(m.a, m.b), [-chord[0], -chord[1]]);
    const hs = look.start !== 'none' ? headShape(look.start, m.a, dStart, L, look.w) : null;
    const he = look.end !== 'none' ? headShape(look.end, m.b, dEnd, L, look.w) : null;
    const t0 = hs ? paramAt(m, q, false, hs.inset) : 0, t1 = he ? paramAt(m, q, true, he.inset) : 1;
    const pts = [];
    let d = '';
    if (t0 !== null && t1 !== null && t1 - t0 > 1e-3) {
        const P0 = at(m, q, t0), P1 = at(m, q, t1);
        const f = (p) => n2(p[0]) + ' ' + n2(p[1]);
        if (curved) {
            const k = t1 - t0;
            const Q = [P0[0] + k * ((1 - t0) * (q[0] - m.a[0]) + t0 * (m.b[0] - q[0])), P0[1] + k * ((1 - t0) * (q[1] - m.a[1]) + t0 * (m.b[1] - q[1]))];
            d = `M${f(P0)} Q${f(Q)} ${f(P1)}`;
            pts.push(P0, P1, ...quadExtrema(P0, Q, P1));
        } else {
            d = `M${f(P0)} L${f(P1)}`;
            pts.push(P0, P1);
        }
    } else pts.push(m.a, m.b);
    const heads = [];
    for (const h of [hs, he]) if (h) { heads.push(h); pts.push(...h.pts); }
    return { d, heads, pts, L };
}

/* ------------------------------------------------------------
   Writing: draw the paths, fit the box round them
   ------------------------------------------------------------ */
function boxOf(el) {
    const st = el.style;
    return { l: parseFloat(st.left) || 0, t: parseFloat(st.top) || 0, w: parseFloat(st.width) || 0, h: parseFloat(st.height) || 0, r: (parseFloat(st.rotate) || 0) * Math.PI / 180 };
}

/* Draw the line for model `m` (in the svg's current coordinates), refit the box round it and put
   the box where it keeps the line in place on the slide. Returns the model in the new
   coordinates. */
export function layout(el, m) {
    const look = readLook(el);
    const g0 = build(m, look);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of g0.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    if (x1 - x0 < 2) { const c = (x0 + x1) / 2; x0 = c - 1; x1 = c + 1; }
    if (y1 - y0 < 2) { const c = (y0 + y1) / 2; y0 = c - 1; y1 = c + 1; }
    x0 = n2(x0); y0 = n2(y0);
    const W = n2(x1 - x0), H = n2(y1 - y0);
    const sh = (p) => [n2(p[0] - x0), n2(p[1] - y0)];
    const m2 = { a: sh(m.a), b: sh(m.b), c: m.c ? sh(m.c) : null };
    const g = build(m2, look);

    // The old box's centre moves so that the point (x0, y0) of the old frame stays where it was.
    const o = boxOf(el), cos = Math.cos(o.r), sin = Math.sin(o.r);
    const v = [x0 - o.w / 2 + W / 2, y0 - o.h / 2 + H / 2];
    const cx = o.l + o.w / 2 + v[0] * cos - v[1] * sin, cy = o.t + o.h / 2 + v[0] * sin + v[1] * cos;
    const st = el.style;
    st.position = st.position || 'absolute';
    st.left = n2(cx - W / 2) + 'px'; st.top = n2(cy - H / 2) + 'px';
    st.width = W + 'px'; st.height = H + 'px';
    st.maxWidth = 'none'; st.maxHeight = 'none'; st.overflow = 'visible';

    const hit = Math.max(look.w + 8, 22);
    const dash = look.dash === 'dashed' ? ` stroke-dasharray="${n2(Math.max(look.w, 2) * 3)} ${n2(Math.max(look.w, 2) * 2.2)}"`
        : look.dash === 'dotted' ? ` stroke-linecap="round" stroke-dasharray="0.01 ${n2(Math.max(look.w * 2.2, 5))}"` : '';
    let html = `<path data-hit d="${pathD(m2)}" fill="none" stroke="transparent" stroke-width="${n2(hit)}" stroke-linecap="round" pointer-events="stroke"/>`;
    if (g.d) html += `<path d="${g.d}"${dash}/>`;
    for (const h of g.heads) {
        html += h.fill ? `<path d="${h.d}" fill="currentColor" stroke="none"/>`
            : `<path d="${h.d}" stroke-linecap="${h.cap}" stroke-linejoin="round"/>`;
    }
    el.innerHTML = html;
    el.setAttribute('viewBox', `0 0 ${W} ${H}`);
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', String(n2(look.w)));
    el.setAttribute('stroke-linecap', look.cap);
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('overflow', 'visible');
    el.setAttribute('pointer-events', 'none');
    el.removeAttribute('preserveAspectRatio');
    el.setAttribute('data-line', `${n2(m2.a[0])} ${n2(m2.a[1])} ${n2(m2.b[0])} ${n2(m2.b[1])}`);
    if (m2.c) el.setAttribute('data-curve', `${n2(m2.c[0])} ${n2(m2.c[1])}`); else el.removeAttribute('data-curve');
    return m2;
}

/* The margin the drawing needs round the box (stroke and heads reach outside it): for exporters. */
export function bleed(el) {
    const look = readLook(el);
    const L = look.hs * Math.max(16, 4 * look.w);
    return Math.ceil(Math.max(look.w * 1.5, (look.start !== 'none' || look.end !== 'none') ? L * 0.5 : 0, 4)) + 2;
}

/* ------------------------------------------------------------
   Making a line
   ------------------------------------------------------------ */
export const KINDS = {
    line: { label: 'line', start: 'none', end: 'none', bend: false },
    arrow: { label: 'arrow', start: 'none', end: 'arrow', bend: false },
    curved: { label: 'curved arrow', start: 'none', end: 'arrow', bend: true },
    double: { label: 'double arrow', start: 'arrow', end: 'arrow', bend: false },
};

/* A new line from stage point a to stage point b (not in the document yet). */
export function createLine(app, kind, a, b) {
    const k = KINDS[kind] || KINDS.arrow;
    const d = app.insert.defaults(), doc = app.deck.doc;
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('data-line', `${n2(a[0])} ${n2(a[1])} ${n2(b[0])} ${n2(b[1])}`);
    if (k.start !== 'none') svg.setAttribute('data-head-start', k.start);
    if (k.end !== 'none') svg.setAttribute('data-head-end', k.end);
    svg.setAttribute('stroke-width', '6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.style.position = 'absolute';
    svg.style.left = '0px'; svg.style.top = '0px';
    svg.style.color = d.accent;
    const m = { a: [a[0], a[1]], b: [b[0], b[1]], c: null };
    if (k.bend) m.c = defaultBend(m);
    layout(svg, m);
    return svg;
}

/* ------------------------------------------------------------
   Undo: a line changes its attributes, its style and its drawing together
   ------------------------------------------------------------ */
const SNAP_ATTRS = ['data-line', 'data-curve', 'data-head-start', 'data-head-end', 'data-head-size', 'data-dash', 'stroke-width', 'stroke-linecap', 'viewBox'];
export function snapshot(el) {
    return { style: el.getAttribute('style'), html: el.innerHTML, attrs: SNAP_ATTRS.map(n => el.getAttribute(n)) };
}
const same = (a, b) => a.style === b.style && a.html === b.html && a.attrs.every((v, i) => v === b.attrs[i]);
function restore(el, s) {
    if (s.style == null) el.removeAttribute('style'); else el.setAttribute('style', s.style);
    SNAP_ATTRS.forEach((n, i) => { if (s.attrs[i] == null) el.removeAttribute(n); else el.setAttribute(n, s.attrs[i]); });
    el.innerHTML = s.html;
}
function lineCmd(el, before, after, label, key = null) {
    return {
        label, key, el, before, after,
        undo() { restore(el, this.before); },
        redo() { restore(el, this.after); },
        merge(next) { this.after = next.after; },
    };
}
/* Change a line (fn writes it) as one undo step. Returns whether anything changed. */
export function edit(app, el, label, fn, key = null) {
    app.history.remember(el);
    const before = snapshot(el);
    app.deck.withoutTransitions(() => fn(el));
    const after = snapshot(el);
    if (same(before, after)) return false;
    app.history.push(lineCmd(el, before, after, label, key));
    app.selection.refresh();
    return true;
}

/* ------------------------------------------------------------
   Older arrows: a fixed 480x24 picture stretched to its box. They keep working as plain boxes;
   this turns one into a line, in place.
   ------------------------------------------------------------ */
export function isLegacyLine(el) {
    return !!el && el.nodeType === 1 && el.matches('svg') && !el.hasAttribute('data-line') && el.getAttribute('viewBox') === '0 0 480 24'
        && !!el.querySelector('path[d^="M6 12h"]') && el.style.position === 'absolute' && /px$/.test(el.style.left) && /px$/.test(el.style.top)
        && !el.style.scale && !el.closest('[data-fig], [data-svg]');
}
export function upgradeLegacy(app, el) {
    if (!isLegacyLine(el)) return false;
    const arrow = el.querySelectorAll('path').length > 1;
    return edit(app, el, 'Edit arrow', (n) => {
        const W = parseFloat(n.style.width) || 480, H = parseFloat(n.style.height) || 24;
        const s = Math.min(W / 480, H / 24), ox = (W - 480 * s) / 2, oy = (H - 24 * s) / 2;
        const colour = n.getAttribute('stroke');
        if (colour && colour !== 'currentColor') n.style.color = colour;
        n.setAttribute('stroke-width', String(n2((parseFloat(n.getAttribute('stroke-width')) || 6) * s)));
        n.setAttribute('data-line', `${n2(ox + 6 * s)} ${n2(oy + 12 * s)} ${n2(ox + (arrow ? 468 : 474) * s)} ${n2(oy + 12 * s)}`);
        if (arrow) n.setAttribute('data-head-end', 'arrow');
        layout(n, readModel(n));
    });
}

/* ------------------------------------------------------------
   Pointer maths: the svg's own pixels <-> the editor's client pixels, through the
   browser's matrix, so rotation, scale and a rotated group all come out right.
   ------------------------------------------------------------ */
function matrixOf(el) {
    const m = el.getScreenCTM();
    return m ? { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f } : null;
}
const applyM = (m, x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
function invertM(m) {
    const det = m.a * m.d - m.b * m.c;
    if (!det) return null;
    return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
}

/* ============================================================
   LineTool - the canvas side: end handles and the bend handle over a
   selected line, dragging them, and drawing a new line by dragging.
   Selection owns the pointer; it hands over when a press lands on one
   of these handles or while a draw tool is armed.
   ============================================================ */
export class LineTool {
    constructor(app, selection) {
        this.app = app;
        this.sel = selection;
        this.armed = null;
        const layer = document.createElement('div');
        layer.className = 'ov-lines';
        layer.hidden = true;
        layer.innerHTML = '<svg class="ov-line-path"><g><path/></g></svg>'
            + '<i class="ov-lh" data-lh="a" title="Drag to move this end (Shift: 15 degree steps)"></i>'
            + '<i class="ov-lh" data-lh="b" title="Drag to move this end (Shift: 15 degree steps)"></i>'
            + '<i class="ov-lh" data-lh="c" title="Drag to bend (double-click to straighten)"></i>';
        selection.overlay.appendChild(layer);
        this.layer = layer;
        this.g = layer.querySelector('g');
        this.path = layer.querySelector('path');
        this.handles = { a: layer.querySelector('[data-lh=a]'), b: layer.querySelector('[data-lh=b]'), c: layer.querySelector('[data-lh=c]') };
    }

    get wrapRect() { return this.sel.wrap.getBoundingClientRect(); }
    /* The editor's client coordinates of a point of the line's own frame, and back. */
    toClient(el, p) {
        const M = matrixOf(el), w = this.wrapRect;
        const q = applyM(M, p[0], p[1]);
        return [q[0] + w.left, q[1] + w.top];
    }
    toLocal(el, cx, cy) {
        const M = invertM(matrixOf(el)), w = this.wrapRect;
        return applyM(M, cx - w.left, cy - w.top);
    }

    /* ------------------------------------------------------------
       Handles over the selection (called from Selection.refresh)
       ------------------------------------------------------------ */
    refresh() {
        const sel = this.sel, el = sel.single;
        const on = !!el && isLine(el) && el.isConnected && sel.deck.isOpen && !isLocked(el) && !sel.overlay.classList.contains('editing');
        const M = on && matrixOf(el), m = M && readModel(el);
        this.layer.hidden = !(M && m);
        if (this.layer.hidden) return;
        this.g.setAttribute('transform', `matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})`);
        this.path.setAttribute('d', pathD(m));
        const put = (key, p) => { const q = applyM(M, p[0], p[1]); Object.assign(this.handles[key].style, { left: q[0] + 'px', top: q[1] + 'px' }); };
        put('a', m.a); put('b', m.b); put('c', midpoint(m));
        this.handles.c.classList.toggle('curved', !!m.c);
    }

    /* ------------------------------------------------------------
       Dragging a handle
       ------------------------------------------------------------ */
    _lines(el) {
        const sel = this.sel;
        return snapLines(sel._snapTargets([el]), { w: sel.deck.stageW, h: sel.deck.stageH }, this.app.rulers && this.app.rulers.lines());
    }

    /* A press on a handle of the selected line. */
    down(e, start, which) {
        const sel = this.sel, el = sel.single;
        if (!isLine(el) || isLocked(el)) return false;
        const m = readModel(el); if (!m) return false;
        const p = this.toClient(el, which === 'a' ? m.a : which === 'b' ? m.b : midpoint(m));
        this.app.history.remember(el);
        sel.deck.setTransitions(false);
        sel.drag = {
            kind: 'line', which, el, start, moved: false, grab: [p[0] - e.clientX, p[1] - e.clientY],
            before: snapshot(el), lines: this._lines(el),
            label: which === 'c' ? 'Bend line' : 'Move line end',
        };
        sel.showHover(null);
        return true;
    }

    /* Drawing: Insert > Line / Arrow / ... arms the tool; the next press on the canvas starts the line. */
    arm(kind) {
        this.armed = KINDS[kind] ? kind : 'arrow';
        this.sel.overlay.classList.add('drawing-line');
        this.sel.showHover(null);
        this.app.toast(`Drag on the slide to draw the ${KINDS[this.armed].label} (Shift: 15 degree steps). A click places a default one; Esc cancels.`, { ms: 4500 });
    }
    disarm() {
        this.armed = null;
        this.sel.overlay.classList.remove('drawing-line');
    }
    startDraw(e, start) {
        const sel = this.sel;
        if (!sel.deck.currentSlide) { this.disarm(); return false; }
        sel.deck.setTransitions(false);
        sel.drag = { kind: 'line', draw: true, which: 'b', start, moved: false, grab: [0, 0], el: null, kindName: this.armed };
        return true;
    }

    move(e, d) {
        const sel = this.sel, k = sel.deck.scale;
        if (d.draw && !d.el) {
            const a = sel.toStage(d.start.x, d.start.y);
            const el = createLine(this.app, d.kindName, [a.x, a.y], [a.x, a.y]);
            this.app.history.begin('Insert ' + KINDS[d.kindName].label);
            d.transaction = true;
            if (!this.app.insert.add(el, 'Insert ' + KINDS[d.kindName].label)) { this.app.history.cancel(); d.transaction = false; this.disarm(); sel.drag = null; return; }
            d.el = el; d.lines = this._lines(el); d.bend = KINDS[d.kindName].bend;
        }
        const el = d.el, m = readModel(el); if (!m) return;
        let cx = e.clientX + d.grab[0], cy = e.clientY + d.grab[1];
        let gx = null, gy = null;
        const free = e.ctrlKey || e.metaKey;                    // Ctrl: no snapping
        if (d.which === 'c') {
            const [px, py] = this.toLocal(el, cx, cy);
            const mid = [(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2];
            const ch = sub(m.b, m.a), len = Math.hypot(ch[0], ch[1]);
            if (len < 1) return;
            const u = [ch[0] / len, ch[1] / len], v = [-u[1], u[0]];
            let du = (px - mid[0]) * u[0] + (py - mid[1]) * u[1], dv = (px - mid[0]) * v[0] + (py - mid[1]) * v[1];
            let straight = false;
            if (!free) {                                         // an arc is symmetric unless pulled aside; pulled flat it straightens
                if (Math.abs(du) * k < 8) du = 0;
                if (Math.abs(dv) * k < 7) straight = true;
            }
            m.c = straight ? null : [mid[0] + u[0] * du + v[0] * dv, mid[1] + u[1] * du + v[1] * dv];
        } else {
            const other = d.which === 'a' ? m.b : m.a;
            if (e.shiftKey) {
                const O = this.toClient(el, other);
                const len = Math.hypot(cx - O[0], cy - O[1]);
                const ang = Math.round(Math.atan2(cy - O[1], cx - O[0]) / DRAG_STEP) * DRAG_STEP;
                cx = O[0] + len * Math.cos(ang); cy = O[1] + len * Math.sin(ang);
            } else if (!free && d.lines) {
                // Other elements' edges and centres, the guides, and the other end (to draw it level).
                const O = sel.toStage(...this.toClient(el, other)), s = sel.toStage(cx, cy), thr = SNAP_PX / k;
                const near = (v, list) => { let best = null, dist = thr; for (const l of list) { const dd = Math.abs(l - v); if (dd < dist) { dist = dd; best = l; } } return best; };
                const bx = near(s.x, [...d.lines.xs, O.x]), by = near(s.y, [...d.lines.ys, O.y]);
                if (bx !== null) { cx += (bx - s.x) * k; gx = bx; }
                if (by !== null) { cy += (by - s.y) * k; gy = by; }
            }
            const p = this.toLocal(el, cx, cy);
            m[d.which] = p;
            if (d.bend) m.c = defaultBend(m);
        }
        layout(el, m);
        d.moved = true;
        sel.showGuides(gx, gy);
        sel.refresh();
    }

    /* The release of a handle or of a draw. */
    finish(e, d) {
        const sel = this.sel;
        if (d.draw) {
            if (!d.el) {                                         // a click: a default one centred on it
                const p = sel.toStage(e.clientX, e.clientY), half = 200;
                const el = createLine(this.app, d.kindName, [p.x - half, p.y], [p.x + half, p.y]);
                this.app.insert.add(el, 'Insert ' + KINDS[d.kindName].label);
            } else if (d.transaction) this.app.history.end();
            this.disarm();
            sel.refresh();
            return;
        }
        if (!d.moved) return;
        const after = snapshot(d.el);
        if (!same(d.before, after)) this.app.history.push(lineCmd(d.el, d.before, after, d.label));
        sel.refresh();
    }

    /* Which handle is under the pointer ('a', 'b', 'c') or null. */
    handleAt(e) {
        if (this.layer.hidden) return null;
        for (const key of ['c', 'a', 'b']) {
            const r = this.handles[key].getBoundingClientRect();
            if (e.clientX >= r.left - 3 && e.clientX <= r.right + 3 && e.clientY >= r.top - 3 && e.clientY <= r.bottom + 3) return key;
        }
        return null;
    }

    /* Double-click on the bend handle: straight again. */
    straighten() {
        const el = this.sel.single; if (!isLine(el)) return;
        edit(this.app, el, 'Straighten line', (n) => { const m = readModel(n); m.c = null; layout(n, m); });
    }
}

/* ============================================================
   LineSection - the Line part of the properties panel: width, dash,
   cap, the two heads and their size, straight or curved, flip. The
   colour is the Colour section's Text colour, relabelled "Line".
   ============================================================ */
export class LineSection {
    constructor(app, root) {
        this.app = app;
        this.root = root;
        this.el = null;
        const opts = HEADS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
        root.innerHTML = `
          <h4>Line</h4>
          <div id="lnOld" hidden>
            <div class="insp-hint">An older arrow, drawn as a stretched picture. Make it an editable line to move its ends, bend it and change its heads.</div>
            <div class="insp-btns"><button class="mini-btn" data-ln="upgrade">Make it an editable line</button></div>
          </div>
          <div id="lnBody">
            <div class="insp-row"><label>Width</label><div class="insp-field insp-range"><input type="range" id="lnWidth" min="1" max="40" step="1"><span id="lnWidthV" class="unit"></span></div></div>
            <div class="insp-row"><label>Dashes</label><div class="insp-field insp-seg" id="lnDash"><button data-v="" title="Solid">Solid</button><button data-v="dashed" title="Dashed">Dashed</button><button data-v="dotted" title="Dotted">Dotted</button></div></div>
            <div class="insp-row"><label>Ends</label><div class="insp-field insp-seg" id="lnCap"><button data-v="butt" title="Flat ends">Flat</button><button data-v="round" title="Round ends">Round</button><button data-v="square" title="Square ends">Square</button></div></div>
            <div class="insp-row"><label>Start</label><div class="insp-field"><select id="lnStart" title="The head at the start">${opts}</select></div></div>
            <div class="insp-row"><label>End</label><div class="insp-field"><select id="lnEnd" title="The head at the end">${opts}</select></div></div>
            <div class="insp-row"><label>Head size</label><div class="insp-field insp-range"><input type="range" id="lnHead" min="0.5" max="3" step="0.1"><span id="lnHeadV" class="unit"></span></div></div>
            <div class="insp-row"><label>Shape</label><div class="insp-field insp-seg" id="lnShape"><button data-v="straight" title="Straight">Straight</button><button data-v="curved" title="Curved: drag the dot in the middle of the line to bend it">Curved</button></div></div>
            <div class="insp-btns"><button class="mini-btn" data-ln="flip" title="Swap the two ends, heads included">Flip direction</button></div>
            <div class="insp-hint">Drag the ends to move them (Shift: 15 degree steps), the dot in the middle to bend; double-click that dot to straighten.</div>
          </div>`;
        const $ = (id) => root.querySelector('#' + id);
        this.$ = $;
        const change = (label, fn, key) => { if (this.el) edit(app, this.el, label, fn, key); };
        const relayout = (el) => layout(el, readModel(el));
        $('lnWidth').addEventListener('input', () => change('Line width', (el) => { el.setAttribute('stroke-width', $('lnWidth').value); relayout(el); }, 'line-width'));
        $('lnHead').addEventListener('input', () => change('Head size', (el) => { el.setAttribute('data-head-size', $('lnHead').value); relayout(el); }, 'line-head-size'));
        $('lnStart').addEventListener('change', () => change('Start head', (el) => { el.setAttribute('data-head-start', $('lnStart').value); relayout(el); }));
        $('lnEnd').addEventListener('change', () => change('End head', (el) => { el.setAttribute('data-head-end', $('lnEnd').value); relayout(el); }));
        $('lnDash').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-v]'); if (!b) return;
            change('Line dashes', (el) => { if (b.dataset.v) el.setAttribute('data-dash', b.dataset.v); else el.removeAttribute('data-dash'); relayout(el); });
            this.sync(this.el);
        });
        $('lnCap').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-v]'); if (!b) return;
            change('Line ends', (el) => { el.setAttribute('stroke-linecap', b.dataset.v); relayout(el); });
            this.sync(this.el);
        });
        $('lnShape').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-v]'); if (!b) return;
            change(b.dataset.v === 'curved' ? 'Curve line' : 'Straighten line', (el) => {
                const m = readModel(el);
                m.c = b.dataset.v === 'curved' ? (m.c || defaultBend(m)) : null;
                layout(el, m);
            });
            this.sync(this.el);
        });
        root.addEventListener('click', (e) => {
            const b = e.target.closest('[data-ln]'); if (!b || !this.el) return;
            if (b.dataset.ln === 'upgrade') upgradeLegacy(app, this.el);
            if (b.dataset.ln === 'flip') {
                change('Flip direction', (el) => {
                    const m = readModel(el), look = readLook(el);
                    [m.a, m.b] = [m.b, m.a];
                    for (const [n, v] of [['data-head-start', look.end], ['data-head-end', look.start]]) { if (v === 'none') el.removeAttribute(n); else el.setAttribute(n, v); }
                    layout(el, m);
                });
            }
            this.sync(this.el);
        });
    }

    sync(el) {
        const line = isLine(el), old = !line && isLegacyLine(el);
        this.el = line || old ? el : null;
        this.root.hidden = !this.el;
        if (!this.el) return;
        this.$('lnOld').hidden = !old;
        this.$('lnBody').hidden = !line;
        if (!line) return;
        const look = readLook(el), m = readModel(el);
        const $ = this.$;
        if (document.activeElement !== $('lnWidth')) $('lnWidth').value = look.w;
        $('lnWidthV').textContent = Math.round(look.w * 10) / 10 + ' px';
        if (document.activeElement !== $('lnHead')) $('lnHead').value = look.hs;
        $('lnHeadV').textContent = Math.round(look.hs * 100) + '%';
        $('lnStart').value = look.start; $('lnEnd').value = look.end;
        const mark = (id, v) => this.root.querySelectorAll('#' + id + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
        mark('lnDash', look.dash); mark('lnCap', look.cap); mark('lnShape', m && m.c ? 'curved' : 'straight');
        $('lnHead').disabled = look.start === 'none' && look.end === 'none';
    }
}
