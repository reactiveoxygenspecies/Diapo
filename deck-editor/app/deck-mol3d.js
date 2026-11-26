/* ============================================================
   DECK MOL3D - 3D molecular structures in a deck (Diapo). No
   dependencies but 3Dmol.js, beside the deck as deck-3dmol.min.js.

   A structure is a <figure data-mol3d="FORMAT"> (pdb, cif, sdf, mol,
   mol2, xyz, pqr) holding
     <img data-mol3d-picture>                  a picture of its view, shown wherever
                                               the structure is not live: while editing,
                                               the PDF, PowerPoint, thumbnails, no WebGL
     <script type="chemical/x-..." data-mol3d-source>   the structure file, as text; or
                                               the same element with src="assets/..."
                                               for a large one (never run: not JavaScript)
   and, on the figure, data-mol3d-settings: JSON
     { style, colour, ligands: {hidden: [...]}, water, hydrogens, pick,
       present: "still" | "turns" | "drag", speed, view: [8 numbers], bg }
   (view is 3Dmol's getView(); a list of views for click steps can come
   later as "views" beside it).

   "Turns slowly" and "Drag to turn" swap the picture for a live viewer
   while the figure's slide shows, and only then (a browser keeps few WebGL
   drawings alive at once); leaving the slide stops it. "Still" needs this
   file not at all: a deck whose structures are all still carries no script.
   Anything that fails leaves the picture in place.

   The editor loads this file too (core/mol3d.js), for apply(): the picture
   it makes and the structure the deck turns come from the same reading.
   ============================================================ */
(function () {
    'use strict';
    if (window.DeckMol3d) return;
    var SELECTOR = 'figure[data-mol3d]';
    // The file formats a figure can hold: 3Dmol's name for each, and the type of its holder.
    var FORMATS = {
        pdb: { lib: 'pdb', mime: 'chemical/x-pdb' },
        cif: { lib: 'cif', mime: 'chemical/x-mmcif' },
        sdf: { lib: 'sdf', mime: 'chemical/x-mdl-sdfile' },
        mol: { lib: 'sdf', mime: 'chemical/x-mdl-molfile' },
        mol2: { lib: 'mol2', mime: 'chemical/x-mol2' },
        xyz: { lib: 'xyz', mime: 'chemical/x-xyz' },
        pqr: { lib: 'pqr', mime: 'chemical/x-pqr' }
    };
    var WATER = ['HOH', 'WAT', 'DOD', 'H2O', 'SOL'];
    var DEFAULTS = { style: '', colour: '', ligands: { hidden: [] }, water: false, hydrogens: null, pick: '', present: 'still', speed: 0.4, view: null, bg: 'slide' };
    var FALLBACK = ['#2f6fed', '#f59e0b', '#10b981', '#e8503f', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

    function settings(el) {
        var s = {};
        try { s = JSON.parse(el.getAttribute('data-mol3d-settings') || '{}') || {}; } catch (e) { s = {}; }
        var out = {};
        for (var k in DEFAULTS) out[k] = Object.prototype.hasOwnProperty.call(s, k) ? s[k] : DEFAULTS[k];
        for (var j in s) if (!(j in out)) out[j] = s[j];
        if (!out.ligands || typeof out.ligands !== 'object') out.ligands = { hidden: [] };
        if (!Array.isArray(out.ligands.hidden)) out.ligands.hidden = [];
        return out;
    }
    function formatOf(el) { var f = (el.getAttribute('data-mol3d') || '').toLowerCase(); return FORMATS[f] ? f : 'pdb'; }
    function holderOf(el) { return el.querySelector(':scope > script[data-mol3d-source]'); }
    function pictureOf(el) { return el.querySelector(':scope > img[data-mol3d-picture]'); }

    /* Text kept in a <script> block: "</script" and "<!--" would end or confuse it, so they are
       written "<\/script" and "<\!--" (no structure file has either), and read back. */
    function escape(text) { return String(text).replace(/<(\/script|!--)/gi, '<\\$1'); }
    function unescape(text) { return String(text).replace(/<\\(\/script|!--)/gi, '<$1'); }

    /* The structure file's text: the holder's, or the file it names (fetched: a deck opened from
       the disk in Chrome cannot fetch, and keeps its picture). */
    function source(el) {
        var h = holderOf(el);
        if (!h) return Promise.reject(new Error('the structure has no file'));
        var src = h.getAttribute('src');
        if (!src) return Promise.resolve(unescape(h.textContent));
        return fetch(new URL(src, el.ownerDocument.baseURI).href).then(function (r) {
            if (!r.ok) throw new Error('could not read ' + src);
            return r.text();
        });
    }

    /* A CSS colour as #rrggbb (3Dmol reads hex), or null for a transparent one. */
    function hex(colour, doc) {
        var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/.exec(colour || '');
        if (!m) {
            if (/^#[0-9a-f]{6}$/i.test(colour || '')) return colour.toLowerCase();
            if (!doc || !colour) return null;
            var probe = doc.createElement('i'); probe.style.color = colour; doc.body.appendChild(probe);
            var c = doc.defaultView.getComputedStyle(probe).color; probe.remove();
            m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/.exec(c);
            if (!m) return null;
        }
        var a = m[4] == null ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        if (a < 0.5) return null;
        return '#' + [m[1], m[2], m[3]].map(function (v) { var s = Math.round(+v).toString(16); return s.length < 2 ? '0' + s : s; }).join('');
    }
    /* The colour behind the figure: the first solid background from it up to the page. */
    function ground(el) {
        var doc = el.ownerDocument, view = doc.defaultView;
        for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
            var c = hex(view.getComputedStyle(n).backgroundColor, null);
            if (c) return c;
        }
        return '#ffffff';
    }

    /* The deck's accent colours (what its :root names as accent, primary, ...), then a fixed set. */
    function palette(el) {
        var doc = el.ownerDocument, root = doc.defaultView.getComputedStyle(doc.documentElement), names = [], out = [];
        for (var i = 0; i < doc.styleSheets.length; i++) {
            var rules;
            try { rules = doc.styleSheets[i].cssRules; } catch (e) { continue; }
            for (var j = 0; rules && j < rules.length; j++) {
                var r = rules[j];
                if (!r.style || (r.selectorText !== ':root' && r.selectorText !== 'html')) continue;
                for (var k = 0; k < r.style.length; k++) {
                    var n = r.style[k];
                    if (n.indexOf('--') === 0 && /accent|primary|secondary|brand|series|highlight/i.test(n) && !/bg|ink|text|soft|muted|shadow|border|font/i.test(n) && names.indexOf(n) < 0) names.push(n);
                }
            }
        }
        names.forEach(function (n) { var v = hex(root.getPropertyValue(n).trim(), doc); if (v && out.indexOf(v) < 0) out.push(v); });
        for (var f = 0; f < FALLBACK.length && out.length < 8; f++) if (out.indexOf(FALLBACK[f]) < 0) out.push(FALLBACK[f]);
        return out;
    }

    /* What is in a model: polymer or small molecule, its chains, ligands (by residue name) and water. */
    function analyse(model) {
        var atoms = model.selectedAtoms({}), chains = [], residues = {}, ligands = {}, order = [], water = 0, hydrogens = 0, resi = [Infinity, -Infinity], polymer = false;
        for (var i = 0; i < atoms.length; i++) {
            var a = atoms[i], resn = String(a.resn || '').trim().toUpperCase();
            if (a.elem === 'H' || a.elem === 'D') hydrogens++;
            if (!a.hetflag) {
                if (a.atom === 'CA' || a.atom === "C4'" || a.atom === 'P') polymer = true;
                if (chains.indexOf(a.chain) < 0) chains.push(a.chain);
                residues[a.chain + ':' + a.resi] = 1;
                if (a.resi < resi[0]) resi[0] = a.resi;
                if (a.resi > resi[1]) resi[1] = a.resi;
            } else if (WATER.indexOf(resn) >= 0) water++;
            else if (resn) {
                if (!ligands[resn]) { ligands[resn] = { resn: resn, sites: {}, atoms: 0 }; order.push(resn); }
                ligands[resn].sites[a.chain + ':' + a.resi] = 1;
                ligands[resn].atoms++;
            }
        }
        return {
            small: !polymer, atoms: atoms.length, chains: chains, residues: Object.keys(residues).length, water: water, hydrogens: hydrogens, resi: resi,
            ligands: polymer ? order.map(function (r) { var l = ligands[r], n = Object.keys(l.sites).length; return { resn: r, count: n, ion: l.atoms / n < 1.5 }; }) : []
        };
    }

    /* The look a figure's settings ask for, on a viewer holding its model. */
    function apply($3D, v, model, s, info, colours) {
        colours = colours || FALLBACK;
        v.removeAllSurfaces();
        v.setStyle({}, {});
        var done = [];
        if (info.small) {
            var deck = s.colour === 'deck';
            var scheme = deck ? { prop: 'elem', map: merge($3D.elementColors.Jmol, { C: colours[0] }) } : 'Jmol';
            var st = s.style || 'ballstick';
            if (st === 'spheres') v.setStyle({}, { sphere: { colorscheme: scheme } });
            else if (st === 'sticks') v.setStyle({}, { stick: { radius: 0.18, colorscheme: scheme } });
            else v.setStyle({}, { stick: { radius: 0.14, colorscheme: scheme }, sphere: { scale: 0.26, colorscheme: scheme } });
            if (st === 'surface') done.push(v.addSurface($3D.SurfaceType.VDW, { opacity: 0.55, colorscheme: scheme }, {}));
        } else {
            var polymer = { hetflag: false }, c = s.colour || 'chain', cs;
            var chainMap = {};
            info.chains.forEach(function (ch, i) { chainMap[ch] = colours[i % colours.length]; });
            var rainbow = { prop: 'resi', gradient: 'roygb', min: info.resi[0], max: info.resi[1] };
            if (c === 'rainbow') cs = { colorscheme: rainbow };
            else if (c === 'ss') cs = { colorscheme: 'ssJmol' };
            else if (c === 'element') cs = { colorscheme: 'Jmol' };
            else if (c === 'deck') cs = { colorscheme: { prop: 'chain', map: chainMap } };
            else cs = { colorscheme: 'chain' };
            var st2 = s.style || 'cartoon';
            var cartoon = c === 'element' ? { color: '#9aa3b8' } : c === 'rainbow' ? { color: 'spectrum' } : cs;
            if (st2 === 'sticks') v.setStyle(polymer, { stick: merge({ radius: 0.2 }, cs) });
            else if (st2 === 'spheres') v.setStyle(polymer, { sphere: merge({}, cs) });
            else v.setStyle(polymer, { cartoon: merge({ arrows: true }, cartoon) });
            if (st2 === 'surface') done.push(v.addSurface($3D.SurfaceType.MS, merge({ opacity: 0.8 }, c === 'element' ? { colorscheme: 'Jmol' } : cs), polymer));
            var hidden = s.ligands.hidden || [], shown = [];
            info.ligands.forEach(function (l) {
                if (hidden.indexOf(l.resn) >= 0) return;
                shown.push(l.resn);
                if (l.ion) v.setStyle({ resn: l.resn, hetflag: true }, { sphere: { scale: 0.75, colorscheme: 'Jmol' } });
                else v.setStyle({ resn: l.resn, hetflag: true }, { stick: { radius: 0.22, colorscheme: 'Jmol' }, sphere: { scale: 0.32, colorscheme: 'Jmol' } });
            });
            if (s.water) v.setStyle({ resn: WATER }, { sphere: { scale: 0.2, color: '#7fb3d8' } });
            var pick = s.pick === 'site' ? (shown.length ? { hetflag: false, byres: true, within: { distance: 4.5, sel: { resn: shown, hetflag: true } } } : null)
                : s.pick ? { resn: String(s.pick).split(','), hetflag: false } : null;
            if (pick) v.addStyle(pick, { stick: { radius: 0.2, colorscheme: c === 'deck' ? { prop: 'elem', map: merge($3D.elementColors.Jmol, { C: colours[1 % colours.length] }) } : 'orangeCarbon' } });
        }
        if (s.hydrogens === false || (s.hydrogens == null && !info.small)) v.setStyle({ elem: ['H', 'D'] }, {});
        return Promise.all(done);
    }
    function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

    /* A viewer drawing a figure's structure into `host`: resolves to { viewer, model, info, settings }.
       opts: settings (in place of the figure's own), format, config (for 3Dmol's createViewer). */
    function build($3D, el, host, text, opts) {
        opts = opts || {};
        // Surfaces in this thread: 3Dmol's workers start from blob: addresses, which a page whose
        // scripts are Diapo's alone (by hash) does not run.
        if ($3D.setSyncSurface) $3D.setSyncSurface(true);
        var s = opts.settings || settings(el), fmt = FORMATS[opts.format || formatOf(el)].lib;
        var bg = s.bg === 'none' ? null : ground(el);
        var v = $3D.createViewer(host, merge({ backgroundColor: bg || '#ffffff', backgroundAlpha: bg ? 1 : 0, antialias: true }, opts.config || {}));
        var model = v.addModel(text, fmt, { keepH: true });
        var info = analyse(model);
        return apply($3D, v, model, s, info, palette(el)).then(function () {
            v.zoomTo();
            if (Array.isArray(s.view) && s.view.length === 8) v.setView(s.view);
            v.render();
            return { viewer: v, model: model, info: info, settings: s };
        });
    }
    /* A viewer's WebGL context given back now, not when the page goes. */
    function dispose(v) {
        if (!v) return;
        try { v.spin(false); } catch (e) { /* not spinning */ }
        try { v.clear(); } catch (e) { /* nothing drawn */ }
        try {
            var c = v.getCanvas(), gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
            var lose = gl && gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
        } catch (e) { /* gone already */ }
    }
    function blank(canvas) {
        try {
            var t = document.createElement('canvas');
            t.width = 64; t.height = Math.max(1, Math.round(64 * canvas.height / canvas.width));
            var g = t.getContext('2d');
            g.drawImage(canvas, 0, 0, t.width, t.height);
            var d = g.getImageData(0, 0, t.width, t.height).data;
            for (var i = 3; i < d.length; i += 4) if (d[i] > 8) return false;
            return true;
        } catch (e) { return false; }
    }
    function webgl() {
        try { var c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
    }

    window.DeckMol3d = { version: 1, selector: SELECTOR, formats: FORMATS, settings: settings, formatOf: formatOf, source: source, escape: escape, unescape: unescape, ground: ground, palette: palette, analyse: analyse, apply: apply, build: build, dispose: dispose, sync: function () {} };

    /* ------------------------------------------------------------
       The live structure. Everything below needs a deck around it.
       ------------------------------------------------------------ */
    var stage = document.querySelector('.deck-stage');
    if (!stage) return;
    var root = document.documentElement;
    var inEditor = false, sawEditing = false;
    try { inEditor = window.parent !== window && !!window.parent.deckEditor && window.parent.deckEditor.deck.iframe === window.frameElement; } catch (e) { /* a frame on another site */ }
    function editing() {
        if (root.classList.contains('deck-editing')) { sawEditing = true; return true; }
        return inEditor && !sawEditing;
    }
    var still = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

    var style = document.createElement('style');
    style.id = 'deck-mol3d-style';
    style.textContent = [
        // Only in the stage: a copy of the slide (the overview) shows the picture, never a blank canvas.
        'figure[data-mol3d]>.deck-mol3d-live{display:none;position:absolute;inset:0;overflow:hidden}',
        '.deck-stage figure[data-mol3d]>.deck-mol3d-live{display:block}',
        'figure[data-mol3d]>.deck-mol3d-live:not(.ready){visibility:hidden;pointer-events:none}',
        'figure[data-mol3d]>.deck-mol3d-live.turns{pointer-events:none}',
        'figure[data-mol3d]>.deck-mol3d-live.drag{cursor:grab;touch-action:none}',
        '.deck-stage figure[data-mol3d]:has(>.deck-mol3d-live.ready)>img[data-mol3d-picture]{visibility:hidden}'
    ].join('\n');
    document.head.appendChild(style);

    function figures() { return Array.prototype.slice.call(stage.querySelectorAll(SELECTOR)); }
    function onShow(el) { var s = el.closest('.slide'); return !s || s.classList.contains('active'); }
    function mode(el) {
        var p = settings(el).present;
        if (p === 'turns' && still && still.matches) return 'still';
        return p === 'turns' || p === 'drag' ? p : 'still';
    }
    function wanted(el) { return !!window.$3Dmol && !editing() && mode(el) !== 'still' && onShow(el); }
    function keyOf(el) { var h = holderOf(el); return [el.clientWidth, el.clientHeight, el.getAttribute('data-mol3d-settings'), h ? (h.getAttribute('src') || h.textContent.length) : 0].join('|'); }

    var canGl = null;
    function draw(el) {
        if (el.__deckMol3d || !window.$3Dmol) return;
        if (canGl === null) canGl = webgl();
        if (!canGl) return;
        var w = el.clientWidth, h = el.clientHeight;
        if (w < 20 || h < 20) return;
        var m = mode(el);
        var host = document.createElement('div');
        host.className = 'deck-mol3d-live ' + m;
        if (m === 'drag') {
            // The structure's own gestures stay its own: a click, a swipe or the wheel over it does not
            // change the slide (data-deck-wheel tells the presentation features to leave the wheel alone).
            host.setAttribute('data-deck-wheel', 'own');
            ['touchstart', 'wheel', 'click', 'dblclick', 'pointerdown', 'mousedown', 'contextmenu'].forEach(function (type) {
                host.addEventListener(type, function (e) { e.stopPropagation(); if (type === 'contextmenu') e.preventDefault(); });
            });
        }
        var state = el.__deckMol3d = { host: host, key: keyOf(el), viewer: null };
        el.appendChild(host);
        var failed = function (err) { if (el.__deckMol3d === state) clear(el); el.__deckMol3dFailed = state.key; warn(err); };
        source(el).then(function (text) {
            if (el.__deckMol3d !== state) return null;
            return build(window.$3Dmol, el, host, text);
        }).then(function (r) {
            if (!r) return;
            if (el.__deckMol3d !== state) { dispose(r.viewer); return; }
            state.viewer = r.viewer;
            // Some browsers' WebGL draws nothing on a see-through background: then the slide's colour.
            if (r.settings.bg === 'none') { r.viewer.render(); if (blank(r.viewer.getCanvas())) { r.viewer.setBackgroundColor(ground(el), 1); r.viewer.render(); } }
            if (m === 'turns') r.viewer.spin('y', +r.settings.speed || 0.4);
            host.classList.add('ready');
        }).catch(failed);
    }
    function clear(el) {
        var state = el.__deckMol3d;
        if (state) dispose(state.viewer);
        el.__deckMol3d = null;
        Array.prototype.forEach.call(el.querySelectorAll(':scope > .deck-mol3d-live'), function (n) { n.remove(); });
    }
    function warn(err) { if (window.console) console.warn('Deck mol3d: the structure was not shown live, its picture stays.', err && err.message || err); }

    var leaving = 0;
    function sync() {
        var later = false;
        figures().forEach(function (el) {
            if (wanted(el)) {
                if (el.__deckMol3d && el.__deckMol3d.key !== keyOf(el)) clear(el);
                if (!el.__deckMol3d && el.__deckMol3dFailed !== keyOf(el)) draw(el);
            } else if (el.__deckMol3d) {
                // The slide that leaves keeps its structure while the transition shows it.
                if (editing() || mode(el) === 'still') clear(el); else later = true;
            }
        });
        clearTimeout(leaving);
        if (later) leaving = setTimeout(function () { figures().forEach(function (el) { if (el.__deckMol3d && !wanted(el)) clear(el); }); }, 1200);
    }
    window.DeckMol3d.sync = sync;
    window.DeckMol3d.clear = clear;
    var queued = 0;
    function queue() { if (!queued) queued = setTimeout(function () { queued = 0; sync(); }, 30); }

    new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) if (records[i].target.classList && records[i].target.classList.contains('slide')) { queue(); return; }
    }).observe(stage, { attributes: true, attributeFilter: ['class'], subtree: true });
    new MutationObserver(queue).observe(root, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('deck:slide', queue);
    if (still && still.addEventListener) still.addEventListener('change', function () { figures().forEach(clear); queue(); });
    if (document.readyState === 'complete') queue(); else window.addEventListener('load', queue);
})();
