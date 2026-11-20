/* ============================================================
   cite.js - citations: the library a deck carries, the Pandoc
   citation syntax, and the CSL styles that write them.

   In a deck:
   - the library is CSL-JSON (what Zotero, Mendeley, JabRef and
     Pandoc export) in <script type="application/vnd.citationstyles.csl+json"
     id="deck-references"> on the stage: inert data, kept so the
     deck can be edited again without the .bib it came from;
   - a citation is <span data-cite="[@key, p. 4; @other]"> in a
     text, holding the text the style wrote. data-cite is Pandoc's
     syntax: [@key] in brackets, @key in the sentence, [-@key] the
     year only, a locator after a comma, ";" between keys, words
     before the @ as a prefix;
   - the style is data-csl-style on the stage (a CSL style id:
     apa, nature, ...); one loaded from a .csl file is kept in
     <script type="application/vnd.citationstyles.csl+xml" id="deck-csl">.
   The words are written when the deck is edited (sources.js), so
   the saved deck needs no script and no library to show them.
   citation.js (MIT) reads .bib, RIS and CSL-JSON; citeproc-js
   (CPAL) writes the style. Both are vendor/citation.js, loaded into
   the editor on first use, never into a deck.
   ============================================================ */
import { loadVendor } from './vendor.js';

export const CITE = 'span[data-cite]';
export const LIBRARY_ID = 'deck-references';
export const CUSTOM_STYLE_ID = 'deck-csl';
export const DEFAULT_STYLE = 'apa';
const LIB_TYPE = 'application/vnd.citationstyles.csl+json';
const CSL_TYPE = 'application/vnd.citationstyles.csl+xml';

export const isCite = (el) => !!el && typeof el.matches === 'function' && el.matches(CITE);

/* ------------------------------------------------------------
   Pandoc's citation syntax
   ------------------------------------------------------------ */
const KEY = String.raw`[\p{L}\p{N}_][\p{L}\p{N}_:.#$%&+?<>~/-]*`;
const KEY_RE = new RegExp('^' + KEY + '$', 'u');
export const isKey = (s) => KEY_RE.test(s || '');
/* Locator words, as Pandoc and the CSL name them. */
const LABELS = [
    [/^(p|pp|pg|pgs|page|pages)\.?$/i, 'page'], [/^(ch|chap|chaps|chapter|chapters)\.?$/i, 'chapter'],
    [/^(fig|figs|figure|figures)\.?$/i, 'figure'], [/^(sec|secs|section|sections|§|§§)\.?$/i, 'section'],
    [/^(vol|vols|volume|volumes)\.?$/i, 'volume'], [/^(tab|tabs|table|tables)\.?$/i, 'table'],
    [/^(eq|eqs|equation|equations)\.?$/i, 'equation'], [/^(para|paras|paragraph|paragraphs|¶|¶¶)\.?$/i, 'paragraph'],
    [/^(l|ll|line|lines)\.?$/i, 'line'], [/^(n|nn|note|notes)\.?$/i, 'note'], [/^(col|cols|column|columns)\.?$/i, 'column'],
    [/^(bk|bks|book|books)\.?$/i, 'book'], [/^(pt|pts|part|parts)\.?$/i, 'part'], [/^(v|vv|verse|verses)\.?$/i, 'verse'],
];

/* One item of a citation: "see -@key, p. 4 and later" -> { id, prefix, suppress, locator, label, suffix }. */
function parseItem(text) {
    const m = new RegExp('^([\\s\\S]*?)(-?)@(' + KEY + ')([\\s\\S]*)$', 'u').exec(text.trim());
    if (!m) return null;
    const item = { id: m[3] };
    // A key ends in punctuation only when more key follows: "@doe99." is the key doe99 and a full stop.
    const tail = /[:.#$%&+?<>~/-]+$/.exec(item.id);
    let rest = m[4];
    if (tail) { item.id = item.id.slice(0, -tail[0].length); rest = tail[0] + rest; }
    if (m[1].trim()) item.prefix = m[1].trim();
    if (m[2]) item.suppress = true;
    rest = rest.trim();
    if (rest.startsWith(',')) {
        rest = rest.slice(1).trim();
        const words = rest.split(/\s+/);
        const lab = LABELS.find(([re]) => re.test(words[0]));
        if (lab && words.length > 1) { item.label = lab[1]; words.shift(); }
        // The locator: numbers, ranges and lists of them ("33-35, 38", "iv", "2a"); the rest is a suffix.
        const loc = /^((?:[\p{L}]{0,4}\d[\p{L}\p{N}]*|[ivxlcdm]+)(?:\s*[-–,&]\s*(?:[\p{L}]{0,4}\d[\p{L}\p{N}]*|[ivxlcdm]+))*)([\s\S]*)$/iu.exec(words.join(' '));
        if (loc && (item.label || /\d/.test(loc[1]))) {
            item.locator = loc[1].trim();
            if (!item.label) item.label = 'page';
            if (loc[2].trim()) item.suffix = loc[2].trim().replace(/^,\s*/, '');
        } else if (rest) item.suffix = rest;
    } else if (rest) item.suffix = rest;
    return item;
}

/* "[see @a, p. 4; -@b]" -> { mode: 'paren', items }, "@a" or "@a [p. 4]" -> { mode: 'narrative', items }, else null. */
export function parseCite(text) {
    const t = String(text || '').trim();
    if (t.startsWith('[') && t.endsWith(']')) {
        const items = splitItems(t.slice(1, -1)).map(parseItem);
        return items.length && items.every(Boolean) ? { mode: 'paren', items } : null;
    }
    const m = new RegExp('^@(' + KEY + ')(?:\\s*\\[([^\\]]*)\\])?$', 'u').exec(t);
    if (!m) return null;
    const item = parseItem('@' + m[1] + (m[2] ? ', ' + m[2] : ''));
    return item ? { mode: 'narrative', items: [item] } : null;
}
function splitItems(s) {
    // A ";" inside a prefix or suffix is rare; a ";" before an "@" separates items.
    const parts = [];
    let cur = '';
    for (const piece of s.split(';')) {
        if (cur && !/@/.test(piece)) { cur += ';' + piece; continue; }
        if (cur) parts.push(cur);
        cur = piece;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
}
const LABEL_WORD = { page: 'p.', chapter: 'chap.', figure: 'fig.', section: 'sec.', volume: 'vol.', table: 'tab.', equation: 'eq.', paragraph: 'para.', line: 'l.', note: 'n.', column: 'col.', book: 'bk.', part: 'pt.', verse: 'v.' };
function formatItem(it) {
    let s = (it.prefix ? it.prefix + ' ' : '') + (it.suppress ? '-' : '') + '@' + it.id;
    if (it.locator) s += ', ' + (it.label && it.label !== 'page' ? LABEL_WORD[it.label] || it.label : 'p.') + ' ' + it.locator;
    if (it.suffix) s += (it.locator ? ' ' : ', ') + it.suffix;
    return s;
}
/* The Pandoc text of a citation. */
export function formatCite(c) {
    if (!c || !c.items.length) return '';
    if (c.mode === 'narrative' && c.items.length === 1) {
        const it = c.items[0];
        const extra = formatItem({ ...it, prefix: null, suppress: false }).replace('@' + it.id, '').replace(/^,\s*/, '');
        return '@' + it.id + (extra ? ' [' + extra + ']' : '');
    }
    return '[' + c.items.map(formatItem).join('; ') + ']';
}
export const keysOf = (span) => { const c = parseCite(span.getAttribute('data-cite')); return c ? c.items.map(i => i.id) : []; };

/* ------------------------------------------------------------
   The library
   ------------------------------------------------------------ */
const KEEP = ['id', 'type', 'title', 'title-short', 'author', 'editor', 'translator', 'container-author', 'collection-editor', 'issued', 'accessed',
    'container-title', 'container-title-short', 'collection-title', 'collection-number', 'volume', 'issue', 'page', 'number', 'edition',
    'publisher', 'publisher-place', 'event', 'event-title', 'event-place', 'genre', 'medium', 'status', 'note', 'language',
    'DOI', 'URL', 'ISBN', 'ISSN', 'PMID', 'PMCID', 'number-of-pages', 'number-of-volumes', 'chapter-number', 'version', 'archive', 'source'];
/* A CSL-JSON item with only the fields the styles read (a DOI lookup brings references, licences, links...). */
export function cleanItem(raw) {
    const out = {};
    for (const k of KEEP) if (raw[k] != null && raw[k] !== '') out[k] = raw[k];
    for (const k of ['author', 'editor', 'translator']) if (Array.isArray(out[k])) out[k] = out[k].map(n => Object.fromEntries(Object.entries(n).filter(([f]) => ['family', 'given', 'literal', 'non-dropping-particle', 'dropping-particle', 'suffix'].includes(f))));
    if (Array.isArray(out.title)) out.title = out.title[0];
    if (Array.isArray(out['container-title'])) out['container-title'] = out['container-title'][0];
    if (Array.isArray(out['container-title-short'])) out['container-title-short'] = out['container-title-short'][0];
    if (!out.type) out.type = 'article-journal';
    return out;
}
export function yearOf(it) {
    const d = it && it.issued;
    if (!d) return '';
    if (Array.isArray(d['date-parts']) && d['date-parts'][0] && d['date-parts'][0][0]) return String(d['date-parts'][0][0]);
    const m = /\d{4}/.exec(d.raw || d.literal || '');
    return m ? m[0] : '';
}
const nameOf = (n) => n ? (n.literal || [n['non-dropping-particle'], n.family].filter(Boolean).join(' ') || n.given || '') : '';
/* "Szostak", "Szostak and Bartel", "Szostak et al." */
export function authorsShort(it) {
    const a = (it.author && it.author.length ? it.author : it.editor) || [];
    if (!a.length) return it['title-short'] || it.title || it.id;
    if (a.length === 1) return nameOf(a[0]);
    if (a.length === 2) return nameOf(a[0]) + ' and ' + nameOf(a[1]);
    return nameOf(a[0]) + ' et al.';
}
/* A key for an item that has none: family name and year, lower case ("szostak2001", then "szostak2001a"). */
export function makeKey(it, taken) {
    const a = (it.author && it.author[0]) || (it.editor && it.editor[0]);
    let base = (nameOf(a) || (it.title || 'ref').split(/\s+/)[0]).normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase() || 'ref';
    base += yearOf(it);
    let key = base, n = 0;
    while (taken.has(key)) key = base + String.fromCharCode(97 + n++);
    return key;
}

export class Library {
    constructor(deck) { this.deck = deck; this._text = null; this._items = []; }
    get script() { return this.deck.isOpen ? this.deck.doc.getElementById(LIBRARY_ID) : null; }
    /* The items, read again whenever the script's text changed (an undo, a paste of a slide). */
    get items() {
        const s = this.script, text = s ? s.textContent : '';
        if (text !== this._text) {
            this._text = text;
            try { const v = JSON.parse(text || '[]'); this._items = Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && x.id) : []; }
            catch (e) { this._items = []; }
        }
        return this._items;
    }
    get(id) { return this.items.find(it => it.id === id) || null; }
    has(id) { return this.items.some(it => it.id === id); }
    get version() { this.items; return this._text || ''; }

    /* Replace the items: one undo step (the script is made on the stage when there is none). */
    write(history, items, label = 'Edit references') {
        const deck = this.deck, text = '\n[\n' + items.map(it => JSON.stringify(it)).join(',\n').replace(/</g, '\\u003c') + '\n]\n';
        let s = this.script;
        const own = !history.tx;               // part of a bigger step (a key renamed with its citations), or one of its own
        if (own) history.begin(label);
        if (!s) {
            s = deck.doc.createElement('script');
            s.type = LIB_TYPE; s.id = LIBRARY_ID;
            s.textContent = text;
            history.insert(s, deck.stage, deck.stage.firstChild, label);
        } else {
            const before = s.innerHTML;
            s.textContent = text;
            history.html(s, before, s.innerHTML, label);
        }
        if (own) history.end();
        this._text = null;
    }
    /* Items read from a .bib, RIS or CSL-JSON text (or an array of CSL-JSON): added, or updated
       when the key is there already. Returns { added, updated, items }. */
    merge(history, incoming, label = 'Import references') {
        const items = this.items.slice(), taken = new Set(items.map(i => i.id)), ids = [];
        let added = 0, updated = 0;
        for (const raw of incoming) {
            const it = cleanItem(raw);
            // The same DOI is the same work, whatever its key: a second lookup updates the first.
            const same = it.DOI ? items.findIndex(x => x.DOI && x.DOI.toLowerCase() === String(it.DOI).toLowerCase()) : -1;
            if (same >= 0 && (!it.id || !isKey(it.id))) it.id = items[same].id;
            if (!it.id || !isKey(it.id)) it.id = makeKey(it, taken);
            const at = items.findIndex(x => x.id === it.id);
            if (at >= 0) { items[at] = it; updated++; } else { items.push(it); taken.add(it.id); added++; }
            ids.push(it.id);
        }
        if (added || updated) this.write(history, items, label);
        return { added, updated, ids };
    }
}

/* Text from a .bib, .ris, .json file or a paste, as CSL-JSON items. */
export async function parseReferences(text) {
    const C = await loadCite();
    const t = String(text || '').trim();
    if (!t) return [];
    if (/^[[{]/.test(t)) {
        try { const v = JSON.parse(t); const arr = Array.isArray(v) ? v : [v]; if (arr.every(x => x && typeof x === 'object' && (x.title || x.author || x.id))) return arr.map(x => ({ ...x })); }
        catch (e) { /* not JSON: BibTeX starts with @, but a stray brace could reach here */ }
    }
    const data = await C.Cite.async(t);
    return data.data.map(d => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith('_'))));
}

/* ------------------------------------------------------------
   Styles
   ------------------------------------------------------------ */
export function loadCite() {
    return loadVendor('citation.js', () => window.DiapoCite);
}
const BUILT_IN = [{ id: 'apa', title: 'APA Style 7th edition', numbered: false }, { id: 'vancouver', title: 'Vancouver', numbered: true }, { id: 'harvard1', title: 'Harvard', numbered: false }];
let styleIndex = null;
/* [{ id, title, numbered }]: the styles citation.js ships and the ones in vendor/csl/. */
export async function styleList() {
    if (!styleIndex) styleIndex = fetch('vendor/csl/styles.json').then(r => r.ok ? r.json() : []).catch(() => []);
    const more = await styleIndex;
    return [...BUILT_IN, ...more.filter(s => !BUILT_IN.some(b => b.id === s.id))].sort((a, b) => a.title.localeCompare(b.title));
}
export const styleIdOf = (deck) => (deck.stage && deck.stage.getAttribute('data-csl-style')) || DEFAULT_STYLE;
export function customStyle(deck) {
    const s = deck.doc && deck.doc.getElementById(CUSTOM_STYLE_ID);
    return s ? { id: s.getAttribute('data-style-id') || 'custom', xml: s.textContent, title: styleTitle(s.textContent) } : null;
}
export const styleTitle = (xml) => ((/<title>([^<]*)<\/title>/.exec(xml || '') || [])[1] || 'Custom style').replace(/&amp;/g, '&');
const xmlCache = new Map();
/* The XML of the deck's style. */
export async function styleXml(deck) {
    const id = styleIdOf(deck), own = customStyle(deck);
    if (own && own.id === id) return own.xml;
    const C = await loadCite();
    if (C.styles[id] && !xmlCache.has(id)) return C.styles[id];
    if (!xmlCache.has(id)) xmlCache.set(id, fetch('vendor/csl/' + encodeURIComponent(id) + '.csl').then(r => { if (!r.ok) throw new Error('no style ' + id); return r.text(); }).catch(() => { xmlCache.delete(id); return C.styles[DEFAULT_STYLE]; }));
    return xmlCache.get(id);
}
export const isNumbered = (xml) => /citation-format="numeric"/.test(xml) || /<text\s+variable="citation-number"/.test(xml);

/* Locales: the ones citation.js ships, and the files in vendor/csl/ (fetched before the engine asks, it asks synchronously). */
const LOCALE_FILES = ['en-GB', 'it-IT'];
const localeCache = new Map(), localeText = new Map();
async function localeFor(xml, deck) {
    const want = (/default-locale="([^"]+)"/.exec(xml) || [])[1] || (deck.doc && deck.doc.documentElement.getAttribute('lang')) || 'en-US';
    const full = { en: 'en-US', it: 'it-IT', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', nl: 'nl-NL' }[want.toLowerCase()] || want;
    const C = await loadCite();
    if (C.locales[full]) return full;
    if (LOCALE_FILES.includes(full)) {
        if (!localeCache.has(full)) localeCache.set(full, fetch('vendor/csl/locales-' + full + '.xml').then(r => r.ok ? r.text() : null).catch(() => null));
        const text = await localeCache.get(full);
        if (text) { localeText.set(full, text); return full; }
    }
    return 'en-US';
}
function retrieveLocale(C) {
    return (l) => C.locales[l] || localeText.get(l) || C.locales[l.replace('_', '-')] || C.locales['en-US'];
}

/* ------------------------------------------------------------
   Writing the citations of a deck
   ------------------------------------------------------------ */
/* HTML from citeproc made safe for a deck: the inline formatting it writes and links, nothing else. */
const OK_TAGS = new Set(['I', 'B', 'EM', 'STRONG', 'SUP', 'SUB', 'SPAN', 'DIV', 'A', 'BR']);
export function cleanHtml(html, doc = document) {
    const t = doc.createElement('template');
    t.innerHTML = html;
    const walk = (node) => {
        for (const n of Array.from(node.childNodes)) {
            if (n.nodeType === 8) { n.remove(); continue; }
            if (n.nodeType !== 1) continue;
            if (!OK_TAGS.has(n.tagName)) { walk(n); n.replaceWith(...n.childNodes); continue; }
            for (const a of Array.from(n.attributes)) {
                const keep = (a.name === 'class' && /^[\w\s-]*$/.test(a.value))
                    || (a.name === 'href' && n.tagName === 'A' && /^https?:\/\//i.test(a.value))
                    || (a.name === 'style' && /^(\s*(font-(style|variant|weight)|text-decoration|vertical-align)\s*:\s*[\w\s-]+;?)+$/i.test(a.value));
                if (!keep) n.removeAttribute(a.name);
            }
            walk(n);
        }
    };
    walk(t.content);
    return t.innerHTML;
}

let engineCache = { key: null, engine: null };
/* Every citation of the deck in order, written in its style.
   `spans`: the citation spans (in deck order); `extra`: { text, index } a citation not in the
   deck yet (the popover's preview), counted at that place.
   Returns { html: Map(span|'extra' -> html), missing: Set(keys), numbered, bib: { ids, entries: Map(id -> html), meta } }. */
export async function writeCitations(deck, library, spans, { extra = null, uncited = false, links = false } = {}) {
    const C = await loadCite();
    const xml = await styleXml(deck);
    const lang = await localeFor(xml, deck);
    const items = Object.fromEntries(library.items.map(it => [it.id, it]));
    const key = [styleIdOf(deck), xml.length, lang, library.version, links].join('|');
    if (engineCache.key !== key) {
        const engine = new C.CSL.Engine({ retrieveLocale: retrieveLocale(C), retrieveItem: (id) => items[id] }, xml, lang, true);
        engine.setOutputFormat('html');
        engine.opt.development_extensions.wrap_url_and_doi = !!links;
        engineCache = { key, engine };
    }
    const engine = engineCache.engine;
    engine.sys.retrieveItem = (id) => items[id];
    const numbered = isNumbered(xml);

    const list = spans.map(s => ({ span: s, c: parseCite(s.getAttribute('data-cite')) }));
    if (extra) list.splice(Math.max(0, Math.min(list.length, extra.index)), 0, { span: 'extra', c: parseCite(extra.text) });
    const missing = new Set();
    const clusters = [], plan = [];
    let n = 0;
    for (const { span, c } of list) {
        if (!c) { plan.push({ span, bad: true }); continue; }
        const known = c.items.filter(it => { if (items[it.id]) return true; missing.add(it.id); return false; });
        if (!known.length) { plan.push({ span, bad: true, c }); continue; }
        const cit = (it, more = {}) => ({ id: it.id, ...(it.locator ? { locator: it.locator, label: it.label || 'page' } : {}), ...(it.prefix ? { prefix: it.prefix + ' ' } : {}), ...(it.suffix ? { suffix: ' ' + it.suffix } : {}), ...(it.suppress ? { 'suppress-author': true } : {}), ...more });
        if (c.mode === 'narrative') {
            const it = known[0];
            const a = 'c' + (n++), b = 'c' + (n++);
            clusters.push({ citationID: a, citationItems: [{ id: it.id, 'author-only': true }], properties: { noteIndex: 0 } });
            clusters.push({ citationID: b, citationItems: [cit(it, { 'suppress-author': true, prefix: undefined })], properties: { noteIndex: 0 } });
            plan.push({ span, narrative: [a, b], item: it });
        } else {
            const id = 'c' + (n++);
            clusters.push({ citationID: id, citationItems: known.map(it => cit(it)), properties: { noteIndex: 0 } });
            plan.push({ span, id });
        }
    }
    let out = [];
    try { out = clusters.length ? engine.rebuildProcessorState(clusters, 'html') : []; }
    catch (err) { engineCache = { key: null, engine: null }; throw err; }
    const byId = new Map(out.map(([id, , html]) => [id, html]));
    const html = new Map();
    for (const p of plan) {
        if (p.bad) { html.set(p.span, null); continue; }
        if (p.narrative) {
            let who = byId.get(p.narrative[0]) || '';
            if (!who || /NO_PRINTED_FORM/.test(who)) who = escapeHtml(authorsShort(items[p.item.id]));
            const rest = byId.get(p.narrative[1]) || '';
            html.set(p.span, who + (/^<sup>/.test(rest) ? '' : ' ') + rest);
        } else html.set(p.span, byId.get(p.id) || '');
    }
    // The bibliography: what is cited (and the rest of the library when asked for).
    if (uncited) engine.updateUncitedItems(library.items.map(i => i.id).filter(id => !clusters.some(c => c.citationItems.some(x => x.id === id))));
    else engine.updateUncitedItems([]);
    let bib = { ids: [], entries: new Map(), meta: {} };
    if (library.items.length && (clusters.length || uncited)) {
        const made = engine.makeBibliography();
        if (made) {
            const [meta, entries] = made;
            const ids = (meta.entry_ids || []).map(x => Array.isArray(x) ? x[0] : x);
            bib = { ids, entries: new Map(ids.map((id, i) => [id, cleanHtml(entries[i] || '')])), meta };
        }
    }
    for (const [k, v] of html) if (v != null) html.set(k, cleanHtml(v));
    return { html, missing, numbered, bib, items };
}
export const escapeHtml = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* The short form of a reference for the foot of a slide: "Szostak et al., Nature 409, 387 (2001)". */
export function shortRef(it) {
    if (!it) return '';
    const who = escapeHtml(authorsShort(it)), year = yearOf(it);
    const venue = it['container-title-short'] || it['container-title'];
    const page = it.page ? String(it.page).split(/[-–]/)[0] : '';
    let s = who;
    if (venue) s += ', <i>' + escapeHtml(venue) + '</i>' + (it.volume ? ' ' + escapeHtml(it.volume) : '') + (page ? ', ' + escapeHtml(page) : '');
    else if (it.publisher) s += ', ' + escapeHtml(it.publisher);
    if (year) s += ' (' + year + ')';
    return s;
}
