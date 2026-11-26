/* ============================================================
   chem.js - chemical structures the editor draws from SMILES.

   A structure is a <figure data-chem="SMILES"> holding its 2D
   drawing: one plain inline <svg> made by SmilesDrawer
   (vendor/smiles-drawer.min.js, loaded into the editor on first
   use), scaled into the figure's box. Bonds and carbon are
   currentColor, so the figure's colour (the Text colour field) sets
   them; other atoms take the usual colours (O red, N blue, ...)
   unless data-chem-colours="off" draws everything in the one colour.
   Aromatic rings get alternating double bonds (kekule.js), as
   ChemDraw draws them; data-chem-aromatic="circles" keeps the circle.
   The <svg>'s data-key is a hash of what it was drawn from, so a
   figure written with the SMILES alone is drawn when the deck opens.

   SmilesDrawer's own <style> block would apply to the whole deck
   (.element, .sub): its rules are written onto the labels instead.

   A structure can also come from a file: a Molfile (V2000, V3000),
   an SDF's first record, or ChemDraw's CDXML (chemfile.js reads it,
   molsvg.js draws it from the file's own 2D coordinates in the same
   style). Such a figure has data-chem="" (so an older Diapo keeps its
   drawing and lists it as a problem rather than redrawing it) and
   data-chem-format="molfile" or "cdxml", and keeps the file after
   its drawing in a data block the browser never runs:
     <script type="chemical/x-mdl-molfile" data-chem-source>...</script>
   (chemical/x-cdxml for CDXML). A file without 2D coordinates (all
   atoms at one point, or 3D) is laid out by SmilesDrawer from the
   SMILES chemfile.js writes for it.
   ============================================================ */
import { loadVendor } from './vendor.js';
import { kekulize } from './kekule.js';
import { FORMATS, sniff, parseChem, formulaOf, molSmiles, needsLayout } from './chemfile.js';
import { drawMol } from './molsvg.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT = 'Arial, Helvetica, sans-serif';
// Readable on light and dark slides alike; carbon and hydrogen follow the figure's colour.
const ATOM_COLOURS = { O: '#e0402a', N: '#2f6fed', S: '#c18f00', P: '#d0661c', F: '#1f9e6e', CL: '#1f9e6e', BR: '#a3472b', I: '#8a43c4', B: '#d0661c', SI: '#d0661c' };

export function isChem(el) {
    return !!el && typeof el.matches === 'function' && el.matches('[data-chem]');
}
export function chemOf(el) {
    const c = el && el.closest ? el.closest('[data-chem]') : null;
    return c && isChem(c) ? c : null;
}
export const smilesOf = (el) => (el.getAttribute('data-chem') || '').trim();
/* 'smiles', 'molfile' or 'cdxml': what the figure's source is. */
export const formatOf = (el) => (el.getAttribute('data-chem-format') || '').trim().toLowerCase() || 'smiles';
/* The figure's source: its SMILES, or the file kept in its data block. */
export function sourceOf(el) {
    const f = formatOf(el);
    if (f === 'smiles') return smilesOf(el);
    const s = el.querySelector(':scope > script[data-chem-source]');
    return s ? fromScript(s.textContent) : '';
}
// The file as a script's text: a line break round it, and nothing that would end the block early.
// Line ends as LF: what the HTML parser gives back when the deck opens again (a Windows clipboard has
// CR LF), so the drawing's key, made from the same text, still matches then.
export const fileText = (src) => String(src).replace(/\r\n?/g, '\n');
const toScript = (src) => '\n' + fileText(src).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--') + '\n';
const fromScript = (t) => String(t).replace(/^\n/, '').replace(/\n$/, '').replace(/<\\\/(script)/gi, '</$1').replace(/<\\!--/g, '<!--');
/* The figure's content: the drawing, and for a file the file after it. */
export function chemHtml(svg, format, source) {
    if (format === 'smiles' || !FORMATS[format]) return svg;
    return svg + `\n<script type="${FORMATS[format].type}" data-chem-source>${toScript(source)}</script>\n`;
}
/* The source in the figure without touching its drawing (a source that does not draw keeps the last drawing). */
function setSource(el, format, source) {
    const old = el.querySelector(':scope > script[data-chem-source]');
    if (format === 'smiles' || !FORMATS[format]) { if (old) old.remove(); return; }
    const s = old || el.ownerDocument.createElement('script');
    s.setAttribute('type', FORMATS[format].type);
    s.setAttribute('data-chem-source', '');
    s.textContent = toScript(source);
    if (!old) el.appendChild(s);
}
/* What a structure is called in a list (the Problems list): its SMILES, or the kind of file and its title line. */
export function chemLabel(el) {
    const f = formatOf(el);
    if (f === 'smiles') return smilesOf(el);
    const name = f === 'molfile' ? (sourceOf(el).split(/\r?\n/)[0] || '').trim() : '';
    return (FORMATS[f] ? FORMATS[f].name : f) + (name ? ' ' + name : '');
}
export { sniff };
export const coloursOn = (el) => el.getAttribute('data-chem-colours') !== 'off';
/* How a figure asks to be drawn: atom colours, aromatic rings as circles. */
export const optsOf = (el) => ({ colours: coloursOn(el), circles: el.getAttribute('data-chem-aromatic') === 'circles' });

const loadSmilesDrawer = () => loadVendor('smiles-drawer.min.js', () => window.SmilesDrawer);

function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}
export const chemKey = (smiles, { colours = true, circles = false } = {}, format = 'smiles') => 'c' + hash((format === 'smiles' ? '2|' : '3|' + format + '|') + smiles + (colours ? '' : '|mono') + (circles ? '|circles' : ''));

/* The drawing of `smiles` as SVG markup and the molecular formula, or an Error saying what
   SmilesDrawer could not read. */
export async function smilesToSvg(smiles, { colours = true, circles = false } = {}) {
    const SD = await loadSmilesDrawer();
    if (!smiles) throw new Error('no SMILES');
    const drawn = circles ? smiles : kekulize(smiles);
    const tree = await new Promise((resolve, reject) => {
        try { SD.parse(drawn, resolve, (err) => reject(err)); } catch (err) { reject(err); }
    }).catch((err) => { throw new Error(readable(err)); });
    const theme = { C: 'currentColor', H: 'currentColor', FOREGROUND: 'currentColor', BACKGROUND: 'transparent', ...(colours ? ATOM_COLOURS : {}) };
    // Groups drawn out (COOH as bonds, not a squeezed label) and no H on stereocentres: as a chemist draws it.
    const drawer = new SD.SvgDrawer({ scale: 1, padding: 4, bondThickness: 1.2, fontFamily: FONT, compactDrawing: false, explicitHydrogens: false, themes: { diapo: theme } });
    const svg = document.createElementNS(NS, 'svg');
    try { drawer.draw(tree, svg, 'diapo'); } catch (err) { throw new Error('could not lay it out (' + readable(err) + ')'); }
    let formula = '';
    try { formula = drawer.getMolecularFormula() || ''; } catch (e) { /* the drawing is what matters */ }
    // The block's rules onto the labels, then the block out: in a deck it would style every .element.
    const rules = {};
    const style = svg.querySelector('style');
    if (style) {
        for (const m of style.textContent.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) rules[m[1]] = m[2].trim().replace(/\s+/g, ' ');
        style.remove();
    }
    for (const [cls, raw] of Object.entries(rules)) {
        // The size stays; the typeface is the figure's own (the Text section's Font field), so it follows the deck.
        const decl = raw.replace(/font:\s*([\d.]+(?:pt|px))\s+[^;]+/, 'font-size: $1; font-family: inherit');
        svg.querySelectorAll('.' + cls).forEach(n => { n.setAttribute('style', decl + (n.getAttribute('style') ? '; ' + n.getAttribute('style') : '')); n.removeAttribute('class'); });
    }
    svg.removeAttribute('style');                    // the drawer's px size: the figure's box sizes it instead
    svg.setAttribute('xmlns', NS);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('style', 'display:block; overflow:visible;');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', formula ? `Structure of ${formula} (SMILES ${smiles})` : `Structure, SMILES ${smiles}`);
    svg.setAttribute('data-key', chemKey(smiles, { colours, circles }));
    return { svg: svg.outerHTML, formula };
}

function readable(err) {
    const m = err && (err.message || err.toString && err.toString()) || String(err);
    return String(m).replace(/^(Syntax)?Error:\s*/, '').replace(/\s+/g, ' ').slice(0, 160);
}

/* The drawing of a structure of any format: { svg, formula, smiles, note }, or an Error saying what
   does not read. A file is drawn from its own coordinates; smiles is the one chemfile.js writes
   for it (no stereo), '' when it cannot; note says when the file had no 2D coordinates. */
export async function structureToSvg(source, format = 'smiles', opts = {}) {
    if (format === 'smiles') { const r = await smilesToSvg(source, opts); return { ...r, smiles: source, note: '' }; }
    source = fileText(source);
    if (!FORMATS[format]) throw new Error(`"${format}" is not a structure format Diapo reads (Molfile, SDF, CDXML or SMILES)`);
    if (!String(source || '').trim()) throw new Error('the ' + FORMATS[format].name + ' is empty');
    const { colours = true, circles = false } = opts;
    const mol = parseChem(source, format);
    if (!mol.atoms.length && format === 'molfile') throw new Error('the Molfile has no atoms');
    const formula = formulaOf(mol);
    let smiles = '';
    try { smiles = molSmiles(mol); } catch (e) { smiles = ''; }
    const key = chemKey(source, { colours, circles }, format);
    const name = (mol.name || '').trim();
    const title = name && name.length < 60 && /[a-z]{3}/i.test(name) && !/^(-?\s*)?(ISIS|Marvin|ChemDraw|RDKit|OpenBabel|Mrv|CDK)/i.test(name) ? name : '';
    const label = (formula || title ? `Structure of ${title}${title && formula ? ', ' : ''}${formula}` : 'Structure') + (smiles ? ` (SMILES ${smiles})` : ` (${FORMATS[format].name})`);
    if (needsLayout(mol)) {
        // No 2D coordinates: SmilesDrawer lays it out from the SMILES (the stereo is not drawn).
        if (!smiles) throw new Error('the file has no 2D coordinates, and it could not be laid out from a SMILES');
        const r = await smilesToSvg(smiles, { colours, circles });
        const svg = r.svg.replace(/ aria-label="[^"]*"/, ` aria-label="${attr(label)}"`).replace(/ data-key="[^"]*"/, ` data-key="${key}"`);
        return { svg, formula: formula || r.formula, smiles, note: 'The file has no 2D coordinates: laid out from its SMILES, without stereo.' };
    }
    const { body, box } = drawMol(mol, { colours: colours ? ATOM_COLOURS : {}, circles });
    const svg = `<svg xmlns="${NS}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block; overflow:visible;" role="img" aria-label="${attr(label)}" data-key="${key}">${body}</svg>`;
    return { svg, formula, smiles, note: '', box };
}
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/* Draw the structure into its figure. Not an undo step by itself (see ChemSection.apply). */
export async function writeChem(el, source = sourceOf(el), format = formatOf(el)) {
    const { svg, formula } = await structureToSvg(source, format, optsOf(el));
    el.innerHTML = chemHtml(svg, format, source);
    uprightLabels(el);
    return formula;
}

/* Atom labels upright on a rotated structure: each <text> turned back by the figure's rotation
   about its own centre, so the bonds turn and the letters stay level, as a chemist draws it.
   Kept in the file (data-upright says for which angle); figures not on show (no layout to
   measure) are left for when they are. */
export function uprightLabels(root) {
    if (!root) return;
    const list = root.matches && root.matches('[data-chem]') ? [root] : Array.from(root.querySelectorAll('[data-chem]'));
    for (const el of list) {
        const svg = el.querySelector(':scope > svg');
        if (!svg) continue;
        const cs = el.ownerDocument.defaultView.getComputedStyle(el);
        let a = cs.rotate && cs.rotate !== 'none' ? parseFloat(cs.rotate) || 0 : 0;
        if (cs.transform && cs.transform !== 'none') { const m = new (el.ownerDocument.defaultView.DOMMatrix)(cs.transform); a += Math.atan2(m.b, m.a) * 180 / Math.PI; }
        a = Math.round((((a % 360) + 540) % 360 - 180) * 10) / 10;
        const key = String(a);
        if ((svg.getAttribute('data-upright') || '0') === key) continue;
        const texts = Array.from(svg.querySelectorAll('text'));
        if (a && texts.some(t => { try { return !t.getBBox().width; } catch (e) { return true; } })) continue;
        for (const t of texts) {
            if (!a) { t.removeAttribute('transform'); continue; }
            const b = t.getBBox();
            t.setAttribute('transform', `rotate(${-a} ${Math.round((b.x + b.width / 2) * 100) / 100} ${Math.round((b.y + b.height / 2) * 100) / 100})`);
        }
        if (a) svg.setAttribute('data-upright', key); else svg.removeAttribute('data-upright');
    }
}

/* Every structure in `root` whose drawing is missing or out of date, drawn; the ones that do not parse. */
export async function refreshChem(root) {
    const bad = [];
    if (!root) return bad;
    const list = root.matches && root.matches('[data-chem]') ? [root] : Array.from(root.querySelectorAll('[data-chem]'));
    for (const el of list) {
        const svg = el.querySelector(':scope > svg');
        if (svg && svg.getAttribute('data-key') === chemKey(sourceOf(el), optsOf(el), formatOf(el))) continue;
        try { await writeChem(el); } catch (err) { bad.push({ el, message: err.message }); }
    }
    return bad;
}

/* ============================================================
   ChemSection - the Structure part of the properties panel: the
   source (drawn on the slide as it is typed; leaving the field is
   the undo step), atom colours, and the formula it reads as. A
   SMILES is a one-line field; a Molfile, an SDF or a CDXML is shown
   in a box of its own. A file pasted into the SMILES field turns the
   structure into that file at once (one undo step); a SMILES typed
   into the file's box turns it back into a SMILES structure.
   ============================================================ */
export class ChemSection {
    constructor(app, root) {
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.root = root;
        this.el = null;
        this.pending = null;          // { el, html, smiles, format } before the typing started
        this.timer = 0;
        this.seq = 0;
        root.innerHTML = `
          <h4>Structure</h4>
          <input type="text" id="chemSmiles" class="insp-notes theme-css" spellcheck="false" autocomplete="off" placeholder="CC(=O)Oc1ccccc1C(=O)O" title="The molecule as SMILES; Enter or leaving the field keeps it. A Molfile or CDXML pasted here takes its place">
          <textarea id="chemSource" class="insp-notes theme-css chem-source" rows="8" wrap="off" spellcheck="false" autocomplete="off" hidden title="The structure's file (Molfile, SDF or CDXML); Ctrl+Enter or leaving the box keeps it"></textarea>
          <div class="insp-hint insp-state insp-warn" id="chemError" role="status" hidden></div>
          <div class="insp-hint insp-state" id="chemFormula"></div>
          <div class="insp-hint insp-state" id="chemFrom" hidden></div>
          <label class="align-toslide"><input type="checkbox" id="chemColours"> <span>Atom colours</span></label>
          <label class="align-toslide" title="Aromatic rings with a circle inside, in place of alternating double bonds"><input type="checkbox" id="chemCircles"> <span>Aromatic rings as circles</span></label>
          <div class="insp-hint">SMILES, as ChemDraw, Marvin or PubChem give it (ChemDraw: Edit &gt; Copy As &gt; SMILES), or a Molfile, an SDF or ChemDraw's CDXML pasted here, drawn with the file's own layout. Bonds take the Text colour below, atom labels the Text font.</div>`;
        this.box = root.querySelector('#chemSmiles');
        this.area = root.querySelector('#chemSource');
        this.err = root.querySelector('#chemError');
        this.formula = root.querySelector('#chemFormula');
        this.from = root.querySelector('#chemFrom');
        this.colours = root.querySelector('#chemColours');
        this.circles = root.querySelector('#chemCircles');
        this.area.style.cssText = 'width:100%; box-sizing:border-box; font:11px/1.35 Consolas, "SF Mono", Menlo, monospace; white-space:pre; overflow:auto; resize:vertical;';
        this.box.addEventListener('input', () => this._typed());
        this.box.addEventListener('change', () => this.commit());
        this.box.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.commit(); this.box.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); this.box.blur(); }
        });
        // A field of one line would run a file's lines together: a pasted file takes the structure's place.
        this.box.addEventListener('paste', (e) => {
            const t = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
            if (!t || sniff(t) === 'smiles') return;
            e.preventDefault();
            this.replace(t);
        });
        this.area.addEventListener('input', () => this._typed());
        this.area.addEventListener('change', () => this.commit());
        this.area.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); this.area.blur(); }
        });
        this.colours.addEventListener('change', () => this._option('data-chem-colours', this.colours.checked ? null : 'off', 'Atom colours'));
        this.circles.addEventListener('change', () => this._option('data-chem-aromatic', this.circles.checked ? 'circles' : null, 'Aromatic rings'));
    }

    /* What the field in use says, and as what: the SMILES field is a SMILES; the box is what it reads as. */
    _field() {
        if (this.area.hidden) return { text: this.box.value.trim(), format: 'smiles' };
        const text = this.area.value;
        let format = sniff(text);
        if (format === 'smiles' && /\n\s*\S/.test(text.trim())) format = /<\w/.test(text) ? 'cdxml' : 'molfile';      // lines, but not a file that reads: say why as that
        return { text: format === 'smiles' ? text.trim() : text, format };
    }
    _show(format, text) {
        const file = format !== 'smiles';
        this.box.hidden = file;
        this.area.hidden = !file;
        if (file) this.area.value = text; else this.box.value = text;
    }

    _snapshot(el) {
        if (!this.pending || this.pending.el !== el) this.pending = { el, html: el.innerHTML, smiles: el.getAttribute('data-chem'), format: el.getAttribute('data-chem-format') };
    }

    _typed() {
        const el = this.el; if (!el || !this.deck.doc.contains(el)) return;
        this._snapshot(el);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { const f = this._field(); this._draw(el, f.text, f.format); }, 150);
    }

    async _draw(el, source, format) {
        const n = ++this.seq;
        try {
            const r = await structureToSvg(source, format, optsOf(el));
            if (n !== this.seq || !this.deck.doc.contains(el)) return;
            this.deck.withoutTransitions(() => { el.innerHTML = chemHtml(r.svg, format, source); uprightLabels(el); });
            this._error(''); this._formula(r, format);
        } catch (err) {
            if (n === this.seq) this._error(err.message);
        }
    }

    _error(msg) {
        this.err.hidden = !msg;
        this.err.textContent = msg ? 'Not drawn: ' + msg + '. The slide shows the last one that worked.' : '';
    }
    _formula(r, format = 'smiles') {
        const f = r && r.formula;
        this.formula.textContent = f ? 'Formula: ' + f : format !== 'smiles' && r ? 'Formula: not worked out (an R group or an abbreviation Diapo does not know)' : '';
        const file = format !== 'smiles' && r;
        this.from.hidden = !file;
        this.from.textContent = file ? `From a ${format === 'cdxml' ? 'ChemDraw CDXML file' : 'Molfile'}` + (r.smiles ? `; SMILES (without stereo): ${r.smiles}` : '') + (r.note ? ' ' + r.note : '') : '';
    }

    async commit() {
        const p = this.pending, el = this.el;
        this.pending = null;          // claimed now: leaving the box while this one draws must not record it twice
        if (!p || p.el !== el || !el || !this.deck.doc.contains(el)) return;
        clearTimeout(this.timer);
        const { text, format } = this._field();
        const drawn = el.querySelector(':scope > svg');
        if (!drawn || drawn.getAttribute('data-key') !== chemKey(text, optsOf(el), format) || formatOf(el) !== format) {   // the drawing shows what the field says
            try { const r = await structureToSvg(text, format, optsOf(el)); el.innerHTML = chemHtml(r.svg, format, text); uprightLabels(el); this._error(''); this._formula(r, format); }
            catch (err) { this._error(err.message); setSource(el, format, text); }
        }
        this._record(el, p, format === 'smiles' ? text : '', format === 'smiles' ? null : format, 'Edit structure');
        if (this.area.hidden !== (format !== 'smiles')) {
            const focused = document.activeElement === this.area || document.activeElement === this.box;
            this._show(format, text);
            if (focused) (format === 'smiles' ? this.box : this.area).focus();
        }
    }

    /* The change from the snapshot to now as one undo step: the attributes, then the content. */
    _record(el, p, smiles, format, label) {
        if (smiles === p.smiles && format === p.format && el.innerHTML === p.html) return;
        this.history.begin(label);
        if (el.getAttribute('data-chem') !== smiles) this.history.attr(el, 'data-chem', smiles, label);
        if (el.getAttribute('data-chem-format') !== format) this.history.attr(el, 'data-chem-format', format, label);
        if (el.innerHTML !== p.html) this.history.html(el, p.html, el.innerHTML, label);
        this.history.end();
        this.app.selection.refresh();
    }

    /* The structure replaced by a file (or a SMILES) as it is: drawn and recorded at once, one undo step. */
    async replace(text) {
        const el = this.el; if (!el || !this.deck.doc.contains(el)) return false;
        const format = sniff(text);
        const source = format === 'smiles' ? text.trim() : text;
        if (this.pending && this.pending.el === el) await this.commit();
        const p = { el, html: el.innerHTML, smiles: el.getAttribute('data-chem'), format: el.getAttribute('data-chem-format') };
        this._show(format, source);
        let r;
        try { r = await structureToSvg(source, format, optsOf(el)); }
        catch (err) { this._error(err.message); this.pending = p; return false; }    // left in the box to be put right; leaving it records it
        el.innerHTML = chemHtml(r.svg, format, source);
        uprightLabels(el);
        this._error(''); this._formula(r, format);
        this._record(el, p, format === 'smiles' ? source : '', format === 'smiles' ? null : format, 'Edit structure');
        (format === 'smiles' ? this.box : this.area).focus();
        return true;
    }

    /* An option attribute (colours, circles) and the drawing it gives: one undo step. */
    async _option(name, value, label) {
        const el = this.el; if (!el) return;
        const before = el.innerHTML, was = el.getAttribute(name);
        const format = formatOf(el), source = sourceOf(el);
        let r;
        el.toggleAttribute(name, value != null); if (value != null) el.setAttribute(name, value);
        try { r = await structureToSvg(source, format, optsOf(el)); }
        catch (err) { this._error(err.message); r = null; }
        if (was == null) el.removeAttribute(name); else el.setAttribute(name, was);   // back, so history records the change
        if (!r) { this.sync(el); return; }
        this.history.begin(label);
        this.history.attr(el, name, value, label);
        el.innerHTML = chemHtml(r.svg, format, source);
        uprightLabels(el);
        this.history.html(el, before, el.innerHTML, label);
        this.history.end();
    }

    focus() {
        if (!this.area.hidden) { this.area.focus(); this.area.setSelectionRange(0, 0); this.area.scrollTop = 0; }
        else { this.box.focus(); this.box.select(); }
    }

    async sync(el) {
        const c = el && isChem(el) ? el : null;
        if (this.el && this.el !== c && this.pending) this.commit();
        this.el = c;
        this.root.hidden = !c;
        if (!c) return;
        this.colours.checked = coloursOn(c);
        this.circles.checked = optsOf(c).circles;
        if (document.activeElement !== this.box && document.activeElement !== this.area) {
            const format = formatOf(c), source = sourceOf(c);
            this._show(format, source); this._error('');
            const n = ++this.seq;
            try { const r = await structureToSvg(source, format, optsOf(c)); if (n === this.seq) this._formula(r, format); }
            catch (err) { if (n === this.seq) { this._formula(null); this._error(err.message); } }
        }
    }
}
