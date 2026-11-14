/* ============================================================
   DECK PLOT - interactive charts in a deck (Diapo). No dependencies
   but the charting library the figure names (plotly.js today).

   A chart is a <figure data-plot="plotly"> holding
     <img data-plot-snapshot>                         a picture of it, shown until the live
                                                      chart is drawn and wherever scripts do
                                                      not run (thumbnails, PDF, a paused deck)
     <script type="application/json" data-plot-figure> the figure: {data, layout, config, frames}
   and, on the figure, the options
     data-plot-live="off"     keep the picture, never draw the live chart
     data-plot-theme="deck"   the deck's text colour, font and accent colours on the chart
     data-plot-toolbar="off"  no toolbar over the chart

   The live chart is drawn into a <div class="deck-plot-live"> inside the figure, for the slide
   on show only (a browser keeps few WebGL drawings alive at once) and never while the deck is
   being edited: the editor moves and sizes the picture, and a deck saved from it holds no
   drawing of the library's. Anything that fails leaves the picture in place.

   The editor loads this file too (core/plot.js), for spec(): the snapshot it makes and the
   chart the deck draws come from the same reading of the figure.
   ============================================================ */
(function () {
    'use strict';
    if (window.DeckPlot) return;
    var SELECTOR = 'figure[data-plot]';
    var CLEAR = 'rgba(0,0,0,0)';
    var FALLBACK = ['#2f6fed', '#f59e0b', '#10b981', '#e8503f', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
    // What plotly.js colours traces with when the figure says nothing, and what plotly.py writes
    // into every figure: a trace in one of these takes the deck's colour in the same place.
    var PLOTLY_COLOURS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];

    function isObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
    function assign(to) {
        for (var i = 1; i < arguments.length; i++) { var from = arguments[i]; if (isObject(from)) for (var k in from) if (Object.prototype.hasOwnProperty.call(from, k)) to[k] = from[k]; }
        return to;
    }
    /* b over a, objects merged level by level; arrays and values replaced. Neither is changed. */
    function merge(a, b) {
        if (!isObject(a) || !isObject(b)) return b === undefined ? a : b;
        var out = assign({}, a);
        for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k)) out[k] = merge(a[k], b[k]);
        return out;
    }

    /* The figure a chart element holds: {data, layout, config, frames}. Throws what is wrong with it. */
    function read(el) {
        var holder = el.querySelector('script[data-plot-figure]');
        if (!holder) throw new Error('the chart has no figure');
        return normalise(JSON.parse(holder.textContent));
    }
    /* A figure as plotly.py writes it ({data, layout, frames}), or only its list of traces. */
    function normalise(fig) {
        if (Array.isArray(fig)) fig = { data: fig };
        if (!isObject(fig) || !Array.isArray(fig.data)) throw new Error('a figure needs "data": a list of traces');
        return { data: fig.data, layout: isObject(fig.layout) ? fig.layout : {}, config: isObject(fig.config) ? fig.config : {}, frames: Array.isArray(fig.frames) && fig.frames.length ? fig.frames : null };
    }

    /* A colour with another opacity, for grid and axis lines in the text colour. */
    function fade(colour, alpha) {
        var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/.exec(colour || '');
        if (!m) return colour;
        var a = m[4] == null ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        return 'rgba(' + Math.round(m[1]) + ',' + Math.round(m[2]) + ',' + Math.round(m[3]) + ',' + Math.round(a * alpha * 1000) / 1000 + ')';
    }

    /* The deck's colours for the series: what its :root names as an accent, in the order it
       names them, then a fixed set. */
    function palette(el) {
        var doc = el.ownerDocument, view = doc.defaultView, root = view.getComputedStyle(doc.documentElement);
        var names = [], out = [];
        for (var i = 0; i < doc.styleSheets.length; i++) {
            var rules;
            try { rules = doc.styleSheets[i].cssRules; } catch (e) { continue; }     // a stylesheet from another site
            for (var j = 0; rules && j < rules.length; j++) {
                var r = rules[j];
                if (!r.style || (r.selectorText !== ':root' && r.selectorText !== 'html')) continue;
                for (var k = 0; k < r.style.length; k++) {
                    var n = r.style[k];
                    if (n.indexOf('--') === 0 && /accent|primary|secondary|brand|series|highlight/i.test(n) && !/bg|ink|text|soft|muted|shadow|border|font/i.test(n) && names.indexOf(n) < 0) names.push(n);
                }
            }
        }
        names.forEach(function (n) {
            var v = root.getPropertyValue(n).trim();
            if (/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(v) && out.indexOf(v) < 0) out.push(v);
        });
        for (var f = 0; f < FALLBACK.length && out.length < 8; f++) if (out.indexOf(FALLBACK[f]) < 0) out.push(FALLBACK[f]);
        return out;
    }

    /* The deck's look on a figure: transparent ground, the element's text colour, font and size,
       the deck's accents for the series, axis and grid lines in the text colour. */
    function themed(el, fig) {
        var cs = el.ownerDocument.defaultView.getComputedStyle(el);
        var ink = cs.color, colours = palette(el);
        var L = assign({}, fig.layout), was = isObject(L.template) ? L.template : {}, wasL = isObject(was.layout) ? was.layout : {};
        var old = (Array.isArray(L.colorway) ? L.colorway : Array.isArray(wasL.colorway) ? wasL.colorway : PLOTLY_COLOURS).map(function (c) { return String(c).toLowerCase(); });
        var axis = { gridcolor: fade(ink, 0.16), linecolor: fade(ink, 0.55), zerolinecolor: fade(ink, 0.35), tickcolor: fade(ink, 0.55) };
        var axis3d = assign({ backgroundcolor: CLEAR, showbackground: false }, axis);
        L.paper_bgcolor = CLEAR;
        L.plot_bgcolor = CLEAR;
        L.font = assign({}, L.font, { family: cs.fontFamily, color: ink, size: Math.round(parseFloat(cs.fontSize)) || 16 });
        L.colorway = colours;
        L.template = assign({}, was, { layout: merge(wasL, {
            xaxis: axis, yaxis: axis, legend: { bgcolor: CLEAR }, geo: { bgcolor: CLEAR },
            polar: { bgcolor: CLEAR, angularaxis: axis, radialaxis: axis },
            ternary: { bgcolor: CLEAR, aaxis: axis, baxis: axis, caxis: axis },
            scene: { xaxis: axis3d, yaxis: axis3d, zaxis: axis3d },
        }) });
        // plotly.py writes the colour of every trace into it; the ones still in a default colour follow the deck.
        var swap = function (c) { var i = typeof c === 'string' ? old.indexOf(c.toLowerCase()) : -1; return i < 0 ? c : colours[i % colours.length]; };
        var data = fig.data.map(function (t) {
            if (!isObject(t)) return t;
            var m = isObject(t.marker) && swap(t.marker.color) !== t.marker.color, l = isObject(t.line) && swap(t.line.color) !== t.line.color;
            if (!m && !l) return t;
            var c = assign({}, t);
            if (m) c.marker = assign({}, t.marker, { color: swap(t.marker.color) });
            if (l) c.line = assign({}, t.line, { color: swap(t.line.color) });
            return c;
        });
        return { data: data, layout: L, config: fig.config, frames: fig.frames };
    }

    /* What the library is given for this element: the figure at the element's size (w x h px),
       themed and with its toolbar as the element asks. Nothing in it reaches the internet by
       itself: the links to Plotly's cloud are off. */
    function spec(el, fig, w, h) {
        if (el.getAttribute('data-plot-theme') === 'deck') fig = themed(el, fig);
        var layout = assign({}, fig.layout, { width: Math.round(w), height: Math.round(h), autosize: false });
        var config = assign({}, fig.config, { responsive: false, displaylogo: false, showLink: false, showSendToCloud: false, showEditInChartStudio: false, plotlyServerURL: '' });
        if (el.getAttribute('data-plot-toolbar') === 'off') config.displayModeBar = false;
        var out = { data: fig.data, layout: layout, config: config };
        if (fig.frames) out.frames = fig.frames;
        return out;
    }

    window.DeckPlot = { version: 1, selector: SELECTOR, read: read, normalise: normalise, spec: spec, palette: palette, draw: draw, clear: clear, sync: sync };

    /* ------------------------------------------------------------
       The live chart. Everything below needs a deck around it.
       ------------------------------------------------------------ */
    var stage = document.querySelector('.deck-stage');
    if (!stage) return;
    var root = document.documentElement;

    /* Inside the editor the deck is being edited from the start, before the editor has had
       the time to say so (it marks the page deck-editing once the file is read). */
    var inEditor = false, sawEditing = false;
    try { inEditor = window.parent !== window && !!window.parent.deckEditor && window.parent.deckEditor.deck.iframe === window.frameElement; } catch (e) { /* a frame on another site */ }
    function editing() {
        if (root.classList.contains('deck-editing')) { sawEditing = true; return true; }
        return inEditor && !sawEditing;
    }

    var style = document.createElement('style');
    style.id = 'deck-plot-style';
    style.textContent = [
        'figure[data-plot]>.deck-plot-live{width:100%;height:100%}',
        // Drawn out of sight; the picture stays until the chart is whole.
        'figure[data-plot]>.deck-plot-live:not(.ready){position:absolute;visibility:hidden;pointer-events:none}',
        'figure[data-plot]:has(>.deck-plot-live.ready)>[data-plot-snapshot]{display:none!important}'      // over the picture's own inline display
    ].join('\n');
    document.head.appendChild(style);

    function figures() { return Array.prototype.slice.call(stage.querySelectorAll('figure[data-plot="plotly"]')); }
    function onShow(el) { var s = el.closest('.slide'); return !s || s.classList.contains('active'); }
    function wanted(el) { return !!window.Plotly && !editing() && el.getAttribute('data-plot-live') !== 'off' && onShow(el); }

    function draw(el) {
        if (el.__deckPlot || !window.Plotly) return;
        var w = el.clientWidth, h = el.clientHeight;
        if (w < 20 || h < 20) return;
        var s;
        try { s = spec(el, read(el), w, h); } catch (err) { warn(el, err); return; }
        var host = document.createElement('div');
        host.className = 'deck-plot-live';
        host.style.width = w + 'px';
        host.style.height = h + 'px';
        // The chart's own gestures stay the chart's: a swipe across it or the wheel over it is not
        // the deck's cue to change slide. (Move and release are left alone: the library listens
        // for them on the page while it drags.)
        ['touchstart', 'wheel', 'click', 'dblclick'].forEach(function (type) { host.addEventListener(type, function (e) { e.stopPropagation(); }); });
        var state = el.__deckPlot = { host: host, w: w, h: h, key: keyOf(el) };
        el.appendChild(host);
        var failed = function (err) { if (el.__deckPlot === state) clear(el); el.__deckPlotFailed = state.key; warn(el, err); };
        try {
            Promise.resolve(window.Plotly.newPlot(host, s)).then(function () {
                if (el.__deckPlot !== state) return;
                host.style.width = host.style.height = '';
                host.classList.add('ready');
            }, failed);
        } catch (err) { failed(err); }
    }
    function clear(el) {
        var state = el.__deckPlot;
        if (state) { try { window.Plotly.purge(state.host); } catch (e) { /* nothing was drawn */ } }
        el.__deckPlot = null;
        Array.prototype.forEach.call(el.querySelectorAll(':scope > .deck-plot-live'), function (n) { n.remove(); });
    }
    function warn(el, err) { if (window.console) console.warn('Deck plot: the live chart was not drawn, its picture stays.', err && err.message || err); }
    /* What a drawing was made from: a chart whose figure, options or box changed is drawn again. */
    function keyOf(el) {
        var holder = el.querySelector('script[data-plot-figure]');
        return [el.clientWidth, el.clientHeight, el.getAttribute('data-plot-theme'), el.getAttribute('data-plot-toolbar'), holder ? holder.textContent.length : 0].join('|');
    }

    var leaving = 0;
    function sync() {
        var later = false;
        figures().forEach(function (el) {
            if (wanted(el)) {
                if (el.__deckPlot && el.__deckPlot.key !== keyOf(el)) clear(el);
                if (!el.__deckPlot && el.__deckPlotFailed !== keyOf(el)) draw(el);
            } else if (el.__deckPlot) {
                // The slide that leaves keeps its chart while the transition shows it.
                if (editing() || el.getAttribute('data-plot-live') === 'off') clear(el); else later = true;
            }
        });
        clearTimeout(leaving);
        if (later) leaving = setTimeout(function () { figures().forEach(function (el) { if (el.__deckPlot && !wanted(el)) clear(el); }); }, 1500);
    }
    var queued = 0;
    function queue() { if (!queued) queued = setTimeout(function () { queued = 0; sync(); }, 30); }

    // The slide on show changes (a class on a slide), the editor starts or stops editing (a class on the page).
    new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) if (records[i].target.classList && records[i].target.classList.contains('slide')) { queue(); return; }
    }).observe(stage, { attributes: true, attributeFilter: ['class'], subtree: true });
    new MutationObserver(queue).observe(root, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('deck:slide', queue);

    // Text is measured as it is drawn: wait for the deck's fonts, but not for ever.
    var started = false;
    function start() { if (!started) { started = true; queue(); } }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(start, start);
    setTimeout(start, 1500);
})();
