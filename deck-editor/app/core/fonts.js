/* ============================================================
   fonts.js - web fonts for a deck.

   A deck's fonts come from three places: the fonts its own head
   already loads (usually one Google Fonts <link>), the families
   added in the editor, and faces the editor downloaded so the deck
   works without a network. Everything the editor adds lives in one
   <style id="deck-editor-fonts"> block before the override block:

       @import url("https://fonts.googleapis.com/css2?family=...");   families still fetched from Google
       a "google fonts: <url>" comment                                 what was requested, kept for re-hosting
       a "self-hosted faces" comment, then @font-face rules            pointing at fonts/name.woff2 next to the
                                                                       deck, or at data: URIs (embedded)

   When faces are hosted, the deck's own Google <link>s are written
   back as <!--deck-editor:hosted <link ...>--> so an offline deck
   never waits for Google; "Use Google Fonts again" restores them.

   Font files of your own (uploaded, or copied from the fonts installed
   on this machine) live in fonts/ too and get their own @font-face
   rules after an "own font files" comment; they are never rewritten
   by Download / Use Google Fonts again.

   State: { google: {family: {weights: [..], italics: [..]}},
            faces: '@font-face text', own: '@font-face text', hosted: bool }.

   The FontPicker at the end is the shared popover used by the
   inspector and the theme panel.
   ============================================================ */
import { CATALOG, CATEGORIES } from './font-catalog.js';

export const FONTS_ID = 'deck-editor-fonts';
const HEADER = '/* Fonts added in the deck editor. */';
const FACES_MARK = '/* self-hosted faces (managed by the deck editor; Download or Embed in the Theme panel rewrites them) */';
const OWN_MARK = '/* own font files (added in the deck editor) */';
const HOSTED_OPEN = '<!--deck-editor:hosted ';
const CSS2 = 'https://fonts.googleapis.com/css2?';
const ALL_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const SYSTEM_FONTS = ['Arial', 'Helvetica Neue', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS', 'Segoe UI', 'system-ui', 'monospace'];

/* Families probed on the server (not in the catalog), remembered for the session. */
const KNOWN = new Map();

export function emptyFonts() { return { google: {}, faces: '', own: '', hosted: false }; }
export function cloneFonts(f) {
    const google = {};
    for (const [k, v] of Object.entries(f.google || {})) google[k] = { weights: [...(v.weights || [])], italics: [...(v.italics || [])] };
    return { google, faces: f.faces || '', own: f.own || '', hosted: !!f.hosted };
}

/* ------------------------------------------------------------
   Google Fonts URLs
   ------------------------------------------------------------ */
/* css2 query for the families in `google`; `only(family, weight, italic)` filters variants. */
export function googleQuery(google, only = () => true) {
    const parts = [];
    for (const fam of Object.keys(google).sort()) {
        const g = google[fam];
        const w = (g.weights || []).filter(x => only(fam, x, false)).sort((a, b) => a - b);
        const i = (g.italics || []).filter(x => only(fam, x, true)).sort((a, b) => a - b);
        if (!w.length && !i.length) continue;
        const name = fam.trim().replace(/ /g, '+');
        if (i.length) parts.push(`family=${name}:ital,wght@` + [...w.map(x => '0,' + x), ...i.map(x => '1,' + x)].join(';'));
        else parts.push(`family=${name}:wght@` + w.join(';'));
    }
    return parts.join('&');
}
export function googleUrl(google, only) {
    const q = googleQuery(google, only);
    return q ? CSS2 + q + '&display=swap' : '';
}
/* A css2 (or css) URL -> {family: {weights, italics}}. */
export function parseGoogleUrl(url) {
    const out = {};
    const query = url.replace(/&amp;/g, '&').split('?')[1] || '';
    for (const part of query.split('&')) {
        if (!part.startsWith('family=')) continue;
        for (const spec of decodeURIComponent(part.slice(7)).split('|')) {      // css (v1) joins families with |
            const [rawName, axes] = spec.split(':');
            const name = rawName.replace(/\+/g, ' ').trim();
            if (!name) continue;
            const g = out[name] = out[name] || { weights: [], italics: [] };
            if (!axes) { add(g.weights, 400); continue; }
            const at = axes.indexOf('@');
            if (at < 0) {                                                       // v1: "400,700,400i" or "wght"
                for (const v of axes.split(',')) { const m = /^(\d+)(i(talic)?)?$/.exec(v.trim()); if (m) add(m[2] ? g.italics : g.weights, +m[1]); }
                if (!g.weights.length && !g.italics.length) add(g.weights, 400);
                continue;
            }
            const names = axes.slice(0, at).split(','), tuples = axes.slice(at + 1).split(';');
            for (const t of tuples) {
                const vals = t.split(',');
                const ital = names.includes('ital') ? vals[names.indexOf('ital')] === '1' : false;
                const wv = names.includes('wght') ? vals[names.indexOf('wght')] : '400';
                const range = /^(\d+)\.\.(\d+)$/.exec(wv);
                const ws = range ? ALL_WEIGHTS.filter(x => x >= +range[1] && x <= +range[2]) : [+wv];
                for (const w of ws) add(ital ? g.italics : g.weights, w);
            }
        }
    }
    return out;
}
function add(list, v) { if (!list.includes(v)) list.push(v); }
export function mergeGoogle(into, from) {
    for (const [fam, g] of Object.entries(from)) {
        const t = into[fam] = into[fam] || { weights: [], italics: [] };
        g.weights.forEach(w => add(t.weights, w)); g.italics.forEach(w => add(t.italics, w));
    }
    return into;
}

/* ------------------------------------------------------------
   Faces (@font-face text)
   ------------------------------------------------------------ */
export function faceKey(family, weight, italic) { return family.trim().toLowerCase() + '|' + weight + '|' + (italic ? 1 : 0); }
/* Every (family, weight, italic) the @font-face text provides. */
export function faceKeys(faces) {
    const set = new Set();
    for (const f of parseFaces(faces)) for (const w of f.weights) set.add(faceKey(f.family, w, f.italic));
    return set;
}
export function parseFaces(faces) {
    const out = [];
    for (const m of (faces || '').matchAll(/@font-face\s*{([^}]*)}/g)) {
        const b = m[1];
        const fam = /font-family:\s*['"]?([^'";]+)/.exec(b), style = /font-style:\s*(\w+)/.exec(b), weight = /font-weight:\s*([\d ]+)/.exec(b), src = /url\(\s*['"]?([^'")]+)/.exec(b);
        if (!fam) continue;
        const wv = weight ? weight[1].trim().split(/\s+/).map(Number) : [400];
        const weights = wv.length === 2 ? ALL_WEIGHTS.filter(x => x >= wv[0] && x <= wv[1]) : [wv[0]];
        out.push({ family: fam[1].trim(), italic: !!style && style[1] === 'italic', weights, src: src ? src[1] : '', embedded: !!src && src[1].startsWith('data:') });
    }
    return out;
}
/* Families in the faces text with what they provide and where it lives. */
export function faceFamilies(faces) {
    const map = new Map();
    for (const f of parseFaces(faces)) {
        const e = map.get(f.family) || { weights: new Set(), italics: new Set(), embedded: false, files: 0 };
        f.weights.forEach(w => (f.italic ? e.italics : e.weights).add(w));
        e.embedded = e.embedded || f.embedded;
        e.files++;
        map.set(f.family, e);
    }
    return map;
}
/* Drop every face of one family (used when a family is removed from the deck). */
export function withoutFamilyFaces(faces, family) {
    const re = new RegExp(`(?:/\\*[^*]*\\*/\\s*)?@font-face\\s*{[^}]*font-family:\\s*['"]?${family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*;[^}]*}\\s*`, 'g');
    return (faces || '').replace(re, '').trim();
}

/* ------------------------------------------------------------
   State <-> block text
   ------------------------------------------------------------ */
export function fontsToCss(state) {
    const have = faceKeys(state.faces);
    const missing = googleUrl(state.google, (f, w, i) => !have.has(faceKey(f, w, i)));
    const all = googleUrl(state.google);
    const lines = [HEADER];
    if (missing) lines.push(`@import url("${missing}");`);
    if (all && all !== missing) lines.push(`/* google fonts: ${all} */`);
    if (state.faces) lines.push(FACES_MARK, state.faces.trim());
    if (state.own) lines.push(OWN_MARK, state.own.trim());
    return lines.length > 1 ? lines.join('\n') + '\n' : '';
}
/* One @font-face rule per uploaded file. */
export function ownFaceCss(entries) {
    return entries.map(e => `@font-face { font-family: '${String(e.family).replace(/'/g, '')}'; font-style: ${e.italic ? 'italic' : 'normal'}; font-weight: ${e.weight}; font-display: swap; src: url(${e.file}) format('${e.format}'); }`).join('\n');
}
export function addOwnFaces(deck, history, entries, label = 'Add font files') {
    const next = cloneFonts(deck.fonts);
    next.own = [next.own.trim(), ownFaceCss(entries)].filter(Boolean).join('\n');
    commitFonts(deck, history, next, label);
}
export function cssToFonts(text, source) {
    const state = emptyFonts();
    for (const m of (text || '').matchAll(/@import\s+url\(\s*["']?(https:\/\/fonts\.googleapis\.com\/css2?\?[^"')]+)/g)) mergeGoogle(state.google, parseGoogleUrl(m[1]));
    for (const m of (text || '').matchAll(/\/\* google fonts: (https:\/\/[^\s]+) \*\//g)) mergeGoogle(state.google, parseGoogleUrl(m[1]));
    const o = (text || '').indexOf(OWN_MARK);
    if (o >= 0) { state.own = text.slice(o + OWN_MARK.length).trim(); text = text.slice(0, o); }
    const i = (text || '').indexOf(FACES_MARK);
    if (i >= 0) state.faces = text.slice(i + FACES_MARK.length).trim();
    state.hosted = (source || '').includes(HOSTED_OPEN);
    return state;
}

/* ------------------------------------------------------------
   The deck's own Google Fonts links (head text)
   ------------------------------------------------------------ */
function headOf(text) { const i = text.search(/<body[\s>]/i); return i < 0 ? text : text.slice(0, i); }
const LINK_RE = /<link\b[^>]*>/gi;
const GOOGLE_HREF = /href=["']?(https?:\/\/fonts\.googleapis\.com\/css2?\?[^"'\s>]+)/i;
/* {active: [href], hosted: [href]} for the stylesheet links to Google Fonts in the file. */
export function deckFontLinks(source) {
    const head = headOf(source || '');
    const hosted = [], active = [];
    for (const m of head.matchAll(/<!--deck-editor:hosted (<link\b[^>]*>)-->/g)) { const h = GOOGLE_HREF.exec(m[1]); if (h) hosted.push(h[1].replace(/&amp;/g, '&')); }
    for (const m of head.replace(/<!--[\s\S]*?-->/g, '').matchAll(LINK_RE)) { const h = GOOGLE_HREF.exec(m[0]); if (h) active.push(h[1].replace(/&amp;/g, '&')); }
    return { active, hosted };
}
/* Comment the deck's Google links out (hosted) or restore them. */
export function applyHostedLinks(text, hosted) {
    const head = headOf(text), rest = text.slice(head.length);
    let out;
    if (hosted) out = head.replace(LINK_RE, (tag, at, s) => (GOOGLE_HREF.test(tag) && !s.slice(0, at).endsWith(HOSTED_OPEN)) ? HOSTED_OPEN + tag + '-->' : tag);
    else out = head.replace(/<!--deck-editor:hosted (<link\b[^>]*>)-->/g, '$1');
    return out + rest;
}

/* ------------------------------------------------------------
   What a family offers: loaded faces, catalog, probed families
   ------------------------------------------------------------ */
export function firstFamily(stack) { return String(stack || '').split(',')[0].trim().replace(/^["']|["']$/g, ''); }
export function isGoogleFamily(name) { return !!(CATALOG[name] || KNOWN.get(name)); }
export function knownGoogle(name) {
    if (CATALOG[name]) return { category: CATALOG[name][0], weights: CATALOG[name][1], italics: CATALOG[name][2] };
    return KNOWN.get(name) || null;
}
export function rememberGoogle(name, info) { KNOWN.set(name, { category: 'other', weights: info.weights, italics: info.italics || [] }); }
/* Faces the deck document has loaded (its own links, our block, hosted faces). */
export function loadedFaces(doc, family) {
    const weights = new Set(), italics = new Set();
    if (!doc || !doc.fonts) return { weights, italics };
    const want = family.trim().toLowerCase();
    for (const f of doc.fonts) {
        if (f.family.replace(/^["']|["']$/g, '').trim().toLowerCase() !== want) continue;
        const wv = String(f.weight).trim().split(/\s+/).map(Number);
        const ws = wv.length === 2 ? ALL_WEIGHTS.filter(x => x >= wv[0] && x <= wv[1]) : [isNaN(wv[0]) ? 400 : wv[0]];
        for (const w of ws) (f.style === 'italic' ? italics : weights).add(w);
    }
    return { weights, italics };
}
/* Weights to offer for a family: everything Google has for a known family, else what is loaded, else null (a system font). */
export function availableWeights(deck, family) {
    const known = knownGoogle(family);
    if (known) return { weights: known.weights, italics: known.italics, google: true };
    const loaded = loadedFaces(deck.doc, family);
    if (loaded.weights.size || loaded.italics.size) return { weights: [...loaded.weights].sort((a, b) => a - b), italics: [...loaded.italics].sort((a, b) => a - b), google: false };
    return null;
}
/* 'Bold Italic', 'SemiBold', 'Light' -> {weight, italic}. */
export function styleFromWords(text) {
    const t = String(text || '').replace(/[\s_-]+/g, '').toLowerCase();
    const italic = /italic|oblique/.test(t);
    const s = t.replace(/italic|oblique/g, '');
    for (const [name, w] of STYLE_WEIGHTS) if (s.includes(name)) return { weight: w, italic };
    return { weight: 400, italic };
}
const STYLE_WEIGHTS = [['thin', 100], ['hairline', 100], ['extralight', 200], ['ultralight', 200], ['light', 300], ['regular', 400], ['normal', 400], ['book', 400],
    ['medium', 500], ['semibold', 600], ['demibold', 600], ['extrabold', 800], ['ultrabold', 800], ['bold', 700], ['black', 900], ['heavy', 900]];
export const WEIGHT_NAMES = { 100: 'thin', 200: 'extra light', 300: 'light', 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extra bold', 900: 'black' };
/* Fallback generic family for a stack. */
export function stackFor(name) {
    const known = knownGoogle(name);
    const generic = { sans: 'sans-serif', serif: 'serif', mono: 'monospace', display: 'sans-serif', hand: 'cursive', other: 'sans-serif' }[known ? known.category : 'other'];
    const q = /[^\w-]/.test(name) ? `"${name}"` : name;
    return known ? `${q}, ${generic}` : (SYSTEM_FONTS.includes(name) && name.includes(' ') ? `"${name}"` : q);
}
export function ownStack(name) { return `"${name}", sans-serif`; }

/* ------------------------------------------------------------
   Making sure a Google face is loaded (one undo step with the caller's change)
   ------------------------------------------------------------ */
/* Weights and italic weights the slides use (computed), so a deck-wide font change
   requests every face the deck needs; `scope` limits it to elements matching a selector. */
export function usedWeights(deck, scope = '') {
    const weights = new Set([400]), italics = new Set();
    if (!deck.isOpen) return { weights: [...weights], italics: [] };
    for (const el of deck.stage.querySelectorAll(scope ? scope + ', ' + scope + ' *' : '*')) {
        const cs = deck.win.getComputedStyle(el);
        const w = +cs.fontWeight || 400;
        if (cs.fontStyle === 'italic') italics.add(w); else weights.add(w);
    }
    return { weights: [...weights], italics: [...italics] };
}
/* Add whatever of (family, weights, italics) is neither loaded in the deck nor requested yet. Returns true when the block changed. */
export function ensureGoogle(deck, history, family, weights = [400], italics = []) {
    const known = knownGoogle(family);
    if (!known) return false;
    const loaded = loadedFaces(deck.doc, family);
    const state = cloneFonts(deck.fonts);
    const g = state.google[family] || { weights: [], italics: [] };
    let changed = false;
    for (const w of weights) if (known.weights.includes(w) && !loaded.weights.has(w) && !g.weights.includes(w)) { g.weights.push(w); changed = true; }
    for (const w of italics) if (known.italics.includes(w) && !loaded.italics.has(w) && !g.italics.includes(w)) { g.italics.push(w); changed = true; }
    if (!changed) return false;
    state.google[family] = g;
    commitFonts(deck, history, state, 'Add font ' + family);
    return true;
}
export function commitFonts(deck, history, next, label) {
    const before = cloneFonts(deck.fonts), after = cloneFonts(next);
    deck.setFonts(after);
    history.push({ label, undo() { deck.setFonts(before); }, redo() { deck.setFonts(after); } });
}

/* ------------------------------------------------------------
   The picker popover
   ------------------------------------------------------------ */
const PREVIEW_ID = 'font-preview-css';
export class FontPicker {
    constructor(app) {
        this.app = app;
        this.deck = app.deck;
        this.el = document.createElement('div');
        this.el.className = 'fontpick';
        this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-modal', 'true'); this.el.setAttribute('aria-label', 'Fonts');
        this.el.hidden = true;
        this.el.innerHTML = `
          <input class="fontpick-search" type="text" placeholder="Search, or type a Google Fonts name" spellcheck="false">
          <div class="fontpick-list"></div>
          <div class="fontpick-acts">
            <button type="button" data-do="upload" title="Add .woff2, .woff, .ttf or .otf files; they are copied into fonts/ next to the deck">Add font files...</button>
            <button type="button" data-do="local" title="List the fonts installed on this computer; picking one copies its files into the deck">Installed fonts...</button>
            <input type="file" accept=".woff2,.woff,.ttf,.otf" multiple hidden>
          </div>
          <div class="fontpick-foot"></div>`;
        document.body.appendChild(this.el);
        this.search = this.el.querySelector('.fontpick-search');
        this.list = this.el.querySelector('.fontpick-list');
        this.foot = this.el.querySelector('.fontpick-foot');
        this.acts = this.el.querySelector('.fontpick-acts');
        this.fileInput = this.el.querySelector('input[type=file]');
        this.local = null;            // Map family -> [FontData] once the user asked for installed fonts
        this.onPick = null;
        this.acts.addEventListener('click', (e) => {
            const b = e.target.closest('[data-do]'); if (!b) return;
            if (b.dataset.do === 'upload') this.fileInput.click();
            else this._listLocal();
        });
        this.fileInput.addEventListener('change', () => { const files = Array.from(this.fileInput.files); this.fileInput.value = ''; if (files.length) this._uploadFiles(files); });
        if (!('queryLocalFonts' in window)) this.acts.querySelector('[data-do=local]').hidden = true;
        this.search.addEventListener('input', () => this._render());
        this.search.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); this.close(); }
            if (e.key === 'Enter') { e.preventDefault(); this._enter(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); const b = this.list.querySelector('.fontpick-item'); if (b) b.focus(); }
        });
        this.list.addEventListener('keydown', (e) => {
            e.stopPropagation();
            const items = Array.from(this.list.querySelectorAll('.fontpick-item'));
            const i = items.indexOf(document.activeElement);
            if (e.key === 'ArrowDown' && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
            if (e.key === 'ArrowUp') { e.preventDefault(); if (i > 0) items[i - 1].focus(); else this.search.focus(); }
            if (e.key === 'Escape') { e.preventDefault(); this.close(); }
        });
        this.list.addEventListener('click', (e) => {
            const form = e.target.closest('[data-form]');
            if (form) { if (form.dataset.form === 'add') this._confirmAdd(); else this._render(); return; }
            const b = e.target.closest('.fontpick-item'); if (!b) return;
            if (b.dataset.probe) { this._probe(b.dataset.probe); return; }
            if (b.dataset.local) { this._copyLocal(b.dataset.local); return; }
            this._choose(b.dataset.name, b.dataset.stack);
        });
        this._outside = (e) => { if (!this.el.hidden && !this.el.contains(e.target) && e.target !== this.anchor) this.close(); };
        document.addEventListener('pointerdown', this._outside, true);
        window.addEventListener('resize', () => this.close());
    }

    /* Open next to `anchor`. onPick(stack, name, info) gets the CSS font-family value. */
    open(anchor, { current = '', onPick }) {
        this.anchor = anchor;
        this.onPick = onPick;
        this.current = firstFamily(current);
        this._loadPreviews();
        this.el.hidden = false;
        const r = anchor.getBoundingClientRect();
        const w = 300, h = Math.min(440, window.innerHeight - 24);
        let left = r.left - w - 8; if (left < 8) left = Math.min(r.right + 8, window.innerWidth - w - 8);
        let top = Math.min(r.top, window.innerHeight - h - 8);
        Object.assign(this.el.style, { left: left + 'px', top: Math.max(8, top) + 'px', width: w + 'px', maxHeight: h + 'px' });
        this.search.value = '';
        this._render();
        this.search.focus();
    }
    close() { if (this.el.hidden) return; this.el.hidden = true; this.onPick = null; this.anchor = null; this._formRows = null; }
    get isOpen() { return !this.el.hidden; }

    /* Families in this deck: theme variables, the body/heading fonts, the head's links, our block. */
    deckFamilies() {
        const names = new Map();
        const deck = this.deck;
        if (!deck.isOpen) return names;
        const put = (name, note) => { if (name && !names.has(name)) names.set(name, note); };
        for (const f of deck.themeFonts()) put(firstFamily(f.value), '--' + f.name);
        for (const url of [...deckFontLinks(deck.source).active, ...deckFontLinks(deck.source).hosted]) for (const fam of Object.keys(parseGoogleUrl(url))) put(fam, 'deck');
        for (const fam of Object.keys(deck.fonts.google)) put(fam, 'added');
        for (const fam of faceFamilies(deck.fonts.faces).keys()) put(fam, 'hosted');
        for (const fam of faceFamilies(deck.fonts.own).keys()) put(fam, 'own file');
        for (const sel of ['body', '.slide', 'h1', 'h2', 'p', 'code']) { const el = deck.doc.querySelector(sel); if (el) put(firstFamily(deck.win.getComputedStyle(el).fontFamily), ''); }
        return names;
    }

    _render() {
        const q = this.search.value.trim().toLowerCase();
        const match = (n) => !q || n.toLowerCase().includes(q);
        const item = (name, note, stack) => `<button class="fontpick-item${name === this.current ? ' on' : ''}" data-name="${esc(name)}" data-stack="${esc(stack || stackFor(name))}" style="font-family:${esc(stack || stackFor(name))}">${esc(name)}${note ? `<span>${esc(note)}</span>` : ''}</button>`;
        let html = '';
        const deckFams = this.deckFamilies();
        const inDeck = Array.from(deckFams).filter(([n]) => match(n));
        if (inDeck.length) html += '<div class="fontpick-group">This deck</div>' + inDeck.map(([n, note]) => item(n, note)).join('');
        const shown = new Set(inDeck.map(([n]) => n));
        for (const [cat, label] of Object.entries(CATEGORIES)) {
            const fams = Object.keys(CATALOG).filter(n => CATALOG[n][0] === cat && !shown.has(n) && match(n));
            if (fams.length) html += `<div class="fontpick-group">${label}</div>` + fams.map(n => item(n, '')).join('');
        }
        const probed = Array.from(KNOWN.keys()).filter(n => !shown.has(n) && match(n));
        if (probed.length) html += '<div class="fontpick-group">Google Fonts</div>' + probed.map(n => item(n, '')).join('');
        const sys = SYSTEM_FONTS.filter(n => !shown.has(n) && match(n));
        if (sys.length) html += '<div class="fontpick-group">System</div>' + sys.map(n => item(n, '', stackFor(n))).join('');
        if (this.local) {
            const fams = Array.from(this.local.keys()).filter(n => !shown.has(n) && match(n));
            html += '<div class="fontpick-group">Installed on this computer</div>' + (fams.length ? fams.map(n => `<button class="fontpick-item" data-local="${esc(n)}" style="font-family:&quot;${esc(n)}&quot;" title="Copies the font files into the deck">${esc(n)}<span>${this.local.get(n).length} ${this.local.get(n).length === 1 ? 'style' : 'styles'}</span></button>`).join('') : '<div class="fontpick-empty">No installed font matches</div>');
        }
        if (q && !CATALOG[this.search.value.trim()] && !KNOWN.has(this.search.value.trim()))
            html += `<div class="fontpick-group">Google Fonts</div><button class="fontpick-item fontpick-probe" data-probe="${esc(this.search.value.trim())}">Look up "${esc(this.search.value.trim())}" on Google Fonts</button>`;
        this.list.innerHTML = html || '<div class="fontpick-empty">No font matches</div>';
        this.foot.textContent = this.deck.fonts.faces ? 'Google fonts you add here load from the network until you download them again (Theme panel).' : 'Google fonts are added to the deck with a stylesheet link; the Theme panel can download them into the deck for offline use.';
        this.acts.hidden = false;
        const on = this.list.querySelector('.on'); if (on) on.scrollIntoView({ block: 'center' });
    }

    /* ---- own font files ---------------------------------------- */
    async _uploadFiles(files) {
        if (!this.deck.isOpen) return;
        this.list.innerHTML = '<div class="fontpick-empty">Copying into fonts/...</div>';
        this.acts.hidden = true;
        try {
            const res = await this.app.api.uploadFonts(this.deck.file, files);
            this._showForm(res.fonts);
        } catch (err) { this.app.toast(err.message, { error: true }); this._render(); }
    }
    /* Uploaded files with what the server read from them; family, weight and italic can be corrected before adding. */
    _showForm(entries) {
        this._formRows = entries;
        this.acts.hidden = true;
        this.list.innerHTML = '<div class="fontpick-group">Add to the deck</div>' + entries.map((e, i) => `<div class="fontadd-row" data-i="${i}">
            <div class="fontadd-file" title="${esc(e.file)}">${esc(e.file.replace(/^fonts\//, ''))} <i>${Math.round(e.bytes / 1024)} KB</i></div>
            <input type="text" value="${esc(e.family)}" spellcheck="false" title="Family name">
            <select title="Weight">${Object.entries(WEIGHT_NAMES).map(([w, n]) => `<option value="${w}"${+w === +e.weight ? ' selected' : ''}>${w} ${n}</option>`).join('')}</select>
            <label><input type="checkbox"${e.italic ? ' checked' : ''}> Italic</label>
          </div>`).join('') + `<div class="fontadd-acts"><button type="button" data-form="add">Add ${entries.length === 1 ? 'this font' : 'these ' + entries.length + ' files'}</button><button type="button" data-form="cancel">Cancel</button></div>
          <div class="fontpick-empty">The files are in fonts/ next to the deck. Check the font's licence before sharing the deck.</div>`;
        const first = this.list.querySelector('input[type=text]'); if (first) first.focus();
    }
    _confirmAdd() {
        const rows = Array.from(this.list.querySelectorAll('.fontadd-row'));
        const entries = rows.map(r => ({ ...this._formRows[+r.dataset.i], family: r.querySelector('input[type=text]').value.trim() || this._formRows[+r.dataset.i].family, weight: +r.querySelector('select').value, italic: r.querySelector('input[type=checkbox]').checked }));
        if (!entries.length) return;
        addOwnFaces(this.deck, this.app.history, entries);
        this.app.toast(`${entries.length} font ${entries.length === 1 ? 'file' : 'files'} added to the deck`);
        const fam = entries[0].family;
        if (this.onPick) this._choose(fam, ownStack(fam)); else { this.current = fam; this._render(); }
    }
    /* ---- fonts installed on this machine ---------------------- */
    async _listLocal() {
        const b = this.acts.querySelector('[data-do=local]');
        b.disabled = true; b.textContent = 'Listing...';
        try {
            const list = await window.queryLocalFonts();
            this.local = new Map();
            for (const f of list) { if (!this.local.has(f.family)) this.local.set(f.family, []); this.local.get(f.family).push(f); }
            this.search.value = ''; this._render();
            const g = Array.from(this.list.querySelectorAll('.fontpick-group')).pop(); if (g) g.scrollIntoView();
        } catch (err) { this.app.toast(err.name === 'NotAllowedError' ? 'Access to the installed fonts was not allowed' : err.message, { error: true }); }
        finally { b.disabled = false; b.textContent = 'Installed fonts...'; }
    }
    /* Copy the core styles (regular, bold, italic, bold italic) of an installed family into fonts/. */
    async _copyLocal(family) {
        const styles = this.local.get(family) || [];
        const want = [[400, false], [700, false], [400, true], [700, true]];
        const picked = [];
        for (const [w, it] of want) {
            const f = styles.find(s => { const st = styleFromWords(s.style); return st.weight === w && st.italic === it; });
            if (f) picked.push(f);
        }
        if (!picked.length) picked.push(styles[0]);
        this.list.innerHTML = `<div class="fontpick-empty">Copying ${picked.length} ${picked.length === 1 ? 'file' : 'files'} of ${esc(family)} into fonts/...</div>`;
        this.acts.hidden = true;
        try {
            const files = [];
            for (const f of picked) {
                const blob = await f.blob();
                const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
                const ext = String.fromCharCode(...head) === 'OTTO' ? '.otf' : head[0] === 0x77 ? '.woff' : '.ttf';
                files.push(new File([blob], `${family}-${(f.style || 'Regular').replace(/\s+/g, '')}${ext}`, { type: 'font/' + ext.slice(1) }));
            }
            const res = await this.app.api.uploadFonts(this.deck.file, files);
            // The file's own tables name the family; keep the installed name so the pick matches what the user clicked.
            const entries = res.fonts.map(e => ({ ...e, family }));
            addOwnFaces(this.deck, this.app.history, entries, 'Add font ' + family);
            this.app.toast(`${entries.length} ${entries.length === 1 ? 'file' : 'files'} of ${family} copied into fonts/ (${Math.round(entries.reduce((n, e) => n + e.bytes, 0) / 1024)} KB)`, { ms: 4000 });
            if (this.onPick) this._choose(family, ownStack(family)); else { this.current = family; this._render(); }
        } catch (err) { this.app.toast(err.message, { error: true }); this._render(); }
    }
    _enter() {
        const q = this.search.value.trim();
        const exact = this.list.querySelector(`.fontpick-item[data-name="${CSS.escape(q)}" i]`) || this.list.querySelector('.fontpick-item:not(.fontpick-probe)');
        if (exact && !exact.dataset.probe && (exact.dataset.name.toLowerCase() === q.toLowerCase() || this.list.querySelectorAll('.fontpick-item:not(.fontpick-probe)').length === 1)) { this._choose(exact.dataset.name, exact.dataset.stack); return; }
        if (q) this._probe(q);
    }
    async _probe(name) {
        const b = this.list.querySelector('.fontpick-probe'); if (b) { b.disabled = true; b.textContent = 'Asking Google Fonts...'; }
        try {
            const info = await this.app.api.googleFamily(name);
            rememberGoogle(info.family, info);
            this._loadPreview(info.family);
            this._choose(info.family, stackFor(info.family));
        } catch (err) {
            this.app.toast(err.message, { error: true });
            this._render();
        }
    }
    _choose(name, stack) {
        const cb = this.onPick;
        this.close();
        if (cb) cb(stack, name);
    }

    /* Previews: one stylesheet for the catalog (only the letters of the names), one per probed family. */
    _loadPreviews() {
        if (document.getElementById(PREVIEW_ID)) return;
        const names = Object.keys(CATALOG);
        const text = encodeURIComponent(Array.from(new Set(names.join(''))).join(''));
        const link = document.createElement('link');
        link.id = PREVIEW_ID; link.rel = 'stylesheet';
        link.href = CSS2 + names.map(n => 'family=' + n.replace(/ /g, '+')).join('&') + '&text=' + text + '&display=swap';
        document.head.appendChild(link);
    }
    _loadPreview(name) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = CSS2 + 'family=' + name.replace(/ /g, '+') + '&text=' + encodeURIComponent(name) + '&display=swap';
        document.head.appendChild(link);
    }
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
