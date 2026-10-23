/* ============================================================
   dom.js - how the editor classifies elements inside a deck.

   Nothing here is deck-specific: the rules look at tag names,
   computed layout and the optional data-* hooks of the contract.
   Used by selection (what does a click mean), transform (does a
   resize change the font or the box) and the inspector.
   ============================================================ */

export const TEXT_TAGS = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td, th, dt, dd, figcaption, label, [data-edit]';
export const MEDIA_TAGS = 'img, video, canvas, iframe, svg, [data-fig], [data-chart], [data-math], [data-chem], [data-svg], picture, object';
/* Figures the editor (or a deck's script) draws: picked, moved and sized as one, never edited inside. */
export const DRAWN = '[data-fig], [data-chart], [data-math], [data-chem]';
export const SHAPE_TAGS = 'path, circle, rect, ellipse, polygon, polyline, line, text, tspan, g, use';

const BLOCK_SELECTOR = TEXT_TAGS + ', ' + MEDIA_TAGS;

/* --- basic predicates ------------------------------------------ */
export function win(el) { return el.ownerDocument.defaultView; }

/* Fill a row of swatches, keeping the keyboard on the swatch it was on: the panel redraws
   its swatches when a colour is applied, and a swatch pressed with Enter would otherwise
   drop the focus to the page (where the next Delete is the canvas's). */
export function setSwatches(box, html) {
    const a = box.ownerDocument.activeElement;
    // Only keyboard focus is kept: after a click the canvas keys (arrows, Delete) go back to the canvas.
    const key = a && a !== box && box.contains(a) && a.dataset && a.matches(':focus-visible') ? a.dataset.c : undefined;
    box.innerHTML = html;
    if (key === undefined) return;
    const again = Array.from(box.querySelectorAll('[data-c]')).find(x => x.dataset.c === key);
    if (again) again.focus({ preventScroll: true });
}

/* A theme colour's name for people: "ink-2" reads "Ink 2", "accentSoft" "Accent soft"
   (a colour named by its value, "#3d3c3a", stays as it is). */
export function colourName(name) {
    const s = String(name);
    if (s.startsWith('#') || s.includes('(')) return s;
    const words = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}
export function css(el) { return win(el).getComputedStyle(el); }
export function isElement(n) { return !!n && n.nodeType === 1; }
export function slideOf(el) { return el.closest ? el.closest('.slide') : null; }

/* The master layer: elements in the stage that are not slides (a footer, a page
   counter, a logo), which every slide shows. The runtime's own chrome is not part of it. */
export const MASTER_SELECTOR = '.deck-stage > :not(.slide):not(script):not(style):not(template):not(.deck-overview):not(.deck-laser):not(.deck-draw):not(.deck-controls)';
export function isMaster(el) {
    if (!el || !el.closest || slideOf(el)) return false;
    const stage = el.closest('.deck-stage');
    if (!stage) return false;
    let top = el;
    while (top.parentElement && top.parentElement !== stage) top = top.parentElement;
    return top !== stage && top.matches(MASTER_SELECTOR);
}
/* The stage-level element a master element belongs to. */
export function masterRootOf(el) {
    const stage = el.closest('.deck-stage');
    let top = el;
    while (top.parentElement && top.parentElement !== stage) top = top.parentElement;
    return top;
}

/* An element inside inline SVG (but not the <svg> root and not inside a chart). */
export function isShape(el) {
    return el instanceof win(el).SVGElement && el.tagName.toLowerCase() !== 'svg' && !el.closest(DRAWN);
}

/* The <svg> root that owns a shape, or the [data-svg] host wrapping it. */
export function svgHostOf(el) {
    const svg = el.closest('svg');
    if (!svg) return null;
    const host = svg.parentElement && svg.parentElement.closest('[data-svg]');
    return host || svg;
}

/* Text directly inside this element (not only inside children). */
export function hasOwnText(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    return false;
}

/* Elements worth selecting on their own: text blocks, media, and elements carrying text. */
export function isMeaningful(el) {
    if (!isElement(el) || el.matches('.slide, .deck-stage')) return false;
    if (el.matches(BLOCK_SELECTOR)) return true;
    if (el.hasAttribute('data-group')) return true;
    if (hasOwnText(el) && css(el).display !== 'inline') return true;
    return false;
}

/* Top-level blocks inside `root` (blocks nested inside a counted block are not counted twice). */
function topBlocks(root, selector) {
    const out = [];
    for (const el of root.querySelectorAll(selector)) {
        if (out.some(o => o.contains(el))) continue;
        out.push(el);
    }
    return out;
}
export function textBlocks(root) {
    const blocks = topBlocks(root, TEXT_TAGS);
    // An element with its own text (a <span> label, a <div> caption) is a text block too.
    for (const el of root.querySelectorAll('span, div, b, strong, em, i, small, a, code')) {
        if (el.closest(TEXT_TAGS) && el.closest(TEXT_TAGS) !== root) continue;
        if (blocks.some(b => b.contains(el))) continue;
        if (hasOwnText(el)) blocks.push(el);
    }
    return blocks;
}
export function mediaBlocks(root) { return topBlocks(root, MEDIA_TAGS); }

/* Something that lays out as its own box, so it makes sense to move it as a unit. */
export function isLayoutUnit(el) {
    if (el.hasAttribute('data-group')) return true;
    const cs = css(el);
    if (cs.position !== 'static') return true;
    if (el.style.width || el.style.height) return true;
    const p = el.parentElement;
    if (p && /flex|grid/.test(css(p).display)) return true;
    return /inline-block|inline-flex|table/.test(cs.display);
}

/* Does resizing this element scale its text (font-size) rather than its box?
   Text-only elements without an explicit box do; anything with media or an
   authored size is a box. */
export function isTextLike(el) {
    if (isShape(el)) return false;
    if (el.matches(MEDIA_TAGS) || el.querySelector(MEDIA_TAGS)) return false;
    if (el.style.width || el.style.height) return false;
    if (el.matches(TEXT_TAGS)) return true;
    return textBlocks(el).length > 0 || hasOwnText(el);
}

/* Elements the user can put text into (SVG labels are edited through a box over them). */
export function isEditableText(el) {
    if (isShape(el)) return el.matches('text, tspan');
    return el.matches(TEXT_TAGS) || hasOwnText(el);
}

/* A locked element (data-locked, on it or on something it is in) is passed by when clicking
   and marquee-selecting, and cannot be moved or resized; Ctrl+click still reaches it. */
export function isLocked(el) { return !!(el && el.closest && el.closest('[data-locked]')); }

/* --- identities ---------------------------------------------------- */
/* data-id is an element's identity for auto-animate (the same id on two slides links the two);
   every inserted element gets one, unique in the deck. data-name is the name the user gives it,
   shown in the panel and the Morph from list. */
export function uniqueId(doc) {
    const used = new Set(Array.from(doc.querySelectorAll('[data-id]')).map(e => e.getAttribute('data-id')));
    let n = used.size + 1, id;
    do { id = 'el-' + (n++); } while (used.has(id));
    return id;
}
/* A copy landing on a slide takes fresh ids where the slide already has them (an id is unique on a
   slide; across slides it is the morph link, so a copy pasted onto another slide keeps it). */
export function ensureUniqueIds(el, scope) {
    for (const n of [el, ...el.querySelectorAll('[data-id]')]) {
        const id = n.getAttribute('data-id'); if (!id) continue;
        if (Array.from(scope.querySelectorAll('[data-id]')).some(o => o !== n && o.getAttribute('data-id') === id)) n.setAttribute('data-id', uniqueId(n.ownerDocument));
    }
}

/* The words of an element as they read on the slide: a line break or the edge of a block
   counts as a space ("Welcome<br>to Diapo" is "Welcome to Diapo", not "Welcometo Diapo").
   Scripts, styles and speaker notes are left out. */
const BLOCK_TAGS = /^(address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)$/;
export function readableText(el) {
    let out = '';
    const walk = (n) => {
        if (n.nodeType === 3) { out += n.nodeValue; return; }
        if (n.nodeType !== 1) return;
        const tag = n.tagName.toLowerCase();
        if (tag === 'br') { out += ' '; return; }
        if (tag === 'script' || tag === 'style' || tag === 'template' || (tag === 'aside' && n.classList.contains('notes'))) return;
        const block = BLOCK_TAGS.test(tag);
        if (block) out += ' ';
        for (const c of n.childNodes) walk(c);
        if (block) out += ' ';
    };
    walk(el);
    return out.replace(/\s+/g, ' ').trim();
}

/* --- description for the inspector ------------------------------ */
const NOISE_CLASSES = /^(reveal|reveal-img|reveal-right|active|visible|js-plotly-plot|plotly-graph-div)$/;
export function describe(el) {
    const tag = el.tagName.toLowerCase();
    const cls = (el.getAttribute('class') || '').split(/\s+/).filter(c => c && !NOISE_CLASSES.test(c)).slice(0, 3);
    const role = el.dataset.fig ? 'chart "' + el.dataset.fig + '"'
        : el.hasAttribute('data-chart') ? (el.dataset.chart ? el.dataset.chart + ' chart' : 'chart')
        : el.hasAttribute('data-math') ? 'equation'
        : el.hasAttribute('data-chem') ? 'structure'
        : el.hasAttribute('data-fa') ? 'icon ' + el.getAttribute('data-fa')
        : el.hasAttribute('data-svg') ? 'inline SVG'
        : el.hasAttribute('data-crop') ? 'image, cropped'
        : tag === 'img' ? 'image'
        : isShape(el) || tag === 'svg' ? 'shape'
        : /^h[1-6]$/.test(tag) ? 'heading'
        : tag === 'p' ? 'paragraph'
        : tag === 'li' ? 'list item'
        : el.hasAttribute('data-group') ? 'group'
        : isTextLike(el) || (el.hasAttribute('data-edit') && hasOwnText(el)) ? 'text' : 'box';
    const text = el.hasAttribute('data-math') ? el.getAttribute('data-math').slice(0, 70)
        : el.hasAttribute('data-chem') ? el.getAttribute('data-chem').slice(0, 70)
        : el.dataset.fig || el.hasAttribute('data-chart') ? '' : readableText(el).slice(0, 70);
    const name = (el.getAttribute('data-name') || '').trim();
    return { tag, classes: cls, role, text, name, id: el.getAttribute('data-id') || '', label: tag + (cls.length ? '.' + cls.join('.') : '') };
}
/* How an element is called in a list: its name, else what it is and says. */
export function nameOf(el) {
    const d = describe(el);
    if (d.name) return d.name;
    return d.role + (d.text ? ': ' + d.text.slice(0, 40) : el.hasAttribute('data-fa') ? '' : ' (' + d.label + ')');
}
