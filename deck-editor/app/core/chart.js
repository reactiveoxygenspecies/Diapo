/* ============================================================
   chart.js - charts the editor draws and edits.

   A chart is a <figure data-chart="column|bar|line|area|pie|doughnut">
   holding two things:
     - <svg data-key> the drawing, plain inline SVG sized to the box
       (viewBox = the box in stage px), so the saved deck needs no
       script or library to show it, in the PDF and the thumbnails too;
     - <script type="application/json" data-chart-data> the table it
       is drawn from: { labels, series: [{ name, values, colour?,
       marker?, dash?, errors? }], palette, legend, values, grid, stacked, unit?,
       title?, and the look, each written only when it is not the
       default: valueAxis { title, line, min, max, step, log, at },
       labelAxis { title, line, angle, at }, ticks, axisWidth, decimals,
       legendPos, lineWidth, pointSize, smooth, barWidth, rounded,
       errorKind, errorDir, errorCaps }. A series' errors are the sizes
       of its error bars, one per label, a column of the grid of their own.
       The value axis is the one with the numbers (up the side, or
       along the bottom of a bar chart), the label axis the other.
       Where each crosses the other: valueAxis.at a label (the axis
       runs through its point), labelAxis.at a value; by default the
       edge of the plot.
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
export const MARKERS = [['circle', 'Circle'], ['square', 'Square'], ['triangle', 'Triangle'], ['diamond', 'Diamond'],
    ['circle-open', 'Open circle'], ['square-open', 'Open square'], ['triangle-open', 'Open triangle'], ['diamond-open', 'Open diamond'], ['none', 'None']];
export const DASHES = [['solid', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted']];
const MARKER_NAMES = MARKERS.map(m => m[0]), DASH_NAMES = DASHES.map(d => d[0]);
/* What an error bar stands for: it names the column (± SD); the bars are drawn alike. */
export const ERROR_KINDS = [['SD', 'SD'], ['SEM', 'SEM'], ['CI', '95% CI']];
/* A column heading that names errors of the column before it, in a pasted table ("SD", "± SEM", "Error"). */
const ERROR_HEAD = /^\s*(?:±|\+\/-|\+-)?\s*(?:sd|s\.d\.?|stdev|std\.?\s*dev\.?|sem|s\.e\.m\.?|se|s\.e\.?|std\.?\s*err(?:or)?|error|err|(?:95\s*%\s*)?ci)\s*$|^\s*(?:±|\+\/-)\s*$/i;
function errorKindOf(head) {
    const h = String(head).toLowerCase().replace(/[±+/\-\s.]/g, '');
    return /^(sem|se|stderr|stderror)$/.test(h) ? 'SEM' : /ci$/.test(h) ? 'CI' : /^(sd|stdev|stddev)$/.test(h) ? 'SD' : '';
}

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
        ...(s && MARKER_NAMES.includes(s.marker) ? { marker: s.marker } : {}),
        ...(s && DASH_NAMES.includes(s.dash) && s.dash !== 'solid' ? { dash: s.dash } : {}),
        // Error bars: one size (plus or minus) per label, in a column of its own beside the values.
        ...(s && Array.isArray(s.errors) ? { errors: labels.map((_, j) => { const v = s.errors[j]; return typeof v === 'number' && isFinite(v) ? Math.abs(v) : null; }) } : {}),
    }));
    const va = r.valueAxis && typeof r.valueAxis === 'object' ? r.valueAxis : {}, la = r.labelAxis && typeof r.labelAxis === 'object' ? r.labelAxis : {};
    return {
        labels, series,
        palette: (Array.isArray(r.palette) ? r.palette : []).filter(c => typeof c === 'string' && SAFE_COLOUR.test(c)),
        legend: r.legend !== false, values: !!r.values, grid: r.grid !== false, stacked: !!r.stacked,
        unit: typeof r.unit === 'string' ? r.unit.slice(0, 12) : '',
        title: typeof r.title === 'string' ? r.title.slice(0, 200) : '',
        valueAxis: { title: str(va.title, 120), line: !!va.line, min: num(va.min, -1e15, 1e15), max: num(va.max, -1e15, 1e15), step: va.step > 0 ? num(va.step, 1e-9, 1e15) : null, log: !!va.log, at: str(va.at, 200) },
        labelAxis: { title: str(la.title, 120), line: !!la.line, angle: [45, 90].includes(la.angle) ? la.angle : 0, at: num(la.at, -1e15, 1e15) },
        ticks: ['out', 'in'].includes(r.ticks) ? r.ticks : 'none',
        axisWidth: num(r.axisWidth, 0.5, 20),
        decimals: Number.isInteger(r.decimals) && r.decimals >= 0 && r.decimals <= 4 ? r.decimals : null,
        legendPos: ['top', 'bottom', 'right'].includes(r.legendPos) ? r.legendPos : '',
        lineWidth: num(r.lineWidth, 0.5, 40), pointSize: num(r.pointSize, 0, 80), smooth: !!r.smooth,
        barWidth: num(r.barWidth, 10, 100), rounded: r.rounded !== false,
        errorKind: ERROR_KINDS.some(([k]) => k === r.errorKind) ? r.errorKind : '',
        errorDir: r.errorDir === 'out' ? 'out' : 'both', errorCaps: r.errorCaps !== false,
    };
}
function num(v, lo, hi) { return typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null; }
function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
function specJson(spec) {
    const out = { labels: spec.labels, series: spec.series.map(s => ({ name: s.name, values: s.values, ...(s.colour ? { colour: s.colour } : {}), ...(s.marker ? { marker: s.marker } : {}), ...(s.dash ? { dash: s.dash } : {}), ...(s.errors ? { errors: s.errors } : {}) })), palette: spec.palette,
        legend: spec.legend, values: spec.values, grid: spec.grid, stacked: spec.stacked };
    if (spec.unit) out.unit = spec.unit;
    if (spec.title) out.title = spec.title;
    // The look: only what differs from the default, so a plain chart's table stays short.
    const va = spec.valueAxis, la = spec.labelAxis, v = {}, l = {};
    if (va.title) v.title = va.title;
    if (va.line) v.line = true;
    for (const key of ['min', 'max', 'step']) if (va[key] != null) v[key] = va[key];
    if (va.log) v.log = true;
    if (va.at) v.at = va.at;
    if (la.title) l.title = la.title;
    if (la.line) l.line = true;
    if (la.angle) l.angle = la.angle;
    if (la.at != null) l.at = la.at;
    if (Object.keys(v).length) out.valueAxis = v;
    if (Object.keys(l).length) out.labelAxis = l;
    if (spec.ticks !== 'none') out.ticks = spec.ticks;
    for (const key of ['axisWidth', 'decimals', 'lineWidth', 'pointSize', 'barWidth']) if (spec[key] != null) out[key] = spec[key];
    if (spec.legendPos) out.legendPos = spec.legendPos;
    if (spec.smooth) out.smooth = true;
    if (!spec.rounded) out.rounded = false;
    if (spec.errorKind) out.errorKind = spec.errorKind;
    if (spec.errorDir !== 'both') out.errorDir = spec.errorDir;
    if (!spec.errorCaps) out.errorCaps = false;
    return JSON.stringify(out).replace(/</g, '\\u003c');
}
/* The two looks the Style section offers in one click: the editor's own, and a journal figure's
   (both axes drawn, ticks outside, no grid, square bars). */
export function applyLook(spec, look) {
    const sci = look === 'scientific';
    spec.valueAxis.line = sci; spec.labelAxis.line = sci;
    spec.ticks = sci ? 'out' : 'none';
    spec.grid = !sci;
    spec.rounded = !sci;
    spec.axisWidth = null;
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
    spec = normalise(JSON.parse(specJson(spec)));             // what the panel set, kept in range as when read
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

/* Column, bar, line and area: a value axis with round ticks (or the ones asked for, or powers of
   ten on a log scale), the labels along the other. Axis lines, tick marks and axis titles where the
   table asks for them. */
function drawAxes(kind, spec, { w, h, fs, measure, onColour, lang, top: top0 = 0 }) {
    const n = spec.labels.length, k = spec.series.length;
    const horizontal = kind === 'bar';
    const va = spec.valueAxis, la = spec.labelAxis, log = va.log;
    const stacked = spec.stacked && kind !== 'line' && !log;
    const small = fs * 0.85, ts = fs * 0.95;                 // tick and label text; axis titles
    const out = [];
    const pad = fs * 0.4;
    let top = Math.max(pad, top0), left = pad, right = w - pad, bottom = h - pad;
    const aw = spec.axisWidth != null ? spec.axisWidth : Math.max(1.5, fs / 14);
    const tl = spec.ticks === 'none' ? 0 : fs * 0.3, tout = spec.ticks === 'out' ? tl : 0;
    const sw = spec.lineWidth != null ? spec.lineWidth : Math.max(3, fs / 7);
    const pr = spec.pointSize != null ? spec.pointSize / 2 : sw * 1.5;
    const markerOf = (s) => s.marker || (kind === 'line' ? 'circle' : 'none');

    // Legend: a row (or rows) across the top or the bottom, or a column at the right.
    let legendRight = null;
    if (spec.legend && k > 0) {
        const entries = spec.series.map((s, i) => ({ name: s.name, colour: seriesColour(spec, i),
            ...(kind === 'line' || (kind === 'area' && (s.marker || s.dash)) ? { line: { marker: markerOf(s), dash: s.dash, sw: Math.min(sw, small * 0.3) } } : {}) }));
        if (spec.legendPos === 'right') {
            legendRight = entries.map(e => [{ ...e, w: legendKeyW(e, small) + small * 0.4 + measure(e.name, small) }]);
            right -= Math.max(...legendRight.map(r => r[0].w)) + fs * 0.6;
        } else {
            const rows = legendRows(entries, right - left, small, measure), lh = rows.length * small * 1.6;
            if (spec.legendPos === 'bottom') { out.push(drawLegendRows(rows, left, bottom - lh, small)); bottom -= lh + fs * 0.4; }
            else { out.push(drawLegendRows(rows, left, top, small)); top += lh + fs * 0.4; }
        }
    }
    if (!n || !k) { out.push(`<text x="${r1(w / 2)}" y="${r1((top + bottom) / 2)}" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="opacity:0.5; font-size:${r1(small)}px">No data</text>`); return out.join(''); }

    // The value range: stacks sum their positives and negatives apart; a log scale takes the positives.
    // Error bars reach past their values: both ways, or only away from zero.
    const errOf = (s, j) => (s.errors && s.errors[j] > 0 ? s.errors[j] : 0);
    const reach = (v, e) => [spec.errorDir === 'both' || v < 0 ? v - e : v, spec.errorDir === 'both' || v >= 0 ? v + e : v];
    let lo = 0, hi = 0, plo = Infinity, phi = -Infinity;
    for (let j = 0; j < n; j++) {
        if (stacked) {
            let p = 0, m = 0;
            for (const s of spec.series) {
                const v = s.values[j], e = errOf(s, j);
                if (v > 0) { p += v; hi = Math.max(hi, p + e); } else if (v < 0) { m += v; lo = Math.min(lo, m - e); }
            }
            hi = Math.max(hi, p); lo = Math.min(lo, m);
        } else for (const s of spec.series) {
            const v = s.values[j]; if (v == null) continue;
            const [a, b] = reach(v, errOf(s, j));
            hi = Math.max(hi, b); lo = Math.min(lo, a);
            if (v > 0) { plo = Math.min(plo, a > 0 ? a : v); phi = Math.max(phi, b); }
        }
    }
    const scale = log ? logScale(plo, phi, va) : valueScale(lo, hi, va);
    const fmt = formatter(spec.unit, lang, null, spec.decimals);
    const tickFmt = log ? (t) => formatter(spec.unit, lang, Math.pow(10, -decimalsOf(t)), spec.decimals)(t)
        : formatter(spec.unit, lang, Math.pow(10, -Math.max(...[scale.step, ...scale.ticks].map(decimalsOf))), spec.decimals);
    const tickW = Math.max(...scale.ticks.map(t => measure(tickFmt(t), small)));
    const valueW = spec.values ? Math.max(0, ...spec.series.flatMap(s => s.values.filter(v => v != null).map(v => measure(fmt(v), small)))) : 0;
    const L0 = log ? Math.log10(scale.lo) : scale.lo, L1 = log ? Math.log10(scale.hi) : scale.hi;
    const frac = (v) => ((log ? Math.log10(v) : v) - L0) / (L1 - L0);
    const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    // Where the axes cross: the value axis through a label's point, the label axis at a value (kept in
    // the range); else at the edge. On a line or an area an axis inside the plot takes its numbers or
    // names with it, as in a graph of a function; bars would cover them, so theirs stay at the edge.
    const crossJ = va.at ? spec.labels.indexOf(va.at) : -1;
    const crossV = la.at == null || (log && la.at <= 0) ? null : Math.min(scale.hi, Math.max(scale.lo, la.at));
    const follow = kind === 'line' || kind === 'area';
    // The room at the edge for an axis' labels, given back as far as they stay inside the plot.
    const fromStart = (base, need, end, f) => (f >= 0.999 ? base : Math.max(base, (base + need - f * end) / (1 - f)));
    const fromEnd = (base, need, start, f) => (f <= 0.001 ? base : Math.min(base, (base - need - start * (1 - f)) / f));

    // Room for the labels: category names below (or at the left for bars), ticks at the left (below),
    // an axis title outside each, and the tick marks that stand out of the plot.
    let cat = spec.labels.slice(), catSize = small;
    const angle = horizontal ? 0 : la.angle, sin = Math.sin(angle * Math.PI / 180), cos = Math.cos(angle * Math.PI / 180);
    const room = ts * 1.5;
    let titleAt = {};                                           // where each axis title goes, as the room is taken
    if (horizontal) {
        const maxW = (right - left) * 0.34;
        cat = cat.map(l => ellipsis(l, maxW, small, measure));
        if (la.title) { titleAt.label = left + ts * 0.7; left += room; }
        left += Math.max(...cat.map(l => measure(l, small))) + fs * 0.6 + tout;
        if (va.title) { titleAt.value = bottom - ts * 0.7; bottom -= room; }
        bottom -= small * 1.7 + tout;
        if (spec.values) right -= valueW + fs * 0.4;
        else right -= measure(tickFmt(scale.ticks[scale.ticks.length - 1]), small) / 2;
    } else {
        if (va.title) { titleAt.value = left + ts * 0.7; left += room; }
        const tickRoom = tickW + fs * 0.6 + tout;
        left = follow && crossJ >= 0 ? fromStart(left, tickRoom, right, (crossJ + 0.5) / n) : left + tickRoom;
        if (spec.values) top += small * 1.4;
        else top += small * 0.6;
        if (la.title) { titleAt.label = bottom - ts * 0.7; bottom -= room; }
        const bottomBase = bottom;
        if (angle) {
            // Turned names hang from their ticks: as long as a good part of the height allows.
            cat = cat.map(l => ellipsis(l, Math.max(fs * 3, (bottom - top) * 0.4), small, measure));
            const widest = Math.max(...cat.map(l => measure(l, small)));
            bottom -= widest * sin + small * cos + small * 0.5 + tout;
            // The first name, turned 45 degrees, reaches out to the left of its column.
            if (angle === 45) left = Math.max(left, pad + measure(cat[0], small) * cos - (right - left) / n / 2);
        } else {
            // Names wider than their column shrink a little, then every second (third...) one shows.
            const band = (right - left) / n;
            const widest = Math.max(...cat.map(l => measure(l, small)));
            if (widest > band * 0.92) catSize = Math.max(small * 0.75, small * band * 0.92 / widest);
            bottom -= catSize * 1.8 + tout;
        }
        if (follow && crossV != null) bottom = fromEnd(bottomBase, bottomBase - bottom, top, 1 - frac(crossV));
    }
    if (bottom - top < fs || right - left < fs) return out.join('');

    const vx = (v) => left + frac(v) * (right - left);           // value -> x (bars)
    const vy = (v) => bottom - frac(v) * (bottom - top);         // value -> y (columns, lines)
    const ok = (v) => v != null && (!log || v > 0);
    const base = log ? scale.lo : Math.min(Math.max(0, scale.lo), scale.hi);   // where bars and areas start
    const band = (horizontal ? bottom - top : right - left) / n;
    const valueAt = crossJ >= 0 ? (horizontal ? top : left) + band * (crossJ + 0.5) : horizontal ? bottom : left;
    const labelAt = crossV != null ? (horizontal ? vx(crossV) : vy(crossV)) : horizontal ? left : bottom;
    const valueText = follow ? valueAt : horizontal ? bottom : left, labelText = follow ? labelAt : horizontal ? left : bottom;
    // The label axis' line would strike through the tick number where it crosses a value axis inside
    // the plot; the value axis' line, through the name of its label when it reaches past it.
    const struck = (t) => follow && la.line && crossJ >= 0 && near(t, crossV != null ? crossV : scale.lo);
    const pierced = (j) => follow && va.line && j === crossJ && crossV != null && frac(crossV) > 0.001;
    // A range set by hand cuts what falls outside it.
    const clip = va.min != null || va.max != null;
    const shown = (v) => !clip || (v >= scale.lo - 1e-9 && v <= scale.hi + 1e-9);

    // Grid, ticks and their numbers.
    const g = [], marks0 = [];
    const tickOp = va.line ? 1 : 0.7;
    const zeroInside = !log && scale.lo < 0 && scale.hi > 0;
    for (const t of scale.ticks) {
        const onEdge = Math.abs(t - scale.lo) < scale.step / 1e6 || (log && t === scale.lo);
        const gridHere = spec.grid && !(!log && t === 0) && !(la.line && (crossV != null ? near(t, crossV) : onEdge));
        const tickText = struck(t) ? '' : esc(tickFmt(t));
        if (horizontal) {
            const x = vx(t);
            if (gridHere) g.push(`<line x1="${r1(x)}" y1="${r1(top)}" x2="${r1(x)}" y2="${r1(bottom)}"/>`);
            if (tl) marks0.push(`<line x1="${r1(x)}" y1="${r1(spec.ticks === 'out' ? valueAt + tl : valueAt - tl)}" x2="${r1(x)}" y2="${r1(valueAt)}"/>`);
            if (tickText) out.push(`<text x="${r1(x)}" y="${r1(valueText + tout + small * 0.9)}" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="opacity:${tickOp}; font-size:${r1(small)}px">${tickText}</text>`);
        } else {
            const y = vy(t);
            if (gridHere) g.push(`<line x1="${r1(left)}" y1="${r1(y)}" x2="${r1(right)}" y2="${r1(y)}"/>`);
            if (tl) marks0.push(`<line x1="${r1(spec.ticks === 'out' ? valueAt - tl : valueAt + tl)}" y1="${r1(y)}" x2="${r1(valueAt)}" y2="${r1(y)}"/>`);
            if (tickText) out.push(`<text x="${r1(valueText - tout - fs * 0.4)}" y="${r1(y)}" text-anchor="end" dominant-baseline="central" fill="currentColor" style="opacity:${tickOp}; font-size:${r1(small)}px">${tickText}</text>`);
        }
    }
    if (g.length) out.unshift(`<g stroke="currentColor" stroke-width="1" style="opacity:0.14">${g.join('')}</g>`);
    const marks1 = [];                                           // the label axis' tick marks, one per name
    if (tl) for (let j = 0; j < n; j++) {
        const c = (horizontal ? top : left) + band * (j + 0.5);
        if (horizontal) marks1.push(`<line x1="${r1(spec.ticks === 'out' ? labelAt - tl : labelAt + tl)}" y1="${r1(c)}" x2="${r1(labelAt)}" y2="${r1(c)}"/>`);
        else marks1.push(`<line x1="${r1(c)}" y1="${r1(spec.ticks === 'out' ? labelAt + tl : labelAt - tl)}" x2="${r1(c)}" y2="${r1(labelAt)}"/>`);
    }
    // The axes: a line where asked for; otherwise a faint line where the bars start, as before.
    const axes = [];
    const axisLine = (x1, y1, x2, y2) => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`;
    const faint = (x1, y1, x2, y2) => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="currentColor" stroke-width="1.5" style="opacity:0.45"/>`;
    const zero = horizontal ? vx(base) : vy(base);
    let zeroLine = '';
    if (!la.line || (zeroInside && !(crossV != null && near(crossV, base)))) zeroLine = horizontal ? faint(zero, top, zero, bottom) : faint(left, zero, right, zero);
    if (va.line) axes.push(horizontal ? axisLine(left, valueAt, right, valueAt) : axisLine(valueAt, top, valueAt, bottom));
    if (la.line) axes.push(horizontal ? axisLine(labelAt, top, labelAt, bottom) : axisLine(left, labelAt, right, labelAt));
    const stroke = (on) => `stroke="currentColor" stroke-width="${r1(aw)}" stroke-linecap="square" style="opacity:${on ? 1 : 0.45}"`;
    const axisMarks = (marks0.length ? `<g ${stroke(va.line)}>${marks0.join('')}</g>` : '') + (marks1.length ? `<g ${stroke(la.line)}>${marks1.join('')}</g>` : '')
        + (axes.length ? `<g stroke="currentColor" stroke-width="${r1(aw)}" stroke-linecap="square">${axes.join('')}</g>` : '');

    // Category names.
    // A name the value axis' line runs through moves off it: above it (bars), or to its right.
    if (horizontal) cat.forEach((l, j) => out.push(`<text x="${r1(labelText - tout - fs * 0.5)}" y="${r1(top + band * (j + 0.5) - (pierced(j) ? small * 0.75 : 0))}" text-anchor="end" dominant-baseline="central" fill="currentColor" style="font-size:${r1(small)}px">${esc(l)}</text>`));
    else if (angle) {
        const every = Math.max(1, Math.ceil(small * 1.15 / (band * sin)));
        const y = labelText + tout + small * 0.5;
        cat.forEach((l, j) => {
            if (j % every) return;
            const x = left + band * (j + 0.5);
            out.push(`<text x="${r1(x)}" y="${r1(y)}" transform="rotate(-${angle} ${r1(x)} ${r1(y)})" text-anchor="end" dominant-baseline="central" fill="currentColor" style="font-size:${r1(small)}px">${esc(l)}</text>`);
        });
    } else {
        const every = Math.max(1, Math.ceil(Math.max(...cat.map(l => measure(l, catSize))) / (band * 0.95)));
        cat.forEach((l, j) => {
            if (j % every) return;
            const off = pierced(j);
            out.push(`<text x="${r1(left + band * (j + 0.5) + (off ? aw / 2 + catSize * 0.3 : 0))}" y="${r1(labelText + tout + catSize * 0.95)}" text-anchor="${off ? 'start' : 'middle'}" dominant-baseline="central" fill="currentColor" style="font-size:${r1(catSize)}px">${esc(l)}</text>`);
        });
    }
    // Axis titles: the one up the side turned to read from the bottom.
    const sideTitle = (t, x) => `<text transform="translate(${r1(x)} ${r1((top + bottom) / 2)}) rotate(-90)" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="font-size:${r1(ts)}px; font-weight:600">${esc(ellipsis(t, bottom - top + fs, ts, measure))}</text>`;
    const baseTitle = (t, y) => `<text x="${r1((left + right) / 2)}" y="${r1(y)}" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="font-size:${r1(ts)}px; font-weight:600">${esc(ellipsis(t, right - left + fs, ts, measure))}</text>`;
    if (va.title) out.push(horizontal ? baseTitle(va.title, titleAt.value) : sideTitle(va.title, titleAt.value));
    if (la.title) out.push(horizontal ? sideTitle(la.title, titleAt.label) : baseTitle(la.title, titleAt.label));
    if (legendRight) out.push(drawLegendRows(legendRight, w - pad - Math.max(...legendRight.map(r => r[0].w)), (top + bottom) / 2 - legendRight.length * small * 0.8, small));

    // An error bar across the value axis at c: from v - e to v + e (or only away from zero), capped
    // at the ends it reaches (on a log scale, a lower end at or below zero stops at the axis, uncapped).
    const errPath = (c, v, e, cap) => {
        const [a0, b] = reach(v, e), a = log && a0 <= 0 ? scale.lo : a0;
        const at = (u, along) => (horizontal ? [vx(u), c + along] : [c + along, vy(u)]);
        let d = `M${pt(at(a, 0))}L${pt(at(b, 0))}`;
        if (spec.errorCaps && cap > 0) {
            if (a0 !== v && !(log && a0 <= 0)) d += `M${pt(at(a, -cap))}L${pt(at(a, cap))}`;
            if (b !== v) d += `M${pt(at(b, -cap))}L${pt(at(b, cap))}`;
        }
        return d;
    };
    // Where a value's label goes: past the end of its error bar, if it has one.
    const tipOf = (v, e, up) => { if (!e) return v; const [a, b] = reach(v, e); return up ? Math.max(v, b) : Math.min(v, log && a <= 0 ? scale.lo : a); };

    const marks = [], labels = [];
    if (kind === 'column' || kind === 'bar') {
        const group = band * (spec.barWidth != null ? spec.barWidth / 100 : k > 1 && !stacked ? 0.78 : 0.62);
        const bw = stacked ? group : group / k;
        const rad = spec.rounded ? Math.min(4, bw / 6) : 0;
        const errs = [];
        for (let j = 0; j < n; j++) {
            let pos = 0, neg = 0;
            spec.series.forEach((s, i) => {
                const v = s.values[j]; if (!ok(v)) return;
                const from = stacked ? (v >= 0 ? pos : neg) : base, to = stacked ? from + v : v;
                if (stacked) { if (v >= 0) pos = to; else neg = to; }
                const off = band * j + (band - group) / 2 + (stacked ? 0 : bw * i);
                const colour = seriesColour(spec, i);
                const up = to >= from, e = errOf(s, j);
                if (horizontal) {
                    const x1 = vx(Math.min(from, to)), x2 = vx(Math.max(from, to)), y = top + off;
                    const bh = bw * (stacked || k === 1 ? 1 : 0.9);
                    if (e) errs.push(errPath(y + bh / 2, to, e, Math.min(bh * 0.25, fs * 0.5)));
                    marks.push(`<rect x="${r1(x1)}" y="${r1(y)}" width="${r1(Math.max(0, x2 - x1))}" height="${r1(bw * (stacked || k === 1 ? 1 : 0.9))}"${rad ? ` rx="${r1(rad)}"` : ''} style="fill:${colour}"/>`);
                    if (spec.values && shown(to)) {
                        const t = fmt(v), tw = measure(t, small), yc = y + bw * (stacked || k === 1 ? 0.5 : 0.45);
                        if (stacked) { if (tw < x2 - x1 - fs * 0.3) labels.push(`<text x="${r1((x1 + x2) / 2)}" y="${r1(yc)}" text-anchor="middle" dominant-baseline="central" style="font-size:${r1(small)}px; fill:${onColour(colour)}">${esc(t)}</text>`); }
                        else labels.push(`<text x="${r1(up ? vx(tipOf(to, e, true)) + fs * 0.3 : vx(tipOf(to, e, false)) - fs * 0.3)}" y="${r1(yc)}" text-anchor="${up ? 'start' : 'end'}" dominant-baseline="central" fill="currentColor" style="font-size:${r1(small)}px">${esc(t)}</text>`);
                    }
                } else {
                    const y1 = vy(Math.max(from, to)), y2 = vy(Math.min(from, to)), x = left + off;
                    const bwx = bw * (stacked || k === 1 ? 1 : 0.9);
                    if (e) errs.push(errPath(x + bwx / 2, to, e, Math.min(bwx * 0.25, fs * 0.5)));
                    marks.push(`<rect x="${r1(x)}" y="${r1(y1)}" width="${r1(bwx)}" height="${r1(Math.max(0, y2 - y1))}"${rad ? ` rx="${r1(rad)}"` : ''} style="fill:${colour}"/>`);
                    if (spec.values && shown(to)) {
                        const t = fmt(v), xc = x + bwx / 2;
                        if (stacked) { if (small * 1.2 < y2 - y1 && measure(t, small) < bwx) labels.push(`<text x="${r1(xc)}" y="${r1((y1 + y2) / 2)}" text-anchor="middle" dominant-baseline="central" style="font-size:${r1(small)}px; fill:${onColour(colour)}">${esc(t)}</text>`); }
                        else labels.push(`<text x="${r1(xc)}" y="${r1(up ? vy(tipOf(to, e, true)) - small * 0.7 : vy(tipOf(to, e, false)) + small * 0.7)}" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="font-size:${r1(small * (measure(t, small) > bwx * 1.4 ? 0.8 : 1))}px">${esc(t)}</text>`);
                    }
                }
            });
            // A stack's total above it.
            if (stacked && spec.values && k > 1 && shown(pos)) {
                const t = fmt(pos + neg);
                if (horizontal) labels.push(`<text x="${r1(vx(pos) + fs * 0.3)}" y="${r1(top + band * (j + 0.5))}" text-anchor="start" dominant-baseline="central" fill="currentColor" style="font-size:${r1(small)}px; font-weight:600">${esc(t)}</text>`);
                else labels.push(`<text x="${r1(left + band * (j + 0.5))}" y="${r1(vy(pos) - small * 0.7)}" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="font-size:${r1(small)}px; font-weight:600">${esc(t)}</text>`);
            }
        }
        // Over the bars, in the text colour, so they read on any fill.
        if (errs.length) marks.push(`<path d="${errs.join('')}" fill="none" stroke="currentColor" stroke-width="${r1(aw)}"/>`);
    } else {
        // Line and area: a point per label at the middle of its column; a gap where a value is missing.
        const x = (j) => left + band * (j + 0.5);
        const acc = new Array(n).fill(0);
        spec.series.forEach((s, i) => {
            const colour = seriesColour(spec, i);
            const ys = s.values.map((v, j) => !ok(v) ? null : (stacked ? acc[j] + v : v));
            const runs = [];
            let run = [];
            ys.forEach((v, j) => { if (v == null) { if (run.length) runs.push(run); run = []; } else run.push(j); });
            if (run.length) runs.push(run);
            const through = (pts) => (spec.smooth ? curve(pts) : pts.slice(1).map(p => 'L' + pt(p)).join(''));
            if (kind === 'area') {
                for (const r of runs) {
                    const upper = r.map(j => [x(j), vy(ys[j])]);
                    const lower = r.slice().reverse().map(j => [x(j), vy(stacked ? acc[j] : base)]);
                    marks.push(`<path d="M${pt(upper[0])}${through(upper)}L${pt(lower[0])}${stacked ? through(lower) : lower.slice(1).map(p => 'L' + pt(p)).join('')}Z" style="fill:${colour}; opacity:${stacked ? 0.85 : 0.28}"/>`);
                }
            }
            const dash = s.dash === 'dash' ? ` stroke-dasharray="${r1(sw * 2.5)} ${r1(sw * 1.8)}"` : s.dash === 'dot' ? ` stroke-dasharray="0 ${r1(sw * 2)}"` : '';
            const shape = markerOf(s);
            // Error bars under the line and its points, in the series' colour.
            const errs = ys.map((y, j) => (y != null && errOf(s, j) ? errPath(x(j), y, errOf(s, j), Math.max(pr, fs * 0.25)) : '')).join('');
            if (errs) marks.push(`<path d="${errs}" fill="none" stroke-width="${r1(aw)}" style="stroke:${colour}"/>`);
            for (const r of runs) {
                if (r.length > 1) { const p = r.map(j => [x(j), vy(ys[j])]); marks.push(`<path d="M${pt(p[0])}${through(p)}" fill="none" stroke-width="${r1(sw)}" stroke-linejoin="round" stroke-linecap="round"${dash} style="stroke:${colour}"/>`); }
                if (shape !== 'none' || r.length === 1) for (const j of r) if (pr > 0) marks.push(markerSvg(shape === 'none' ? 'circle' : shape, x(j), vy(ys[j]), pr, colour, sw));
            }
            if (spec.values) s.values.forEach((v, j) => { if (ys[j] != null && shown(ys[j])) labels.push(`<text x="${r1(x(j))}" y="${r1(Math.min(vy(ys[j]) - Math.max(small * 0.9, pr + small * 0.6), vy(tipOf(ys[j], errOf(s, j), true)) - small * 0.7))}" text-anchor="middle" dominant-baseline="central" fill="currentColor" style="font-size:${r1(small)}px">${esc(fmt(v))}</text>`); });
            if (stacked) s.values.forEach((v, j) => { if (v != null) acc[j] += v; });
        });
    }
    if (clip) {
        // The plot's box, with room in the labels' direction (and for points on the edge of the range).
        const m = kind === 'line' || kind === 'area' ? pr + sw : 0;
        const id = 'chart-clip-' + hash([w, h, left, top, right, bottom, JSON.stringify(spec)].join('|'));
        const box = horizontal ? [left - m, top - band, right - left + 2 * m, bottom - top + 2 * band] : [left - band, top - m, right - left + 2 * band, bottom - top + 2 * m];
        out.push(`<clipPath id="${id}"><rect x="${r1(box[0])}" y="${r1(box[1])}" width="${r1(box[2])}" height="${r1(box[3])}"/></clipPath><g clip-path="url(#${id})">${marks.join('')}</g>`, zeroLine);
    } else out.push(`<g>${marks.join('')}</g>`, zeroLine);
    if (axisMarks) out.push(axisMarks);
    if (labels.length) out.push(`<g>${labels.join('')}</g>`);
    return out.join('');
}

/* A point of a line: filled, or open (filled with the slide's colour, so the line stops at it). */
function markerSvg(shape, cx, cy, r, colour, sw) {
    const open = shape.endsWith('-open'), kind = shape.replace('-open', '');
    const style = open ? `style="fill:var(--slide-bg, var(--paper, var(--bg, #fff))); stroke:${colour}" stroke-width="${r1(Math.max(1, Math.min(sw, r * 0.6)))}"` : `style="fill:${colour}"`;
    const rr = open ? r * 0.85 : r;
    if (kind === 'square') { const a = rr * 0.88; return `<rect x="${r1(cx - a)}" y="${r1(cy - a)}" width="${r1(a * 2)}" height="${r1(a * 2)}" ${style}/>`; }
    if (kind === 'triangle') return `<path d="M${r1(cx)} ${r1(cy - rr * 1.25)}L${r1(cx + rr * 1.15)} ${r1(cy + rr * 0.75)}L${r1(cx - rr * 1.15)} ${r1(cy + rr * 0.75)}Z" stroke-linejoin="round" ${style}/>`;
    if (kind === 'diamond') return `<path d="M${r1(cx)} ${r1(cy - rr * 1.3)}L${r1(cx + rr * 1.05)} ${r1(cy)}L${r1(cx)} ${r1(cy + rr * 1.3)}L${r1(cx - rr * 1.05)} ${r1(cy)}Z" stroke-linejoin="round" ${style}/>`;
    return `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(rr)}" ${style}/>`;
}
function pt(p) { return `${r1(p[0])} ${r1(p[1])}`; }
/* A smooth line through points (monotone: it never overshoots a point, Fritsch-Carlson), as the
   path segments after the first point. */
function curve(p) {
    const n = p.length;
    if (n < 3) return p.slice(1).map(q => 'L' + pt(q)).join('');
    const d = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { d[i] = p[i + 1][0] - p[i][0]; m[i] = d[i] ? (p[i + 1][1] - p[i][1]) / d[i] : 0; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
        if (!m[i]) { t[i] = 0; t[i + 1] = 0; continue; }
        const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
        if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    let out = '';
    for (let i = 0; i < n - 1; i++) {
        const h = d[i] / 3;
        out += `C${r1(p[i][0] + h)} ${r1(p[i][1] + t[i] * h)} ${r1(p[i + 1][0] - h)} ${r1(p[i + 1][1] - t[i + 1] * h)} ${pt(p[i + 1])}`;
    }
    return out;
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
        if (spec.legendPos === 'top') {
            const rows = legendRows(items.map(it => ({ name: it.label, colour: it.colour })), right - left, small, measure);
            out.push(drawLegendRows(rows, left, top, small));
            top += rows.length * small * 1.6 + fs * 0.4;
        } else if (spec.legendPos === 'right' || (!spec.legendPos && right - left - lw > (bottom - top) * 0.9)) {
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
    const fmt = formatter(spec.unit, lang, null, spec.decimals);
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

/* Legend entries laid out in rows that fit the width. An entry is a square of its colour, or, for
   a line, a short stretch of it with its point. */
function legendKeyW(e, size) { return e.line ? size * 1.8 : size * 0.8; }
function legendRows(entries, width, size, measure) {
    const rows = [[]];
    let x = 0;
    for (const e of entries) {
        const ew = legendKeyW(e, size) + size * 0.4 + measure(e.name, size) + size * 1.2;
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
            const kw = legendKeyW(e, size);
            if (e.line) {
                const lw = Math.max(1, e.line.sw), dash = e.line.dash === 'dash' ? ` stroke-dasharray="${r1(lw * 2.5)} ${r1(lw * 1.8)}"` : e.line.dash === 'dot' ? ` stroke-dasharray="0 ${r1(lw * 2)}"` : '';
                out.push(`<line x1="${r1(x)}" y1="${r1(y)}" x2="${r1(x + kw)}" y2="${r1(y)}" stroke-width="${r1(lw)}" stroke-linecap="round"${dash} style="stroke:${e.colour}"/>`);
                if (e.line.marker !== 'none') out.push(markerSvg(e.line.marker, x + kw / 2, y, size * 0.3, e.colour, lw));
            } else out.push(`<rect x="${r1(x)}" y="${r1(y - size * 0.4)}" width="${r1(size * 0.8)}" height="${r1(size * 0.8)}" rx="${r1(size * 0.15)}" style="fill:${e.colour}"/>`);
            out.push(`<text x="${r1(x + kw + size * 0.4)}" y="${r1(y)}" dominant-baseline="central" fill="currentColor" style="font-size:${r1(size)}px">${esc(e.name)}</text>`);
            x += e.w;
        }
    });
    return `<g>${out.join('')}</g>`;
}

/* The value axis' range and ticks: round ones from the data, or the minimum, maximum and step the
   table sets (ticks from the minimum, a step apart). */
export function valueScale(lo, hi, ax = {}) {
    const fixLo = ax.min != null, fixHi = ax.max != null;
    if (!fixLo && !fixHi && ax.step == null) return niceScale(lo, hi);
    let a = fixLo ? ax.min : lo, b = fixHi ? ax.max : hi;
    if (b <= a) { if (fixHi && !fixLo) a = b - (Math.abs(b) || 1); else b = a + (Math.abs(a) || 1); }
    const auto = niceScale(a, b).step;
    let step = ax.step > 0 ? ax.step : auto;
    if ((b - a) / step > 50) step = auto;                     // a step too small for the range: about five ticks
    if (!fixLo) a = Math.floor(a / step + 1e-9) * step;
    if (!fixHi) b = Math.ceil(b / step - 1e-9) * step;
    if (b <= a) b = a + step;
    const ticks = [];
    for (let i = 0, t = a; t <= b + step * 1e-6; i++, t = a + i * step) ticks.push(Math.abs(t) < step / 1e6 ? 0 : +t.toPrecision(12));
    return { lo: a, hi: b, step, ticks };
}
/* A log scale: whole powers of ten round the positive values (or the range set), a tick at each,
   with 2 and 5 between them over less than two of them. */
export function logScale(lo, hi, ax = {}) {
    if (!(lo > 0) || !isFinite(lo)) { lo = 1; hi = 10; }
    let a = ax.min > 0 ? ax.min : Math.pow(10, Math.floor(Math.log10(lo) + 1e-9));
    let b = ax.max > a ? ax.max : Math.pow(10, Math.ceil(Math.log10(Math.max(hi, a)) - 1e-9));
    if (b <= a) b = a * 10;
    const d0 = Math.floor(Math.log10(a) + 1e-9), d1 = Math.ceil(Math.log10(b) - 1e-9);
    const every = Math.max(1, Math.ceil((d1 - d0) / 8));
    const between = d1 - d0 <= 2 ? [1, 2, 5] : [1];
    const ticks = [];
    for (let d = d0; d <= d1; d += every) for (const f of between) {
        const t = +(f * Math.pow(10, d)).toPrecision(12);
        if (t >= a * (1 - 1e-9) && t <= b * (1 + 1e-9)) ticks.push(t);
    }
    if (!ticks.length) ticks.push(a, b);
    return { lo: a, hi: b, log: true, ticks };
}
/* How many decimals a number is written with (0.25 -> 2), up to four. */
function decimalsOf(v) {
    if (!isFinite(v) || v === 0) return 0;
    const s = Math.abs(v).toPrecision(10).replace(/0+$/, '').replace(/\.$/, '');
    const dot = s.indexOf('.');
    return Math.min(4, dot < 0 ? 0 : s.length - dot - 1);
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
   else after ("%", " kg"). Ticks keep the decimals their step needs; big ticks go compact (12k).
   Decimals the table fixes (fixed) go on every number, and nothing goes compact. */
function formatter(unit, lang, step = null, fixed = null) {
    const decimals = fixed != null ? fixed : step == null ? 2 : Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9)));
    let plain, compact;
    try {
        plain = new Intl.NumberFormat(lang, { maximumFractionDigits: decimals, minimumFractionDigits: step == null && fixed == null ? 0 : decimals });
        compact = new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 });
    } catch (e) {
        plain = new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals });
        compact = plain;
    }
    const pre = /^[$€£¥₹]/.test(unit || '') ? unit : '', post = pre ? '' : (unit || '');
    return (v) => {
        const body = step != null && fixed == null && Math.abs(v) >= 10000 ? compact.format(v) : plain.format(v);
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
   options; then Chart axes (lines, titles, range, log scale,
   ticks) and Chart style (bars, lines, points, two looks).
   Every change is one undo step: the figure's markup
   before and after, plus the kind when it changes.
   ============================================================ */
export class ChartSection {
    /* root: the Chart section; axes and style: the two folding sections after it (their heading
       is the panel's, the rest is written here). */
    constructor(app, root, axes, style) {
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.root = root;
        this.axesRoot = axes;
        this.styleRoot = style;
        this.roots = [root, axes, style].filter(Boolean);
        this.el = null;
        this.active = 0;              // the series the colour row works on
        this.pending = null;          // the figure's markup before a cell being typed in
        this._build();
        this._bind();
    }

    _build() {
        const clear = (path, what) => `<i class="insp-clear" role="button" tabindex="0" data-clear-set="${path}" title="${what}" aria-label="${what}">&times;</i>`;
        const opts = (list) => list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
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
          <div class="chart-colour-row" id="chartColourRow"><span class="insp-hint insp-state" id="chartColourLabel"></span><div class="insp-swatches" id="chartSwatches"></div>
            <div class="insp-row2" id="chartSeriesLook">
              <div class="insp-field"><label>Points</label><select data-series="marker" title="The points of this series"><option value="">Automatic</option>${opts(MARKERS)}</select></div>
              <div class="insp-field"><label>Line</label><select data-series="dash" title="The line of this series">${opts(DASHES)}</select></div>
            </div>
            <label class="align-toslide" id="chartErrRow" title="A column beside this series' values in the table: the size of each error bar (plus or minus), such as the SD or the SEM"><input type="checkbox" data-series-err> <span>Error bars (a &plusmn; column)</span></label>
          </div>
          <div class="insp-row" id="chartErrKindRow"><label>Error is</label><div class="insp-field" data-cfield="errorKind"><select data-set="errorKind" title="What the error bars stand for: it heads their columns (&plusmn; SD); the bars are drawn alike"><option value="">&plusmn; (not named)</option>${opts(ERROR_KINDS)}</select>${clear('errorKind', 'Not named')}</div></div>
          <div class="chart-opts">
            <label class="align-toslide" id="chartStackedRow"><input type="checkbox" data-opt="stacked"> <span>Stacked</span></label>
            <label class="align-toslide"><input type="checkbox" data-opt="legend"> <span>Legend</span></label>
            <label class="align-toslide"><input type="checkbox" data-opt="values"> <span>Values on the chart</span></label>
            <label class="align-toslide" id="chartGridRow"><input type="checkbox" data-opt="grid"> <span>Grid lines</span></label>
          </div>
          <div class="insp-row" id="chartLegendPosRow"><label>Legend at</label><div class="insp-field" data-cfield="legendPos"><select data-set="legendPos"><option value="">Automatic</option><option value="top">Top</option><option value="bottom">Bottom</option><option value="right">Right</option></select>${clear('legendPos', 'Where it fits')}</div></div>
          <div class="insp-row"><label>Title</label><div class="insp-field" data-cfield="title"><input type="text" id="chartTitle" placeholder="(none)" spellcheck="true" title="A title across the top of the chart; a text box on the slide does the same with more choice"><i class="insp-clear" role="button" tabindex="0" data-clear="title" title="No title">&times;</i></div></div>
          <div class="insp-row"><label>Unit</label><div class="insp-field" data-cfield="unit"><input type="text" id="chartUnit" placeholder="%, $, kg" spellcheck="false" title="Written with every number: a currency sign before it, anything else after (put a space first for &quot;12 kg&quot;)"><i class="insp-clear" role="button" tabindex="0" data-clear="unit" title="No unit">&times;</i></div></div>
          <div class="insp-row"><label>Decimals</label><div class="insp-field" data-cfield="decimals"><select data-set="decimals" data-num title="Decimals on every number of the chart: the axis and the values"><option value="">Automatic</option><option value="0">0 (12)</option><option value="1">1 (12.3)</option><option value="2">2 (12.34)</option><option value="3">3 (12.345)</option><option value="4">4</option></select>${clear('decimals', 'As each number needs')}</div></div>
          <div class="insp-hint">Text size, font and colour: the Text fields below.</div>`;
        if (this.axesRoot) this.axesRoot.insertAdjacentHTML('beforeend', `
          <div class="chart-axis-head" id="chartValueHead">Y axis: the values</div>
          <div class="chart-opts">
            <label class="align-toslide"><input type="checkbox" data-set="valueAxis.line"> <span>Axis line</span></label>
            <label class="align-toslide" title="Powers of ten an equal step apart; zero and negative values are left out"><input type="checkbox" data-set="valueAxis.log"> <span>Log scale</span></label>
          </div>
          <div class="insp-row"><label>Title</label><div class="insp-field" data-cfield="valueAxis.title"><input type="text" data-set="valueAxis.title" placeholder="(none)" spellcheck="true" title="The name of the axis, turned along it">${clear('valueAxis.title', 'No title')}</div></div>
          <div class="insp-row2">
            <div class="insp-field" data-cfield="valueAxis.min"><label>Min</label><input type="number" step="any" data-set="valueAxis.min" placeholder="auto" title="Where the axis starts; empty: from the data">${clear('valueAxis.min', 'From the data')}</div>
            <div class="insp-field" data-cfield="valueAxis.max"><label>Max</label><input type="number" step="any" data-set="valueAxis.max" placeholder="auto" title="Where the axis ends; empty: from the data">${clear('valueAxis.max', 'From the data')}</div>
          </div>
          <div class="insp-row2" id="chartStepRow">
            <div class="insp-field" data-cfield="valueAxis.step"><label>Step</label><input type="number" step="any" min="0" data-set="valueAxis.step" placeholder="auto" title="The distance between two ticks; empty: about five round ones">${clear('valueAxis.step', 'Round ticks')}</div>
          </div>
          <div class="insp-row"><label>Crosses at</label><div class="insp-field" data-cfield="valueAxis.at"><select data-set="valueAxis.at" id="chartValueAt" title="The label whose point the axis runs through (0, for a graph of x); its numbers go with it"></select>${clear('valueAxis.at', 'At the edge')}</div></div>
          <div class="chart-axis-head" id="chartLabelHead">X axis: the labels</div>
          <div class="chart-opts">
            <label class="align-toslide"><input type="checkbox" data-set="labelAxis.line"> <span>Axis line</span></label>
          </div>
          <div class="insp-row"><label>Title</label><div class="insp-field" data-cfield="labelAxis.title"><input type="text" data-set="labelAxis.title" placeholder="(none)" spellcheck="true" title="The name of the axis">${clear('labelAxis.title', 'No title')}</div></div>
          <div class="insp-row"><label>Crosses at</label><div class="insp-field" data-cfield="labelAxis.at"><input type="number" step="any" data-set="labelAxis.at" id="chartLabelAt" placeholder="edge" title="The value the axis crosses the other at (0, below which values are negative); its names go with it. Empty: at the edge">${clear('labelAxis.at', 'At the edge')}</div></div>
          <div class="insp-row" id="chartAngleRow"><label>Labels</label><div class="insp-field insp-seg" id="chartAngle"><button data-set-btn="labelAxis.angle" data-v="0" title="Level">Level</button><button data-set-btn="labelAxis.angle" data-v="45" title="Turned 45 degrees, for long names">45&deg;</button><button data-set-btn="labelAxis.angle" data-v="90" title="Upright, reading from the bottom">90&deg;</button></div></div>
          <div class="chart-axis-head">Both axes</div>
          <div class="insp-row"><label>Ticks</label><div class="insp-field insp-seg" id="chartTicks"><button data-set-btn="ticks" data-v="none" title="No tick marks">None</button><button data-set-btn="ticks" data-v="out" title="Tick marks outside the plot">Outside</button><button data-set-btn="ticks" data-v="in" title="Tick marks inside the plot">Inside</button></div></div>
          <div class="insp-row"><label>Thickness</label><div class="insp-field" data-cfield="axisWidth"><input type="number" min="0.5" max="20" step="0.5" data-set="axisWidth" placeholder="auto" title="The axis lines and tick marks"><span class="unit">px</span>${clear('axisWidth', 'Follow the text size')}</div></div>`);
        if (this.styleRoot) this.styleRoot.insertAdjacentHTML('beforeend', `
          <div class="insp-btns">
            <button class="mini-btn" data-chart-look="clean" title="Grid lines, no axis lines or ticks, rounded bars: the editor's own look">Clean</button>
            <button class="mini-btn" data-chart-look="scientific" title="Both axes drawn, ticks outside, no grid lines, square bars: a journal figure">Scientific</button>
          </div>
          <div id="chartBarStyle">
            <div class="insp-row"><label>Bar width</label><div class="insp-field insp-range" data-cfield="barWidth"><input type="range" min="10" max="100" step="2" data-set="barWidth" title="How much of its slot a bar (or a group of bars) fills"><span class="unit" id="chartBarWidthV"></span>${clear('barWidth', 'Automatic')}</div></div>
            <label class="align-toslide"><input type="checkbox" data-set="rounded"> <span>Rounded corners</span></label>
          </div>
          <div id="chartLineStyle">
            <div class="insp-row2">
              <div class="insp-field" data-cfield="lineWidth"><label>Line</label><input type="number" min="0.5" max="40" step="0.5" data-set="lineWidth" placeholder="auto" title="The thickness of the lines"><span class="unit">px</span>${clear('lineWidth', 'Follow the text size')}</div>
              <div class="insp-field" data-cfield="pointSize"><label>Points</label><input type="number" min="0" max="80" step="1" data-set="pointSize" placeholder="auto" title="The size of the points (0: none)"><span class="unit">px</span>${clear('pointSize', 'Follow the line')}</div>
            </div>
            <label class="align-toslide" title="A curve through the points that never overshoots them"><input type="checkbox" data-set="smooth"> <span>Smooth curve</span></label>
          </div>
          <div id="chartErrStyle">
            <div class="insp-row"><label>Error bars</label><div class="insp-field insp-seg" id="chartErrDir"><button data-set-btn="errorDir" data-v="both" title="Above and below the value">Both ways</button><button data-set-btn="errorDir" data-v="out" title="Only away from zero: up from a positive value, down from a negative one">Outward</button></div></div>
            <label class="align-toslide"><input type="checkbox" data-set="errorCaps"> <span>Caps on the error bars</span></label>
          </div>`);
        this.$ = (id) => document.getElementById(id);
    }

    _bind() {
        for (const r of this.roots) this._bindRoot(r);
    }
    _bindRoot(r) {
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
            if (clear && this.el) { const k = clear.dataset.clear; this.apply('Chart ' + k, (s) => { s[k] = ''; }); return; }
            const clearSet = e.target.closest('.insp-clear[data-clear-set]');
            if (clearSet && this.el) { const p = clearSet.dataset.clearSet; this.apply('Chart ' + nameOf(p), (s) => { setPath(s, p, typeof getPath(s, p) === 'string' ? '' : null); }); return; }
            const btn = e.target.closest('[data-set-btn]');
            if (btn && this.el) { const p = btn.dataset.setBtn, v = /^\d+$/.test(btn.dataset.v) ? +btn.dataset.v : btn.dataset.v; this.apply('Chart ' + nameOf(p), (s) => { setPath(s, p, v); }); return; }
            const look = e.target.closest('[data-chart-look]');
            if (look && this.el) this.apply('Chart look', (s) => applyLook(s, look.dataset.chartLook));
        });
        r.addEventListener('change', (e) => {
            const opt = e.target.closest('[data-opt]');
            if (opt && this.el) { this.apply('Chart ' + opt.dataset.opt, (s) => { s[opt.dataset.opt] = opt.checked; }); return; }
            const set = e.target.closest('[data-set]');
            if (set && this.el) { const p = set.dataset.set, v = inputValue(set); this.apply('Chart ' + nameOf(p), (s) => { setPath(s, p, v); }); return; }
            const err = e.target.closest('[data-series-err]');
            if (err && this.el) {
                const i = this.active, on = err.checked;
                this.apply(on ? 'Add error bars' : 'Remove error bars', (s) => { if (s.series[i]) { if (on) s.series[i].errors = s.labels.map(() => null); else delete s.series[i].errors; } });
                // Straight to its first cell, to type or paste the errors in.
                const c = on ? gridCols(readChart(this.el)).findIndex(col => col.s === i && col.err) : -1;
                const first = c > 0 && this.root.querySelector(`#chartGrid input[data-r="1"][data-c="${c}"]`);
                if (first) { first.focus(); first.select(); }
                return;
            }
            const ser = e.target.closest('[data-series]');
            if (ser && this.el) { const i = this.active, k = ser.dataset.series, v = ser.value; this.apply('Series ' + (k === 'dash' ? 'line' : 'points'), (s) => { if (s.series[i]) { if (v && !(k === 'dash' && v === 'solid')) s.series[i][k] = v; else delete s.series[i][k]; } }); return; }
            if (e.target.id === 'chartUnit' && this.el) { const v = e.target.value.slice(0, 12); this.apply('Chart unit', (s) => { s.unit = v; }); return; }
            if (e.target.id === 'chartTitle' && this.el) { const v = e.target.value.trim().slice(0, 200); this.apply('Chart title', (s) => { s.title = v; }); return; }
            if (e.target.closest('#chartGrid') && this.el) this.apply('Chart data', (s) => this._fromGrid(s));
        });
        // Typing in a cell (or dragging a slider) redraws as it goes; the change (Tab, Enter, leaving the cell) is the undo step.
        r.addEventListener('input', (e) => {
            if (!this.el || !this.deck.doc.contains(this.el)) return;
            const range = e.target.matches('input[type=range][data-set]') ? e.target : null;
            if (!range && !e.target.closest('#chartGrid')) return;
            if (this.pending == null) this.pending = this.el.innerHTML;
            const s = readChart(this.el);
            if (range) { setPath(s, range.dataset.set, inputValue(range)); this._rangeText(s); }
            else this._fromGrid(s);
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
                if (r0 === 0 && c0 === 0 && rows.length > 1) { tableInto(s, rows); return; }
                const needRows = r0 + rows.length - 1, needCols = c0 + Math.max(...rows.map(x => x.length)) - 1;
                while (s.labels.length < needRows) s.labels.push('');
                while (gridCols(s).length - 1 < needCols) s.series.push({ name: 'Series ' + (s.series.length + 1), values: s.labels.map(() => null) });
                for (const sr of s.series) while (sr.values.length < s.labels.length) sr.values.push(null);
                const cols = gridCols(s);
                rows.forEach((row, i) => row.forEach((v, j) => setCell(s, r0 + i, c0 + j, v, cols)));
            });
        });
        r.addEventListener('keydown', (e) => {
            // Enter in a text or number field is done with it (its change is the undo step).
            if (e.key === 'Enter' && e.target.matches('#chartUnit, #chartTitle, input[data-set]:not([type=checkbox]):not([type=range])')) { e.preventDefault(); e.target.blur(); return; }
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
        const cols = gridCols(spec);
        for (const input of this.root.querySelectorAll('#chartGrid input')) setCell(spec, +input.dataset.r, +input.dataset.c, input.value, cols);
    }

    /* Focus the first value, for a double-click on the chart. */
    focusData() {
        const first = this.root.querySelector('#chartGrid input[data-r="1"][data-c="1"]');
        if (first) { first.focus(); first.select(); }
    }

    /* The bar width slider shows the automatic width when none is set. */
    _rangeText(spec) {
        const auto = spec.series.length > 1 && !spec.stacked ? 78 : 62;
        this.$('chartBarWidthV').textContent = Math.round(spec.barWidth != null ? spec.barWidth : auto) + '%';
        return auto;
    }

    sync(el) {
        this.el = el && isChart(el) ? el : null;
        this.root.hidden = !this.el;
        if (!this.el) { this.pending = null; for (const r of this.roots) r.hidden = true; return; }
        const spec = readChart(this.el), kind = chartKind(this.el), pie = kind === 'pie' || kind === 'doughnut';
        if (this.axesRoot) this.axesRoot.hidden = pie;
        if (this.styleRoot) this.styleRoot.hidden = pie;
        this.active = Math.min(this.active, Math.max(0, spec.series.length - 1));
        this.root.querySelectorAll('#chartKind [data-kind]').forEach(b => b.classList.toggle('on', b.dataset.kind === kind));
        // The grid: rebuilt when its shape changes, else refilled around the cell being typed in.
        const grid = this.$('chartGrid');
        // A series with error bars has a column of them after its values (headed ± SD).
        const cols = gridCols(spec);
        const errHead = '±' + (spec.errorKind ? ' ' + spec.errorKind : '');
        const shape = `${spec.labels.length}x${cols.map(c => (c.err ? 'e' : 's')).join('')}${errHead}`;
        const colourOf = (i) => { const c = seriesColour(spec, i); return /^var\(/.test(c) ? resolve(this.el, c) : c; };
        if (grid.dataset.shape !== shape) {
            grid.dataset.shape = shape;
            const head = '<tr><th><input data-r="0" data-c="0" placeholder="paste" title="Paste a whole table here: the first row the series names, the first column the labels; a column headed SD, SEM or &plusmn; gives the error bars of the one before it" spellcheck="false"></th>'
                + cols.slice(1).map((col, k) => (col.err ? `<th class="chart-err-head" title="The error bars of ${esc(spec.series[col.s].name)}">${esc(errHead)}</th>`
                    : `<th><span class="chart-head"><button class="chart-chip" data-s="${col.s}" title="The colour of this series"></button><input data-r="0" data-c="${k + 1}" spellcheck="false"></span></th>`)).join('') + '</tr>';
            const body = spec.labels.map((l, j) => `<tr><th><input data-r="${j + 1}" data-c="0" spellcheck="false"></th>` + cols.slice(1).map((col, k) => `<td${col.err ? ' class="chart-err"' : ''}><input data-r="${j + 1}" data-c="${k + 1}" inputmode="decimal" spellcheck="false"></td>`).join('') + '</tr>').join('');
            grid.innerHTML = head + body;
        }
        const lang = this.deck.doc.documentElement.lang || undefined;
        for (const input of grid.querySelectorAll('input')) {
            if (input === document.activeElement) continue;
            const r = +input.dataset.r, c = +input.dataset.c, col = cols[c], ser = col && spec.series[col.s];
            input.value = c === 0 ? (r === 0 ? '' : spec.labels[r - 1]) : r === 0 ? ser.name : numText((col.err ? ser.errors : ser.values)[r - 1], lang);
            // A pie draws the first series only, without error bars.
            input.closest('td, th').classList.toggle('chart-off', pie && c > 0 && (col.s > 0 || !!col.err));
        }
        grid.querySelectorAll('.chart-chip').forEach(b => {
            const i = +b.dataset.s;
            b.style.background = pie ? 'transparent' : colourOf(i);
            b.hidden = pie;
            b.classList.toggle('on', i === this.active);
        });
        // Colours: the active series (or, for a pie, none: its slices take the palette in turn).
        this.$('chartColourRow').hidden = pie || !spec.series.length;
        const cur = spec.series[this.active];
        if (!pie && cur) {
            this.$('chartColourLabel').textContent = 'Colour of ' + (cur.name || 'series ' + (this.active + 1));
            const theme = this.deck.themeColours().map(c => [`var(--${c.name})`, c.value, c.name]);
            const seen = new Set(theme.map(t => t[0]));
            const extra = spec.palette.filter(c => !seen.has(c)).map(c => [c, c, c]);
            setSwatches(this.$('chartSwatches'), `<button type="button" class="insp-swatch chart-auto${cur.colour ? '' : ' on'}" data-c="" title="Automatic: the chart's colours in turn" aria-label="Automatic: the chart's colours in turn"></button>`
                + theme.concat(extra).map(([v, show, name]) => `<button type="button" class="insp-swatch${cur.colour === v ? ' on' : ''}" data-c="${esc(v)}" title="${esc(name === show ? show : colourName(name) + ' ' + show)}" aria-label="${esc(name === show ? show : colourName(name) + ' ' + show)}" style="background:${esc(show)}"></button>`).join(''));
            // Points and line of the series, for lines and areas.
            this.$('chartSeriesLook').hidden = !(kind === 'line' || kind === 'area');
            this.root.querySelector('[data-series="marker"]').value = cur.marker || '';
            this.root.querySelector('[data-series="dash"]').value = cur.dash || 'solid';
            this.root.querySelector('[data-series-err]').checked = !!cur.errors;
        }
        const errors = !pie && spec.series.some(x => x.errors);
        this.$('chartErrKindRow').hidden = !errors;
        this.$('chartHint').textContent = pie ? 'A pie shows the first series: one slice per row. Paste cells from a spreadsheet into any cell.' : 'Paste cells from a spreadsheet into any cell; the top-left cell takes a whole table with its headings.';
        this.$('chartStackedRow').hidden = !(kind === 'column' || kind === 'bar' || kind === 'area');
        this.$('chartGridRow').hidden = pie;
        this.$('chartLegendPosRow').hidden = !spec.legend;
        this.root.querySelectorAll('[data-opt]').forEach(i => { i.checked = !!spec[i.dataset.opt]; });
        if (document.activeElement !== this.$('chartUnit')) this.$('chartUnit').value = spec.unit;
        if (document.activeElement !== this.$('chartTitle')) this.$('chartTitle').value = spec.title;
        // Axes and style: every field shows the table's value; a field set away from the default is marked.
        const horizontal = kind === 'bar';
        if (this.axesRoot) {
            this.$('chartValueHead').textContent = horizontal ? 'X axis: the values' : 'Y axis: the values';
            this.$('chartLabelHead').textContent = horizontal ? 'Y axis: the labels' : 'X axis: the labels';
            this.$('chartAngleRow').hidden = horizontal;
            // The labels the value axis can cross at (one no longer in the table says so: drawn at the edge).
            const at = this.$('chartValueAt'), names = [...new Set(spec.labels.filter(l => l !== ''))];
            const list = [['', horizontal ? 'Bottom edge' : 'Left edge'], ...names.map(l => [l, l])];
            if (spec.valueAxis.at && !names.includes(spec.valueAxis.at)) list.push([spec.valueAxis.at, spec.valueAxis.at + ' (not a label)']);
            const optsHtml = list.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
            if (at.dataset.opts !== optsHtml) { at.innerHTML = optsHtml; at.dataset.opts = optsHtml; }
            this.$('chartLabelAt').placeholder = horizontal ? 'left edge' : 'bottom edge';
        }
        if (this.styleRoot) {
            this.$('chartBarStyle').hidden = !(kind === 'column' || kind === 'bar');
            this.$('chartLineStyle').hidden = !(kind === 'line' || kind === 'area');
            this.$('chartErrStyle').hidden = !errors;
        }
        const auto = this._rangeText(spec);
        for (const r of this.roots) {
            r.querySelectorAll('[data-set]').forEach(input => {
                if (input === document.activeElement && input.type !== 'checkbox') return;
                const v = getPath(spec, input.dataset.set);
                if (input.type === 'checkbox') input.checked = !!v;
                else if (input.type === 'range') input.value = v != null ? v : auto;
                else input.value = v == null ? '' : String(v);
            });
            r.querySelectorAll('[data-set-btn]').forEach(b => b.classList.toggle('on', String(getPath(spec, b.dataset.setBtn)) === b.dataset.v));
            r.querySelectorAll('.insp-field[data-cfield]').forEach(f => { const v = getPath(spec, f.dataset.cfield); f.classList.toggle('set', v != null && v !== ''); });
        }
        // Folded, the two sections say in a few words what is set.
        const va = spec.valueAxis, la = spec.labelAxis;
        this._summary(this.axesRoot, [va.line || la.line ? 'lines' : '', spec.ticks !== 'none' ? 'ticks' : '', va.log ? 'log' : '', va.min != null || va.max != null ? 'range' : '', va.at || la.at != null ? 'crossing' : '', va.title || la.title ? 'titles' : ''].filter(Boolean).join(', '));
        this._summary(this.styleRoot, [spec.barWidth != null ? Math.round(spec.barWidth) + '% bars' : '', !spec.rounded ? 'square' : '', spec.smooth ? 'smooth' : '', spec.lineWidth != null ? spec.lineWidth + ' px lines' : '', errors && spec.errorDir === 'out' ? 'outward errors' : ''].filter(Boolean).join(', '));
    }
    _summary(sec, text) { const s = sec && sec.querySelector('.insp-sum'); if (s) s.textContent = text; }
}

/* A path in the table ("valueAxis.min") read and written. */
function getPath(spec, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), spec); }
function setPath(spec, path, v) { const ks = path.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], spec)[last] = v; }
/* The undo label's name for a path: "valueAxis.min" -> "axis min". */
function nameOf(path) { return path.replace(/^valueAxis\./, 'value axis ').replace(/^labelAxis\./, 'label axis ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); }
/* A field's value for the table: a checkbox's tick, a number (empty: none), or the text. */
function inputValue(input) {
    if (input.type === 'checkbox') return input.checked;
    if (input.type === 'number' || input.type === 'range' || input.hasAttribute('data-num')) { const v = parseFloat(input.value); return input.value === '' || !isFinite(v) ? null : v; }
    return input.value.trim();
}

/* The grid's columns: the labels, then each series' values and, when it has error bars, their sizes. */
function gridCols(spec) {
    const cols = [{ s: -1 }];
    spec.series.forEach((s, i) => { cols.push({ s: i }); if (s.errors) cols.push({ s: i, err: true }); });
    return cols;
}
/* One cell of the grid into the table (row 0: names, column 0: labels). */
function setCell(spec, r, c, v, cols = gridCols(spec)) {
    if (r === 0 && c === 0) return;
    if (c === 0) {
        if (r > 0 && r - 1 < spec.labels.length) {
            // The label the value axis crosses at keeps it when renamed.
            const old = spec.labels[r - 1], now = String(v), va = spec.valueAxis;
            if (va && va.at && va.at === old && now && now !== old && spec.labels.filter(l => l === old).length === 1) va.at = now;
            spec.labels[r - 1] = now;
        }
        return;
    }
    const col = cols[c], s = col && spec.series[col.s];
    if (!s) return;
    if (r === 0) { if (!col.err) s.name = String(v); return; }
    if (r - 1 >= spec.labels.length) return;
    if (col.err) { const e = parseNumber(v); s.errors[r - 1] = e == null ? null : Math.abs(e); }
    else s.values[r - 1] = parseNumber(v);
}
/* A whole table pasted: its first row the series names, its first column the labels. A column
   headed SD, SEM, CI, Error or ± after a series holds that series' error bars (Mean | SD | Mean | SD,
   as statistics programs export it); its heading names what they stand for. */
function tableInto(spec, rows) {
    spec.labels = rows.slice(1).map(row => row[0] || '');
    spec.series = [];
    const map = [];
    rows[0].forEach((h, j) => {
        if (!j) return;
        const prev = spec.series[spec.series.length - 1];
        if (prev && !prev.errors && ERROR_HEAD.test(h)) {
            prev.errors = [];
            map[j] = { s: spec.series.length - 1, err: true };
            if (!spec.errorKind) spec.errorKind = errorKindOf(h);
        } else {
            spec.series.push({ name: h || 'Series ' + (spec.series.length + 1), values: [] });
            map[j] = { s: spec.series.length - 1 };
        }
    });
    rows.slice(1).forEach((row, i) => row.forEach((v, j) => {
        const m = map[j]; if (!m) return;
        const n = parseNumber(v), s = spec.series[m.s];
        if (m.err) s.errors[i] = n == null ? null : Math.abs(n); else s.values[i] = n;
    }));
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
