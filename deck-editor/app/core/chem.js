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
   ============================================================ */
import { loadVendor } from './vendor.js';
import { kekulize } from './kekule.js';

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
export const coloursOn = (el) => el.getAttribute('data-chem-colours') !== 'off';
/* How a figure asks to be drawn: atom colours, aromatic rings as circles. */
export const optsOf = (el) => ({ colours: coloursOn(el), circles: el.getAttribute('data-chem-aromatic') === 'circles' });

const loadSmilesDrawer = () => loadVendor('smiles-drawer.min.js', () => window.SmilesDrawer);

function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}
export const chemKey = (smiles, { colours = true, circles = false } = {}) => 'c' + hash('2|' + smiles + (colours ? '' : '|mono') + (circles ? '|circles' : ''));

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

/* Draw the structure into its figure. Not an undo step by itself (see ChemSection.apply). */
export async function writeChem(el, smiles = smilesOf(el)) {
    const { svg, formula } = await smilesToSvg(smiles, optsOf(el));
    el.innerHTML = svg;
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
        if (svg && svg.getAttribute('data-key') === chemKey(smilesOf(el), optsOf(el))) continue;
        try { await writeChem(el); } catch (err) { bad.push({ el, message: err.message }); }
    }
    return bad;
}

/* ============================================================
   ChemSection - the Structure part of the properties panel: the
   SMILES (drawn on the slide as it is typed; leaving the field is
   the undo step), atom colours, and the formula it reads as.
   ============================================================ */
export class ChemSection {
    constructor(app, root) {
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.root = root;
        this.el = null;
        this.pending = null;          // { el, html, smiles } before the typing started
        this.timer = 0;
        this.seq = 0;
        root.innerHTML = `
          <h4>Structure</h4>
          <input type="text" id="chemSmiles" class="insp-notes theme-css" spellcheck="false" autocomplete="off" placeholder="CC(=O)Oc1ccccc1C(=O)O" title="The molecule as SMILES; Enter or leaving the field keeps it">
          <div class="insp-hint insp-state insp-warn" id="chemError" role="status" hidden></div>
          <div class="insp-hint insp-state" id="chemFormula"></div>
          <label class="align-toslide"><input type="checkbox" id="chemColours"> <span>Atom colours</span></label>
          <label class="align-toslide" title="Aromatic rings with a circle inside, in place of alternating double bonds"><input type="checkbox" id="chemCircles"> <span>Aromatic rings as circles</span></label>
          <div class="insp-hint">SMILES, as ChemDraw, Marvin or PubChem give it (ChemDraw: Edit &gt; Copy As &gt; SMILES). Bonds take the Text colour below, atom labels the Text font.</div>`;
        this.box = root.querySelector('#chemSmiles');
        this.err = root.querySelector('#chemError');
        this.formula = root.querySelector('#chemFormula');
        this.colours = root.querySelector('#chemColours');
        this.circles = root.querySelector('#chemCircles');
        this.box.addEventListener('input', () => this._typed());
        this.box.addEventListener('change', () => this.commit());
        this.box.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.commit(); this.box.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); this.box.blur(); }
        });
        this.colours.addEventListener('change', () => this._option('data-chem-colours', this.colours.checked ? null : 'off', 'Atom colours'));
        this.circles.addEventListener('change', () => this._option('data-chem-aromatic', this.circles.checked ? 'circles' : null, 'Aromatic rings'));
    }

    _typed() {
        const el = this.el; if (!el || !this.deck.doc.contains(el)) return;
        if (!this.pending || this.pending.el !== el) this.pending = { el, html: el.innerHTML, smiles: smilesOf(el) };
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this._draw(el, this.box.value.trim()), 150);
    }

    async _draw(el, smiles) {
        const n = ++this.seq;
        try {
            const { svg, formula } = await smilesToSvg(smiles, optsOf(el));
            if (n !== this.seq || !this.deck.doc.contains(el)) return;
            this.deck.withoutTransitions(() => { el.innerHTML = svg; uprightLabels(el); });
            this._error(''); this._formula(formula);
        } catch (err) {
            if (n === this.seq) this._error(err.message);
        }
    }

    _error(msg) {
        this.err.hidden = !msg;
        this.err.textContent = msg ? 'Not drawn: ' + msg + '. The slide shows the last one that worked.' : '';
    }
    _formula(f) { this.formula.textContent = f ? 'Formula: ' + f : ''; }

    async commit() {
        const p = this.pending, el = this.el;
        this.pending = null;          // claimed now: leaving the box while this one draws must not record it twice
        if (!p || p.el !== el || !el || !this.deck.doc.contains(el)) return;
        clearTimeout(this.timer);
        const smiles = this.box.value.trim();
        const drawn = el.querySelector(':scope > svg');
        if (smiles !== p.smiles || !drawn || drawn.getAttribute('data-key') !== chemKey(smiles, optsOf(el))) {   // the drawing shows what the field says
            try { const r = await smilesToSvg(smiles, optsOf(el)); el.innerHTML = r.svg; uprightLabels(el); this._error(''); this._formula(r.formula); }
            catch (err) { this._error(err.message); }
        }
        if (smiles === p.smiles && el.innerHTML === p.html) return;
        this.history.begin('Edit structure');
        if (smiles !== p.smiles) this.history.attr(el, 'data-chem', smiles, 'Edit structure');
        if (el.innerHTML !== p.html) this.history.html(el, p.html, el.innerHTML, 'Edit structure');
        this.history.end();
        this.app.selection.refresh();
    }

    /* An option attribute (colours, circles) and the drawing it gives: one undo step. */
    async _option(name, value, label) {
        const el = this.el; if (!el) return;
        const before = el.innerHTML, was = el.getAttribute(name);
        let r;
        el.toggleAttribute(name, value != null); if (value != null) el.setAttribute(name, value);
        try { r = await smilesToSvg(smilesOf(el), optsOf(el)); }
        catch (err) { this._error(err.message); r = null; }
        if (was == null) el.removeAttribute(name); else el.setAttribute(name, was);   // back, so history records the change
        if (!r) { this.sync(el); return; }
        this.history.begin(label);
        this.history.attr(el, name, value, label);
        el.innerHTML = r.svg;
        uprightLabels(el);
        this.history.html(el, before, el.innerHTML, label);
        this.history.end();
    }

    focus() { this.box.focus(); this.box.select(); }

    async sync(el) {
        const c = el && isChem(el) ? el : null;
        if (this.el && this.el !== c && this.pending) this.commit();
        this.el = c;
        this.root.hidden = !c;
        if (!c) return;
        this.colours.checked = coloursOn(c);
        this.circles.checked = optsOf(c).circles;
        if (document.activeElement !== this.box) {
            this.box.value = smilesOf(c); this._error('');
            const n = ++this.seq;
            try { const { formula } = await smilesToSvg(smilesOf(c), optsOf(c)); if (n === this.seq) this._formula(formula); }
            catch (err) { if (n === this.seq) { this._formula(''); this._error(err.message); } }
        }
    }
}
