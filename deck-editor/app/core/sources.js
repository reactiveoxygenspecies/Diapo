/* ============================================================
   sources.js - what the editor writes from the deck's citations
   and picture credits, kept current while the deck is edited:

   - the words of each citation (span[data-cite], see cite.js);
   - the references at the foot of each slide that cites something
     (div.deck-slide-refs[data-slide-refs]), when the stage has
     data-cite-foot; a slide with data-cite-foot="off" has none;
   - the Sources slide (section.slide[data-sources]): its body
     (div.deck-sources[data-sources-body]) lists the references and
     the pictures' credits; a list longer than the slide continues
     on slides of its own (section.slide[data-sources-more]);
   - a credit beside each picture that has one
     (div.deck-credit[data-credit-for="<the picture's data-id>"]),
     in the look chosen in Theme > Image credits (data-credits on the
     stage: corner, edge, under, footer or info).

   A picture's credit is on the <img>: data-credit-by, -from,
   -license and -url; data-credit-show="off" keeps it off the slide,
   data-credit-none marks a picture that needs none.

   All of it is ordinary HTML in the saved deck: the deck shows it
   with no script. It is rewritten from the deck after every change
   (outside the undo history: undo and redo change what it is written
   from, and it follows), and when a deck opens. The look is a block
   in the editor's style element (deck-editor-overrides).
   ============================================================ */
import { CITE, Library, writeCitations, keysOf, shortRef, escapeHtml } from './cite.js';
import { cropBoxOf } from './crop.js';

export const CREDIT_STYLES = [['', 'Not on the slides'], ['corner', 'On the picture, in a corner'], ['edge', "Along the picture's edge"], ['under', 'Under the picture'], ['footer', "In the slide's footer"], ['info', 'An ⓘ that shows it on hover']];
export const CREDIT_FORMATS = [['', 'By · From · Licence'], ['by-from', 'By, From'], ['from', 'From only'], ['copyright', '© By']];
export const LICENCES = ['CC BY 4.0', 'CC BY-SA 4.0', 'CC BY-NC 4.0', 'CC BY-NC-SA 4.0', 'CC BY-ND 4.0', 'CC0', 'Public domain', 'Used with permission', 'Reproduced from a paper', 'Own work', 'All rights reserved'];
const PICTURE = 'img';
/* Pictures whose markup the deck's own script makes (Deck.generatedHosts): the save writes them
   back as the file had them, so a credit on them would not be kept. */
export const creditable = (img) => !!img && img.tagName === 'IMG' && !img.closest('[data-svg], [data-fig], [data-generated], [data-placeholder], [data-sources-body], [data-slide-refs], .deck-credit');
const MARK_START = '/* citations and credits (managed by the deck editor) */';
const MARK_END = '/* end citations and credits */';

/* The credit of a picture: { by, from, license, url } (empty strings when not given). */
export function creditOf(img) {
    const g = (n) => (img.getAttribute('data-credit-' + n) || '').trim();
    return { by: g('by'), from: g('from'), license: g('license'), url: g('url') };
}
export const hasCredit = (c) => !!(c.by || c.from || c.license);
/* The words of a credit, in the deck's format. */
export function creditText(c, format = '') {
    if (format === 'copyright') return c.by ? '© ' + c.by : c.from;
    if (format === 'from') return c.from || c.by;
    if (format === 'by-from') return [c.by, c.from].filter(Boolean).join(', ');
    return [c.by, c.from, c.license].filter(Boolean).join(' · ');
}

/* The look of what this module writes, as CSS for the deck. Sizes are in the stage's pixels. */
export function sourcesCss(stage) {
    if (!stage) return '';
    const doc = stage.ownerDocument;
    // By class: a Sources slide that is no longer updated keeps its look.
    const any = doc.querySelector('.deck-stage .deck-slide-refs, .deck-stage .deck-sources, .deck-stage .deck-credit, .deck-stage .deck-cite-tight');
    if (!any) return '';
    const size = Math.max(8, Math.min(60, parseFloat(stage.getAttribute('data-credit-size')) || 18));
    return [MARK_START,
        '.deck-stage .deck-cite-tight { margin-left: -0.26em; }',
        '.deck-stage .deck-slide-refs { position: absolute; left: 6%; right: 6%; bottom: 2.6%; font-size: 18px; line-height: 1.35; opacity: 0.78; z-index: 4; }',
        '.deck-slide-refs ol { list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 48px; }',
        '.deck-slide-refs ol.one { columns: 1; }',
        '.deck-slide-refs li { break-inside: avoid; margin: 0 0 2px; }',
        '.deck-slide-refs li > sup:first-child { margin-right: 4px; }',
        '.deck-slide-refs .csl-left-margin { display: inline; margin-right: 6px; } .deck-slide-refs .csl-right-inline, .deck-slide-refs .csl-entry { display: inline; }',
        '.deck-slide-refs .deck-slide-credits { margin-top: 2px; }',
        '.deck-stage .deck-sources { position: absolute; font-size: 24px; line-height: 1.38; overflow: hidden; }',
        '.deck-sources.both { display: grid; grid-template-columns: 1.4fr 1fr; gap: 4%; align-content: start; }',
        '.deck-sources h3 { margin: 0 0 0.6em; font-size: 0.8em; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.7; }',
        '.deck-sources .csl-entry { margin: 0 0 0.55em; }',
        '.deck-sources .hang .csl-entry { padding-left: 1.6em; text-indent: -1.6em; }',
        '.deck-sources .csl-entry:has(> .csl-left-margin) { display: grid; grid-template-columns: 2.2em 1fr; }',
        '.deck-sources .csl-left-margin { font-weight: 600; }',
        '.deck-sources a { color: inherit; text-decoration: none; opacity: 0.75; overflow-wrap: anywhere; }',
        '.deck-sources ul { list-style: none; margin: 0; padding: 0; } .deck-sources li { margin: 0 0 0.55em; }',
        '.deck-sources .deck-sources-none { opacity: 0.55; }',
        `.deck-stage .deck-credit { position: absolute; z-index: 5; font-size: ${size}px; line-height: 1.25; pointer-events: auto; }`,
        '.deck-credit.corner { padding: 0.25em 0.6em; border-radius: 0.3em; background: rgba(0, 0, 0, 0.55); color: #fff; white-space: nowrap; }',
        '.deck-credit.edge { transform-origin: 0 0; transform: rotate(-90deg); white-space: nowrap; opacity: 0.7; }',
        '.deck-credit.under { opacity: 0.75; }',
        '.deck-credit.info { width: 1.9em; height: 1.9em; border-radius: 50%; background: rgba(0, 0, 0, 0.5); color: #fff; font: italic 700 1em/1.9em Georgia, serif; text-align: center; cursor: help; }',
        '.deck-credit.info > span { display: none; position: absolute; right: 0; bottom: calc(100% + 0.5em); padding: 0.4em 0.8em; border-radius: 0.4em; background: rgba(15, 17, 24, 0.9); font: normal 400 1em/1.3 system-ui, sans-serif; white-space: nowrap; }',
        '.deck-credit.info.left > span { left: 0; right: auto; }',
        '.deck-credit.info:hover > span, .deck-credit.info:focus > span { display: block; }',
        '.deck-slide-refs .deck-credit-print { display: none; }',
        '@media print { .deck-credit.info { display: none; } .deck-slide-refs .deck-credit-print { display: block; } }',
        MARK_END].join('\n');
}

/* Where an element sits inside `within` (its offsets, so a reveal's transform does not move it). */
function boxIn(el, within) {
    let x = 0, y = 0, n = el;
    while (n && n !== within) {
        x += n.offsetLeft; y += n.offsetTop;
        const p = n.offsetParent;
        if (!p) return null;
        if (p !== within && !within.contains(p)) return null;
        n = p;
    }
    if (n !== within || !el.offsetWidth) return null;
    return { x: Math.round(x), y: Math.round(y), w: Math.round(el.offsetWidth), h: Math.round(el.offsetHeight) };
}
/* Set an element's HTML only when it says something else (no mutation, no thumbnail redraw, when nothing changed). */
function setHtml(el, html) {
    const t = el.ownerDocument.createElement('template');
    t.innerHTML = html;
    const norm = t.innerHTML;
    if (el.innerHTML !== norm) { el.innerHTML = norm; return true; }
    return false;
}
function setAttr(el, name, value) {
    if (value == null) { if (el.hasAttribute(name)) { el.removeAttribute(name); return true; } return false; }
    if (el.getAttribute(name) !== value) { el.setAttribute(name, value); return true; }
    return false;
}

export class Sources extends EventTarget {
    constructor(app) {
        super();
        this.app = app;
        this.deck = app.deck;
        this.library = new Library(app.deck);
        this.timer = 0;
        this.running = null;
        this.again = false;
        this.problem = null;      // what the last pass could not write (a style that failed, missing keys)
        this.deck.citeCssProvider = () => sourcesCss(this.deck.stage);
    }

    /* The words a citation (Pandoc's text) would have as the deck's index-th citation. */
    async preview(text, index) {
        const spans = Array.from(this.deck.stage.querySelectorAll(CITE)).filter(s => !s.closest('[data-sources-body], [data-slide-refs]'));
        if (!this.library.items.length) return '';
        const w = await writeCitations(this.deck, this.library, spans, { extra: { text, index } });
        return w.html.get('extra') || '';
    }
    /* A pass a moment after the last change. */
    schedule(ms = 200) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.run(), ms);
    }
    /* Does the deck have anything for this module? (Without, nothing loads.) */
    get active() {
        const deck = this.deck;
        if (!deck.isOpen) return false;
        return !!deck.doc.querySelector(`.deck-stage ${CITE}, .deck-stage > .slide[data-sources], .deck-stage > .slide[data-sources-more], .deck-stage [data-slide-refs], .deck-stage [data-credit-for]`)
            || deck.stage.hasAttribute('data-credits');
    }
    async run() {
        if (this.running) { this.again = true; return this.running; }
        this.running = this._run().catch((err) => { this.problem = err.message || String(err); console.warn('sources:', err); }).finally(() => {
            this.running = null;
            if (this.again) { this.again = false; this.schedule(50); }
        });
        return this.running;
    }

    async _run() {
        if (!this.active) { this.problem = null; return; }
        const deck = this.deck, doc = deck.doc, stage = deck.stage;
        const slides = () => Array.from(stage.querySelectorAll(':scope > .slide'));
        const sourcesSlide = stage.querySelector(':scope > .slide[data-sources]');
        const parts = sourcesSlide ? (sourcesSlide.getAttribute('data-sources') || 'references credits').split(/\s+/) : [];
        const spans = Array.from(stage.querySelectorAll(CITE)).filter(s => !s.closest('[data-sources-body], [data-slide-refs]'));
        const footOn = stage.hasAttribute('data-cite-foot');
        let written = null;
        const needRefs = spans.length || (sourcesSlide && parts.includes('references') && this.library.items.length);
        if (needRefs && this.library.items.length) {
            written = await writeCitations(deck, this.library, spans, {
                uncited: !!(sourcesSlide && sourcesSlide.getAttribute('data-sources-list') === 'all'),
                links: !!(sourcesSlide && sourcesSlide.hasAttribute('data-sources-links')),
            });
            if (deck.doc !== doc) return;
        }
        let changed = false;

        this.lastBib = written ? written.bib.entries : new Map();     // for the library dialog
        this.lastNumbered = !!(written && written.numbered);
        // 1. The citations' words.
        const hide = stage.getAttribute('data-cite-intext') === 'hide';
        const missing = new Set();
        for (const span of spans) {
            const html = written ? written.html.get(span) : null;
            if (html == null) {
                const keys = keysOf(span);
                keys.filter(k => !this.library.has(k)).forEach(k => missing.add(k));
                // Not in the library (yet): the citation shows as typed, so nothing is lost.
                changed = setHtml(span, escapeHtml(span.getAttribute('data-cite') || '')) || changed;
                changed = setAttr(span, 'data-cite-missing', '') || changed;
            } else {
                changed = setHtml(span, hide ? '' : html) || changed;
                changed = setAttr(span, 'data-cite-missing', null) || changed;
                // A superscript number hugs its word: a space typed before the citation (as one does
                // for "(Author, year)") is taken back by the citation, so the text can change style.
                const prev = span.previousSibling;
                const tight = !hide && /^<sup>/.test(html) && prev && prev.nodeType === 3 && /\s$/.test(prev.data);
                if (span.classList.contains('deck-cite-tight') !== !!tight) { span.classList.toggle('deck-cite-tight', !!tight); if (!span.classList.length) span.removeAttribute('class'); changed = true; }
            }
        }
        this.missing = missing;

        // 2. Pictures and their credits, in deck order.
        const creditStyle = stage.getAttribute('data-credits') || '';
        const format = stage.getAttribute('data-credit-format') || '';
        const pics = Array.from(stage.querySelectorAll(PICTURE)).filter(creditable);

        // 3. The foot of each slide: its references (in the order it cites them), and its pictures' credits in the footer look.
        const numbered = written && written.numbered;
        const number = new Map(written ? written.bib.ids.map((id, i) => [id, i + 1]) : []);
        const form = stage.getAttribute('data-cite-foot-form') || 'short';
        for (const slide of slides()) {
            if (slide.hasAttribute('data-sources') || slide.hasAttribute('data-sources-more')) { slide.querySelectorAll(':scope > [data-slide-refs]').forEach(n => { n.remove(); changed = true; }); continue; }
            let html = '';
            if (footOn && written && slide.getAttribute('data-cite-foot') !== 'off') {
                const ids = [];
                for (const s of spans) if (slide.contains(s)) for (const k of keysOf(s)) if (written.items[k] && !ids.includes(k)) ids.push(k);
                if (numbered) ids.sort((a, b) => (number.get(a) || 0) - (number.get(b) || 0));
                if (ids.length) {
                    const item = (id) => {
                        const n = numbered && number.has(id) ? `<sup>${number.get(id)}</sup>` : '';
                        if (form === 'full' && written.bib.entries.has(id)) return `<li>${written.bib.entries.get(id)}</li>`;
                        if (form === 'author-year') return `<li>${n}${shortRef({ ...written.items[id], 'container-title': null, 'container-title-short': null, publisher: null })}</li>`;
                        return `<li>${n}${shortRef(written.items[id])}</li>`;
                    };
                    html += `<ol${ids.length < 2 || form === 'full' ? ' class="one"' : ''}>${ids.map(item).join('')}</ol>`;
                }
            }
            if (creditStyle === 'footer' || creditStyle === 'info') {
                const words = pics.filter(img => img.closest('.slide') === slide && showsCredit(img)).map(img => creditText(creditOf(img), format)).filter(Boolean);
                if (words.length) html += `<div class="deck-slide-credits${creditStyle === 'info' ? ' deck-credit-print' : ''}">${words.length > 1 ? 'Images' : 'Image'}: ${words.map(escapeHtml).join('; ')}</div>`;
            }
            let foot = slide.querySelector(':scope > [data-slide-refs]');
            if (!html) { if (foot) { foot.remove(); changed = true; } continue; }
            if (!foot) {
                foot = doc.createElement('div');
                foot.className = 'deck-slide-refs';
                foot.setAttribute('data-slide-refs', '');
                foot.setAttribute('data-locked', '');
                foot.setAttribute('data-name', 'References and credits');
                slide.appendChild(foot);
                changed = true;
            }
            changed = setHtml(foot, html) || changed;
        }

        // 4. Captions beside the pictures.
        const want = new Set();
        if (['corner', 'edge', 'under', 'info'].includes(creditStyle)) {
            const corner = stage.getAttribute('data-credit-corner') || 'br';
            for (const img of pics) {
                if (!showsCredit(img)) continue;
                const box = cropBoxOf(img) || img;
                const host = box.closest('.slide') || stage;
                const at = boxIn(box, host);
                if (!at) continue;
                let id = img.getAttribute('data-id');
                if (!id) { id = 'pic-' + Math.random().toString(36).slice(2, 8); img.setAttribute('data-id', id); }
                want.add(id);
                let cap = host.querySelector(`:scope > .deck-credit[data-credit-for="${CSS.escape(id)}"]`);
                if (!cap) {
                    cap = doc.createElement('div');
                    cap.setAttribute('data-credit-for', id);
                    cap.setAttribute('data-locked', '');
                    cap.setAttribute('data-name', 'Credit');
                    host.appendChild(cap);
                    changed = true;
                }
                const text = creditText(creditOf(img), format);
                const left = /l$/.test(corner), top = /^t/.test(corner);
                const W = host.offsetWidth || deck.stageW, H = host.offsetHeight || deck.stageH, inset = 12;
                let style = '';
                if (creditStyle === 'corner' || creditStyle === 'info') {
                    style = (left ? `left:${at.x + inset}px;` : `right:${W - at.x - at.w + inset}px;`) + (top ? `top:${at.y + inset}px;` : `bottom:${H - at.y - at.h + inset}px;`);
                } else if (creditStyle === 'edge') style = `left:${at.x + at.w + 6}px; top:${at.y + at.h}px;` + (at.h > 60 ? ` max-width:${at.h}px;` : '');
                else style = `left:${at.x}px; top:${at.y + at.h + 8}px; width:${at.w}px;`;
                changed = setAttr(cap, 'class', `deck-credit ${creditStyle}${creditStyle === 'info' && left ? ' left' : ''}`) || changed;
                changed = setAttr(cap, 'style', style) || changed;
                changed = setAttr(cap, 'tabindex', creditStyle === 'info' ? '0' : null) || changed;
                changed = setAttr(cap, 'aria-label', creditStyle === 'info' ? 'Image credit: ' + text : null) || changed;
                changed = setHtml(cap, creditStyle === 'info' ? `i<span>${escapeHtml(text)}</span>` : escapeHtml(text)) || changed;
                // A picture revealed as a fragment brings its credit with it.
                const frag = (box.closest('[data-fragment]'));
                const slide = box.closest('.slide');
                if (frag && slide) {
                    const all = Array.from(slide.querySelectorAll('[data-fragment]')).filter(f => !f.matches('.deck-credit'));
                    const explicit = parseInt(frag.getAttribute('data-fragment-index'), 10);
                    changed = setAttr(cap, 'data-fragment', '') || changed;
                    changed = setAttr(cap, 'data-fragment-index', String(isFinite(explicit) ? explicit : all.indexOf(frag))) || changed;
                } else {
                    changed = setAttr(cap, 'data-fragment', null) || changed;
                    changed = setAttr(cap, 'data-fragment-index', null) || changed;
                }
            }
        }
        for (const cap of Array.from(stage.querySelectorAll('.deck-credit[data-credit-for]'))) if (!want.has(cap.getAttribute('data-credit-for'))) { cap.remove(); changed = true; }

        // 5. The Sources slide and the slides it continues on.
        changed = this._writeSources(sourcesSlide, parts, written, pics, format) || changed;

        // 6. The look, in the editor's style block.
        if (changed || this._css !== sourcesCss(stage)) { this._css = sourcesCss(stage); deck._applyOverrides(); }
        this.problem = null;
        if (changed) this.app.selection.refresh();
        this.dispatchEvent(new CustomEvent('written'));
    }

    _writeSources(slide, parts, written, pics, format) {
        const deck = this.deck, stage = deck.stage;
        let changed = false;
        const more = () => Array.from(stage.querySelectorAll(':scope > .slide[data-sources-more]'));
        if (!slide) { for (const m of more()) { m.remove(); changed = true; } return changed; }
        let body = slide.querySelector('[data-sources-body]');
        if (!body) {
            body = deck.doc.createElement('div');
            body.className = 'deck-sources';
            body.setAttribute('data-sources-body', '');
            body.setAttribute('data-locked', '');
            body.setAttribute('data-name', 'Sources list');
            body.style.cssText = `left:${Math.round(deck.stageW * 0.0625)}px; top:${Math.round(deck.stageH * 0.23)}px; width:${Math.round(deck.stageW * 0.875)}px; height:${Math.round(deck.stageH * 0.68)}px;`;
            slide.appendChild(body);
            changed = true;
        }
        // The entries, each a block of its own so a long list can be split.
        const refs = parts.includes('references') && written ? written.bib.ids.map(id => written.bib.entries.get(id)).filter(Boolean) : [];
        const hang = written && !written.numbered;
        const showNone = slide.getAttribute('data-sources-pictures') !== 'credited';
        const credits = parts.includes('credits') ? pics.filter(img => !img.hasAttribute('data-credit-none') && !img.closest('[data-sources], [data-sources-more]')).map(img => {
            const c = creditOf(img), s = img.closest('.slide');
            const n = s ? deck.slides.indexOf(s) + 1 : 0;
            const what = (img.getAttribute('alt') || '').trim();
            if (!hasCredit(c)) return showNone && what ? `<li class="deck-sources-none">${n ? `<b>Slide ${n}.</b> ` : ''}${escapeHtml(what)}: source not given</li>` : '';
            const link = c.url && /^https?:\/\//i.test(c.url) ? ` <a href="${escapeHtml(c.url)}">${escapeHtml(c.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : '';
            return `<li>${n ? `<b>Slide ${n}.</b> ` : ''}${what ? escapeHtml(what) + ': ' : ''}${escapeHtml(creditText(c, format))}${link}</li>`;
        }).filter(Boolean) : [];
        const both = refs.length && credits.length;
        const page = (r, c) => {
            const a = r.length ? `<div class="deck-sources-refs${hang ? ' hang' : ''}">${both || credits.length ? '<h3>References</h3>' : ''}${r.join('')}</div>` : '';
            const b = c.length ? `<div class="deck-sources-credits">${both || r.length ? '<h3>Pictures</h3>' : '<h3>Picture credits</h3>'}<ul>${c.join('')}</ul></div>` : '';
            return a + b;
        };
        changed = setAttr(body, 'class', 'deck-sources' + (both ? ' both' : '')) || changed;
        // The largest type that fits (24 px down to 15 px); past that the rest goes on the next slide.
        const fits = (el) => el.scrollHeight <= el.clientHeight + 1;
        const size = (el, px) => { if (el.style.fontSize !== px + 'px') el.style.fontSize = px + 'px'; };
        const none = { r: [], c: [] };
        const fill = (el, r, c) => {
            // The same list in the same box and type as last time: what was measured then still holds
            // (the search below changes the size step by step, and each step redraws the thumbnails).
            const cs = getComputedStyle(el);
            const sig = page(r, c) + '|' + el.clientWidth + 'x' + el.clientHeight + '|' + cs.fontFamily + '|' + cs.lineHeight;
            if (el._fit && el._fit.sig === sig && el._fit.out === el.innerHTML) return el._fit.rest;
            const rest = measure(el, r, c);
            el._fit = { sig, out: el.innerHTML, rest };
            return rest;
        };
        const measure = (el, r, c) => {
            changed = setHtml(el, page(r, c)) || changed;
            size(el, 24);
            if (fits(el)) return none;
            let lo = 15, hi = 23, best = 15;
            while (lo <= hi) { const mid = (lo + hi) >> 1; size(el, mid); if (fits(el)) { best = mid; lo = mid + 1; } else hi = mid - 1; }
            size(el, best);
            if (fits(el)) return none;
            // Still too long at the smallest size: keep what fits in each column, hand on the rest.
            const limit = el.getBoundingClientRect().bottom + 1;
            const over = (list) => { const i = list.findIndex(e => e.getBoundingClientRect().bottom > limit); return i < 0 ? list.length : i; };
            const keepR = over(Array.from(el.querySelectorAll('.csl-entry'))), keepC = over(Array.from(el.querySelectorAll('.deck-sources-credits li')));
            if (!keepR && !keepC) return none;            // not even one entry fits: nothing to gain from more slides
            changed = setHtml(el, page(r.slice(0, keepR), c.slice(0, keepC))) || changed;
            return { r: r.slice(keepR), c: c.slice(keepC) };
        };
        let rest = fill(body, refs, credits);
        // Continuation slides: copies of the Sources slide, made and dropped as the list needs.
        let prev = slide, i = 0;
        const have = more();
        while ((rest.r.length || rest.c.length) && i < 6) {
            let m = have[i];
            if (!m) {
                m = slide.cloneNode(true);
                m.removeAttribute('data-sources');
                m.setAttribute('data-sources-more', '');
                m.classList.remove('active', 'visible');
                m.querySelectorAll('[data-id]').forEach(n => n.removeAttribute('data-id'));
                prev.after(m);
                changed = true;
            } else if (m.previousElementSibling !== prev) { prev.after(m); changed = true; }
            const b = m.querySelector('[data-sources-body]');
            b.style.cssText = body.style.cssText;
            rest = fill(b, rest.r, rest.c);
            prev = m; i++;
        }
        for (const m of have.slice(i)) { m.remove(); changed = true; }
        this.sourcesPages = 1 + i;
        return changed;
    }
}

/* Does this picture show its credit on the slide? */
export function showsCredit(img) {
    return img.getAttribute('data-credit-show') !== 'off' && !img.hasAttribute('data-credit-none') && hasCredit(creditOf(img)) && !img.closest('[data-hidden]');
}
