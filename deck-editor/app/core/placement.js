/* ============================================================
   placement.js - where a new element lands on the slide.

   One routine for every insert (text, lists, tables, code, shapes,
   lines, icons, charts, equations, structures, pictures, video,
   audio, embeds, pasted pictures and text):
   - the slide centre, when that area is free;
   - otherwise the position on a grid, nearest the centre, that
     overlaps what the slide already shows least, kept inside the
     slide margins;
   - on a slide too full for that, the old cascade: the centre,
     stepped down and right a little per insert, so successive
     inserts do not hide each other exactly.
   A chart, an equation and a structure inserted one after the other
   so end up side by side instead of on top of each other.

   choosePlace() is plain arithmetic on rectangles (no DOM), so its
   choice can be tested on its own; obstaclesOn() reads the slide.
   ============================================================ */
import { css, TEXT_TAGS, MEDIA_TAGS, hasOwnText } from './dom.js';

export const GRID = 40;        // stage px between the positions tried
export const GAP = 16;         // clear space wanted round what is already there
export const CASCADE = 24;     // the step of the fallback cascade
/* A slide is full when even the best position covers this much of the new element. */
const FULL = 0.5;
/* An element covering more of the slide than this is ground (a backdrop, a panel the layout
   sits on), not something a new element should keep away from; what is inside it still counts. */
const GROUND = 0.6;

/* Where an element of w x h goes on a stageW x stageH slide that shows `rects` ({x, y, w, h},
   stage px). `cascade` is how many inserts have cascaded so far. Returns {x, y, how}, the
   top-left corner in stage px, how being 'centre', 'grid' or 'cascade'. */
export function choosePlace({ w, h, stageW, stageH, rects = [], margin = null, cascade = 0 }) {
    w = Math.max(1, w); h = Math.max(1, h);
    if (margin == null) margin = Math.round(Math.min(stageW, stageH) * 0.05);
    const cx = (stageW - w) / 2, cy = (stageH - h) / 2;
    const boxes = rects.filter(r => r && r.w > 0 && r.h > 0).map(r => ({ x: r.x - GAP, y: r.y - GAP, w: r.w + 2 * GAP, h: r.h + 2 * GAP }));
    const cost = (x, y) => {
        let sum = 0;
        for (const b of boxes) {
            const ox = Math.min(x + w, b.x + b.w) - Math.max(x, b.x);
            const oy = Math.min(y + h, b.y + b.h) - Math.max(y, b.y);
            if (ox > 0 && oy > 0) sum += ox * oy;
        }
        return sum;
    };
    const round = (p, how) => ({ x: Math.round(p.x), y: Math.round(p.y), how });
    if (cost(cx, cy) === 0) return round({ x: cx, y: cy }, 'centre');

    // The grid runs through the centre, so a free spot straight above or beside it is found,
    // and reaches both margins exactly. An element wider (or taller) than the space between
    // the margins stays centred on that axis.
    const axis = (size, stage, c) => {
        const lo = margin, hi = stage - margin - size;
        if (hi < lo) return [c];
        const out = new Set([lo, hi, Math.min(hi, Math.max(lo, c))]);
        for (let v = c; v >= lo; v -= GRID) if (v <= hi) out.add(v);
        for (let v = c + GRID; v <= hi; v += GRID) if (v >= lo) out.add(v);
        return Array.from(out);
    };
    let best = null;
    for (const y of axis(h, stageH, cy)) {
        for (const x of axis(w, stageW, cx)) {
            const c = cost(x, y), d = (x - cx) ** 2 + (y - cy) ** 2;
            if (!best || c < best.c - 1e-6 || (Math.abs(c - best.c) <= 1e-6 && d < best.d)) best = { x, y, c, d };
        }
    }
    if (best && best.c <= w * h * FULL) return round(best, 'grid');
    // Full: the cascade from the centre, kept on the slide when the element fits on it.
    const n = (cascade % 8) * CASCADE;
    const clamp = (v, size, stage) => size >= stage ? v : Math.max(0, Math.min(stage - size, v));
    return round({ x: clamp(cx + n, w, stageW), y: clamp(cy + n, h, stageH) }, 'cascade');
}

/* The top-left corner that centres an element of w x h on a point, kept on the slide (a picture
   dropped near an edge lands whole, with its edge on the slide's). */
export function centreOn({ x, y }, w, h, stageW, stageH) {
    const clamp = (v, size, stage) => size >= stage ? (stage - size) / 2 : Math.max(0, Math.min(stage - size, v));
    return { x: Math.round(clamp(x - w / 2, w, stageW)), y: Math.round(clamp(y - h / 2, h, stageH)) };
}

/* What the current slide shows, as stage rectangles: its text blocks, pictures, drawings,
   groups and free boxes with a fill or border, and the master layer's (footer, logo) unless the
   slide keeps it out. Hidden elements, speaker notes and ground (see GROUND) are left out, and
   so is `exclude` (the element being placed) with what contains it. */
const COUNTS = TEXT_TAGS + ', ' + MEDIA_TAGS + ', [data-group], [data-line], [data-placeholder]';
export function obstaclesOn(deck, exclude = null) {
    const slide = deck.currentSlide;
    if (!slide) return [];
    const roots = [slide];
    if (!slide.hasAttribute('data-no-master')) roots.push(...deck.masterElements);
    const ground = deck.stageW * deck.stageH * GROUND;
    const kept = [], out = [];
    for (const root of roots) {
        const all = root === slide ? Array.from(slide.querySelectorAll('*')) : [root, ...root.querySelectorAll('*')];
        for (const el of all) {
            if (exclude && (el === exclude || exclude.contains(el) || el.contains(exclude))) continue;
            if (kept.some(k => k.contains(el))) continue;
            if (el.namespaceURI === 'http://www.w3.org/2000/svg' && el.tagName.toLowerCase() !== 'svg') continue;
            if (/^(script|style|template|br)$/i.test(el.tagName) || el.closest('aside.notes, .notes')) continue;
            if (!counts(el)) continue;
            const cs = css(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
            const r = deck.stageRect(el);
            if (r.w < 2 || r.h < 2 || r.w * r.h > ground) continue;
            kept.push(el);
            out.push(r);
        }
    }
    return out;
}
function counts(el) {
    if (el.matches(COUNTS)) return true;
    const cs = css(el);
    if (hasOwnText(el) && cs.display !== 'inline') return true;
    // A free box drawn with a fill or a border (a rectangle from Insert, a card).
    if (/absolute|fixed/.test(cs.position)) {
        const fill = cs.backgroundImage !== 'none' || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor);
        const border = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
        if (fill || border) return true;
    }
    return false;
}
