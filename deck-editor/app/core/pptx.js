/* ============================================================
   pptx.js - Export > PowerPoint: the open deck measured slide by
   slide into the description pptx_export.py writes as a .pptx.

   Each slide is shown in turn (transitions off, so every reveal is
   at rest) and its elements are read as the browser lays them out:
     - text blocks (headings, paragraphs, lists, code) become text
       boxes with their paragraphs and runs: font, size, weight,
       italic, underline, colour, super/subscript, letter spacing,
       links, bullets and numbering, alignment and line spacing;
     - boxes with a fill, an outline or rounded corners become
       shapes (with their text when they hold it), CSS linear and
       radial gradients becoming native gradient fills;
     - pictures keep their crop (object-fit, the editor's crop box),
       rounded corners, flips and opacity;
     - tables become native tables, merged cells included;
     - the editor's charts become native charts with their table;
     - anything drawn (equations, structures, icons, SVG shapes,
       charts of a deck's script) becomes a picture: the SVG itself,
       with a PNG beside it for older PowerPoint;
     - speaker notes, hidden slides, slide backgrounds, the master
       layer on every slide.
   What PowerPoint cannot hold (videos, embedded pages, CSS
   ::before decorations, blend modes) is listed in the notes the
   export returns.
   ============================================================ */
import { readChart, chartKind, seriesColour, isChart } from './chart.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SKIP = 'script, style, template, noscript, aside.notes, .notes, .deck-controls, .deck-overview, .deck-laser, .deck-draw, .deck-draw-bar, [data-placeholder]';
const INLINE = new Set(['inline', 'contents']);
const LEAF_MEDIA = 'img, svg, video, canvas, iframe, object, embed, picture, table, [data-chart], [data-math], [data-chem], [data-fig]';
const GENERIC_FONTS = { 'sans-serif': 'Arial', serif: 'Georgia', monospace: 'Consolas', 'system-ui': 'Segoe UI', cursive: 'Comic Sans MS', fantasy: 'Impact' };
const BULLETS = { disc: '•', circle: '◦', square: '▪', '-': '–' };
const NUMBERING = { decimal: 'arabicPeriod', 'decimal-leading-zero': 'arabicPeriod', 'lower-alpha': 'alphaLcPeriod', 'lower-latin': 'alphaLcPeriod', 'upper-alpha': 'alphaUcPeriod', 'upper-latin': 'alphaUcPeriod', 'lower-roman': 'romanLcPeriod', 'upper-roman': 'romanUcPeriod' };

export class PptxCollector {
    constructor(app) {
        this.app = app;
        this.deck = app.deck;
        this.notes = [];
    }

    note(text) { if (!this.notes.includes(text)) this.notes.push(text); }

    /* The whole deck as the export's description. `progress(i, n)` is told each slide. */
    async collect(progress = () => {}) {
        const deck = this.deck, doc = deck.doc, win = deck.win;
        this.doc = doc; this.win = win;
        const slides = deck.slides, start = deck.current;
        const out = { w: deck.stageW, h: deck.stageH, title: (doc.title || '').trim() || 'Presentation', theme: this.theme(), slides: [] };
        deck.setTransitions(false);
        try {
            for (let i = 0; i < slides.length; i++) {
                progress(i, slides.length);
                deck.goTo(i);
                await this.settle(slides[i]);
                out.slides.push(await this.slide(slides[i], i));
            }
        } finally {
            deck.goTo(start);
            if (slides[start]) await this.settle(slides[start]);      // back where the user was before the caller restores the selection
            await new Promise(r => setTimeout(r, 60));
            deck.setTransitions(true);
        }
        return out;
    }

    async settle(slide) {
        const win = this.win;
        for (let t = 0; t < 40 && !(slide.classList.contains('active') && slide.classList.contains('visible')); t++) await new Promise(r => setTimeout(r, 15));
        await new Promise(r => win.requestAnimationFrame(() => win.requestAnimationFrame(r)));
    }

    theme() {
        const vars = this.deck.themeColours();
        const pick = (re) => (vars.find(c => re.test(c.name)) || {}).value;
        const accents = vars.filter(c => /accent|primary|brand/i.test(c.name)).map(c => c.value);
        const colours = [pick(/^ink$|^text$|^fg$/i) || '#1c1c1f', pick(/^paper$|^bg$|^background$/i) || '#ffffff', pick(/ink-2|text-2|muted/i) || '#45464d', pick(/paper-2|bg-2|surface|panel/i) || '#f4f4f5', ...accents]
            .map(c => this.hex(c).hex);
        const fonts = this.deck.themeFonts().map(f => this.fontName(f.value));
        const display = this.deck.themeFonts().find(f => /display|head/i.test(f.name));
        return { colours, fonts: [display ? this.fontName(display.value) : (fonts[0] || 'Calibri'), fonts[0] || 'Calibri'] };
    }

    async slide(slide, index) {
        const items = [];
        const kids = Array.from(slide.children).map((el, i) => ({ el, i, z: parseInt(this.css(el).zIndex, 10) || 0 }));
        kids.sort((a, b) => a.z - b.z || a.i - b.i);
        for (const k of kids) await this.walk(k.el, items);
        for (const m of this.deck.masterElements) if (!slide.hasAttribute('data-no-master')) await this.walk(m, items);
        return { hidden: slide.hasAttribute('data-skip'), notes: notesOf(slide), bg: this.background(slide), items };
    }

    background(slide) {
        for (const el of [slide, this.deck.stage, this.doc.body]) {
            const cs = this.css(el);
            const fill = this.fillOf(el, cs, true);
            if (fill && (fill.color || fill.grad || fill.image)) {
                if (fill.image) return { image: fill.image, color: fill.color };
                if (fill.grad) return { grad: fill.grad, color: fill.grad.stops[0] && fill.grad.stops[0].color };
                return { color: fill.color, alpha: fill.alpha };
            }
        }
        return { color: '#ffffff' };
    }

    /* ------------------------------------------------------------
       The walk: one element, and what it becomes.
       ------------------------------------------------------------ */
    async walk(el, out) {
        if (el.nodeType !== 1 || el.matches(SKIP)) return;
        const cs = this.css(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
        if (el.hasAttribute('data-hidden')) return;
        const tag = el.tagName.toLowerCase();
        const box = this.box(el, cs);
        if (isChart(el)) { out.push(this.chart(el, box, cs)); return; }
        if (el.matches('[data-math], [data-chem], [data-fig]') || tag === 'svg') { const s = await this.svgItem(el, box); if (s) { const a = this.opacity(el); if (a < 0.999) s.alpha = a; out.push(s); } return; }
        if (el.matches('[data-crop]')) { const img = el.querySelector('img'); if (img) { const p = await this.picture(img, box, el); if (p) out.push(p); } return; }
        if (tag === 'img') { const p = await this.picture(el, box); if (p) out.push(p); return; }
        if (tag === 'video') { if (el.poster) { const p = await this.picture(el, box, null, el.poster); if (p) out.push(p); } this.note('videos are not carried into PowerPoint (a poster picture stands in where there is one)'); return; }
        if (tag === 'iframe' || tag === 'object' || tag === 'embed') { this.note('embedded web pages are left out of the PowerPoint file'); return; }
        if (tag === 'canvas') { try { out.push({ kind: 'pic', ...box, src: { data: el.toDataURL('image/png') } }); } catch (e) { this.note('a canvas drawing could not be copied'); } return; }
        if (tag === 'table') { out.push(this.table(el, box)); return; }
        if (box.w < 0.5 && box.h < 0.5 && !el.children.length) return;
        const alpha = this.opacity(el);
        const fill = fade(this.fillOf(el, cs), alpha), radius = this.radius(el, cs, box);
        const edges = this.borders(cs, alpha);
        const line = edges.all;
        if (fill && fill.image) {
            if (fill.color) out.push({ kind: 'shape', ...box, geom: radius.geom, radius: radius.r, radius2: radius.r2, fill: { color: fill.color, alpha: fill.alpha } });
            out.push({ kind: 'pic', ...box, src: fill.image, radius: radius.r || 0, alpha: alpha < 1 ? alpha : undefined, name: this.name(el) });
        }
        const before = this.pseudoBox(el, cs, box, '::before', alpha), after = this.pseudoBox(el, cs, box, '::after', alpha);
        this.alpha = alpha;
        const text = this.textBlock(el, cs);
        this.alpha = 1;
        const solid = fill && !fill.image && (fill.color || fill.grad) ? fill : null;
        const shadow = this.shadow(cs, alpha);
        if (text) {
            const inset = this.insets(cs);
            if (before.push) inset[1] += before.push;
            const item = { kind: 'shape', ...box, name: this.name(el), geom: radius.geom, radius: radius.r, radius2: radius.r2, fill: solid, line, shadow,
                paras: text.paras, inset, anchor: this.anchor(cs), wrap: text.wrap };
            // PowerPoint takes tight (or loose) line spacing from above the first line; CSS shares it
            // above and below each line. Move the text by the difference so the first line sits where it did.
            const p0 = text.paras[0], r0 = p0.runs.find(r => !r.br);
            if (p0.lineMult && r0 && item.anchor === 't') {
                const delta = (1.2 - p0.lineMult) * r0.size / 2;
                if (!solid && !line) item.y += delta; else inset[1] = Math.max(0, inset[1] + delta);
            }
            out.push(item);
            out.push(...this.sideBars(box, edges), ...before.items, ...after.items);
            return;
        }
        if (solid || line) {
            // A blurred glow (filter: blur) as PowerPoint's soft edges.
            const blur = /blur\(([\d.]+)px\)/.exec(cs.filter || '');
            out.push({ kind: 'shape', ...box, name: this.name(el), geom: radius.geom, radius: radius.r, radius2: radius.r2, fill: solid, line, shadow, soft: blur ? parseFloat(blur[1]) * 2 : undefined });
        }
        out.push(...this.sideBars(box, edges), ...before.items);
        for (const node of el.childNodes) {
            if (node.nodeType === 1) await this.walk(node, out);
            else if (node.nodeType === 3 && /\S/.test(node.textContent)) { const t = this.looseText(node, el, cs, alpha); if (t) out.push(t); }
        }
        out.push(...after.items);
    }

    /* Opacity of the element and every ancestor up to the slide, multiplied. */
    opacity(el) {
        let a = 1;
        for (let n = el; n && n.nodeType === 1 && !n.classList.contains('deck-stage'); n = n.parentElement) a *= parseFloat(this.css(n).opacity);
        return isNaN(a) ? 1 : a;
    }

    /* Text sitting directly in an element that is not a text block itself (a legend's words
       beside its colour chips): a text box of its own where the browser put it. */
    looseText(node, el, cs, alpha) {
        const range = this.doc.createRange();
        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects()).filter(r => r.width > 0.5);
        if (!rects.length) return null;
        const r = range.getBoundingClientRect(), s = this.deck.stage.getBoundingClientRect(), k = this.deck.scale;
        this.alpha = alpha;
        const runs = this.collapse([this.run(el, node.textContent.replace(/[\t\n\r ]+/g, ' '))]);
        this.alpha = 1;
        if (!runs.length) return null;
        const lines = new Set(rects.map(q => Math.round(q.top / 4))).size;
        const pad = 2;
        return { kind: 'shape', x: (r.left - s.left) / k - pad, y: (r.top - s.top) / k, w: r.width / k + 2 * pad, h: r.height / k, rot: 0,
            paras: [this.makePara(cs, runs)], inset: [pad, 0, pad, 0], anchor: 't', wrap: lines > 1 };
    }

    /* ------------------------------------------------------------
       Geometry: the element's own box (before rotation) and its
       rotation, in stage px.
       ------------------------------------------------------------ */
    box(el, cs) {
        const r = this.deck.stageRect(el);
        let rot = 0, sx = 1, sy = 1;
        if (cs.rotate && cs.rotate !== 'none') rot += parseFloat(cs.rotate) || 0;
        if (cs.scale && cs.scale !== 'none') { const p = cs.scale.split(/\s+/).map(parseFloat); sx *= p[0]; sy *= (p.length > 1 ? p[1] : p[0]); }
        if (cs.transform && cs.transform !== 'none') {
            const m = new this.win.DOMMatrix(cs.transform);
            rot += Math.atan2(m.b, m.a) * 180 / Math.PI;
            sx *= Math.hypot(m.a, m.b); sy *= Math.hypot(m.c, m.d) * Math.sign(m.a * m.d - m.b * m.c || 1);
        }
        rot = ((rot % 360) + 360) % 360;
        const ow = el.offsetWidth, oh = el.offsetHeight;
        if (Math.abs(rot) < 0.05 || ow == null) return { x: r.x, y: r.y, w: r.w, h: r.h, rot: 0 };
        const w = ow * Math.abs(sx), h = oh * Math.abs(sy), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        return { x: cx - w / 2, y: cy - h / 2, w, h, rot };
    }

    insets(cs) {
        const n = (p) => (parseFloat(cs['padding' + p]) || 0) + (parseFloat(cs['border' + p + 'Width']) || 0);
        return [n('Left'), n('Top'), n('Right'), n('Bottom')];
    }
    anchor(cs) {
        const flex = /flex|grid/.test(cs.display);
        const col = /column/.test(cs.flexDirection);
        const v = flex ? (col ? cs.justifyContent : cs.alignItems) : '';
        return /center/.test(v) ? 'ctr' : /end/.test(v) ? 'b' : 't';
    }
    /* The corner rounding as PowerPoint can draw it: all corners alike (roundRect, or an ellipse),
       opposite corners in pairs (round2Diag, a leaf), top and bottom in pairs (round2Same, a tab). */
    radius(el, cs, size = null) {
        const w = (size && size.w) || el.offsetWidth || 1, h = (size && size.h) || el.offsetHeight || 1;
        const px = (v) => /%/.test(v) ? parseFloat(v) / 100 * Math.min(w, h) : parseFloat(v) || 0;
        const [tl, tr, br, bl] = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(px);
        if (!tl && !tr && !br && !bl) return { geom: 'rect', r: 0 };
        const same = (a, b) => Math.abs(a - b) < 0.5;
        if (same(tl, tr) && same(tr, br) && same(br, bl)) {
            if (tl >= Math.min(w, h) / 2 - 0.5 && Math.abs(w - h) < 1) return { geom: 'ellipse', r: 0 };
            return { geom: 'roundRect', r: tl };
        }
        if (same(tl, br) && same(tr, bl)) return { geom: 'round2Diag', r: tl, r2: tr };
        if (same(tl, tr) && same(br, bl)) return { geom: 'round2Same', r: tl, r2: bl };
        return { geom: 'roundRect', r: Math.max(tl, tr, br, bl) / 2 };
    }
    name(el) { return el.getAttribute('data-name') || ''; }

    /* ------------------------------------------------------------
       Colours and fills.
       ------------------------------------------------------------ */
    css(el) { return this.win.getComputedStyle(el); }
    hex(colour) {
        const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(colour || '');
        if (!m) {
            const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((colour || '').trim());
            if (h) { const s = h[1].length === 3 ? h[1].replace(/./g, c => c + c) : h[1]; return { hex: '#' + s.toLowerCase(), alpha: 1 }; }
            return { hex: null, alpha: 0 };
        }
        const a = m[4] == null ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        return { hex: '#' + [m[1], m[2], m[3]].map(v => Math.round(+v).toString(16).padStart(2, '0')).join(''), alpha: a };
    }
    /* A colour in any CSS form (var(), names) as hex, resolved where `el` is. */
    resolveColour(el, value) {
        const p = el.ownerDocument.createElement('i');
        p.style.color = value; p.style.display = 'none';
        el.appendChild(p);
        const c = this.css(p).color;
        p.remove();
        return this.hex(c);
    }
    fillOf(el, cs, background = false) {
        const bg = this.hex(cs.backgroundColor);
        const fill = bg.hex && bg.alpha > 0.01 ? { color: bg.hex, alpha: bg.alpha } : null;
        const img = cs.backgroundImage;
        if (img && img !== 'none') {
            const url = /url\(["']?([^"')]+)["']?\)/.exec(img);
            const grad = /^(repeating-)?(linear|radial)-gradient/.test(img) ? this.gradient(img, { w: el.offsetWidth || 1, h: el.offsetHeight || 1 }) : null;
            if (grad) return { grad, alpha: 1 };
            if (url) {
                const ref = this.pictureRef(url[1]);
                if (ref) return { ...(fill || {}), image: ref, crop: background ? null : null };
                this.note('a background picture could not be read');
            }
            if (/gradient/.test(img) && !grad) this.note('a background gradient was simplified to its colour');
        }
        return fill;
    }
    /* linear-gradient(...) / radial-gradient(...) -> {angle, radial, stops: [{pos, color, alpha}]}. */
    gradient(css, size = null) {
        const top = splitTop(css)[0];
        const m = /^(?:repeating-)?(linear|radial)-gradient\((.*)\)$/s.exec(top.trim());
        if (!m) return null;
        const parts = splitTop(m[2]);
        let angle = 180, radial = m[1] === 'radial', shape = '';
        if (!radial) {
            const a = parts[0].trim();
            if (/^-?[\d.]+(deg|turn|rad|grad)$/.test(a)) { angle = cssAngle(a); parts.shift(); }
            else if (/^to /.test(a)) { angle = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135, 'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315 }[a] ?? 180; parts.shift(); }
        } else if (!/^(rgb|#|hsl|[a-z]+\s*$)/i.test(parts[0].trim()) || /circle|ellipse|at |closest|farthest/.test(parts[0])) shape = parts.shift();
        const stops = [];
        parts.forEach((p, i) => {
            const cm = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)\s*([\d.]+%)?/i.exec(p.trim());
            if (!cm) return;
            const c = this.hex(cm[1]);
            if (!c.hex) return;
            stops.push({ pos: cm[2] ? parseFloat(cm[2]) / 100 : null, color: c.hex, alpha: c.alpha, i });
        });
        if (stops.length < 2) return null;
        stops.forEach((s, i) => { if (s.pos == null) s.pos = i / (stops.length - 1); });
        // PowerPoint's radial fill reaches the box's corners; CSS ends where its size keyword says.
        if (radial && size) {
            const hyp = Math.hypot(size.w, size.h) || 1;
            const f = /closest-side/.test(shape) ? Math.min(size.w, size.h) / hyp : /farthest-side/.test(shape) ? Math.max(size.w, size.h) / hyp : 1;
            if (f < 0.999) { stops.forEach(s => { s.pos *= f; }); const last = stops[stops.length - 1]; stops.push({ ...last, pos: 1 }); }
        }
        if (splitTop(css).length > 1) this.note('layered CSS backgrounds were reduced to their top layer');
        return { angle, radial, stops: stops.map(({ pos, color, alpha }) => ({ pos, color, alpha })) };
    }
    /* The outline: one LINE when all four sides match (PowerPoint outlines all round), else
       the visible sides one by one, drawn as thin bars (sideBars). */
    borders(cs, alpha = 1) {
        const sides = {};
        for (const s of ['Top', 'Right', 'Bottom', 'Left']) {
            const w = parseFloat(cs['border' + s + 'Width']) || 0, st = cs['border' + s + 'Style'], c = this.hex(cs['border' + s + 'Color']);
            if (w > 0 && st !== 'none' && st !== 'hidden' && c.hex && c.alpha > 0.01) sides[s] = { color: c.hex, alpha: c.alpha * alpha, width: w, dash: st === 'dashed' ? 'dash' : st === 'dotted' ? 'dot' : 'solid' };
        }
        const k = Object.keys(sides);
        if (k.length === 4 && k.every(s => sides[s].width === sides.Top.width && sides[s].color === sides.Top.color && sides[s].dash === sides.Top.dash)) return { all: sides.Top, sides: {} };
        return { all: null, sides };
    }
    sideBars(box, edges) {
        if (box.rot) return [];
        const out = [];
        for (const [s, ln] of Object.entries(edges.sides || {})) {
            const w = ln.width, b = { Top: [box.x, box.y, box.w, w], Bottom: [box.x, box.y + box.h - w, box.w, w], Left: [box.x, box.y, w, box.h], Right: [box.x + box.w - w, box.y, w, box.h] }[s];
            out.push({ kind: 'shape', x: b[0], y: b[1], w: b[2], h: b[3], rot: 0, name: 'Rule', geom: 'rect', fill: { color: ln.color, alpha: ln.alpha } });
        }
        return out;
    }
    /* A box the deck draws with ::before / ::after (an accent bar, a frame, a dot): a shape where
       the browser draws it. A block one before the text pushes the text down by `push`. */
    pseudoBox(el, cs, box, which, alpha) {
        const none = { items: [], push: 0 };
        const p = this.win.getComputedStyle(el, which);
        if (!p || p.content === 'none' || p.content === 'normal' || p.display === 'none') return none;
        const fill = fade(this.fillOf(el, p), alpha), edges = this.borders(p, alpha);
        const text = /^["'](.*)["']$/.exec(p.content || '');
        const hasText = text && text[1].trim() && !/counter\(/.test(p.content);
        if (!fill && !edges.all && !Object.keys(edges.sides).length && !hasText) return none;
        const w = parseFloat(p.width), h = parseFloat(p.height);
        const ins = this.insets(cs), bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
        let x, y, push = 0;
        if (/absolute|fixed/.test(p.position)) {
            if (isNaN(w) || isNaN(h)) { this.note('a ::before / ::after decoration without a fixed size was left out'); return none; }
            const L = parseFloat(p.left), R = parseFloat(p.right), T = parseFloat(p.top), B = parseFloat(p.bottom);
            x = !isNaN(L) ? box.x + bl + L : !isNaN(R) ? box.x + box.w - (parseFloat(cs.borderRightWidth) || 0) - R - w : box.x + ins[0];
            y = !isNaN(T) ? box.y + bt + T : !isNaN(B) ? box.y + box.h - (parseFloat(cs.borderBottomWidth) || 0) - B - h : box.y + ins[1];
        } else if (/block|flex|grid|table/.test(p.display) && !/inline/.test(p.display) && which === '::before') {
            if (isNaN(h)) return none;
            const mt = parseFloat(p.marginTop) || 0, mb = parseFloat(p.marginBottom) || 0;
            x = box.x + ins[0] + (parseFloat(p.marginLeft) || 0); y = box.y + ins[1] + mt;
            push = mt + h + mb;
            if (isNaN(w)) return { items: [], push };
        } else {
            if (!el.matches('li')) this.note('decorations the deck draws inline with CSS (::before, ::after) are not in the PowerPoint file');
            return none;
        }
        if (box.rot) return none;
        const r = this.radius(el, p, { w, h });
        const items = [];
        if (fill || edges.all) items.push({ kind: 'shape', x, y, w, h, rot: 0, name: 'Decoration', geom: r.geom, radius: r.r, radius2: r.r2, fill: fill && !fill.image ? fill : null, line: edges.all });
        if (fill && fill.image) items.push({ kind: 'pic', x, y, w, h, rot: 0, src: fill.image });
        items.push(...this.sideBars({ x, y, w, h, rot: 0 }, edges));
        if (hasText) {
            this.alpha = alpha;
            const run = this.runOf(p, text[1], el);
            this.alpha = 1;
            items.push({ kind: 'shape', x, y, w, h, rot: 0, paras: [this.makePara(p, [run])], inset: [0, 0, 0, 0], anchor: 'ctr', wrap: false });
        }
        return { items, push };
    }

    /* ------------------------------------------------------------
       Text.
       ------------------------------------------------------------ */
    fontName(family) {
        const first = (family || '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).find(Boolean) || 'Arial';
        return GENERIC_FONTS[first] || first;
    }

    /* The element as one text box, or null when it is not text (or not only text): inline
       content and blocks stacked one under the other, a paragraph each. */
    textBlock(el, cs) {
        if (!hasText(el)) return null;
        const tag = el.tagName.toLowerCase();
        if (tag === 'ul' || tag === 'ol') {
            if (!this.flowable(el)) return null;
            const paras = [];
            this.listParas(el, 0, paras, el);
            return paras.length ? { paras, wrap: true } : null;
        }
        if (!this.flowable(el)) return null;
        const paras = [];
        this.flow(el, cs, paras);
        if (!paras.length) return null;
        paras[0].before = 0;
        paras[paras.length - 1].after = 0;
        return { paras, wrap: !this.fitsOnItsLines(el, cs, paras) };
    }

    inlineish(display) { return INLINE.has(display) || /^inline-/.test(display); }

    /* Can this element's whole content go in one text box? Nothing drawn inside it (pictures,
       boxes with a fill or an outline), nothing placed on its own, blocks stacked vertically. */
    flowable(el) {
        if (!this.stacked(el)) return false;
        for (const d of el.querySelectorAll('*')) {
            if (d.matches(SKIP) || d.tagName === 'BR') continue;
            if (d.matches(LEAF_MEDIA)) return false;
            const dcs = this.css(d);
            if (dcs.display === 'none') continue;
            if (/absolute|fixed/.test(dcs.position)) return false;
            const boxed = (() => { const f = this.fillOf(d, dcs), e = this.borders(dcs); return !!(f && (f.color || f.grad || f.image)) || !!e.all || Object.keys(e.sides).length > 0; })();
            if (this.inlineish(dcs.display)) {
                if (boxed && !hasText(d)) return false;             // a colour chip or a dot: a shape of its own
                continue;
            }
            if (boxed || !this.stacked(d)) return false;
        }
        return true;
    }
    /* Block children one under the other (not side by side, as a row of columns is). */
    stacked(el) {
        let bottom = -Infinity;
        for (const k of el.children) {
            const kcs = this.css(k);
            if (kcs.display === 'none' || k.matches(SKIP) || this.inlineish(kcs.display)) continue;
            const r = k.getBoundingClientRect();
            if (r.top < bottom - 2) return false;
            bottom = r.bottom;
        }
        return true;
    }

    /* Paragraphs of a block: its inline content, broken where a block child starts; block
       children (and lists) in turn, their margins as spacing. */
    flow(block, cs, out, skipTags = null) {
        let runs = [];
        const flush = () => { const r = this.collapse(runs, /^pre/.test(cs.whiteSpace)); if (r.length) out.push(this.makePara(cs, r)); runs = []; };
        for (const n of block.childNodes) {
            if (n.nodeType === 3) { runs.push(...this.textRuns(n, cs)); continue; }
            if (n.nodeType !== 1 || n.matches(SKIP) || (skipTags && skipTags.includes(n.tagName))) continue;
            if (n.tagName === 'BR') { runs.push({ br: true, size: parseFloat(cs.fontSize) || 32 }); continue; }
            const ncs = this.css(n);
            if (ncs.display === 'none') continue;
            if (this.inlineish(ncs.display)) { runs.push(...this.spaced(n, ncs, this.inlineRuns(n))); continue; }
            flush();
            const start = out.length;
            if (n.tagName === 'UL' || n.tagName === 'OL') this.listParas(n, 0, out, n);
            else this.flow(n, ncs, out);
            if (out.length > start) {
                out[start].before = Math.max(out[start].before || 0, parseFloat(ncs.marginTop) || 0);
                out[out.length - 1].after = Math.max(out[out.length - 1].after || 0, parseFloat(ncs.marginBottom) || 0);
            }
        }
        flush();
    }
    textRuns(node, cs) {
        const pe = node.parentElement, pcs = this.css(pe);
        const pre = /^pre/.test(pcs.whiteSpace);
        let t = node.textContent;
        if (!pre) return t ? [this.run(pe, t.replace(/[\t\n\r ]+/g, ' '))] : [];
        const out = [];
        t.split('\n').forEach((line, i) => { if (i) out.push({ br: true, size: parseFloat(pcs.fontSize) || 32 }); if (line) out.push(this.run(pe, line)); });
        return out;
    }
    /* An inline element's margins as spaces ("1" then "Start here" with a margin between). */
    spaced(el, cs, runs) {
        if (!runs.length) return runs;
        const em = (parseFloat(cs.fontSize) || 32) * 0.2;
        const out = runs.slice();
        if ((parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.paddingLeft) || 0) >= em) out.unshift(this.run(el, ' '));
        if ((parseFloat(cs.marginRight) || 0) + (parseFloat(cs.paddingRight) || 0) >= em) out.push(this.run(el, ' '));
        return out;
    }
    inlineRuns(el) {
        const out = [];
        for (const n of el.childNodes) {
            if (n.nodeType === 3) out.push(...this.textRuns(n));
            else if (n.nodeType === 1 && !n.matches(SKIP)) {
                if (n.tagName === 'BR') out.push({ br: true, size: parseFloat(this.css(n).fontSize) || 32 });
                else { const ncs = this.css(n); if (ncs.display !== 'none') out.push(...this.spaced(n, ncs, this.inlineRuns(n))); }
            }
        }
        return out;
    }
    /* The spaces HTML collapses: at the ends of a paragraph and doubled across runs. */
    collapse(runs, pre = false) {
        if (!pre) {
            let prevSpace = true;
            for (const r of runs) {
                if (r.br) { prevSpace = true; continue; }
                if (prevSpace) r.t = r.t.replace(/^ +/, '');
                if (r.t) prevSpace = /\s$/.test(r.t);
            }
            for (let i = runs.length - 1; i >= 0; i--) { if (runs[i].br) continue; runs[i].t = runs[i].t.replace(/ +$/, ''); if (runs[i].t) break; }
        }
        const kept = runs.filter(r => r.br || r.t);
        while (kept.length && kept[kept.length - 1].br) kept.pop();
        while (kept.length && kept[0].br) kept.shift();
        return kept;
    }
    makePara(cs, runs) {
        const size = parseFloat(cs.fontSize) || 32, lh = parseFloat(cs.lineHeight);
        return { align: { left: 'l', start: 'l', center: 'ctr', right: 'r', end: 'r', justify: 'just' }[cs.textAlign] || 'l',
            lineMult: isNaN(lh) ? null : Math.round(lh / size * 100) / 100, before: 0, after: 0, runs };
    }
    /* True when the browser shows every paragraph (and every line break) on a single line: the
       text box then does not wrap, so PowerPoint's slightly different letter widths cannot push
       a word onto a line of its own. */
    fitsOnItsLines(el, cs, paras) {
        const range = el.ownerDocument.createRange();
        range.selectNodeContents(el);
        const tops = new Set(Array.from(range.getClientRects()).filter(r => r.width > 0.5).map(r => Math.round(r.top / 3)));
        const lines = paras.reduce((n, p) => n + 1 + p.runs.filter(r => r.br).length, 0);
        return tops.size <= lines;
    }

    listParas(list, level, out, root) {
        const lcs = this.css(list);
        const ordered = list.tagName === 'OL';
        let n = parseInt(list.getAttribute('start') || '1', 10) || 1;
        const rootLeft = root.getBoundingClientRect().left, k = this.deck.scale;
        for (const li of list.children) {
            if (li.tagName !== 'LI') continue;
            const cs = this.css(li);
            if (cs.display === 'none') continue;
            const type = cs.listStyleType || lcs.listStyleType;
            const size = parseFloat(cs.fontSize) || 32;
            const left = (li.getBoundingClientRect().left - rootLeft) / k;
            let bullet = type === 'none' ? null : ordered || NUMBERING[type] ? { auto: NUMBERING[type] || 'arabicPeriod', start: n } : { char: BULLETS[type] || '•' };
            const marker = this.win.getComputedStyle(li, '::marker');
            if (bullet && marker && marker.color) { const c = this.hex(marker.color); if (c.hex) bullet.color = c.hex; }
            if (!bullet) bullet = this.drawnBullet(li);
            const hang = Math.min(Math.max(left, size * 0.9), size * 1.4);
            // The item's own text (nested lists apart).
            const ps = [];
            this.flow(li, cs, ps, ['UL', 'OL']);
            ps.forEach((p, i) => {
                p.level = level;
                p.marL = Math.max(left, hang);
                p.indent = i === 0 && bullet ? -hang : 0;
                p.bullet = i === 0 ? bullet : null;
                p.after = Math.max(parseFloat(cs.marginBottom) || 0, 0);
            });
            if (ps.length) out.push(...ps);
            for (const sub of li.children) if (sub.tagName === 'UL' || sub.tagName === 'OL') this.listParas(sub, level + 1, out, root);
            n++;
        }
    }

    /* A bullet the deck draws itself (list-style none, a ::before dot or dash) as a bullet character. */
    drawnBullet(li) {
        const p = this.win.getComputedStyle(li, '::before');
        if (!p || p.content === 'none' || p.content === 'normal' || p.display === 'none') return null;
        const text = /^["'](.*)["']$/.exec(p.content || '');
        if (text && text[1].trim() && !/counter\(/.test(p.content)) { const c = this.hex(p.color); return { char: text[1].trim()[0], color: c.hex || undefined }; }
        const bg = this.hex(p.backgroundColor);
        if (bg.hex && bg.alpha > 0.01) {
            const w = parseFloat(p.width) || 0, h = parseFloat(p.height) || 0;
            const size = parseFloat(this.css(li).fontSize) || 32;
            return { char: w > h * 2 ? '\u2013' : parseFloat(p.borderTopLeftRadius) ? '\u2022' : '\u25AA', color: bg.hex, scale: Math.max(1, Math.min(2.5, Math.max(w, h) / (size * 0.3))) };
        }
        // An outlined box or ring (a checkbox, a circle): the hollow square or circle.
        const edge = this.borders(p);
        const ln = edge.all || Object.values(edge.sides)[0];
        if (ln) {
            const w = parseFloat(p.width) || 0, size = parseFloat(this.css(li).fontSize) || 32;
            return { char: parseFloat(p.borderTopLeftRadius) >= w / 2 - 0.5 && w ? '○' : '□', color: ln.color, scale: Math.max(1, Math.min(2.5, w / (size * 0.55))) };
        }
        if (/counter\(/.test(p.content)) return { auto: 'arabicPeriod', color: this.hex(p.color).hex || undefined };
        return null;
    }

    /* The first outer box-shadow as {color, alpha, x, y, blur} (stage px). */
    shadow(cs, alpha = 1) {
        const v = cs.boxShadow;
        if (!v || v === 'none') return null;
        const first = splitTop(v).find(s => !/\binset\b/.test(s));
        if (!first) return null;
        const c = this.hex((/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i.exec(first) || [])[0]);
        const n = (first.replace(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i, '').match(/-?[\d.]+px/g) || []).map(parseFloat);
        if (!c.hex || c.alpha < 0.02 || n.length < 2) return null;
        return { color: c.hex, alpha: c.alpha * alpha, x: n[0], y: n[1], blur: n[2] || 0 };
    }

    run(el, text) { return this.runOf(this.css(el), text, el); }
    runOf(cs, text, el) {
        const c = this.hex(cs.webkitTextFillColor && !/currentcolor/i.test(cs.webkitTextFillColor) && this.hex(cs.webkitTextFillColor).alpha > 0 ? cs.webkitTextFillColor : cs.color);
        const deco = el ? decorations(el, this.win) : { u: false, s: false };
        const run = { t: text, font: this.fontName(cs.fontFamily), size: Math.round((parseFloat(cs.fontSize) || 32) * 10) / 10, b: (parseInt(cs.fontWeight, 10) || 400) >= 600, i: /italic|oblique/.test(cs.fontStyle),
            u: deco.u, s: deco.s, color: c.hex || '#000000', alpha: c.alpha * (this.alpha ?? 1) };
        const hl = el && el.nodeType === 1 && this.inlineish(cs.display) ? this.hex(cs.backgroundColor) : null;
        if (hl && hl.hex && hl.alpha > 0.2) run.highlight = hl.hex;
        if (c.alpha === 0 && /text/.test(cs.backgroundClip || cs.webkitBackgroundClip || '')) {
            const g = this.gradient(cs.backgroundImage || '');
            if (g) { run.color = g.stops[0].color; run.alpha = 1; this.note('gradient text became its first colour'); }
        }
        const va = cs.verticalAlign;
        if (va === 'super' || (el && el.closest('sup'))) run.base = 30000;
        else if (va === 'sub' || (el && el.closest('sub'))) run.base = -25000;
        const ls = parseFloat(cs.letterSpacing);
        if (ls) run.spc = ls;
        if (cs.textTransform === 'uppercase') run.cap = 'all';
        else if (cs.textTransform === 'lowercase') run.t = run.t.toLowerCase();
        else if (cs.textTransform === 'capitalize') run.t = run.t.replace(/\b\w/g, m => m.toUpperCase());
        const link = el && el.closest('a[href], [data-href]');
        const href = link && (link.getAttribute('data-href') || link.getAttribute('href'));
        if (href && /^(https?:|mailto:)/i.test(href)) run.href = href;
        return run;
    }

    /* ------------------------------------------------------------
       Pictures.
       ------------------------------------------------------------ */
    /* A file the server can read (a workspace path), or the picture's bytes when it cannot. */
    pictureRef(url) {
        try {
            const u = new URL(url, this.doc.baseURI);
            if (u.protocol === 'data:') return { data: u.href };
            if (u.origin === location.origin && u.pathname.startsWith('/deck/')) return { path: decodeURIComponent(u.pathname.slice('/deck/'.length)) };
        } catch (e) { /* below */ }
        return null;
    }

    async picture(img, box, cropBox = null, srcOverride = null) {
        const src = srcOverride || img.currentSrc || img.src || '';
        if (!src) return null;
        const cs = this.css(img);
        const out = { kind: 'pic', ...box, alt: img.getAttribute('alt') || '', name: this.name(img) };
        // Crop: the editor's crop box shows part of the picture; object-fit cover cuts what overflows.
        const nat = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
        const k = this.deck.scale;
        if (cropBox) {
            const B = cropBox.getBoundingClientRect(), I = img.getBoundingClientRect();
            out.crop = [(B.left - I.left) / I.width, (B.top - I.top) / I.height, (I.right - B.right) / I.width, (I.bottom - B.bottom) / I.height].map(v => Math.max(0, v));
            out.radius = parseFloat(this.css(cropBox).borderTopLeftRadius) || 0;
        } else if (cs.objectFit === 'cover' || cs.objectFit === 'contain' || cs.objectFit === 'scale-down') {
            const bw = img.clientWidth || box.w, bh = img.clientHeight || box.h;
            const scale = cs.objectFit === 'cover' ? Math.max(bw / nat.w, bh / nat.h) : Math.min(bw / nat.w, bh / nat.h, cs.objectFit === 'scale-down' ? 1 : Infinity);
            const dw = nat.w * scale, dh = nat.h * scale;
            const [px, py] = (cs.objectPosition || '50% 50%').split(/\s+/).map(v => /%$/.test(v) ? parseFloat(v) / 100 : 0.5);
            if (cs.objectFit === 'cover') {
                const cx = Math.max(0, dw - bw) / dw, cy = Math.max(0, dh - bh) / dh;
                out.crop = [cx * px, cy * py, cx * (1 - px), cy * (1 - py)];
            } else {
                // contain: the picture is smaller than its box, placed by object-position.
                out.x += (box.w - dw) * px; out.y += (box.h - dh) * py; out.w = dw; out.h = dh;
            }
        }
        if (!cropBox) out.radius = parseFloat(cs.borderTopLeftRadius) || 0;
        const op = this.opacity(img);
        if (op < 0.999) out.alpha = op;
        if (cs.scale && cs.scale !== 'none') { const p = cs.scale.split(/\s+/).map(parseFloat); if (p[0] < 0) out.flipH = true; if ((p[1] ?? p[0]) < 0) out.flipV = true; }
        if (/grayscale\(\s*(1|100%)/.test(cs.filter)) this.note('grayscale pictures are in colour in PowerPoint (set Picture Color there)');
        // An SVG file stays vector; formats PowerPoint may not read (webp, avif) go as PNG.
        const ref = this.pictureRef(src);
        const ext = (/\.([a-z0-9]+)(?:[?#]|$)/i.exec(ref && ref.path || '') || [])[1];
        if (ref && ref.path && /^svg$/i.test(ext)) {
            try {
                const text = await fetch(src, { cache: 'no-store' }).then(r => r.ok ? r.text() : '');
                if (text) return { kind: 'svg', x: out.x, y: out.y, w: out.w, h: out.h, rot: out.rot, name: out.name, alt: out.alt, svg: text, png: await this.rasterImg(img, out.w, out.h) };
            } catch (e) { /* as a picture below */ }
        }
        if (!ref || (ref.path && !/^(png|jpe?g|gif|bmp)$/i.test(ext || '')) || (ref.data && !/^data:image\/(png|jpe?g|gif|bmp)/i.test(ref.data))) {
            const png = await this.rasterImg(img, nat.w, nat.h, true);
            if (!png) { this.note('a picture from the internet was left out (save it into the deck folder to export it)'); return null; }
            out.src = { data: png };
        } else out.src = ref;
        return out;
    }

    /* A PNG of a loaded picture, or null when the browser will not give its pixels (another site's picture). */
    async rasterImg(img, w, h, natural = false) {
        try {
            if (!img.complete) await img.decode();
            const c = document.createElement('canvas');
            const s = natural ? 1 : 2;
            c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            return c.toDataURL('image/png');
        } catch (e) { return null; }
    }

    /* ------------------------------------------------------------
       Drawings: any inline SVG (and the figures that hold one) as a
       standalone SVG with its colours and fonts written in, plus a PNG.
       ------------------------------------------------------------ */
    async svgItem(el, box) {
        const svg = el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg');
        if (!svg) {
            const canvas = el.querySelector('canvas');
            if (canvas) { try { return { kind: 'pic', ...box, src: { data: canvas.toDataURL('image/png') } }; } catch (e) { /* tainted */ } }
            if (el.matches('[data-math], [data-chem]')) this.note('an equation or structure without its drawing was left out (open it in the editor once to draw it)');
            else this.note('a chart drawn by the deck\'s own script was left out');
            return null;
        }
        const r = this.deck.stageRect(svg);
        const markup = this.standaloneSvg(svg, r.w, r.h);
        const png = await this.rasterSvg(markup, r.w, r.h);
        const label = svg.getAttribute('aria-label') || el.getAttribute('data-math') || el.getAttribute('data-chem') || '';
        const item = { kind: 'svg', ...box, svg: markup, png, name: this.name(el) || (el.hasAttribute('data-math') ? 'Equation' : el.hasAttribute('data-chem') ? 'Structure' : ''), alt: label };
        if (svg !== el) Object.assign(item, { x: r.x, y: r.y, w: r.w, h: r.h, rot: box.rot });
        return item;
    }

    standaloneSvg(svg, w, h) {
        const clone = svg.cloneNode(true);
        const live = [svg, ...svg.querySelectorAll('*')], copy = [clone, ...clone.querySelectorAll('*')];
        const props = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'stop-color', 'stop-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin'];
        live.forEach((n, i) => {
            const c = copy[i]; if (!c || !c.setAttribute) return;
            const cs = this.css(n);
            for (const p of props) {
                let v = cs.getPropertyValue(p);
                if (!v || v === 'normal' && p !== 'font-weight') continue;
                if (p === 'font-family') v = this.fontName(v) + ', Arial, sans-serif';
                if (p === 'fill' || p === 'stroke' || p === 'stop-color') { if (/^url\(/.test(v)) v = v.replace(/url\("?[^#]*(#[^")]+)"?\)/, 'url($1)'); }
                c.setAttribute(p, v);
            }
            c.removeAttribute('class');
            if (c.getAttribute('style')) c.setAttribute('style', c.getAttribute('style').replace(/var\([^)]*\)/g, ''));
        });
        if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${svg.clientWidth || w} ${svg.clientHeight || h}`);
        clone.setAttribute('width', Math.round(w * 100) / 100);
        clone.setAttribute('height', Math.round(h * 100) / 100);
        clone.setAttribute('xmlns', SVG_NS);
        clone.removeAttribute('style');
        clone.setAttribute('color', this.hex(this.css(svg).color).hex || '#000000');
        return new XMLSerializer().serializeToString(clone);
    }

    async rasterSvg(markup, w, h) {
        try {
            const img = new Image();
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
            await img.decode();
            const c = document.createElement('canvas');
            const s = Math.min(3, Math.max(1, 1600 / Math.max(w, h, 1)));
            c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            return c.toDataURL('image/png');
        } catch (e) { return null; }
    }

    /* ------------------------------------------------------------
       Tables and charts.
       ------------------------------------------------------------ */
    table(table, box) {
        const k = this.deck.scale;
        const rows = Array.from(table.rows).filter(r => this.css(r).display !== 'none');
        // The grid: column edges from every cell's left/right.
        const edges = new Set();
        for (const r of rows) for (const c of r.cells) { const b = c.getBoundingClientRect(); edges.add(Math.round(b.left / k)); edges.add(Math.round(b.right / k)); }
        const xs = Array.from(edges).sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > 1);
        const cols = xs.slice(1).map((v, i) => v - xs[i]);
        const colOf = (px) => { let best = 0; xs.forEach((v, i) => { if (Math.abs(v - px) < Math.abs(xs[best] - px)) best = i; }); return best; };
        const grid = rows.map(() => new Array(cols.length).fill(null));
        rows.forEach((r, ri) => {
            for (const c of r.cells) {
                const b = c.getBoundingClientRect();
                const c0 = Math.min(colOf(Math.round(b.left / k)), cols.length - 1), c1 = Math.max(c0 + 1, colOf(Math.round(b.right / k)));
                const span = c1 - c0, rowspan = Math.min(c.rowSpan || 1, rows.length - ri);
                const cs = this.css(c);
                const fill = this.fillOf(c, cs);
                const t = []; this.flow(c, cs, t);
                const side = (s) => { const w = parseFloat(cs['border' + s + 'Width']) || 0; const col = this.hex(cs['border' + s + 'Color']); return w && cs['border' + s + 'Style'] !== 'none' && col.hex ? { color: col.hex, alpha: col.alpha, width: w } : null; };
                grid[ri][c0] = { paras: t.length ? t : [{ runs: [] }], fill: fill && !fill.image && !fill.grad ? fill : null, span, rowspan, inset: this.insets(cs), anchor: { middle: 'ctr', bottom: 'b' }[cs.verticalAlign] || 't',
                    borders: { l: side('Left'), r: side('Right'), t: side('Top'), b: side('Bottom') } };
                for (let dr = 0; dr < rowspan; dr++) for (let dc = 0; dc < span; dc++) {
                    if (!dr && !dc) continue;
                    if (grid[ri + dr]) grid[ri + dr][c0 + dc] = { hmerge: dc > 0, vmerge: dr > 0, paras: [{ runs: [] }] };
                }
            }
        });
        const out = rows.map((r, ri) => ({ h: r.getBoundingClientRect().height / k, cells: grid[ri].map(c => c || { paras: [{ runs: [] }] }) }));
        return { kind: 'table', ...box, cols, rows: out, name: this.name(table) };
    }

    chart(el, box, cs) {
        const spec = readChart(el), kind = chartKind(el);
        const colour = (c) => this.resolveColour(el, c).hex;
        const series = spec.series.map((s, i) => ({ name: s.name, values: s.values, color: colour(seriesColour(spec, i)) }));
        const pie = kind === 'pie' || kind === 'doughnut';
        const palette = pie ? spec.labels.map((l, i) => colour(spec.palette[i % (spec.palette.length || 1)] || '#2f6fed')) : null;
        const text = { font: this.fontName(cs.fontFamily), size: parseFloat(cs.fontSize) || 24, color: this.hex(cs.color).hex };
        return { kind: 'chart', chart: kind, ...box, name: this.name(el) || (spec.title || 'Chart'), labels: spec.labels, series, palette, legend: spec.legend, values: spec.values, grid: spec.grid, stacked: spec.stacked, unit: spec.unit, title: spec.title, text };
    }
}

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
/* A fill with an opacity applied (an element's own or inherited opacity). */
function fade(fill, a) {
    if (!fill || a >= 0.999) return fill;
    const f = { ...fill };
    if (f.color) f.alpha = (f.alpha ?? 1) * a;
    if (f.grad) f.grad = { ...f.grad, stops: f.grad.stops.map(s => ({ ...s, alpha: (s.alpha ?? 1) * a })) };
    return f;
}
function hasText(el) { return /\S/.test(el.textContent || ''); }

function notesOf(slide) {
    const aside = slide.querySelector(':scope > aside.notes, :scope > .notes');
    if (!aside) return '';
    const blocks = aside.querySelectorAll('p, li');
    const text = blocks.length ? Array.from(blocks).map(b => b.textContent.trim()).join('\n') : aside.textContent;
    return text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

/* Underline and strike-through come from the element or an ancestor up to its block. */
function decorations(el, win) {
    let u = false, s = false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const cs = win.getComputedStyle(n);
        const line = cs.textDecorationLine || cs.textDecoration || '';
        if (/underline/.test(line)) u = true;
        if (/line-through/.test(line)) s = true;
        if (!INLINE.has(cs.display)) break;
    }
    return { u, s };
}

/* Split on top-level commas (not inside parentheses). */
function splitTop(s) {
    const out = []; let depth = 0, cur = '';
    for (const ch of s) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
}
function cssAngle(a) {
    const v = parseFloat(a);
    if (/turn$/.test(a)) return v * 360;
    if (/grad$/.test(a)) return v * 0.9;
    if (/rad$/.test(a)) return v * 180 / Math.PI;
    return v;
}
