/* ============================================================
   plot.js - interactive charts from a figure's JSON (Plotly).

   A chart is a <figure data-plot="plotly"> holding the figure as
   data, <script type="application/json" data-plot-figure>, and a
   picture of it, <img data-plot-snapshot>. The deck draws the live
   chart itself when it is presented (app/deck-plot.js, with
   plotly.js beside the deck: serve.py copies both in on save and
   lets them run as Diapo's own); the picture is what shows wherever
   scripts do not run: the slide strip, the PDF, PowerPoint, a deck
   whose scripts are paused, and here while editing, so that a click
   or a drag on the chart is the editor's and never the chart's.

   This module reads what the user pastes (figure JSON, or the page
   fig.write_html makes), makes the picture (Plotly.toImage in the
   editor page, vendor/plotly.min.js loaded on first use, from the
   same reading of the figure as the deck's: DeckPlot.spec), and has
   the Insert dialog and the panel's section.

   data-plot names the library, so another one (Vega-Lite, Chart.js)
   can come in as another value with the same two children.
   ============================================================ */
import { loadVendor } from './vendor.js';

export const PLOT = 'figure[data-plot]';
/* The script tags a deck with a chart carries, in this order, as the last things in its body. */
export const PLOT_SCRIPTS = [['deck-plotly.min.js', 'library'], ['deck-plot.js', 'renderer']];
const PICTURE_STYLE = 'display:block;width:100%;height:100%;';
const BIG_PICTURE = 3 * 1024 * 1024;      // an SVG past this (a scatter of a hundred thousand points) is kept as a PNG

export function isPlot(el) { return !!el && typeof el.matches === 'function' && el.matches(PLOT); }
export function plotOf(el) { return el && el.closest ? el.closest(PLOT) : null; }
const holderOf = (el) => el.querySelector(':scope > script[data-plot-figure]');
const pictureOf = (el) => el.querySelector(':scope > [data-plot-snapshot]');
export const figureText = (el) => { const h = holderOf(el); return h ? h.textContent : ''; };

/* ------------------------------------------------------------
   The libraries, in the editor page
   ------------------------------------------------------------ */
let rendererLoading = null;
function loadRenderer() {
    if (!rendererLoading) rendererLoading = new Promise((resolve, reject) => {
        if (window.DeckPlot) return resolve(window.DeckPlot);
        const s = document.createElement('script');
        s.src = 'deck-plot.js';
        s.onload = () => resolve(window.DeckPlot);
        s.onerror = () => { rendererLoading = null; reject(new Error('could not load deck-plot.js')); };
        document.head.appendChild(s);
    });
    return rendererLoading;
}
export async function loadPlotly() {
    const [Plotly] = await Promise.all([loadVendor('plotly.min.js', () => window.Plotly), loadRenderer()]);
    return Plotly;
}

/* ------------------------------------------------------------
   Reading what is pasted
   ------------------------------------------------------------ */
/* A figure as JSON text that can sit inside a <script> block: no "</script>", no "<!--". */
export function figureJson(fig) {
    const out = { data: fig.data };
    if (fig.layout && Object.keys(fig.layout).length) out.layout = fig.layout;
    if (fig.config && Object.keys(fig.config).length) out.config = fig.config;
    if (fig.frames && fig.frames.length) out.frames = fig.frames;
    return JSON.stringify(out).replace(/</g, '\\u003c');
}

function checkFigure(value) {
    if (value && !Array.isArray(value) && typeof value === 'object' && typeof value.$schema === 'string' && /vega/i.test(value.$schema)) throw new Error('This is a Vega or Vega-Lite chart. Only Plotly figures can be inserted for now.');
    if (Array.isArray(value)) value = { data: value };
    if (!value || typeof value !== 'object') throw new Error('A figure is written between braces: {"data": [...], "layout": {...}}.');
    if (!Array.isArray(value.data)) throw new Error('There is no "data" in it: a Plotly figure is {"data": [...], "layout": {...}}, as fig.to_json() writes it.');
    if (!value.data.length) throw new Error('The figure has no traces: its "data" is an empty list.');
    if (value.data.some(t => !t || typeof t !== 'object' || Array.isArray(t))) throw new Error('Every entry of "data" must be a trace, written between braces.');
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    return { data: value.data, layout: obj(value.layout), config: obj(value.config), frames: Array.isArray(value.frames) && value.frames.length ? value.frames : null };
}

/* Why JSON.parse refused the text, in words, with the line where the browser gives one. */
function jsonProblem(text, err) {
    const msg = String(err && err.message || err);
    if (/\b(True|False|None)\b/.test(text) && !/\b(true|false|null)\b/.test(text) || /^\s*[\[{]\s*'/.test(text)) return 'This looks like Python text (single quotes, True, None), not JSON. In Python, use fig.to_json() or fig.write_json("figure.json").';
    if (/\bNaN\b|\bInfinity\b/.test(text) && /NaN|Infinity|token N|token I/.test(msg)) return 'The text has NaN or Infinity in it, which JSON cannot hold. fig.to_json() writes them as null.';
    let where = '';
    const pos = /position (\d+)/.exec(msg), lc = /line (\d+) column (\d+)/.exec(msg);
    if (lc) where = ` (line ${lc[1]}, column ${lc[2]})`;
    else if (pos) { const before = text.slice(0, +pos[1]).split('\n'); where = ` (line ${before.length}, column ${before[before.length - 1].length + 1})`; }
    const what = msg.replace(/^JSON\.parse:\s*/, '').replace(/\s*in JSON at position \d+.*$/, '').replace(/\s*at position \d+.*$/, '').replace(/\s*at line \d+ column \d+.*$/, '').replace(/\s*\(line \d+ column \d+\)\s*$/, '');
    return 'This is not valid JSON' + where + ': ' + what.charAt(0).toLowerCase() + what.slice(1) + '.';
}

/* The arguments of a call, as the text of each, from just after its "(": strings and
   brackets are skipped over, so a comma inside the figure does not split it. */
function callArguments(src, i) {
    const args = [];
    let depth = 0, start = i, quote = null;
    for (; i < src.length; i++) {
        const c = src[i];
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'" || c === '`') quote = c;
        else if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') {
            if (depth === 0) { args.push(src.slice(start, i)); return args; }
            depth--;
        } else if (c === ',' && depth === 0) { args.push(src.slice(start, i)); start = i + 1; }
    }
    return null;
}

/* The figure in a page Plotly exported (fig.write_html, with the library inside or from a
   CDN): the data, layout and config written into its Plotly.newPlot(...) call, and the frames
   of its Plotly.addFrames(...). A page from R (htmlwidgets) keeps them in a JSON block. */
function figureFromHtml(html) {
    const calls = Array.from(html.matchAll(/Plotly\.(?:newPlot|react)\s*\(/g));
    let variables = false;
    for (const m of calls.reverse()) {                    // the page's own call comes after the library's text
        const args = callArguments(html, m.index + m[0].length);
        if (!args || args.length < 2) continue;
        let data, layout = {}, config = {};
        try {
            data = JSON.parse(args[1]);
            if (args[2] && args[2].trim()) layout = JSON.parse(args[2]);
            if (args[3] && args[3].trim()) config = JSON.parse(args[3]);
        } catch (e) { if (/^\s*[A-Za-z_$][\w$.]*\s*$/.test(args[1])) variables = true; continue; }
        if (!Array.isArray(data)) continue;
        let frames = null;
        const fm = /Plotly\.addFrames\s*\(/.exec(html.slice(m.index));
        if (fm) {
            const fa = callArguments(html, m.index + fm.index + fm[0].length);
            try { frames = fa && fa[1] ? JSON.parse(fa[1]) : null; } catch (e) { frames = null; }
        }
        return checkFigure({ data, layout, config, frames });
    }
    for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script/gi)) {
        try { const v = JSON.parse(m[1]); if (v && v.x && Array.isArray(v.x.data)) return checkFigure({ data: v.x.data, layout: v.x.layout, config: v.x.config, frames: v.x.frames }); } catch (e) { /* another block */ }
    }
    if (variables) throw new Error('This page draws its chart from variables in its script, so the figure cannot be read out of it. Export it with fig.write_html(...), or paste what fig.to_json() gives.');
    throw new Error(calls.length ? 'This page calls Plotly, but its figure could not be read. Paste what fig.to_json() gives instead.' : 'No Plotly chart was found in this page: there is no Plotly.newPlot(...) in it.');
}

/* What the user pasted or chose, as a figure {data, layout, config, frames}. Throws an Error
   that says, in plain words, what is wrong. */
export function parseFigure(text) {
    const t = String(text || '').replace(/^﻿/, '').trim();
    if (!t) throw new Error('Paste a figure here, or choose a file.');
    if (t[0] === '<' || (/Plotly\.(newPlot|react)\s*\(/.test(t) && t[0] !== '{' && t[0] !== '[')) return figureFromHtml(t);
    let value;
    try { value = JSON.parse(t); } catch (err) { throw new Error(jsonProblem(t, err)); }
    return checkFigure(value);
}

/* What drawing this figure fetches from the internet, in words ('' when nothing): maps need
   their outlines or tiles, a picture given by address its file. Nothing is drawn unasked then. */
export function onlineNeeds(fig) {
    const kinds = new Set((fig.data || []).map(t => String(t && t.type || '')));
    if ([...kinds].some(k => /^(scatter|choropleth|density)(mapbox|map)$/.test(k))) return 'It has a map: the map tiles come from the internet each time the chart is drawn.';
    if (kinds.has('choropleth') || kinds.has('scattergeo')) return 'It has a map: the outlines of the countries come from the internet (cdn.plot.ly) each time the chart is drawn.';
    const pics = fig.layout && Array.isArray(fig.layout.images) ? fig.layout.images : [];
    if (pics.some(p => p && /^(https?:)?\/\//i.test(String(p.source || '')))) return 'It shows a picture from the internet, fetched each time the chart is drawn.';
    return '';
}

/* ------------------------------------------------------------
   The picture
   ------------------------------------------------------------ */
function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}
const textHashes = new WeakMap();      // figure element -> { text, hash }: a figure can be megabytes
function textHash(el) {
    const text = figureText(el), was = textHashes.get(el);
    if (was && was.text === text) return was.hash;
    const h = hash(text);
    textHashes.set(el, { text, hash: h });
    return h;
}
/* What a picture was made from: the figure, the box, and for a chart in the deck's look the
   colours and font it took. A picture with another key is out of date. */
export function plotKey(el) {
    const parts = [textHash(el), el.clientWidth, el.clientHeight];
    if (el.getAttribute('data-plot-theme') === 'deck' && window.DeckPlot) {
        const cs = el.ownerDocument.defaultView.getComputedStyle(el);
        parts.push(cs.color, cs.fontFamily, cs.fontSize, window.DeckPlot.palette(el).join(','));
    }
    return 'p' + hash(parts.join('|'));
}

/* A picture of the figure as the element would show it: { src, key, alt }. */
export async function plotPicture(el, fig = null) {
    const Plotly = await loadPlotly();
    const w = el.clientWidth, h = el.clientHeight;
    if (w < 20 || h < 20) throw new Error('the chart has no size yet');
    const spec = window.DeckPlot.spec(el, fig || window.DeckPlot.read(el), w, h);
    let src;
    try {
        src = await Plotly.toImage(spec, { format: 'svg', width: w, height: h });
        if (src.length > BIG_PICTURE) src = await Plotly.toImage(spec, { format: 'png', width: w, height: h, scale: 2 });
    } catch (err) { throw new Error(readable(err)); }
    const title = spec.layout.title && (typeof spec.layout.title === 'string' ? spec.layout.title : spec.layout.title.text);
    return { src, key: plotKey(el), alt: String(title || '').replace(/<[^>]*>/g, '').trim() };
}
function readable(err) {
    return String(err && err.message || err || 'it could not be drawn').replace(/\s+/g, ' ').slice(0, 200);
}

/* Draw the picture into its figure. Not an undo step by itself (see PlotSection). */
export async function writePlot(el) {
    const pic = await plotPicture(el);
    let img = pictureOf(el);
    if (!img) {
        img = el.ownerDocument.createElement('img');
        img.setAttribute('data-plot-snapshot', '');
        img.setAttribute('style', PICTURE_STYLE);
        el.insertBefore(img, el.firstChild);
    }
    img.setAttribute('alt', pic.alt);
    img.setAttribute('data-key', pic.key);
    img.setAttribute('src', pic.src);
}

/* Every chart in `root` whose picture is missing or out of date, drawn again; the ones that
   could not be. A figure that needs the internet to draw is left as it is: that takes a click. */
let refreshing = Promise.resolve();
export function refreshPlots(root) {
    const run = async () => {
        const bad = [];
        if (!root) return bad;
        const list = isPlot(root) ? [root] : Array.from(root.querySelectorAll(PLOT));
        for (const el of list) {
            if (!el.isConnected || el.getAttribute('data-plot') !== 'plotly' || el.hasAttribute('data-ed-probe')) continue;
            try {
                if (!window.DeckPlot) await loadRenderer();
                const img = pictureOf(el);
                if (img && img.getAttribute('data-key') === plotKey(el)) continue;
                if (onlineNeeds(window.DeckPlot.read(el))) continue;
                await writePlot(el);
            } catch (err) { bad.push({ el, message: readable(err) }); }
        }
        return bad;
    };
    refreshing = refreshing.then(run, run);
    return refreshing;
}

/* ------------------------------------------------------------
   In the deck
   ------------------------------------------------------------ */
/* A new chart element for this deck, not yet on a slide: the figure, the deck's text font and
   colour (the chart takes them when it uses the deck's look), a box of the figure's shape. */
export function createPlot(app, fig, { theme = true } = {}) {
    const deck = app.deck, d = app.insert.defaults();
    const el = deck.doc.createElement('figure');
    el.setAttribute('data-plot', 'plotly');
    if (theme) el.setAttribute('data-plot-theme', 'deck');
    const lw = +fig.layout.width, lh = +fig.layout.height;
    const ratio = lw > 50 && lh > 50 ? lw / lh : 16 / 9;
    let w = Math.min(1100, Math.round(deck.stageW * 0.72)), h = Math.round(w / ratio);
    const maxH = Math.round(deck.stageH * 0.74);
    if (h > maxH) { h = maxH; w = Math.round(h * ratio); }
    app.insert.place(el, w, h);
    el.style.cssText += `margin:0; font-family:${d.font}; font-size:22px; color:${d.color};`;
    const holder = deck.doc.createElement('script');
    holder.setAttribute('type', 'application/json');
    holder.setAttribute('data-plot-figure', '');
    holder.textContent = figureJson(fig);
    el.appendChild(holder);
    return el;
}

/* The script tags of a deck with a chart, written into the saved text (`body` is the copy being
   serialised, never the live deck): added after everything else when a slide has a chart,
   taken out when none has. The files themselves are copied beside the deck by serve.py. */
export function syncPlotScripts(body) {
    const doc = body.ownerDocument;
    const tags = Array.from(body.querySelectorAll('script[data-deck-plot]'));
    const used = !!body.querySelector('.deck-stage ' + PLOT);
    if (!used) {
        for (const t of tags) { const before = t.previousSibling; if (before && before.nodeType === 3 && !before.textContent.trim()) before.remove(); t.remove(); }
        return;
    }
    for (const [src, role] of PLOT_SCRIPTS) {
        if (tags.some(t => t.getAttribute('data-deck-plot') === role)) continue;
        const s = doc.createElement('script');
        s.setAttribute('src', src);
        s.setAttribute('data-deck-plot', role);
        body.append('\n', s);
    }
}

/* Plotly and the renderer in the deck the editor shows, for Preview: a deck that got its
   first chart since it was opened has neither yet (its page was served before they were
   beside it), so their text goes in as inline scripts, which the deck's policy lets run as
   Diapo's own. They sit in the head, which is never written back. */
let texts = null;
export async function ensureDeckPlots(deck) {
    const doc = deck.doc, win = deck.win;
    if (!doc || !doc.querySelector('.deck-stage ' + PLOT)) return;
    if (!win.Plotly || !win.DeckPlot) {
        if (!texts) texts = Promise.all(['vendor/plotly.min.js', 'deck-plot.js'].map(u => fetch(u).then(r => { if (!r.ok) throw new Error('could not load ' + u); return r.text(); })));
        let both;
        try { both = await texts; } catch (err) { texts = null; throw err; }
        if (deck.doc !== doc) return;
        [!win.Plotly, !win.DeckPlot].forEach((missing, i) => {
            if (!missing) return;
            const s = doc.createElement('script');
            s.setAttribute('data-ed-plot', '');
            s.textContent = '\n' + both[i].replace(/\r\n?/g, '\n').trim() + '\n';     // the form serve.py knows the hash of
            doc.head.appendChild(s);
        });
    }
    if (win.DeckPlot) win.DeckPlot.sync();
}

/* ------------------------------------------------------------
   Insert > Interactive chart: paste the figure or choose a file,
   see it, insert it.
   ------------------------------------------------------------ */
export function openPlotDialog(app) {
    document.querySelectorAll('.help.plot-dialog').forEach(h => h.remove());
    if (!app.deck.isOpen || !app.deck.currentSlide) return null;
    const h = document.createElement('div');
    h.className = 'help plot-dialog';
    h.setAttribute('role', 'dialog'); h.setAttribute('aria-modal', 'true'); h.setAttribute('aria-label', 'Insert an interactive chart');
    h.innerHTML = `<div class="help-card plot-card">
        <h2>Interactive chart (Plotly)</h2>
        <p>Paste the figure as JSON (in Python: <code>fig.to_json()</code>), or choose a <code>.json</code> file or a page saved with <code>fig.write_html()</code>. When you present, the chart is live: hover, zoom, click the legend.</p>
        <textarea id="plotInput" class="insp-notes theme-css" rows="7" spellcheck="false" autocomplete="off" placeholder='{"data": [{"type": "scatter", "x": [1, 2, 3], "y": [2, 1, 3]}], "layout": {"title": {"text": "My figure"}}}' aria-label="The figure as JSON, or a Plotly page"></textarea>
        <div class="plot-msg" id="plotMsg" role="status"></div>
        <div class="plot-preview" id="plotPreview" aria-label="Preview"><span class="plot-empty">The chart shows here.</span></div>
        <label class="align-toslide"><input type="checkbox" id="plotTheme" checked> <span>Use the deck's colours and fonts</span></label>
        <div class="row">
            <button class="mini-btn" id="plotFile">Choose a file...</button>
            <button class="mini-btn" id="plotSample" title="A small figure to try it with">Try a sample</button>
            <input type="file" id="plotFileInput" accept=".json,.html,.htm,application/json,text/html" hidden>
            <span class="spacer"></span>
            <button class="tb-btn" id="plotCancel">Cancel</button>
            <button class="tb-btn primary" id="plotInsert" disabled>Insert</button>
        </div>
    </div>`;
    document.body.appendChild(h);
    const $ = (id) => h.querySelector('#' + id);
    const input = $('plotInput'), msg = $('plotMsg'), box = $('plotPreview'), insertBtn = $('plotInsert'), themeBox = $('plotTheme');
    let fig = null, probe = null, seq = 0, timer = 0, allowOnline = false, closed = false;

    const say = (text, bad = false) => { msg.textContent = text; msg.classList.toggle('bad', bad); };
    const dropProbe = () => { if (probe) probe.remove(); probe = null; };
    /* The chart-to-be, on the slide but out of sight: its box and the deck's look are read from it. */
    const makeProbe = () => {
        dropProbe();
        probe = createPlot(app, fig, { theme: themeBox.checked });
        probe.setAttribute('data-ed-probe', '');
        probe.style.visibility = 'hidden';
        app.deck.currentSlide.appendChild(probe);
        return probe;
    };
    const clearPreview = (text) => {
        if (window.Plotly && box.firstElementChild && box.firstElementChild.classList.contains('plot-live')) { try { window.Plotly.purge(box.firstElementChild); } catch (e) { /* not drawn */ } }
        box.innerHTML = `<span class="plot-empty"></span>`;
        box.firstChild.textContent = text;
    };
    const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        watcher.disconnect();
        clearPreview('');
        dropProbe();
        h.remove();
    };
    // Esc is the editor's key (it removes the dialog): what the dialog put on the slide goes with it.
    const watcher = new MutationObserver(() => { if (!h.isConnected) close(); });
    watcher.observe(document.body, { childList: true });

    async function preview() {
        const n = ++seq;
        const el = makeProbe();
        const need = onlineNeeds(fig);
        if (need && !allowOnline) {
            clearPreview('');
            box.firstChild.innerHTML = '';
            box.firstChild.append(need + ' ');
            const b = document.createElement('button'); b.className = 'mini-btn'; b.id = 'plotOnline'; b.textContent = 'Draw it';
            b.addEventListener('click', () => { allowOnline = true; preview(); });
            box.firstChild.append(b);
            return;
        }
        try {
            const Plotly = await loadPlotly();
            if (n !== seq || closed) return;
            const w = el.clientWidth, hgt = el.clientHeight;
            const spec = window.DeckPlot.spec(el, fig, w, hgt);
            // At its real size, scaled into the box: text and marks keep the proportions they have on the slide.
            const k = Math.min(box.clientWidth / w, 340 / hgt);
            box.innerHTML = '';
            const live = document.createElement('div');
            live.className = 'plot-live';
            live.style.cssText = `width:${w}px;height:${hgt}px;transform:scale(${k});transform-origin:0 0;`;
            box.style.height = Math.round(hgt * k) + 'px';
            box.style.background = groundOf(app.deck.currentSlide);
            box.appendChild(live);
            await Plotly.newPlot(live, spec);
            if (n !== seq || closed) return;
            const traces = fig.data.length;
            say(`${traces} trace${traces === 1 ? '' : 's'}${fig.frames ? ', animated' : ''}. ` + (need || 'This is how it looks on the slide.'));
        } catch (err) {
            if (n !== seq || closed) return;
            clearPreview('');
            say('Plotly could not draw this figure: ' + readable(err), true);
            insertBtn.disabled = true;
        }
    }
    function read() {
        allowOnline = false;
        try { fig = parseFigure(input.value); }
        catch (err) {
            fig = null; seq++;
            insertBtn.disabled = true;
            dropProbe();
            clearPreview('The chart shows here.');
            say(input.value.trim() ? err.message : '', !!input.value.trim());
            return;
        }
        insertBtn.disabled = false;
        say('Drawing...');
        preview();
    }
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(read, 250); });
    themeBox.addEventListener('change', () => { if (fig) preview(); });
    $('plotFile').addEventListener('click', () => $('plotFileInput').click());
    $('plotFileInput').addEventListener('change', async () => {
        const f = $('plotFileInput').files[0]; $('plotFileInput').value = '';
        if (!f) return;
        const text = await f.text();
        // A page with the library inside is megabytes of script: the field shows the figure read from it.
        let shown = text;
        if (text.length > 400000) { try { shown = figureJson(parseFigure(text)); } catch (e) { shown = text.slice(0, 2000); input.value = shown; say(e.message, true); fig = null; insertBtn.disabled = true; return; } }
        input.value = shown;
        clearTimeout(timer);
        read();
    });
    $('plotSample').addEventListener('click', () => { input.value = JSON.stringify(SAMPLE, null, 1); clearTimeout(timer); read(); });
    h.addEventListener('click', (e) => { if (e.target === h || e.target.id === 'plotCancel') close(); });
    insertBtn.addEventListener('click', async () => {
        if (!fig || insertBtn.disabled) return;
        insertBtn.disabled = true;
        say('Inserting...');
        try {
            const el = probe || makeProbe();
            await writePlot(el);                         // drawn where it will sit, then put there for good
            if (closed) return;
            probe = null;
            el.remove();
            el.removeAttribute('data-ed-probe');
            el.style.visibility = '';
            if (!el.getAttribute('style')) el.removeAttribute('style');
            close();
            app.insert.add(el, 'Insert interactive chart');
            app.selection.select(el);
            ensureDeckPlots(app.deck).catch(() => {});
        } catch (err) { say('The chart could not be drawn: ' + readable(err), true); insertBtn.disabled = false; }
    });
    setTimeout(() => input.focus(), 0);
    return h;
}

/* The colour behind a slide's content, for the dialog's preview. */
function groundOf(slide) {
    for (let el = slide; el; el = el.parentElement) {
        const bg = el.ownerDocument.defaultView.getComputedStyle(el).backgroundColor;
        if (bg && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg)) return bg;
    }
    return '#fff';
}

const SAMPLE = {
    data: [
        { type: 'scatter', mode: 'lines+markers', name: 'Control', x: [0, 10, 20, 30, 40, 50, 60], y: [0.02, 0.05, 0.11, 0.24, 0.41, 0.52, 0.55] },
        { type: 'scatter', mode: 'lines+markers', name: 'Treated', x: [0, 10, 20, 30, 40, 50, 60], y: [0.02, 0.09, 0.27, 0.58, 0.83, 0.91, 0.93] },
    ],
    layout: { title: { text: 'Growth over time' }, xaxis: { title: { text: 'Time (min)' } }, yaxis: { title: { text: 'OD600' } } },
};

/* ============================================================
   PlotSection - the Interactive chart part of the properties
   panel: the figure's JSON (applied on Ctrl+Enter, Apply or on
   leaving the box; a mistake is said under it and the slide keeps
   the chart it had), replace from a file, and the options.
   ============================================================ */
const SHOW_MAX = 1500000;        // characters of JSON the box will hold
const needs = new WeakMap();     // figure element -> { text, need }: read once per figure text, not on every selection change

export class PlotSection {
    constructor(app, root) {
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.root = root;
        this.el = null;
        this.shown = '';             // what the box held when it was filled: unchanged text is not applied
        root.innerHTML = `
          <h4>Interactive chart</h4>
          <textarea id="plotJson" class="insp-notes theme-css" rows="9" spellcheck="false" autocomplete="off" title="The figure as JSON; Ctrl+Enter, Apply or leaving the box puts it on the slide"></textarea>
          <div class="insp-hint insp-state insp-warn" id="plotError" role="status" hidden></div>
          <div class="insp-btns"><button class="mini-btn" id="plotApply" title="Draw the chart from this JSON (Ctrl+Enter)">Apply</button><button class="mini-btn" id="plotReplace" title="Another figure in the same box: a .json file, or a page saved with fig.write_html()">Replace from a file...</button><button class="mini-btn" id="plotRedraw" hidden>Update the picture</button></div>
          <input type="file" id="plotReplaceInput" accept=".json,.html,.htm,application/json,text/html" hidden>
          <label class="align-toslide" title="When presenting, the chart answers the mouse: hover, zoom, legend. Off: the slide shows its picture"><input type="checkbox" id="plotLive"> <span>Live in the presentation</span></label>
          <label class="align-toslide" title="The chart takes its text colour, font and size from the Text and Colour sections below, and the deck's accent colours for its series"><input type="checkbox" id="plotDeckLook"> <span>Use the deck's colours and fonts</span></label>
          <label class="align-toslide" title="Plotly's row of buttons over the chart (zoom, pan, reset, save as picture), shown when the mouse is on it"><input type="checkbox" id="plotToolbar"> <span>Plotly's toolbar</span></label>
          <div class="insp-hint insp-state" id="plotNote"></div>
          <div class="insp-hint">While editing, the slide shows a picture of the chart; Preview (F5) and the saved deck show it live. The picture is also what the PDF, PowerPoint and the slide strip use.</div>`;
        const $ = (id) => root.querySelector('#' + id);
        this.box = $('plotJson'); this.err = $('plotError'); this.note = $('plotNote');
        this.live = $('plotLive'); this.look = $('plotDeckLook'); this.toolbar = $('plotToolbar'); this.redraw = $('plotRedraw');
        this.box.addEventListener('change', () => this.apply());
        this.box.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.apply(); }
            else if (e.key === 'Tab') { e.preventDefault(); this.box.setRangeText('  ', this.box.selectionStart, this.box.selectionEnd, 'end'); }
        });
        $('plotApply').addEventListener('click', () => this.apply());
        $('plotReplace').addEventListener('click', () => $('plotReplaceInput').click());
        $('plotReplaceInput').addEventListener('change', async () => {
            const f = $('plotReplaceInput').files[0]; $('plotReplaceInput').value = '';
            if (f) this.apply(await f.text());
        });
        this.redraw.addEventListener('click', () => this._redraw());
        this.live.addEventListener('change', () => this._option('data-plot-live', this.live.checked ? null : 'off', 'Live chart', false));
        this.look.addEventListener('change', () => this._option('data-plot-theme', this.look.checked ? 'deck' : null, 'Chart colours and fonts', true));
        this.toolbar.addEventListener('change', () => this._option('data-plot-toolbar', this.toolbar.checked ? null : 'off', 'Chart toolbar', false));
    }

    _error(msg) { this.err.hidden = !msg; this.err.textContent = msg ? msg + ' The slide keeps the chart it had.' : ''; }

    /* The figure from `text` (the box, or a file) onto the slide, with its picture: one undo step. */
    async apply(text = null) {
        const el = this.el; if (!el || !this.deck.doc.contains(el)) return;
        const fromBox = text == null;
        if (fromBox) { text = this.box.value; if (text === this.shown) return; }
        let fig;
        try { fig = parseFigure(text); } catch (err) { this._error(err.message); return; }
        const before = el.innerHTML, holder = holderOf(el);
        const json = figureJson(fig);
        if (holder && holder.textContent === json) { this._error(''); if (!fromBox) this._fill(el); return; }
        try {
            let h = holder;
            if (!h) { h = el.ownerDocument.createElement('script'); h.setAttribute('type', 'application/json'); h.setAttribute('data-plot-figure', ''); el.appendChild(h); }
            h.textContent = json;
            await writePlot(el);
        } catch (err) { el.innerHTML = before; this._error('Plotly could not draw this figure: ' + readable(err) + '.'); return; }   // a figure Plotly refuses leaves the slide as it was
        this.history.html(el, before, el.innerHTML, 'Edit chart');
        this._error('');
        this._fill(el);
        this.app.selection.refresh();
    }

    /* An option attribute, and the picture it gives where it changes it: one undo step. */
    async _option(name, value, label, repaint) {
        const el = this.el; if (!el) return;
        const before = el.innerHTML, was = el.getAttribute(name);
        const put = (v) => { if (v == null) el.removeAttribute(name); else el.setAttribute(name, v); };
        let after = before;
        if (repaint) {
            put(value);
            try { await writePlot(el); after = el.innerHTML; }
            catch (err) { this._error('The picture could not be drawn again: ' + readable(err) + '.'); }
            put(was);                                    // back, so history records the change
        }
        this.history.begin(label);
        this.history.attr(el, name, value, label);
        this.history.html(el, before, after, label);
        this.history.end();
        this.sync(el);
    }

    /* The picture drawn again on request: a figure that fetches from the internet is not redrawn by itself. */
    async _redraw() {
        const el = this.el; if (!el) return;
        const before = el.innerHTML;
        try { await writePlot(el); this.history.html(el, before, el.innerHTML, 'Update chart picture'); this._error(''); }
        catch (err) { this._error('The picture could not be drawn: ' + readable(err) + '.'); }
        this.sync(el);
    }

    _fill(el) {
        const text = figureText(el);
        let shown;
        if (text.length > SHOW_MAX) shown = '';
        else { try { shown = JSON.stringify(JSON.parse(text), null, text.length < 300000 ? 1 : 0); } catch (e) { shown = text; } }
        this.box.value = this.shown = shown;
        this.box.disabled = text.length > SHOW_MAX;
        this.box.placeholder = text.length > SHOW_MAX ? `The figure is ${(text.length / 1048576).toFixed(1)} MB, too much to edit here: replace it from a file.` : '';
    }

    focus() { this.box.focus(); }

    sync(el) {
        const p = el && isPlot(el) ? el : null;
        const changed = this.el !== p;
        this.el = p;
        this.root.hidden = !p;
        if (!p) return;
        this.live.checked = p.getAttribute('data-plot-live') !== 'off';
        this.look.checked = p.getAttribute('data-plot-theme') === 'deck';
        this.toolbar.checked = p.getAttribute('data-plot-toolbar') !== 'off';
        if (changed || document.activeElement !== this.box) {
            if (changed) this._error('');
            if (changed || figureText(p) !== this._lastText) this._fill(p);
        }
        this._lastText = figureText(p);
        let need = '';
        const seen = needs.get(p);
        if (seen && seen.text === this._lastText) need = seen.need;
        else {
            try { need = onlineNeeds(JSON.parse(this._lastText)); } catch (e) { this._error('The figure in this chart is not valid JSON.'); }
            needs.set(p, { text: this._lastText, need });
        }
        const img = pictureOf(p);
        const stale = !!need && window.DeckPlot && (!img || img.getAttribute('data-key') !== plotKey(p));
        this.redraw.hidden = !stale;
        this.note.textContent = need + (stale ? ' Its picture is out of date; "Update the picture" draws it again.' : '');
    }
}
