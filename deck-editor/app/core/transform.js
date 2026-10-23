/* ============================================================
   transform.js - moving, resizing and rotating elements, plus
   the snapping maths used while dragging.

   Where a move is written depends on the element:
   - elements whose CSS already reads --dx/--dy (the deck's reveal
     rule: translate(var(--dx), var(--dy))) get those custom
     properties, so the entrance animation still plays;
   - everything else gets the CSS `translate` property, which
     composes with any transform the author set (a translateX(-50%)
     centring survives) instead of replacing it.
   Rotation always uses the `rotate` property for the same reason.
   Sizes are written as width/height; text elements scale their
   font-size instead, SVG shapes their `scale`.
   ============================================================ */
import { css, win, isShape, isTextLike } from './dom.js';
import { isChart, writeChart } from './chart.js';


/* ------------------------------------------------------------
   Does this element's transform respond to --dx/--dy?
   Reveal classes are the documented fast path; anything else is
   probed once by setting --dx and reading the computed transform
   (with transitions switched off for the probe).
   ------------------------------------------------------------ */
const varsCache = new WeakMap();
export function forgetVars(el) { varsCache.delete(el); }
export function usesVars(el) {
    if (el.matches('.reveal, .reveal-img, .reveal-right')) return true;
    if (varsCache.has(el)) return varsCache.get(el);
    let result = false;
    const slide = el.closest('.slide');
    if (slide && slide.classList.contains('visible') && !isShape(el)) {
        const saved = el.getAttribute('style');
        const cs = css(el);
        const before = cs.transform;
        el.style.transition = 'none';
        el.style.setProperty('--dx', '7px');
        el.style.setProperty('--dy', '0px');
        result = css(el).transform !== before;
        if (saved == null) el.removeAttribute('style'); else el.setAttribute('style', saved);
        varsCache.set(el, result);
    }
    return result;
}

/* ------------------------------------------------------------
   Offset (the move written by the editor) and rotation
   ------------------------------------------------------------ */
export function getOffset(el) {
    let x = 0, y = 0;
    if (usesVars(el)) {
        x = parseFloat(el.style.getPropertyValue('--dx')) || 0;
        y = parseFloat(el.style.getPropertyValue('--dy')) || 0;
    } else {
        const t = (el.style.translate || '').trim().split(/\s+/);
        x = parseFloat(t[0]) || 0;
        y = parseFloat(t[1]) || 0;
    }
    const r = parseFloat(el.style.rotate) || 0;
    return { x, y, r };
}

export function setOffset(el, x, y, r) {
    x = Math.round(x * 10) / 10; y = Math.round(y * 10) / 10;
    if (usesVars(el)) {
        if (x) el.style.setProperty('--dx', x + 'px'); else el.style.removeProperty('--dx');
        if (y) el.style.setProperty('--dy', y + 'px'); else el.style.removeProperty('--dy');
    } else {
        el.style.translate = (x || y) ? `${x}px ${y}px` : '';
    }
    if (r !== undefined) setRotation(el, r);
}

export function setRotation(el, deg) {
    deg = Math.round(deg * 10) / 10;
    if (deg) {
        el.style.rotate = deg + 'deg';
        if (isShape(el)) { el.style.transformBox = 'fill-box'; el.style.transformOrigin = 'center'; }
    } else {
        el.style.rotate = '';
    }
}

/* ------------------------------------------------------------
   Size. `r0` is the element's rect at the start of the drag and
   `font0` its font size then; w/h are the wanted new size.
   ------------------------------------------------------------ */
export function resizeMode(el) {
    if (isShape(el)) return 'shape';
    if (el.matches('[data-math]')) return 'text';          // an equation is sized by its font size, like text
    if (isTextLike(el)) return 'text';
    return 'box';
}

export function applySize(el, mode, { w, h, r0, font0, scale0, axis }) {
    if (mode === 'text') {
        const k = axis === 'x' ? w / r0.w : axis === 'y' ? h / r0.h : Math.max(w / r0.w, h / r0.h);
        el.style.fontSize = Math.max(6, Math.round(font0 * k)) + 'px';
    } else if (mode === 'shape') {
        const k = axis === 'x' ? w / r0.w : axis === 'y' ? h / r0.h : Math.max(w / r0.w, h / r0.h);
        el.style.transformBox = 'fill-box';
        el.style.transformOrigin = 'center';
        el.style.scale = String(Math.max(0.05, (scale0 || 1) * k).toFixed(3));
    } else {
        if (axis !== 'y') el.style.width = Math.max(1, Math.round(w)) + 'px';
        if (axis !== 'x') el.style.height = Math.max(1, Math.round(h)) + 'px';
        if (el.tagName === 'IMG' || el.tagName === 'VIDEO') { el.style.maxWidth = 'none'; el.style.maxHeight = 'none'; }
        afterResize(el);
    }
}

/* Shrink to fit (data-fit="shrink"): the text's font size steps down from the size it was given
   (data-fit-size, the inline size when the fit was turned on, or the deck's) until the text no
   longer overflows its box, never below 8px; when there is room again it grows back to that size.
   Returns true when the inline font-size changed. */
export function fitText(el) {
    if (!el || el.getAttribute('data-fit') !== 'shrink' || !el.isConnected) return false;
    const before = el.style.fontSize;
    const base = el.getAttribute('data-fit-size') || '';
    el.style.fontSize = base;
    const overflows = () => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    if (overflows()) {
        let size = parseFloat(css(el).fontSize) || 16;
        for (let i = 0; i < 40 && size > 8 && overflows(); i++) { size = Math.max(8, Math.round(size * 0.94 * 10) / 10); el.style.fontSize = size + 'px'; }
    }
    return el.style.fontSize !== before;
}
/* Every shrink-to-fit text in `root` refitted; the ones whose size changed. */
export function refitAll(root) {
    const out = [];
    if (root) for (const el of root.querySelectorAll('[data-fit="shrink"]')) if (fitText(el)) out.push(el);
    return out;
}

/* Charts render into their host; tell them the host changed size. The editor's own charts
   (data-chart) are drawn again for the new box. */
export function afterResize(el) {
    const w = win(el);
    if (isChart(el)) writeChart(el);
    if (el.dataset.fig && w.Plotly && el._fullLayout) {
        w.Plotly.relayout(el, { width: el.clientWidth, height: el.clientHeight });
    }
    el.dispatchEvent(new w.CustomEvent('deck:resize', { bubbles: true, detail: { width: el.clientWidth, height: el.clientHeight } }));
}

/* ------------------------------------------------------------
   Snapping. `targets` is a list of stage-space rects (other
   elements, slide edges); `box` is the moving rect. Returns the
   snapped position and the guide lines to draw.
   ------------------------------------------------------------ */
export function snapLines(targets, stage, extra = null) {
    const xs = new Set([0, stage.w / 2, stage.w]), ys = new Set([0, stage.h / 2, stage.h]);
    for (const t of targets) {
        xs.add(t.x); xs.add(t.x + t.w / 2); xs.add(t.x + t.w);
        ys.add(t.y); ys.add(t.y + t.h / 2); ys.add(t.y + t.h);
    }
    if (extra) { for (const v of extra.xs || []) xs.add(v); for (const v of extra.ys || []) ys.add(v); }
    return { xs: Array.from(xs), ys: Array.from(ys) };
}

export function snapBox(box, lines, threshold) {
    const cand = (v, list) => {
        let best = null, dist = threshold;
        for (const l of list) { const d = Math.abs(l - v); if (d < dist) { dist = d; best = l; } }
        return best;
    };
    let dx = 0, dy = 0, gx = null, gy = null;
    const edgesX = [box.x, box.x + box.w / 2, box.x + box.w];
    const edgesY = [box.y, box.y + box.h / 2, box.y + box.h];
    let bx = threshold, by = threshold;
    for (const e of edgesX) { const s = cand(e, lines.xs); if (s !== null && Math.abs(s - e) < bx) { bx = Math.abs(s - e); dx = s - e; gx = s; } }
    for (const e of edgesY) { const s = cand(e, lines.ys); if (s !== null && Math.abs(s - e) < by) { by = Math.abs(s - e); dy = s - e; gy = s; } }
    return { dx, dy, gx, gy };
}
