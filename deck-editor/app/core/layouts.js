/* ============================================================
   layouts.js - slide layouts for "New slide".

   A layout builds a <section class="slide"> out of absolutely
   positioned elements with inline styles in stage pixels, the same
   way insert.js builds single elements, so any deck that follows
   the contract can show it. Headings and paragraphs keep their tags
   (h1, h2, p, ul) so the deck's own type styles apply; only the
   position, width and margins are inline.

   Image placeholders ([data-placeholder="image"]) are dashed boxes
   the user double-clicks to choose a picture. They carry
   display:none inline and are shown by the editor's host CSS only,
   so an unfilled placeholder never appears in the presentation.

   Every layout also has a sketch: boxes in stage coordinates that
   the picker draws small, so the user sees the arrangement.
   ============================================================ */

const W = 1920, H = 1080, PX = 96, PT = 72;

/* d: insert.js defaults() - font, color, accent, muted, rule, paper2 */
function el(doc, tag, text, d, { x, y, w, h = null, style = '', edit = true } = {}) {
    const e = doc.createElement(tag);
    if (text != null) e.textContent = text;
    if (edit && text != null) e.setAttribute('data-edit', '');
    e.style.cssText = `position:absolute; left:${x}px; top:${y}px; width:${w}px;${h != null ? ` height:${h}px;` : ''} margin:0;${style}`;
    return e;
}

export function imagePlaceholder(doc, d, { x, y, w, h }) {
    const e = doc.createElement('div');
    e.setAttribute('data-placeholder', 'image');
    e.textContent = 'Double-click to choose an image';
    e.style.cssText = `position:absolute; left:${x}px; top:${y}px; width:${w}px; height:${h}px; display:none; align-items:center; justify-content:center; box-sizing:border-box; border:3px dashed ${d.rule}; border-radius:12px; color:${d.muted}; font-family:${d.font}; font-size:28px; text-align:center;`;
    return e;
}

function bullets(doc, d, items, box) {
    const ul = el(doc, 'ul', null, d, { ...box, style: ' padding-left:1.2em; line-height:1.5;' });
    ul.setAttribute('data-group', '');
    for (const t of items) { const li = doc.createElement('li'); li.setAttribute('data-edit', ''); li.textContent = t; ul.appendChild(li); }
    return ul;
}

export const LAYOUTS = [
    {
        id: 'blank', label: 'Blank', sketch: [],
        build: () => [],
    },
    {
        id: 'title', label: 'Title',
        sketch: [['title', PX, 400, 1400, 130], ['text', PX, 580, 900, 50]],
        build: (doc, d) => [
            el(doc, 'h1', 'Presentation title', d, { x: PX, y: 380, w: 1500 }),
            el(doc, 'p', 'Subtitle or author', d, { x: PX, y: 580, w: 1200, style: ` color:${d.muted};` }),
        ],
    },
    {
        id: 'section', label: 'Section',
        sketch: [['accent', PX, 430, 120, 10], ['title', PX, 470, 1200, 120]],
        build: (doc, d) => [
            el(doc, 'div', null, d, { x: PX, y: 440, w: 120, h: 10, style: ` background:${d.accent}; border-radius:5px;`, edit: false }),
            el(doc, 'h1', 'Section title', d, { x: PX, y: 480, w: 1600 }),
        ],
    },
    {
        id: 'title-text', label: 'Title and text',
        sketch: [['title', PX, PT, 1400, 90], ['text', PX, 250, 1728, 500]],
        build: (doc, d) => [
            el(doc, 'h2', 'Slide title', d, { x: PX, y: PT, w: 1728 }),
            el(doc, 'p', 'Body text. Double-click to edit, drag to move, use the handles to resize.', d, { x: PX, y: 250, w: 1728, style: ' line-height:1.5;' }),
        ],
    },
    {
        id: 'title-bullets', label: 'Title and bullets',
        sketch: [['title', PX, PT, 1400, 90], ['bullets', PX, 250, 1500, 400]],
        build: (doc, d) => [
            el(doc, 'h2', 'Slide title', d, { x: PX, y: PT, w: 1728 }),
            bullets(doc, d, ['First point', 'Second point', 'Third point'], { x: PX, y: 250, w: 1728 }),
        ],
    },
    {
        id: 'two-columns', label: 'Two columns',
        sketch: [['title', PX, PT, 1400, 90], ['bullets', PX, 250, 830, 400], ['bullets', 994, 250, 830, 400]],
        build: (doc, d) => [
            el(doc, 'h2', 'Slide title', d, { x: PX, y: PT, w: 1728 }),
            bullets(doc, d, ['Left column', 'Second point', 'Third point'], { x: PX, y: 250, w: 800 }),
            bullets(doc, d, ['Right column', 'Second point', 'Third point'], { x: 1024, y: 250, w: 800 }),
        ],
    },
    {
        id: 'comparison', label: 'Comparison',
        sketch: [['title', PX, PT, 1400, 90], ['subtitle', PX, 240, 800, 50], ['text', PX, 320, 800, 380], ['subtitle', 1024, 240, 800, 50], ['text', 1024, 320, 800, 380]],
        build: (doc, d) => [
            el(doc, 'h2', 'Slide title', d, { x: PX, y: PT, w: 1728 }),
            el(doc, 'h3', 'Option A', d, { x: PX, y: 240, w: 800, style: ` color:${d.accent};` }),
            el(doc, 'p', 'How it compares.', d, { x: PX, y: 320, w: 800, style: ' line-height:1.5;' }),
            el(doc, 'h3', 'Option B', d, { x: 1024, y: 240, w: 800, style: ` color:${d.accent};` }),
            el(doc, 'p', 'How it compares.', d, { x: 1024, y: 320, w: 800, style: ' line-height:1.5;' }),
        ],
    },
    {
        id: 'title-image', label: 'Text and image',
        sketch: [['title', PX, PT, 1400, 90], ['text', PX, 250, 760, 400], ['image', 900, 240, 924, 720]],
        build: (doc, d) => [
            el(doc, 'h2', 'Slide title', d, { x: PX, y: PT, w: 1728 }),
            el(doc, 'p', 'Body text next to the picture.', d, { x: PX, y: 250, w: 760, style: ' line-height:1.5;' }),
            imagePlaceholder(doc, d, { x: 900, y: 240, w: 924, h: 720 }),
        ],
    },
    {
        id: 'image', label: 'Image and caption',
        sketch: [['image', PX, 100, 1728, 780], ['text', 496, 920, 928, 40]],
        build: (doc, d) => [
            imagePlaceholder(doc, d, { x: PX, y: 100, w: 1728, h: 780 }),
            el(doc, 'p', 'Caption', d, { x: PX, y: 920, w: 1728, style: ` text-align:center; color:${d.muted};` }),
        ],
    },
    {
        id: 'two-images', label: 'Two images',
        sketch: [['title', PX, PT, 1400, 90], ['image', PX, 240, 840, 620], ['image', 984, 240, 840, 620], ['text', PX, 900, 840, 40], ['text', 984, 900, 840, 40]],
        build: (doc, d) => [
            el(doc, 'h2', 'Slide title', d, { x: PX, y: PT, w: 1728 }),
            imagePlaceholder(doc, d, { x: PX, y: 240, w: 840, h: 620 }),
            imagePlaceholder(doc, d, { x: 984, y: 240, w: 840, h: 620 }),
            el(doc, 'p', 'Caption', d, { x: PX, y: 900, w: 840, style: ` text-align:center; color:${d.muted};` }),
            el(doc, 'p', 'Caption', d, { x: 984, y: 900, w: 840, style: ` text-align:center; color:${d.muted};` }),
        ],
    },
    {
        id: 'quote', label: 'Quote',
        sketch: [['accent', 196, 330, 10, 300], ['title', 250, 330, 1400, 220], ['text', 250, 620, 700, 40]],
        build: (doc, d) => [
            el(doc, 'div', null, d, { x: 196, y: 330, w: 10, h: 300, style: ` background:${d.accent}; border-radius:5px;`, edit: false }),
            el(doc, 'blockquote', 'A quotation that deserves a slide of its own.', d, { x: 250, y: 320, w: 1450, style: ' font-size:64px; line-height:1.3; font-weight:500;' }),
            el(doc, 'p', 'Who said it', d, { x: 250, y: 640, w: 1000, style: ` color:${d.muted};` }),
        ],
    },
    {
        id: 'big-number', label: 'Big number',
        sketch: [['title', PX, 300, 800, 220], ['text', PX, 560, 900, 60], ['text', PX, 640, 900, 120]],
        build: (doc, d) => [
            el(doc, 'div', '42%', d, { x: PX, y: 280, w: 1200, style: ` font-family:${d.font}; font-size:240px; font-weight:800; line-height:1; color:${d.accent};` }),
            el(doc, 'h2', 'What the number means', d, { x: PX, y: 560, w: 1500 }),
            el(doc, 'p', 'One sentence of context.', d, { x: PX, y: 660, w: 1500, style: ` color:${d.muted};` }),
        ],
    },
];

export function layoutById(id) { return LAYOUTS.find(l => l.id === id) || LAYOUTS[0]; }

/* Type sizes for a 1920x1080 stage, used only when the deck's own CSS leaves a tag at
   browser-default size (a deck that styles its headings for the stage keeps them). */
const FALLBACK_PX = { h1: 96, h2: 64, h3: 44, p: 36, li: 36, blockquote: 64, ul: 36, ol: 36 };
export function applyTypeFallback(slide, history) {
    const win = slide.ownerDocument.defaultView;
    for (const el of slide.querySelectorAll('h1, h2, h3, p, ul, ol, blockquote')) {
        if (el.style.fontSize) continue;
        const size = parseFloat(win.getComputedStyle(el).fontSize);
        const want = FALLBACK_PX[el.tagName.toLowerCase()];
        if (want && size < 30) {
            const set = () => { el.style.fontSize = want + 'px'; if (/^h[1-3]$/i.test(el.tagName)) { el.style.lineHeight = '1.15'; el.style.fontWeight = el.style.fontWeight || '700'; } };
            if (history) history.style(el, set, { label: 'Add slide' }); else set();
        }
    }
}

/* Build a slide element for a layout inside the deck document. */
export function buildSlide(doc, layout, d, size = { w: W, h: H }) {
    const section = doc.createElement('section');
    section.className = 'slide';
    for (const child of layout.build(doc, d)) section.appendChild(child);
    if (size.w !== W || size.h !== H) scaleLayout(section, size.w / W, size.h / H);
    return section;
}

/* Layouts are authored for 1920x1080; on another stage their boxes are stretched to it
   (widths with the stage's width, heights with its height). Type sizes come from the
   deck's CSS, so they are unchanged. */
function scaleLayout(section, kx, ky) {
    const scaleProp = (el, prop, k) => { const v = parseFloat(el.style[prop]); if (Number.isFinite(v)) el.style[prop] = Math.round(v * k) + 'px'; };
    for (const el of section.querySelectorAll('*')) {
        if (el.style.position !== 'absolute') continue;
        scaleProp(el, 'left', kx); scaleProp(el, 'width', kx);
        scaleProp(el, 'top', ky); scaleProp(el, 'height', ky);
    }
}

/* Markup for one picker tile: the sketch boxes as percentages, drawn into a tile
   with the stage's aspect ratio (so on a 4:3 stage they stretch the way the slide does). */
export function sketchHtml(layout) {
    const boxes = layout.sketch.map(([kind, x, y, w, h]) =>
        `<i class="lk lk-${kind}" style="left:${(x / W * 100).toFixed(1)}%;top:${(y / H * 100).toFixed(1)}%;width:${(w / W * 100).toFixed(1)}%;height:${(h / H * 100).toFixed(1)}%"></i>`).join('');
    return `<div class="layout-sketch">${boxes}</div>`;
}
