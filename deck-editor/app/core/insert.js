/* ============================================================
   insert.js - putting new elements on the current slide.

   Everything inserted is an absolutely positioned element sized in
   stage pixels with inline styles only (no editor classes), so the
   saved file needs nothing from the editor to render it. Defaults
   come from the deck: its body font, its text colour, its first
   accent colour, and (when its :root names them) a muted text
   colour, a rule colour and a panel colour.

   Kinds: text box, bullet list, table, chart (chart.js), code block, image (file or
   URL), video (file or URL), embedded web page, shapes (rectangle,
   rounded rectangle, ellipse, triangle, diamond, hexagon, star,
   block arrow, chevron, speech bubble), line, arrow, icons, and
   filling an image placeholder from a layout.
   ============================================================ */
import { css, uniqueId, ensureUniqueIds } from './dom.js';
import { getOffset, setOffset } from './transform.js';
import { imagePlaceholder } from './layouts.js';
import { sampleChart, deckPalette, writeChart } from './chart.js';
import { texToSvg, lastMathFont } from './math.js';
import { smilesToSvg } from './chem.js';

/* A small set of icons as SVG paths on a 24x24 grid. */
export const ICONS = {
    check: 'M20 6 9 17l-5-5',
    cross: 'M18 6 6 18M6 6l12 12',
    'arrow-right': 'M5 12h14m-6-6 6 6-6 6',
    'arrow-up': 'M12 19V5m-6 6 6-6 6 6',
    plus: 'M12 5v14M5 12h14',
    star: 'm12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
    heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8z',
    bolt: 'M13 2 3 14h9l-1 8 10-12h-9z',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-6v-4m0-4h.01',
    warning: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4m0 4h.01',
    circle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    square: 'M4 4h16v16H4z',
    flask: 'M9 3h6M10 3v6L4 20a1 1 0 0 0 .9 1.5h14.2A1 1 0 0 0 20 20l-6-11V3',
    bulb: 'M9 18h6m-5 3h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-14v6l4 2',
    mail: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm0 1 8 7 8-7',
    user: 'M20 21a8 8 0 1 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
    globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L14.8 3H9.2l-.4 2.6a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1l.4 2.6h5.6l.4-2.6a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.1-.3.1-.7.1-1z',
    'chart-bar': 'M4 20V10m6 10V4m6 16v-7m6 7H2',
    'chart-line': 'M3 17 9 11l4 4 8-8M3 21h18',
    pin: 'M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1m2 5a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
    play: 'M6 4v16l14-8z',
    quote: 'M10 11H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6a4 4 0 0 1-4 4m14-6h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6a4 4 0 0 1-4 4',
    calendar: 'M4 5h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm4-3v4m8-4v4M3 10h18',
    target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-6a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    file: 'M14 2H6a1 1 0 0 0-1 1v18a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7l-5-5zm0 0v5h5',
};

/* Shapes on a 100x100 grid, stretched to the box (preserveAspectRatio none). */
export const SHAPES = {
    triangle: 'M50 3 97 97H3Z',
    diamond: 'M50 2 98 50 50 98 2 50Z',
    hexagon: 'M25 4H75L97 50 75 96H25L3 50Z',
    star: 'M50 3 61.8 36.6 97.6 36.6 68.6 58.4 79.4 92 50 71.6 20.6 92 31.4 58.4 2.4 36.6 38.2 36.6Z',
    'block-arrow': 'M0 30H60V6L100 50 60 94V70H0Z',
    chevron: 'M0 0H70L100 50 70 100H0L30 50Z',
    bubble: 'M8 2H92a6 6 0 0 1 6 6V64a6 6 0 0 1-6 6H42L22 92V70H8a6 6 0 0 1-6-6V8a6 6 0 0 1 6-6Z',
};

/* Video sites: a page URL -> the URL of its embeddable player. */
export function embedUrl(url) {
    const u = String(url || '').trim();
    let m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i.exec(u);
    if (m) return `https://www.youtube.com/embed/${m[1]}`;
    m = /vimeo\.com\/(?:video\/)?(\d+)/i.exec(u);
    if (m) return `https://player.vimeo.com/video/${m[1]}`;
    return u;
}

export class Inserter {
    constructor(app) {
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.selection = app.selection;
        this.count = 0;                // cascades successive inserts so they do not stack exactly
    }

    /* ------------------------------------------------------------
       Deck-derived defaults
       ------------------------------------------------------------ */
    defaults() {
        const slide = this.deck.currentSlide;
        const cs = css(slide);
        const theme = this.deck.themeColours();
        const pick = (re, exclude = null) => (theme.find(c => re.test(c.name) && !(exclude && exclude.test(c.name))) || {}).name;
        const accent = pick(/accent|primary|brand|coral|teal|blue|red|green/i) || pick(/./, /bg|paper|white|ink|rule|grey|gray|stage|slide|line|muted/i);
        const muted = pick(/ink-3|muted|secondary|grey|gray|caption/i);
        const rule = pick(/rule|line|border|divider/i);
        const paper2 = pick(/paper-2|panel|surface|bg-2|soft/i);
        // Prefer the deck's variables when the computed value matches one, so inserted
        // elements follow the theme and the saved markup stays readable.
        const fontVar = this.deck.themeFonts().find(f => norm(f.value) === norm(cs.fontFamily));
        const colourVar = theme.find(c => sameColour(c.value, cs.color, slide));
        // Everything new must read on this slide: a deck's text colour is made for its usual
        // ground, and a dark slide in a light deck (or the other way round) would get text in
        // the colour of the ground. Colours that do not stand out are swapped for the theme
        // colour that reads best there, else white or near-black.
        const ground = slideGround(slide);
        const dark = luminance(ground) < 0.4;
        const readable = (value, min) => value && contrast(resolveColour(value, slide), ground) >= min;
        let color = colourVar ? `var(--${colourVar.name})` : cs.color;
        if (!readable(color, 3)) {          // 3:1, the WCAG ratio for large text (new text is 32px)
            const best = theme.map(c => ({ name: c.name, k: contrast(resolveColour(c.value, slide), ground) })).sort((a, b) => b.k - a.k)[0];
            color = best && best.k >= 4.5 ? `var(--${best.name})` : dark ? '#ffffff' : '#111111';
        }
        const pickOr = (name, min, onDark, onLight) => (name && readable(`var(--${name})`, min)) ? `var(--${name})` : dark ? onDark : onLight;
        return {
            font: fontVar ? `var(--${fontVar.name})` : cs.fontFamily,
            color,
            accent: accent ? `var(--${accent})` : '#2f6fed',
            muted: pickOr(muted, 2, 'rgba(255,255,255,0.65)', 'rgba(0,0,0,0.55)'),
            rule: pickOr(rule, 1.3, 'rgba(255,255,255,0.25)', 'rgba(0,0,0,0.2)'),
            paper2: paper2 && Math.abs(luminance(resolveColour(`var(--${paper2})`, slide)) - luminance(ground)) < 0.25 ? `var(--${paper2})` : dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
        };
    }

    /* Position for a new element of the given size: slide centre, nudged per insert. */
    place(el, w, h) {
        const n = this.count++ % 8;
        const x = Math.round((this.deck.stageW - w) / 2 + n * 24), y = Math.round((this.deck.stageH - (h || 200)) / 2 + n * 24);
        el.style.position = 'absolute';
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        if (w) el.style.width = w + 'px';
        if (h) el.style.height = h + 'px';
    }

    add(el, label) {
        const slide = this.deck.currentSlide;
        if (!slide) return null;
        if (!el.hasAttribute('data-id')) el.setAttribute('data-id', uniqueId(this.deck.doc));   // its identity, for auto-animate
        this.history.insert(el, slide, null, label);
        this.selection.select(el);
        return el;
    }

    /* A footer on every slide: a stage-level element (the master layer) with an editable
       text and a page counter. Decks that already have a master layer keep it. */
    masterFooter() {
        const existing = this.deck.masterElements;
        if (existing.length) {
            this.selection.select(existing[0]);
            this.app.toast('This deck already has elements on every slide; they are selected. Click any of them to edit it.');
            return existing[0];
        }
        const d = this.defaults(), doc = this.deck.doc;
        const el = doc.createElement('div');
        el.className = 'deck-footer';
        el.style.cssText = `position:absolute; left:${Math.round(this.deck.stageW * 0.05)}px; right:${Math.round(this.deck.stageW * 0.05)}px; bottom:36px; display:flex; justify-content:space-between; align-items:center; font-family:${d.font}; font-size:18px; color:${d.muted}; letter-spacing:0.04em; z-index:5;`;
        const text = doc.createElement('span'); text.setAttribute('data-edit', ''); text.textContent = 'Footer text';
        const num = doc.createElement('span'); num.style.fontVariantNumeric = 'tabular-nums';
        const now = doc.createElement('b'); now.setAttribute('data-page-now', ''); now.textContent = String(this.deck.current + 1);
        const total = doc.createElement('span'); total.setAttribute('data-page-total', ''); total.textContent = String(this.deck.slides.length);
        num.append(now, ' / ', total);
        el.append(text, num);
        this.history.insert(el, this.deck.stage, null, 'Insert footer on every slide');
        this.selection.select(text);
        if (!(this.deck.win.deckRuntime)) this.app.toast('Footer added to every slide. Add the presentation features (Presenter menu) so the page number counts when presenting.', { ms: 5000 });
        return el;
    }

    /* Select the whole content of an element so typing replaces the placeholder text. */
    _selectAll(el) {
        const r = this.deck.doc.createRange(); r.selectNodeContents(el);
        const s = this.deck.win.getSelection(); s.removeAllRanges(); s.addRange(r);
    }

    /* ------------------------------------------------------------
       Text kinds
       ------------------------------------------------------------ */
    text(content = 'Text') {
        const d = this.defaults(), doc = this.deck.doc;
        const el = doc.createElement('div');
        el.setAttribute('data-edit', '');
        el.textContent = content;
        this.place(el, 640, 0);
        el.style.fontFamily = d.font;
        el.style.fontSize = '32px';
        el.style.lineHeight = '1.4';
        el.style.color = d.color;
        this.add(el, 'Insert text');
        this.app.textEdit.start(el);
        this._selectAll(el);
        return el;
    }

    list(ordered = false) {
        const d = this.defaults(), doc = this.deck.doc;
        const ul = doc.createElement(ordered ? 'ol' : 'ul');
        ul.setAttribute('data-group', '');
        for (const t of ['First point', 'Second point', 'Third point']) {
            const li = doc.createElement('li'); li.setAttribute('data-edit', ''); li.textContent = t; ul.appendChild(li);
        }
        this.place(ul, 900, 0);
        ul.style.cssText += `margin:0; padding-left:1.2em; font-family:${d.font}; font-size:36px; line-height:1.5; color:${d.color};`;
        return this.add(ul, ordered ? 'Insert numbered list' : 'Insert list');
    }

    table(rows = 3, cols = 3) {
        const d = this.defaults(), doc = this.deck.doc;
        const table = doc.createElement('table');
        table.setAttribute('data-group', '');
        for (let r = 0; r < rows; r++) {
            const tr = doc.createElement('tr');
            for (let c = 0; c < cols; c++) {
                const cell = doc.createElement(r === 0 ? 'th' : 'td');
                cell.setAttribute('data-edit', '');
                cell.textContent = r === 0 ? `Column ${c + 1}` : `Cell`;
                cell.style.cssText = `border:2px solid ${d.rule}; padding:14px 22px; text-align:left; vertical-align:top;` + (r === 0 ? ` background:${d.paper2}; font-weight:600;` : '');
                tr.appendChild(cell);
            }
            table.appendChild(tr);
        }
        this.place(table, 1100, 0);
        table.style.cssText += `border-collapse:collapse; font-family:${d.font}; font-size:30px; line-height:1.4; color:${d.color};`;
        return this.add(table, 'Insert table');
    }

    /* Row and column operations on a table (used by the inspector). */
    tableAddRow(table, atEnd = true) {
        const rows = Array.from(table.querySelectorAll(':scope > tr, :scope > tbody > tr'));
        const ref = rows[rows.length - 1]; if (!ref) return;
        const tr = ref.cloneNode(true);
        tr.querySelectorAll('td, th').forEach(c => { c.textContent = ''; c.removeAttribute('contenteditable'); });
        this.history.insert(tr, ref.parentNode, atEnd ? ref.nextSibling : ref, 'Add row');
        return tr;
    }
    tableAddColumn(table) {
        const rows = Array.from(table.querySelectorAll(':scope > tr, :scope > tbody > tr'));
        this.history.begin('Add column');
        for (const tr of rows) {
            const last = tr.lastElementChild; if (!last) continue;
            const c = last.cloneNode(true); c.textContent = ''; c.removeAttribute('contenteditable');
            this.history.insert(c, tr, null, 'Add column');
        }
        this.history.end();
    }
    tableRemoveRow(table) {
        const rows = Array.from(table.querySelectorAll(':scope > tr, :scope > tbody > tr'));
        if (rows.length <= 1) return;
        this.history.remove(rows[rows.length - 1], 'Delete row');
    }
    tableRemoveColumn(table) {
        const rows = Array.from(table.querySelectorAll(':scope > tr, :scope > tbody > tr'));
        if (!rows.length || rows[0].children.length <= 1) return;
        this.history.begin('Delete column');
        for (const tr of rows) if (tr.lastElementChild) this.history.remove(tr.lastElementChild, 'Delete column');
        this.history.end();
    }

    /* A chart the editor draws (see chart.js): a figure with the drawing and its table, text in the
       deck's font and colour, series in the deck's accent colours. */
    chart(kind = 'column') {
        const d = this.defaults(), doc = this.deck.doc;
        const fig = doc.createElement('figure');
        fig.setAttribute('data-chart', kind);
        this.place(fig, 1100, 620);
        fig.style.cssText += `margin:0; font-family:${d.font}; font-size:24px; color:${d.color};`;
        // Drawn once it is on the slide, where its box and fonts are known; the table goes in with it.
        fig.innerHTML = `<script type="application/json" data-chart-data>${JSON.stringify(sampleChart(deckPalette(this.deck)))}</script>`;
        this.history.begin('Insert chart');
        this.add(fig, 'Insert chart');
        writeChart(fig);
        this.history.end();
        this.selection.select(fig);
        return fig;
    }

    /* An equation (see math.js): a figure with the LaTeX and its drawing, in the deck's text
       colour, centred on the slide. MathJax loads on the first one, so this waits for it. */
    async equation(tex = 'E = mc^2') {
        const d = this.defaults(), doc = this.deck.doc;
        const font = lastMathFont();
        const svg = await texToSvg(tex, font);
        if (!this.deck.currentSlide) return null;
        const fig = doc.createElement('figure');
        fig.setAttribute('data-math', tex);
        if (font === 'stix2') fig.setAttribute('data-math-font', 'stix2');
        fig.style.cssText = `position:absolute; left:0px; top:0px; margin:0; font-size:64px; color:${d.color};`;
        fig.innerHTML = svg;
        this.history.begin('Insert equation');
        this.add(fig, 'Insert equation');
        this._centre(fig);
        this.history.end();
        this.selection.select(fig);
        return fig;
    }

    /* A chemical structure (see chem.js): a figure with the SMILES and its drawing, scaled into
       its box. SmilesDrawer loads on the first one. */
    async structure(smiles = 'CC(=O)Oc1ccccc1C(=O)O') {
        const d = this.defaults(), doc = this.deck.doc;
        const { svg } = await smilesToSvg(smiles);
        if (!this.deck.currentSlide) return null;
        const fig = doc.createElement('figure');
        fig.setAttribute('data-chem', smiles);
        this.place(fig, 520, 400);
        fig.style.cssText += `margin:0; color:${d.color};`;
        fig.innerHTML = svg;
        this.history.begin('Insert structure');
        this.add(fig, 'Insert structure');
        this.history.end();
        this.selection.select(fig);
        return fig;
    }

    /* Centre an element just added (its size known only once it is on the slide), offset like place(). */
    _centre(el) {
        const r = this.deck.stageRect(el), n = (this.count++ % 8) * 24;
        el.style.left = Math.round((this.deck.stageW - r.w) / 2 + n) + 'px';
        el.style.top = Math.round((this.deck.stageH - r.h) / 2 + n) + 'px';
    }

    code(sample ='def greet(name):\n    # say hello\n    return f"Hello, {name}!"\n\nprint(greet("world"))') {
        const doc = this.deck.doc;
        const pre = doc.createElement('pre');
        pre.setAttribute('data-group', '');
        const code = doc.createElement('code');
        code.setAttribute('data-edit', '');
        code.setAttribute('data-code', '');
        code.textContent = sample;
        highlightCode(code);
        pre.appendChild(code);
        this.place(pre, 1100, 0);
        pre.style.cssText += `margin:0; padding:28px 34px; border-radius:14px; background:#1e1f26; color:#e6e6ea; font:28px/1.5 Consolas, "SF Mono", Menlo, monospace; white-space:pre-wrap; overflow-wrap:anywhere; tab-size:4;`;
        return this.add(pre, 'Insert code block');
    }

    /* ------------------------------------------------------------
       Media
       ------------------------------------------------------------ */
    image(src, alt = '') {
        const el = this.deck.doc.createElement('img');
        el.src = src;
        el.alt = alt;
        this.place(el, 640, 0);
        el.style.maxWidth = 'none';
        el.style.maxHeight = 'none';
        el.style.height = 'auto';
        return this.add(el, 'Insert image');
    }

    /* Upload files into assets/ and insert each as an image or a video. */
    async upload(files, { placeholder = null } = {}) {
        const dir = this.deck.file.includes('/') ? this.deck.file.slice(0, this.deck.file.lastIndexOf('/')) : '';
        const r = await this.app.api.upload(dir, files);
        let last = null;
        for (const rel of r.files) {
            const alt = files[0] ? files[0].name.replace(/\.[^.]+$/, '') : '';
            const target = placeholder && this.deck.doc.contains(placeholder) ? placeholder : null;
            if (target && /^(img|video)$/i.test(target.tagName)) {
                // Another file in the same box: the picture (or video) keeps its place, size and look.
                this.history.begin('Replace picture');
                this.history.attr(target, 'src', rel, 'Replace picture');
                if (target.tagName === 'IMG' && !target.getAttribute('alt')) this.history.attr(target, 'alt', alt, 'Replace picture');
                this.history.end();
                this.selection.select(target); last = target; placeholder = null;
            }
            else if (/\.(mp4|webm|mov|ogg)$/i.test(rel)) last = this.video(rel);
            else if (target) { last = this.fillPlaceholder(target, rel, alt); placeholder = null; }
            else last = this.image(rel, alt);
        }
        return { el: last, files: r.files, refused: r.refused || [] };
    }

    /* An image placeholder from a layout becomes a real picture in the same box. */
    fillPlaceholder(ph, src, alt = '') {
        const doc = this.deck.doc;
        const img = doc.createElement('img');
        img.src = src; img.alt = alt;
        const s = ph.style;
        img.style.cssText = `position:absolute; left:${s.left}; top:${s.top}; width:${s.width}; height:${s.height}; object-fit:cover; max-width:none; max-height:none;` + (s.borderRadius ? ` border-radius:${s.borderRadius};` : '') + (s.rotate ? ` rotate:${s.rotate};` : '');
        this.history.begin('Choose image');
        this.history.insert(img, ph.parentNode, ph, 'Choose image');
        this.history.remove(ph, 'Choose image');
        this.history.end();
        this.selection.select(img);
        return img;
    }

    placeholder() {
        const d = this.defaults();
        const ph = imagePlaceholder(this.deck.doc, d, { x: 0, y: 0, w: 800, h: 500 });
        this.place(ph, 800, 500);
        return this.add(ph, 'Insert image placeholder');
    }

    video(src) {
        const el = this.deck.doc.createElement('video');
        el.src = src;
        el.setAttribute('controls', '');
        el.setAttribute('playsinline', '');
        el.setAttribute('preload', 'metadata');
        this.place(el, 1280, 720);
        el.style.maxWidth = 'none';
        el.style.maxHeight = 'none';
        el.style.background = '#000';
        return this.add(el, 'Insert video');
    }

    embed(url) {
        const el = this.deck.doc.createElement('iframe');
        el.src = embedUrl(url);
        el.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
        el.setAttribute('allowfullscreen', '');
        el.setAttribute('loading', 'lazy');
        this.place(el, 1280, 720);
        el.style.border = '0';
        el.style.maxWidth = 'none';
        el.style.maxHeight = 'none';
        el.style.background = '#000';
        return this.add(el, 'Insert embed');
    }

    /* ------------------------------------------------------------
       Shapes
       ------------------------------------------------------------ */
    rect(ellipse = false, radius = 0) {
        const d = this.defaults();
        const el = this.deck.doc.createElement('div');
        this.place(el, 420, 260);
        el.style.background = d.accent;
        if (ellipse) el.style.borderRadius = '50%';
        else if (radius) el.style.borderRadius = radius + 'px';
        return this.add(el, ellipse ? 'Insert ellipse' : radius ? 'Insert rounded rectangle' : 'Insert rectangle');
    }

    /* A filled path stretched to its box; the colour lives in `color` (fill: currentColor),
       so the Text colour field of the properties panel recolours it. */
    shape(kind) {
        const path = SHAPES[kind]; if (!path) return null;
        const d = this.defaults(), doc = this.deck.doc;
        const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.innerHTML = `<path d="${path}" fill="currentColor"/>`;
        const sizes = { 'block-arrow': [360, 200], chevron: [300, 200], bubble: [420, 300] };
        const [w, h] = sizes[kind] || [300, 300];
        this.place(svg, w, h);
        svg.style.color = d.accent;
        svg.style.maxWidth = 'none';
        svg.style.maxHeight = 'none';
        return this.add(svg, 'Insert ' + kind.replace('-', ' '));
    }

    line(arrow = false) {
        const d = this.defaults(), doc = this.deck.doc;
        const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 480 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', d.accent);
        svg.setAttribute('stroke-width', '6');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.innerHTML = arrow
            ? '<path d="M6 12h460"/><path d="m448 2 20 10-20 10"/>'
            : '<path d="M6 12h468"/>';
        this.place(svg, 480, 24);
        svg.style.overflow = 'visible';
        svg.style.maxWidth = 'none';
        svg.style.maxHeight = 'none';
        return this.add(svg, arrow ? 'Insert arrow' : 'Insert line');
    }

    icon(name) {
        const path = ICONS[name]; if (!path) return null;
        const d = this.defaults(), doc = this.deck.doc;
        const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', d.accent);
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.innerHTML = `<path d="${path}"/>`;
        this.place(svg, 120, 120);
        svg.style.maxWidth = 'none';
        svg.style.maxHeight = 'none';
        return this.add(svg, 'Insert icon');
    }

    /* A Font Awesome icon (see core/icons.js): an inline svg with a currentColor path, coloured
       through the svg's `color`, which is what the Text colour of the properties panel sets. */
    faIcon({ name, style, width, path, attribution }) {
        const d = this.defaults(), doc = this.deck.doc;
        const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${width} 512`);
        svg.setAttribute('data-fa', ({ s: 'solid', r: 'regular', b: 'brands' }[style] || style) + '/' + name);
        svg.setAttribute('aria-label', name.replace(/-/g, ' '));
        svg.innerHTML = (attribution || '') + `<path fill="currentColor" d="${path}"/>`;
        const h = 120, w = Math.round(h * width / 512);
        this.place(svg, w, h);
        svg.style.color = d.accent;
        svg.style.maxWidth = 'none';
        svg.style.maxHeight = 'none';
        return this.add(svg, 'Insert icon');
    }

    /* Duplicate the selected elements in place, offset a little. */
    duplicateSelection() {
        const items = this.selection.items.slice();
        if (!items.length) return;
        const clones = [];
        this.history.begin('Duplicate');
        for (const el of items) {
            const c = this.app.editops.cloneInPlace(el);          // in flow: an absolute copy at the same spot, no reflow
            const o = getOffset(c);
            setOffset(c, o.x + 24, o.y + 24);          // part of the same undo step
            ensureUniqueIds(c, this.deck.currentSlide || this.deck.stage);
            this.history.insert(c, el.parentNode, el.nextSibling, 'Duplicate');
            clones.push(c);
        }
        this.history.end();
        this.selection.set(clones);
        return clones;
    }
}

/* ------------------------------------------------------------
   Code highlighting: a small, language-agnostic pass over the
   text of a <code data-code> element. Comments, strings, numbers
   and a shared set of keywords get inline-coloured spans, so the
   saved file needs no stylesheet for it. Runs when a code block is
   inserted and again after each edit (textedit.js).
   ------------------------------------------------------------ */
const KEYWORDS = new Set(('def class return if elif else for while in not and or is None True False import from as with try except finally lambda yield pass break continue global nonlocal raise assert del ' +
    'function const let var new this typeof instanceof export default async await switch case do throw catch null undefined true false extends super static of ' +
    'struct fn pub use impl match mut enum trait where loop int float double void char bool string public private protected package interface implements final abstract ' +
    'SELECT FROM WHERE JOIN ON GROUP BY ORDER LIMIT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE AS AND OR NOT NULL select from where join on group by order limit insert into values update set delete create table').split(/\s+/));
const TOKEN = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|--[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|(\b[A-Za-z_][\w]*\b)/g;
const COLOURS = { comment: '#8a8f9c', string: '#c3e88d', number: '#f78c6c', keyword: '#82aaff' };

/* Turn a bulleted list into a numbered one or back: the items move into a new element of the
   other kind, keeping their attributes, styles and place in the slide. A marker an item carries
   from an import goes, so the new kind is what shows. One undo step; returns the new list. */
export function setListKind(history, list, ordered) {
    const label = ordered ? 'Numbered list' : 'Bulleted list';
    const next = list.ownerDocument.createElement(ordered ? 'ol' : 'ul');
    for (const a of list.attributes) next.setAttribute(a.name, a.value);
    if (!ordered) next.removeAttribute('start');
    next.style.listStyleType = '';
    if (!next.getAttribute('style')) next.removeAttribute('style');
    history.begin(label);
    history.insert(next, list.parentNode, list, label);
    for (const li of Array.from(list.children)) {
        if (li.style.listStyleType) history.style(li, clearMarker, { label });
        history.move(li, next, null, label);
    }
    history.remove(list, label);
    history.end();
    return next;
}
/* Take the marker off an element without leaving an empty style attribute in the file. */
export function clearMarker(el) { el.style.listStyleType = ''; if (!el.getAttribute('style')) el.removeAttribute('style'); }

export function highlightCode(code) {
    const text = code.textContent;
    const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    let out = '', last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(text))) {
        out += esc(text.slice(last, m.index));
        const kind = m[1] ? 'comment' : m[2] ? 'string' : m[3] ? 'number' : (KEYWORDS.has(m[4]) ? 'keyword' : null);
        // "#" starts a comment in Python and shells, but not inside CSS colours or C pre-processor lines followed by words: keep it simple, only at line start or after spaces.
        const ok = kind !== 'comment' || !m[1].startsWith('#') || m.index === 0 || /\s/.test(text[m.index - 1]);
        out += kind && ok ? `<span style="color:${COLOURS[kind]}${kind === 'comment' ? ';font-style:italic' : ''}">${esc(m[0])}</span>` : esc(m[0]);
        last = m.index + m[0].length;
    }
    out += esc(text.slice(last));
    code.innerHTML = out;
}

/* Font stacks compare without quotes, spaces or case. */
function norm(s) { return String(s || '').replace(/["'\s]/g, '').toLowerCase(); }

/* Compare a theme colour (any CSS colour) with a computed rgb() by letting the deck resolve it. */
function sameColour(themeValue, computed, ref) {
    return resolveColour(themeValue, ref, true) === computed;
}
/* Any CSS colour (a var(), a name) as the deck resolves it where `ref` is: {r, g, b, a}, or the
   computed rgb() string when `raw`. */
function resolveColour(value, ref, raw = false) {
    const probe = ref.ownerDocument.createElement('i');
    probe.style.color = value;
    ref.appendChild(probe);
    const resolved = css(probe).color;
    probe.remove();
    return raw ? resolved : parseRgb(resolved) || { r: 0, g: 0, b: 0, a: 1 };
}
function parseRgb(s) {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
/* The colour a slide shows behind its content: its own background, else the stage's, the
   body's, white. A picture or gradient background counts by its colour, if it has one. */
function slideGround(slide) {
    for (let el = slide; el && el.nodeType === 1; el = el.parentElement) {
        const c = parseRgb(css(el).backgroundColor);
        if (c && c.a > 0.5) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
}
/* WCAG relative luminance and contrast ratio. */
function luminance({ r, g, b }) {
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
