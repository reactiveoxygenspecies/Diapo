/* ============================================================
   chart.js - charts the editor draws and edits.

   A chart is a <figure data-chart="column|bar|line|area|pie|doughnut">
   holding two things:
     - <svg data-key> the drawing, plain inline SVG sized to the box
       (viewBox = the box in stage px), so the saved deck needs no
       script or library to show it, in the PDF and the thumbnails too;
     - <script type="application/json" data-chart-data> the table it
       is drawn from: { labels, series: [{ name, values, colour? }],
       palette, legend, values, grid, stacked, unit?, title? }.
   The editor redraws the SVG from the table whenever the box, the
   text size or the font changes (the data-key tells), and after
   every change to the table. Colours are the deck's theme variables
   (var(--accent), ...) taken when the chart is inserted, so a theme
   change recolours the chart; text is the figure's own font, size
   and colour (currentColor), which the Text fields of the panel set.

   A PowerPoint import writes its charts the same way, with its own
   drawing of them in the <svg> (no data-key): that drawing stays, as
   close to PowerPoint's as the import can make it, until the chart is
   changed in the editor, which then draws it from the table.

   Charts a deck renders with its own script ([data-fig], Plotly)
   stay the deck's: this is for charts made in the editor.
   ============================================================ */
import { css, colourName, setSwatches } from './dom.js';

export const CHART_KINDS = [
    ['column', 'Column', 'M4 20V11h4v9M10 20V5h4v15M16 20v-6h4v6M2 20.5h20'],
    ['bar', 'Bar', 'M4 4h9v4H4zM4 10h15v4H4zM4 16h6v4H4zM3.5 2v20'],
    ['line', 'Line', 'M3 17l5-6 4 3 8-9M2 20.5h20'],
    ['area', 'Area', 'M3 20v-4l5-6 4 3 8-8v15z'],
    ['pie', 'Pie', 'M12 3a9 9 0 1 0 9 9h-9z M14 1.5v8.5h8.5A8.5 8.5 0 0 0 14 1.5z'],
    ['doughnut', 'Doughnut', 'M12 3a9 9 0 1 0 9 9h-4a5 5 0 1 1-5-5z M14 1.5V7a5 5 0 0 1 3.5 3.5h5A8.5 8.5 0 0 0 14 1.5z'],
];
const KIND_NAMES = Object.fromEntries(CHART_KINDS.map(([k, l]) => [k, l]));
const FALLBACK = ['#2f6fed', '#f59e0b', '#10b981', '#e8503f', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
const SAFE_COLOUR = /^[#\w\s(),.%-]+$/;

/* --- what a chart is ------------------------------------------------ */
export function isChart(el) {
    return !!el && typeof el.matches === 'function' && el.matches('[data-chart]') && !!el.querySelector(':scope > script[data-chart-data]');
}
/* The chart an element is part of (itself, or the figure round a bar of it). */
export function chartOf(el) {
    const c = el && el.closest ? el.closest('[data-chart]') : null;
    return c && isChart(c) ? c : null;
}
export function chartKind(el) { const k = el.getAttribute('data-chart'); return KIND_NAMES[k] ? k : 'column'; }

export function readChart(el) {
    const s = el.querySelector(':scope > script[data-chart-data]');
    let raw = null;
    try { raw = JSON.parse(s ? s.textContent : 'null'); } catch (e) { raw = null; }
    return normalise(raw);
}
function normalise(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const labels = Array.isArray(r.labels) ? r.labels.map(l => String(l == null ? '' : l)) : [];
    const series = (Array.isArray(r.series) ? r.series : []).map((s, i) => ({
        name: String(s && s.name != null ? s.name : 'Series ' + (i + 1)),
        values: labels.map((_, j) => { const v = s && Array.isArray(s.values) ? s.values[j] : null; return typeof v === 'number' && isFinite(v) ? v : null; }),
        ...(s && typeof s.colour === 'string' && SAFE_COLOUR.test(s.colour) ? { colour: s.colour } : {}),
    }));
    return {
        labels, series,
        palette: (Array.isArray(r.palette) ? r.palette : []).filter(c => typeof c === 'string' && SAFE_COLOUR.test(c)),
        legend: r.legend !== false, values: !!r.values, grid: r.grid !== false, stacked: !!r.stacked,
        unit: typeof r.unit === 'string' ? r.unit.slice(0, 12) : '',
        title: typeof r.title === 'string' ? r.title.slice(0, 200) : '',
    };
}
function specJson(spec) {
    const out = { labels: spec.labels, series: spec.series.map(s => ({ name: s.name, values: s.values, ...(s.colour ? { colour: s.colour } : {}) })), palette: spec.palette,
        legend: spec.legend, values: spec.values, grid: spec.grid, stacked: spec.stacked };
    if (spec.unit) out.unit = spec.unit;
    if (spec.title) out.title = spec.title;
    return JSON.stringify(out).replace(/</g, '\\u003c');
}

/* The colours a new chart takes: the deck's accents first, then its other colours that stand out
   from the slide (not its paper, ink or rules), then a fixed set. As var(--name) where it can. */
export function deckPalette(deck) {
    const theme = deck.themeColours ? deck.themeColours() : [];
    const slide = deck.currentSlide;
    const bg = slide ? lum(css(slide).backgroundColor) : 1;
    const standsOut = (c) => { const l = lum(c.value); return l == null || Math.abs(l - bg) > 0.12; };
    const skip = /bg|background|paper|ink|text|rule|grid|stage|slide|line|muted|surface|panel|soft|border|shadow|white|black|grey|gray|navy/i;
    const first = theme.filter(c => /accent|primary|secondary|brand|series|highlight/i.test(c.name) && standsOut(c));
    const other = theme.filter(c => !first.includes(c) && !skip.test(c.name) && standsOut(c));
    const chosen = [...first, ...other];
    const out = chosen.map(c => `var(--${c.name})`);
    // The fixed set fills up to eight, leaving out hues the deck's colours already have.
    const hues = chosen.map(c => hueOf(c.value)).filter(h => h != null);
    for (const f of FALLBACK) {
        if (out.length >= 8) break;
        const h = hueOf(f);
        if (hues.some(x => Math.min(Math.abs(x - h), 360 - Math.abs(x - h)) < 28)) continue;
        out.push(f); hues.push(h);
    }
    return out;
}
/* The hue (degrees) of a colour that has one; null for greys and what cannot be read. */
function hueOf(c) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''), h = /^#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec((c || '').trim());
    let rgb;
    if (m) rgb = [+m[1], +m[2], +m[3]];
    else if (h) { const x = h[1].length === 3 ? [...h[1]].map(d => d + d).join('') : h[1]; rgb = [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16)); }
    else return null;
    const [r, g, b] = rgb.map(v => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d < 0.12) return null;
    const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (hue * 60 + 360) % 360;
}
export function seriesColour(spec, i) { const s = spec.series[i]; return (s && s.colour) || spec.palette[i % (spec.palette.length || 1)] || FALLBACK[i % FALLBACK.length]; }
function sliceColour(spec, i) { return spec.palette[i % (spec.palette.length || 1)] || FALLBACK[i % FALLBACK.length]; }

/* A new chart's table: a few quarters over two years. */
export function sampleChart(palette) {
    return normalise({
        labels: ['Q1', 'Q2', 'Q3', 'Q4'],
        series: [{ name: '2025', values: [42, 55, 61, 70] }, { name: '2026', values: [48, 63, 72, 86] }],
        palette, legend: true, values: false, grid: true, stacked: false,
    });
}

/* --- drawing ------------------------------------------------------- */
/* The figure's box and type, as the SVG was drawn for it. */
function keyOf(el) {
    const cs = css(el);
    return [el.clientWidth, el.clientHeight, Math.round(parseFloat(cs.fontSize) * 10) / 10, hash(cs.fontFamily + '|' + cs.fontWeight + '|' + el.getAttribute('data-chart'))].join(' ');
}
/* Draw the chart into its figure (the SVG and the table). Not an undo step by itself: callers
   record the figure's innerHTML before and after (see ChartSection.apply). */
export function writeChart(el, spec = readChart(el)) {
    const cs = css(el);
    const w = Math.max(40, el.clientWidth || parseFloat(el.style.width) || 600), h = Math.max(40, el.clientHeight || parseFloat(el.style.height) || 400);
    const fs = parseFloat(cs.fontSize) || 24;
    const svg = drawChart(chartKind(el), spec, { w, h, fs, measure: measurer(el, cs), onColour: (c) => contrastOn(el, c), lang: el.ownerDocument.documentElement.lang || undefined });
    el.innerHTML = `\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r1(w)} ${r1(h)}" width="100%" height="100%" role="img" aria-label="${esc(summary(chartKind(el), spec))}" data-key="${keyOf(el)}" style="display:block; overflow:visible;">${svg}</svg>\n<script type="application/json" data-chart-data>${specJson(spec)}</script>\n`;
}
/* Redraw the charts in root whose box, text size or font changed since they were drawn. */
export function refreshCharts(root) {
    if (!root) return [];
    const out = [];
    const list = root.matches && root.matches('[data-chart]') ? [root] : Array.from(root.querySelectorAll('[data-chart]'));
    for (const el of list) {
        if (!isChart(el) || !el.clientWidth || !el.clientHeight) continue;
        const svg = el.querySelector(':scope > svg');
        if (svg && !svg.hasAttribute('data-key')) continue;          // an imported drawing: kept until the chart is changed
        if (svg && svg.getAttribute('data-key') === keyOf(el)) continue;
        writeChart(el);
        out.push(el);
    }
    return out;
}

function summary(kind, spec) {
    const s = spec.series.map(x => x.name).join(', ');
    return `${KIND_NAMES[kind]} chart` + (spec.labels.length ? ` of ${spec.labels.join(', ')}` : '') + (s && kind !== 'pie' && kind !== 'doughnut' ? ` (${s})` : '');
}

export function drawChart(kind, spec, opt) {
    // A title across the top, then the chart in the room left under it.
    let title = '';
    if (spec.title) {
        const size = opt.fs * 1.15;
        title = `<text x="${r1(opt.w / 2)}" y="${r1(opt.fs * 0.4 + size * 0.6)}" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="font-size:${r1(size)}px; font-weight:600">${esc(ellipsis(spec.title, opt.w - opt.fs, size, opt.measure))}</text>`;
        opt = { ...opt, top: opt.fs * 0.4 + size * 1.5 };
    }
    return title + (kind === 'pie' || kind === 'doughnut' ? drawPie(spec, opt, kind === 'doughnut') : drawAxes(kind, spec, opt));
}

/* Column, bar, line and area: a value axis with round ticks, the labels along the other. */
function drawAxes(kind, spec, { w, h, fs, measure, onColour, lang, top: top0 = 0 }) {
    const n = spec.labels.length, k = spec.series.length;
    const horizontal = kind === 'bar';
    const stacked = spec.stacked && kind !== 'line';
    const small = fs * 0.85;
    const out = [];
    const pad = fs * 0.4;
    let top = Math.max(pad, top0), left = pad, right = w - pad, bottom = h - pad;

    // Legend: a row (or rows) across the top.
    if (spec.legend && k > 0) {
        const rows = legendRows(spec.series.map((s, i) => ({ name: s.name, colour: seriesColour(spec, i) })), right - left, small, measure);
        out.push(drawLegendRows(rows, left, top, small));
        top += rows.length * small * 1.6 + fs * 0.4;
    }
    if (!n || !k) { out.push(`<text x="${r1(w / 2)}" y="${r1((top + bottom) / 2)}" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="opacity:0.5; font-size:${r1(small)}px">No data</text>`); return out.join(''); }

    // The value range: stacks sum their positives and negatives apart.
    let lo = 0, hi = 0;
    for (let j = 0; j < n; j++) {
        if (stacked) {
            let p = 0, m = 0;
            for (const s of spec.series) { const v = s.values[j]; if (v > 0) p += v; else if (v < 0) m += v; }
            hi = Math.max(hi, p); lo = Math.min(lo, m);
        } else for (const s of spec.series) { const v = s.values[j]; if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, v); } }
    }
    const scale = niceScale(lo, hi);
    const fmt = formatter(spec.unit, lang), tickFmt = formatter(spec.unit, lang, scale.step);
    const tickW = Math.max(...scale.ticks.map(t => measure(tickFmt(t), small)));
    const valueW = spec.values ? Math.max(0, ...spec.series.flatMap(s => s.values.filter(v => v != null).map(v => measure(fmt(v), small)))) : 0;

    // Room for the labels: category names below (or at the left for bars), ticks at the left (below).
    let cat = spec.labels.slice(), catSize = small;
    if (horizontal) {
        const maxW = (right - left) * 0.34;
        cat = cat.map(l => ellipsis(l, maxW, small, measure));
        left += Math.max(...cat.map(l => measure(l, small))) + fs * 0.6;
        bottom -= small * 1.7;
        if (spec.values) right -= valueW + fs * 0.4;
        else right -= measure(tickFmt(scale.ticks[scale.ticks.length - 1]), small) / 2;
    } else {
        left += tickW + fs * 0.6;
        if (spec.values) top += small * 1.4;
        else top += small * 0.6;
        // Names wider than their column shrink a little, then every second (third...) one shows.
        const band = (right - left) / n;
        const widest = Math.max(...cat.map(l => measure(l, small)));
        if (widest > band * 0.92) catSize = Math.max(small * 0.75, small * band * 0.92 / widest);
        bottom -= catSize * 1.8;
    }
    if (bottom - top < fs || right - left < fs) return out.join('');

    const vx = (v) => left + (v - scale.lo) / (scale.hi - scale.lo) * (right - left);      // value -> x (bars)
    const vy = (v) => bottom - (v - scale.lo) / (scale.hi - scale.lo) * (bottom - top);    // value -> y (columns, lines)
    const band = (horizontal ? bottom - top : right - left) / n;

    // Grid, ticks and the zero line.
    const g = [];
    for (const t of scale.ticks) {
        if (horizontal) {
            const x = vx(t);
            if (spec.grid && t !== 0) g.push(`<line x1="${r1(x)}" y1="${r1(top)}" x2="${r1(x)}" y2="${r1(bottom)}"/>`);
            out.push(`<text x="${r1(x)}" y="${r1(bottom + small * 0.9)}" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="opacity:0.7; font-size:${r1(small)}px">${esc(tickFmt(t))}</text>`);
        } else {
            const y = vy(t);
            if (spec.grid && t !== 0) g.push(`<line x1="${r1(left)}" y1="${r1(y)}" x2="${r1(right)}" y2="${r1(y)}"/>`);
            out.push(`<text x="${r1(left - fs * 0.4)}" y="${r1(y)}" text-anchor="end" dominant-baseline="central" fill="currentColor" style="opacity:0.7; font-size:${r1(small)}px">${esc(tickFmt(t))}</text>`);
        }
    }
    if (g.length) out.unshift(`<g stroke="currentColor" stroke-width="1" style="opacity:0.14">${g.join('')}</g>`);
    const zero = horizontal ? vx(0) : vy(0);
    const zeroLine = horizontal
        ? `<line x1="${r1(zero)}" y1="${r1(top)}" x2="${r1(zero)}" y2="${r1(bottom)}" stroke="currentColor" stroke-width="1.5" style="opacity:0.45"/>`
        : `<line x1="${r1(left)}" y1="${r1(zero)}" x2="${r1(right)}" y2="${r1(zero)}" stroke="currentColor" stroke-width="1.5" style="opacity:0.45"/>`;

    // Category names.
    const every = horizontal ? 1 : Math.max(1, Math.ceil(Math.max(...cat.map(l => measure(l, catSize))) / (band * 0.95)));
    cat.forEach((l, j) => {
        if (j % every) return;
        if (horizontal) out.push(`<text x="${r1(left - fs * 0.5)}" y="${r1(top + band * (j + 0.5))}" text-anchor="end" dominant-baseline="central" fill="currentColor" style="font-size:${r1(small)}px">${esc(l)}</text>`);
        else out.push(`<text x="${r1(left + band * (j + 0.5))}" y="${r1(bottom + catSize * 0.95)}" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="font-size:${r1(catSize)}px">${esc(l)}</text>`);
    });

    const marks = [], labels = [];
    if (kind === 'column' || kind === 'bar') {
        const group = band * (k > 1 && !stacked ? 0.78 : 0.62);
        const bw = stacked ? group : group / k;
        const rad = Math.min(4, bw / 6);
        for (let j = 0; j < n; j++) {
            let pos = 0, neg = 0;
            spec.series.forEach((s, i) => {
                const v = s.values[j]; if (v == null) return;
                const from = stacked ? (v >= 0 ? pos : neg) : 0, to = from + v;
                if (stacked) { if (v >= 0) pos = to; else neg = to; }
                const off = band * j + (band - group) / 2 + (stacked ? 0 : bw * i);
                const colour = seriesColour(spec, i);
                if (horizontal) {
                    const x1 = vx(Math.min(from, to)), x2 = vx(Math.max(from, to)), y = top + off;
                    marks.push(`<rect x="${r1(x1)}" y="${r1(y)}" width="${r1(Math.max(0, x2 - x1))}" height="${r1(bw * (stacked || k === 1 ? 1 : 0.9))}" rx="${r1(rad)}" style="fill:${colour}"/>`);
                    if (spec.values) {
                        const t = fmt(v), tw = measure(t, small), yc = y + bw * (stacked || k === 1 ? 0.5 : 0.45);
                        if (stacked) { if (tw < x2 - x1 - fs * 0.3) labels.push(`<text x="${r1((x1 + x2) / 2)}" y="${r1(yc)}" text-anchor="middle" dominant-baseline="central" style="font-size:${r1(small)}px; fill:${onColour(colour)}">${esc(t)}</text>`); }
                        else labels.push(`<text x="${r1(v >= 0 ? x2 + fs * 0.3 : x1 - fs * 0.3)}" y="${r1(yc)}" text-anchor="${v >= 0 ? 'start' : 'end'}" dominant-baseline="central" fill="currentColor" style="font-size:${r1(small)}px">${esc(t)}</text>`);
                    }
                } else {
                    const y1 = vy(Math.max(from, to)), y2 = vy(Math.min(from, to)), x = left + off;
                    const bwx = bw * (stacked || k === 1 ? 1 : 0.9);
                    marks.push(`<rect x="${r1(x)}" y="${r1(y1)}" width="${r1(bwx)}" height="${r1(Math.max(0, y2 - y1))}" rx="${r1(rad)}" style="fill:${colour}"/>`);
                    if (spec.values) {
                        const t = fmt(v), xc = x + bwx / 2;
                        if (stacked) { if (small * 1.2 < y2 - y1 && measure(t, small) < bwx) labels.push(`<text x="${r1(xc)}" y="${r1((y1 + y2) / 2)}" text-anchor="middle" dominant-baseline="central" style="font-size:${r1(small)}px; fill:${onColour(colour)}">${esc(t)}</text>`); }
                        else labels.push(`<text x="${r1(xc)}" y="${r1(v >= 0 ? y1 - small * 0.7 : y2 + small * 0.7)}" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="font-size:${r1(small * (measure(t, small) > bwx * 1.4 ? 0.8 : 1))}px">${esc(t)}</text>`);
                    }
                }
            });
            // A stack's total above it.
            if (stacked && spec.values && k > 1) {
                const t = fmt(pos + neg);
                if (horizontal) labels.push(`<text x="${r1(vx(pos) + fs * 0.3)}" y="${r1(top + band * (j + 0.5))}" text-anchor="start" dominant-baseline="central" fill="currentColor" style="font-size:${r1(small)}px; font-weight:600">${esc(t)}</text>`);
                else labels.push(`<text x="${r1(left + band * (j + 0.5))}" y="${r1(vy(pos) - small * 0.7)}" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="font-size:${r1(small)}px; font-weight:600">${esc(t)}</text>`);
            }
        }
    } else {
        // Line and area: a point per label at the middle of its column; a gap where a value is missing.
        const sw = Math.max(3, fs / 7);
        const x = (j) => left + band * (j + 0.5);
        const base = new Array(n).fill(0);
        spec.series.forEach((s, i) => {
            const colour = seriesColour(spec, i);
            const ys = s.values.map((v, j) => v == null ? null : (stacked ? base[j] + v : v));
            const runs = [];
            let run = [];
            ys.forEach((v, j) => { if (v == null) { if (run.length) runs.push(run); run = []; } else run.push(j); });
            if (run.length) runs.push(run);
            if (kind === 'area') {
                for (const r of runs) {
                    const upper = r.map(j => `${r1(x(j))} ${r1(vy(ys[j]))}`);
                    const lower = r.slice().reverse().map(j => `${r1(x(j))} ${r1(vy(stacked ? base[j] : 0))}`);
                    marks.push(`<path d="M${upper.join('L')}L${lower.join('L')}Z" style="fill:${colour}; opacity:${stacked ? 0.85 : 0.28}"/>`);
                }
            }
            for (const r of runs) {
                if (r.length > 1) marks.push(`<path d="M${r.map(j => `${r1(x(j))} ${r1(vy(ys[j]))}`).join('L')}" fill="none" stroke-width="${r1(sw)}" stroke-linejoin="round" stroke-linecap="round" style="stroke:${colour}"/>`);
                if (kind === 'line' || r.length === 1) for (const j of r) marks.push(`<circle cx="${r1(x(j))}" cy="${r1(vy(ys[j]))}" r="${r1(sw * 1.5)}" style="fill:${colour}"/>`);
            }
            if (spec.values) s.values.forEach((v, j) => { if (v != null) labels.push(`<text x="${r1(x(j))}" y="${r1(vy(ys[j]) - small * 0.9)}" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="font-size:${r1(small)}px">${esc(fmt(v))}</text>`); });
            if (stacked) s.values.forEach((v, j) => { if (v != null) base[j] += v; });
        });
    }
    out.push(`<g>${marks.join('')}</g>`, zeroLine);
    if (labels.length) out.push(`<g>${labels.join('')}</g>`);
    return out.join('');
}

/* Pie and doughnut: the first series, a slice per label, from twelve o'clock. Names and shares
   outside the slices (in the text colour, so they read on any slide); a legend instead of the
   names when it is on. */
function drawPie(spec, { w, h, fs, measure, lang, top: top0 = 0 }, hole) {
    const s = spec.series[0];
    const small = fs * 0.85, out = [];
    const items = spec.labels.map((l, j) => ({ label: l, v: s ? s.values[j] : null, colour: sliceColour(spec, j) })).filter(it => it.v != null && it.v > 0);
    const total = items.reduce((a, it) => a + it.v, 0);
    if (!total) return `<text x="${r1(w / 2)}" y="${r1(h / 2)}" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="opacity:0.5; font-size:${r1(small)}px">No data</text>`;
    const pad = fs * 0.4;
    let left = pad, right = w - pad, top = Math.max(pad, top0), bottom = h - pad;
    if (spec.legend) {
        const lw = Math.max(...items.map(it => measure(it.label, small))) + small * 1.6;
        if (right - left - lw > (bottom - top) * 0.9) {
            // Beside the pie, one name per line.
            const rows = items.map(it => [{ name: it.label, colour: it.colour, w: measure(it.label, small) + small * 1.6 }]);
            const lh = small * 1.6, y0 = (top + bottom) / 2 - rows.length * lh / 2;
            out.push(drawLegendRows(rows, right - lw, y0, small));
            right -= lw + fs;
        } else {
            const rows = legendRows(items.map(it => ({ name: it.label, colour: it.colour })), right - left, small, measure);
            out.push(drawLegendRows(rows, left, bottom - rows.length * small * 1.6, small));
            bottom -= rows.length * small * 1.6 + fs * 0.4;
        }
    }
    // Shares in whole percents, with a decimal under ten (7.5%, not 8.0%).
    const pctFmt = formatter('%', lang);
    const pct = (v) => { const p = v / total * 100, k = p < 10 ? 10 : 1; return pctFmt(Math.round(p * k) / k); };
    const fmt = formatter(spec.unit, lang);
    const text = (it) => {
        const share = pct(it.v);
        const value = spec.values ? fmt(it.v) + ' · ' + share : share;
        return spec.legend ? value : it.label + '  ' + value;
    };
    // Room for the labels round the pie.
    const labelW = Math.max(...items.map(it => measure(text(it), small)));
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    let r = Math.min((right - left) / 2 - labelW - fs * 0.6, (bottom - top) / 2 - small * 1.8);
    r = Math.max(r, Math.min(right - left, bottom - top) * 0.22);
    const inner = hole ? r * 0.58 : 0;
    let a = -Math.PI / 2;
    const marks = [], labels = [];
    for (const it of items) {
        const da = it.v / total * Math.PI * 2, a2 = a + da;
        marks.push(`<path d="${arc(cx, cy, r, inner, a, a2)}" style="fill:${it.colour}"/>`);
        if (it.v / total >= 0.025) {
            const mid = a + da / 2, cos = Math.cos(mid), sin = Math.sin(mid);
            const lx = cx + cos * (r + fs * 0.5), ly = cy + sin * (r + small * 0.9);
            labels.push(`<text x="${r1(lx)}" y="${r1(ly)}" text-anchor="${Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end'}" dominant-baseline="central" fill="currentColor" style="font-size:${r1(small)}px">${esc(text(it))}</text>`);
        }
        a = a2;
    }
    // Slices part with a hairline in the slide's colour.
    out.push(`<g stroke-width="${r1(Math.max(1.5, fs / 12))}" style="stroke:var(--slide-bg, var(--paper, var(--bg, #fff)))">${marks.join('')}</g>`, `<g>${labels.join('')}</g>`);
    if (hole && spec.values) out.push(`<text x="${r1(cx)}" y="${r1(cy)}" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="font-size:${r1(Math.min(fs * 1.6, inner * 0.55))}px; font-weight:600">${esc(fmt(total))}</text>`);
    return out.join('');
}
function arc(cx, cy, r, inner, a1, a2) {
    const full = a2 - a1 >= Math.PI * 2 - 1e-6;
    if (full) a2 = a1 + Math.PI * 2 - 1e-4;
    const p = (rad, a) => `${r1(cx + Math.cos(a) * rad)} ${r1(cy + Math.sin(a) * rad)}`;
    const large = a2 - a1 > Math.PI ? 1 : 0;
    if (!inner) return `M${r1(cx)} ${r1(cy)}L${p(r, a1)}A${r1(r)} ${r1(r)} 0 ${large} 1 ${p(r, a2)}Z`;
    return `M${p(r, a1)}A${r1(r)} ${r1(r)} 0 ${large} 1 ${p(r, a2)}L${p(inner, a2)}A${r1(inner)} ${r1(inner)} 0 ${large} 0 ${p(inner, a1)}Z`;
}

/* Legend entries laid out in rows that fit the width. */
function legendRows(entries, width, size, measure) {
    const rows = [[]];
    let x = 0;
    for (const e of entries) {
        const ew = size * 1.2 + measure(e.name, size) + size * 1.2;
        if (x + ew > width && rows[rows.length - 1].length) { rows.push([]); x = 0; }
        rows[rows.length - 1].push({ ...e, w: ew });
        x += ew;
    }
    return rows;
}
function drawLegendRows(rows, x0, y0, size) {
    const out = [];
    rows.forEach((row, i) => {
        let x = x0;
        const y = y0 + i * size * 1.6 + size * 0.8;
        for (const e of row) {
            out.push(`<rect x="${r1(x)}" y="${r1(y - size * 0.4)}" width="${r1(size * 0.8)}" height="${r1(size * 0.8)}" rx="${r1(size * 0.15)}" style="fill:${e.colour}"/>`);
            out.push(`<text x="${r1(x + size * 1.2)}" y="${r1(y)}" dominant-baseline="central" fill="currentColor" style="font-size:${r1(size)}px">${esc(e.name)}</text>`);
            x += e.w;
        }
    });
    return `<g>${out.join('')}</g>`;
}

/* Round ticks covering lo..hi, about five of them. */
export function niceScale(lo, hi, count = 5) {
    if (lo === hi) { if (hi === 0) hi = 1; else if (hi > 0) lo = 0; else hi = 0; }
    const raw = (hi - lo) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
    const ticks = [];
    for (let t = a; t <= b + step / 2; t += step) ticks.push(Math.abs(t) < step / 1e6 ? 0 : +t.toPrecision(12));
    return { lo: a, hi: b === a ? a + step : b, step, ticks };
}

/* Numbers as the deck's language writes them, with the unit: a currency sign before, anything
   else after ("%", " kg"). Ticks keep the decimals their step needs; big ticks go compact (12k). */
function formatter(unit, lang, step = null) {
    const decimals = step == null ? 2 : Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9)));
    let plain, compact;
    try {
        plain = new Intl.NumberFormat(lang, { maximumFractionDigits: decimals, minimumFractionDigits: step == null ? 0 : decimals });
        compact = new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 });
    } catch (e) {
        plain = new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals });
        compact = plain;
    }
    const pre = /^[$€£¥₹]/.test(unit || '') ? unit : '', post = pre ? '' : (unit || '');
    return (v) => {
        const body = step != null && Math.abs(v) >= 10000 ? compact.format(v) : plain.format(v);
        return v < 0 && pre ? '-' + pre + body.replace(/^[-−]/, '') : pre + body + post;
    };
}

/* Text widths in the deck's own fonts (a canvas in the deck document sees its web fonts). */
function measurer(el, cs) {
    const doc = el.ownerDocument;
    const canvas = measurer.canvas && measurer.canvas.ownerDocument === doc ? measurer.canvas : (measurer.canvas = doc.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    const cache = new Map();
    return (text, size) => {
        const key = size + '|' + text;
        if (cache.has(key)) return cache.get(key);
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
        const wdt = ctx.measureText(String(text)).width;
        cache.set(key, wdt);
        return wdt;
    };
}
function ellipsis(text, max, size, measure) {
    if (measure(text, size) <= max) return text;
    let t = text;
    while (t.length > 1 && measure(t + '…', size) > max) t = t.slice(0, -1);
    return t.trimEnd() + '…';
}

/* A text colour that reads on a fill: resolved in the deck (a theme variable), light or dark. */
function contrastOn(el, colour) {
    const probe = el.ownerDocument.createElement('i');
    probe.style.color = colour;
    el.appendChild(probe);
    const l = lum(css(probe).color);
    probe.remove();
    return l != null && l > 0.55 ? 'rgba(0,0,0,0.82)' : '#fff';
}
function lum(c) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
    if (m) return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
    const h = /^#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec((c || '').trim());
    if (!h) return null;
    const x = h[1].length === 3 ? [...h[1]].map(d => d + d).join('') : h[1];
    return (0.2126 * parseInt(x.slice(0, 2), 16) + 0.7152 * parseInt(x.slice(2, 4), 16) + 0.0722 * parseInt(x.slice(4, 6), 16)) / 255;
}

/* --- the table as text ------------------------------------------------ */
/* Cells pasted from a spreadsheet (tabs), a CSV (commas or semicolons) or typed. */
export function parseCells(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
    const sep = lines.some(l => l.includes('\t')) ? '\t' : lines.some(l => l.includes(';')) ? ';' : lines.some(l => l.includes(',')) && !lines.every(l => /^[\s\d.,-]*$/.test(l)) ? ',' : '\t';
    return lines.map(l => l.split(sep).map(c => c.trim().replace(/^"(.*)"$/, '$1')));
}
/* "1,234.5", "1.234,5", "12 %", "$3", "(4)" -> numbers; empty or text -> null. */
export function parseNumber(s) {
    let t = String(s == null ? '' : s).trim();
    if (!t) return null;
    const neg = /^\(.*\)$/.test(t) || /^[-−]/.test(t);
    t = t.replace(/[()\s%$€£¥₹−-]/g, '').replace(/[a-z]+$/i, '');
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
    else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(',', '.');
    if (!/^\d*\.?\d+(e[+-]?\d+)?$/i.test(t)) return null;
    const v = parseFloat(t);
    return isFinite(v) ? (neg ? -v : v) : null;
}

/* --- small helpers --------------------------------------------------- */
function r1(v) { return Math.round(v * 10) / 10; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

/* ============================================================
   ChartSection - the Chart part of the properties panel: the
   kind, the table (a grid of cells, a spreadsheet paste goes
   in from the cell it lands on), the series colours and the
   options. Every change is one undo step: the figure's markup
   before and after, plus the kind when it changes.
   ============================================================ */
export class ChartSection {
    constructor(app, root) {
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.root = root;
        this.el = null;
        this.active = 0;              // the series the colour row works on
        this.pending = null;          // the figure's markup before a cell being typed in
        this._build();
        this._bind();
    }

    _build() {
        this.root.innerHTML = `
          <h4>Chart</h4>
          <div class="insp-seg chart-kinds" id="chartKind">${CHART_KINDS.map(([k, l, d]) => `<button data-kind="${k}" title="${l}"><svg viewBox="0 0 24 24"><path d="${d}"/></svg></button>`).join('')}</div>
          <div class="chart-grid-wrap"><table class="chart-grid" id="chartGrid"></table></div>
          <div class="insp-btns">
            <button class="mini-btn" data-chart-act="row-add" title="Add a label (a row)">+ Row</button>
            <button class="mini-btn" data-chart-act="series-add" title="Add a series (a column)">+ Series</button>
            <button class="mini-btn" data-chart-act="row-del" title="Remove the last row">- Row</button>
            <button class="mini-btn" data-chart-act="series-del" title="Remove the last series">- Series</button>
          </div>
          <div class="insp-hint" id="chartHint">Paste cells from a spreadsheet into any cell; the top-left cell takes a whole table with its headings.</div>
          <div class="chart-colour-row" id="chartColourRow"><span class="insp-hint insp-state" id="chartColourLabel"></span><div class="insp-swatches" id="chartSwatches"></div></div>
          <div class="chart-opts">
            <label class="align-toslide" id="chartStackedRow"><input type="checkbox" data-opt="stacked"> <span>Stacked</span></label>
            <label class="align-toslide"><input type="checkbox" data-opt="legend"> <span>Legend</span></label>
            <label class="align-toslide"><input type="checkbox" data-opt="values"> <span>Values on the chart</span></label>
            <label class="align-toslide" id="chartGridRow"><input type="checkbox" data-opt="grid"> <span>Grid lines</span></label>
          </div>
          <div class="insp-row"><label>Title</label><div class="insp-field" data-prop="_chartTitle"><input type="text" id="chartTitle" placeholder="(none)" spellcheck="true" title="A title across the top of the chart; a text box on the slide does the same with more choice"><i class="insp-clear" role="button" tabindex="0" data-clear="title" title="No title">&times;</i></div></div>
          <div class="insp-row"><label>Unit</label><div class="insp-field" data-prop="_chartUnit"><input type="text" id="chartUnit" placeholder="%, $, kg" spellcheck="false" title="Written with every number: a currency sign before it, anything else after (put a space first for &quot;12 kg&quot;)"><i class="insp-clear" role="button" tabindex="0" data-clear="unit" title="No unit">&times;</i></div></div>
          <div class="insp-hint">Text size, font and colour: the Text fields below.</div>`;
        this.$ = (id) => this.root.querySelector('#' + id);
    }

    _bind() {
        const r = this.root;
        r.addEventListener('click', (e) => {
            // The swatches and the x are the panel's own kinds of control: its handlers must not see these.
            if (e.target.closest('.insp-swatch, .insp-clear')) e.stopPropagation();
            const kb = e.target.closest('[data-kind]');
            if (kb && this.el) { this.apply('Chart kind', () => {}, kb.dataset.kind); return; }
            const act = e.target.closest('[data-chart-act]');
            if (act && this.el) { this._act(act.dataset.chartAct); return; }
            const chip = e.target.closest('.chart-chip');
            if (chip) { this.active = +chip.dataset.s; this.sync(this.el); return; }
            const sw = e.target.closest('#chartSwatches .insp-swatch');
            if (sw && this.el) { const i = this.active, c = sw.dataset.c; this.apply('Series colour', (s) => { if (s.series[i]) { if (c) s.series[i].colour = c; else delete s.series[i].colour; } }); return; }
            const clear = e.target.closest('.insp-clear[data-clear]');
            if (clear && this.el) { const k = clear.dataset.clear; this.apply('Chart ' + k, (s) => { s[k] = ''; }); }
        });
        r.addEventListener('change', (e) => {
            const opt = e.target.closest('[data-opt]');
            if (opt && this.el) { this.apply('Chart ' + opt.dataset.opt, (s) => { s[opt.dataset.opt] = opt.checked; }); return; }
            if (e.target.id === 'chartUnit' && this.el) { const v = e.target.value.slice(0, 12); this.apply('Chart unit', (s) => { s.unit = v; }); return; }
            if (e.target.id === 'chartTitle' && this.el) { const v = e.target.value.trim().slice(0, 200); this.apply('Chart title', (s) => { s.title = v; }); return; }
            if (e.target.closest('#chartGrid') && this.el) this.apply('Chart data', (s) => this._fromGrid(s));
        });
        // Typing in a cell redraws as it goes; the change (Tab, Enter, leaving the cell) is the undo step.
        r.addEventListener('input', (e) => {
            if (!e.target.closest('#chartGrid') || !this.el || !this.deck.doc.contains(this.el)) return;
            if (this.pending == null) this.pending = this.el.innerHTML;
            const s = readChart(this.el);
            this._fromGrid(s);
            this.deck.withoutTransitions(() => writeChart(this.el, s));
        });
        r.addEventListener('paste', (e) => {
            const cell = e.target.closest('#chartGrid input'); if (!cell || !this.el) return;
            const text = (e.clipboardData || window.clipboardData).getData('text');
            if (!/[\t\n]/.test(text.replace(/\n+$/, ''))) return;           // one value: the ordinary paste
            e.preventDefault();
            const rows = parseCells(text);
            const r0 = +cell.dataset.r, c0 = +cell.dataset.c;
            this.apply('Paste into chart', (s) => {
                this._fromGrid(s);
                // A whole table in the top-left cell replaces the chart's table, headings and all.
                if (r0 === 0 && c0 === 0 && rows.length > 1) { s.labels = []; s.series = []; }
                const needRows = r0 + rows.length - 1, needCols = c0 + Math.max(...rows.map(x => x.length)) - 1;
                while (s.labels.length < needRows) s.labels.push('');
                while (s.series.length < needCols) s.series.push({ name: 'Series ' + (s.series.length + 1), values: s.labels.map(() => null) });
                for (const sr of s.series) while (sr.values.length < s.labels.length) sr.values.push(null);
                rows.forEach((row, i) => row.forEach((v, j) => setCell(s, r0 + i, c0 + j, v)));
            });
        });
        r.addEventListener('keydown', (e) => {
            const cell = e.target.closest('#chartGrid input'); if (!cell) return;
            if (e.key === 'Enter') {
                // Down a row, as in a spreadsheet; past the last row, a new one.
                e.preventDefault();
                const rr = +cell.dataset.r + 1, cc = +cell.dataset.c;
                cell.dispatchEvent(new Event('change', { bubbles: true }));
                if (!this.el) return;
                if (rr > readChart(this.el).labels.length) this._act('row-add');
                const next = this.root.querySelector(`#chartGrid input[data-r="${rr}"][data-c="${cc}"]`);
                if (next) { next.focus(); next.select(); }
            } else if (e.key === 'Escape') { e.preventDefault(); cell.blur(); }
        });
        for (const id of ['chartUnit', 'chartTitle']) this.$(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    }

    /* Change the chart: fn(spec) edits the table, kind (optional) is the new kind. One undo step. */
    apply(label, fn, kind = null) {
        const el = this.el; if (!el || !this.deck.doc.contains(el)) return;
        const before = this.pending != null ? this.pending : el.innerHTML;
        this.pending = null;
        const spec = readChart(el);
        fn(spec);
        this.history.begin(label);
        if (kind && kind !== el.getAttribute('data-chart')) this.history.attr(el, 'data-chart', kind, label);
        this.deck.withoutTransitions(() => writeChart(el, spec));
        this.history.html(el, before, el.innerHTML, label);
        this.history.end();
        this.sync(el);
        this.app.selection.refresh();
    }

    _act(act) {
        switch (act) {
            case 'row-add': this.apply('Add chart row', (s) => { s.labels.push(nextLabel(s.labels)); for (const x of s.series) x.values.push(null); }); break;
            case 'row-del': this.apply('Remove chart row', (s) => { if (s.labels.length > 1) { s.labels.pop(); for (const x of s.series) x.values.pop(); } }); break;
            case 'series-add': this.apply('Add chart series', (s) => { s.series.push({ name: 'Series ' + (s.series.length + 1), values: s.labels.map(() => null) }); }); break;
            case 'series-del': this.apply('Remove chart series', (s) => { if (s.series.length > 1) s.series.pop(); this.active = Math.min(this.active, s.series.length - 1); }); break;
        }
    }

    /* The grid's cells into the table: row 0 the series names, column 0 the labels. */
    _fromGrid(spec) {
        for (const input of this.root.querySelectorAll('#chartGrid input')) setCell(spec, +input.dataset.r, +input.dataset.c, input.value);
    }

    /* Focus the first value, for a double-click on the chart. */
    focusData() {
        const first = this.root.querySelector('#chartGrid input[data-r="1"][data-c="1"]');
        if (first) { first.focus(); first.select(); }
    }

    sync(el) {
        this.el = el && isChart(el) ? el : null;
        this.root.hidden = !this.el;
        if (!this.el) { this.pending = null; return; }
        const spec = readChart(this.el), kind = chartKind(this.el), pie = kind === 'pie' || kind === 'doughnut';
        this.active = Math.min(this.active, Math.max(0, spec.series.length - 1));
        this.root.querySelectorAll('#chartKind [data-kind]').forEach(b => b.classList.toggle('on', b.dataset.kind === kind));
        // The grid: rebuilt when its shape changes, else refilled around the cell being typed in.
        const grid = this.$('chartGrid');
        const shape = `${spec.labels.length}x${spec.series.length}`;
        const colourOf = (i) => { const c = seriesColour(spec, i); return /^var\(/.test(c) ? resolve(this.el, c) : c; };
        if (grid.dataset.shape !== shape) {
            grid.dataset.shape = shape;
            const head = '<tr><th><input data-r="0" data-c="0" placeholder="paste" title="Paste a whole table here: the first row the series names, the first column the labels" spellcheck="false"></th>'
                + spec.series.map((s, i) => `<th><span class="chart-head"><button class="chart-chip" data-s="${i}" title="The colour of this series"></button><input data-r="0" data-c="${i + 1}" spellcheck="false"></span></th>`).join('') + '</tr>';
            const body = spec.labels.map((l, j) => `<tr><th><input data-r="${j + 1}" data-c="0" spellcheck="false"></th>` + spec.series.map((s, i) => `<td><input data-r="${j + 1}" data-c="${i + 1}" inputmode="decimal" spellcheck="false"></td>`).join('') + '</tr>').join('');
            grid.innerHTML = head + body;
        }
        const lang = this.deck.doc.documentElement.lang || undefined;
        for (const input of grid.querySelectorAll('input')) {
            if (input === document.activeElement) continue;
            const r = +input.dataset.r, c = +input.dataset.c;
            input.value = r === 0 ? (c === 0 ? '' : spec.series[c - 1].name) : c === 0 ? spec.labels[r - 1] : numText(spec.series[c - 1].values[r - 1], lang);
            // A pie draws the first series only.
            input.closest('td, th').classList.toggle('chart-off', pie && c > 1);
        }
        grid.querySelectorAll('.chart-chip').forEach(b => {
            const i = +b.dataset.s;
            b.style.background = pie ? 'transparent' : colourOf(i);
            b.hidden = pie;
            b.classList.toggle('on', i === this.active);
        });
        // Colours: the active series (or, for a pie, none: its slices take the palette in turn).
        this.$('chartColourRow').hidden = pie || !spec.series.length;
        if (!pie && spec.series[this.active]) {
            this.$('chartColourLabel').textContent = 'Colour of ' + (spec.series[this.active].name || 'series ' + (this.active + 1));
            const cur = spec.series[this.active].colour || '';
            const theme = this.deck.themeColours().map(c => [`var(--${c.name})`, c.value, c.name]);
            const seen = new Set(theme.map(t => t[0]));
            const extra = spec.palette.filter(c => !seen.has(c)).map(c => [c, c, c]);
            setSwatches(this.$('chartSwatches'), `<button type="button" class="insp-swatch chart-auto${cur ? '' : ' on'}" data-c="" title="Automatic: the chart's colours in turn" aria-label="Automatic: the chart's colours in turn"></button>`
                + theme.concat(extra).map(([v, show, name]) => `<button type="button" class="insp-swatch${cur === v ? ' on' : ''}" data-c="${esc(v)}" title="${esc(name === show ? show : colourName(name) + ' ' + show)}" aria-label="${esc(name === show ? show : colourName(name) + ' ' + show)}" style="background:${esc(show)}"></button>`).join(''));
        }
        this.$('chartHint').textContent = pie ? 'A pie shows the first series: one slice per row. Paste cells from a spreadsheet into any cell.' : 'Paste cells from a spreadsheet into any cell; the top-left cell takes a whole table with its headings.';
        this.$('chartStackedRow').hidden = !(kind === 'column' || kind === 'bar' || kind === 'area');
        this.$('chartGridRow').hidden = pie;
        this.root.querySelectorAll('[data-opt]').forEach(i => { i.checked = !!spec[i.dataset.opt]; });
        if (document.activeElement !== this.$('chartUnit')) this.$('chartUnit').value = spec.unit;
        this.root.querySelector('.insp-field[data-prop="_chartUnit"]').classList.toggle('set', !!spec.unit);
        if (document.activeElement !== this.$('chartTitle')) this.$('chartTitle').value = spec.title;
        this.root.querySelector('.insp-field[data-prop="_chartTitle"]').classList.toggle('set', !!spec.title);
    }
}

/* One cell of the grid into the table (row 0: names, column 0: labels). */
function setCell(spec, r, c, v) {
    if (r === 0 && c === 0) return;
    if (r === 0) { if (spec.series[c - 1]) spec.series[c - 1].name = String(v); return; }
    if (c === 0) { if (r - 1 < spec.labels.length) spec.labels[r - 1] = String(v); return; }
    const s = spec.series[c - 1];
    if (s && r - 1 < spec.labels.length) s.values[r - 1] = parseNumber(v);
}
/* The next label after "Q4" is "Q5", after "2026" "2027"; otherwise "Item n". */
function nextLabel(labels) {
    const last = labels[labels.length - 1] || '';
    const m = /^(.*?)(\d+)$/.exec(last);
    return m ? m[1] + (+m[2] + 1) : 'Item ' + (labels.length + 1);
}
function numText(v, lang) { return v == null ? '' : String(v).replace('.', decimalSign(lang)); }
function decimalSign(lang) { try { return (1.5).toLocaleString(lang).includes(',') ? ',' : '.'; } catch (e) { return '.'; } }
function resolve(el, colour) { const p = el.ownerDocument.createElement('i'); p.style.color = colour; el.appendChild(p); const v = css(p).color; p.remove(); return v; }
