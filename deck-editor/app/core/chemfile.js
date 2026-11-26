/* ============================================================
   chemfile.js - chemical structure files read into atoms and bonds.

   Molfile (V2000 and V3000), the first record of an SDF, and
   ChemDraw's CDXML (its XML format; the binary .cdx is not read)
   become one model: atoms with their own 2D coordinates (the
   chemist's layout, which is why a file is pasted rather than its
   SMILES), bonds with their order and stereo display, and for CDXML
   the reaction arrows and text captions on the page. molsvg.js
   draws the model; this file also works out what it is: the
   molecular formula (Hill order) and a SMILES without stereo, for
   the panel, the alt text and the drawing of a file that has no 2D
   coordinates (chem.js).

   Implicit hydrogens follow the usual valences (C 4, N 3, O 2, S 2/4/6,
   P 3/5, B 3, halogens 1, shifted by a charge), unless the file says
   (a V2000 valence field, V3000 VAL=, CDXML NumHydrogens). A
   ChemDraw abbreviation (OMe, Ph, Boc) is drawn as its label; for the
   formula and the SMILES it is expanded from the fragment ChemDraw
   keeps inside the node, else from a short table of common groups;
   an R group or an unknown label leaves the formula unknown.
   Nothing here touches the page: pure functions over strings.
   ============================================================ */

export const FORMATS = {
    molfile: { type: 'chemical/x-mdl-molfile', name: 'Molfile' },
    cdxml: { type: 'chemical/x-cdxml', name: 'CDXML' },
};
/* The file extensions read as structures (a drop, Insert > Chemical structure from file). */
export const CHEM_EXT = { mol: 'molfile', mdl: 'molfile', sdf: 'molfile', sd: 'molfile', cdxml: 'cdxml' };

/* What a text is: 'cdxml', 'molfile' or 'smiles' (anything else, one line). */
export function sniff(text) {
    const t = String(text || '');
    if (/<CDXML[\s>]/.test(t.slice(0, 4000))) return 'cdxml';
    if (/^M {2}END\b/m.test(t) || /\n.*V[23]000\s*(\n|$)/.test(t)) return 'molfile';
    return 'smiles';
}

const SYMBOLS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe '
    + 'Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr '
    + 'Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' ');
const IS_ELEMENT = new Set(SYMBOLS);
export const elementOf = (n) => SYMBOLS[n - 1] || null;

/* ------------------------------------------------------------
   Molfile and SDF
   ------------------------------------------------------------ */
const BOND_V2000 = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 1, 6: 1, 7: 2, 8: 1, 9: 0, 10: 0 };
const CHARGE_V2000 = { 1: 3, 2: 2, 3: 1, 5: -1, 6: -2, 7: -3 };

export function parseMolfile(text) {
    let src = String(text || '').replace(/\r\n?/g, '\n');
    const end = src.search(/^\$\$\$\$/m);                  // an SDF: its first record
    if (end >= 0) src = src.slice(0, end);
    const lines = src.split('\n');
    let c = lines.findIndex(l => /V[23]000\s*$/.test(l));
    if (c < 0) c = lines.findIndex((l, i) => i >= 3 && /^\s*\d+\s+\d+(\s|$)/.test(l) && /^[\s\d]{6}/.test(l));
    if (c < 0) throw new Error('not a Molfile (no counts line)');
    const header = { name: (lines[c - 3] || '').trim(), dim: (lines[c - 2] || '').slice(20, 22).toUpperCase() };
    const mol = /V3000\s*$/.test(lines[c]) ? v3000(lines, c) : v2000(lines, c);
    mol.name = header.name;
    mol.dim = header.dim;
    mol.format = 'molfile';
    return finish(mol);
}

function num(s) { const v = parseFloat(s); return Number.isFinite(v) ? v : NaN; }

function v2000(lines, c) {
    const counts = lines[c];
    const na = parseInt(counts.slice(0, 3), 10), nb = parseInt(counts.slice(3, 6), 10);
    if (!(na >= 0) || !(nb >= 0)) throw new Error('the counts line does not read');
    const atoms = [], bonds = [];
    for (let i = 0; i < na; i++) {
        const l = lines[c + 1 + i];
        if (l == null) throw new Error(`the file stops in the atom block (atom ${i + 1} of ${na})`);
        let x = num(l.slice(0, 10)), y = num(l.slice(10, 20)), z = num(l.slice(20, 30)), sym = l.slice(31, 34).trim(), rest = l.slice(34);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !sym) {         // not in columns: by spaces
            const p = l.trim().split(/\s+/);
            [x, y, z] = [num(p[0]), num(p[1]), num(p[2])]; sym = p[3] || ''; rest = (p[4] || '0').padStart(2) + p.slice(5).map(v => v.padStart(3)).join('');
        }
        if (!Number.isFinite(x) || !Number.isFinite(y) || !sym) throw new Error(`atom ${i + 1} does not read: "${l.trim().slice(0, 40)}"`);
        // After the symbol: dd (2 columns), then ccc, sss, hhh, bbb, vvv (3 each).
        const ccc = parseInt(rest.slice(2, 5), 10) || 0, vvv = parseInt(rest.slice(14, 17), 10) || 0;
        atoms.push(atom(sym, x, y, Number.isFinite(z) ? z : 0, { charge: CHARGE_V2000[ccc] || 0, rad: ccc === 4 ? 1 : 0, valence: vvv === 15 ? 0 : vvv || null }));
    }
    for (let i = 0; i < nb; i++) {
        const l = lines[c + 1 + na + i];
        if (l == null) throw new Error(`the file stops in the bond block (bond ${i + 1} of ${nb})`);
        let a = parseInt(l.slice(0, 3), 10), b = parseInt(l.slice(3, 6), 10), t = parseInt(l.slice(6, 9), 10), s = parseInt(l.slice(9, 12), 10) || 0;
        if (!(a > 0 && b > 0 && t > 0)) { const p = l.trim().split(/\s+/).map(v => parseInt(v, 10)); [a, b, t, s] = [p[0], p[1], p[2], p[3] || 0]; }
        if (!(a > 0 && b > 0 && a <= na && b <= na && t > 0)) throw new Error(`bond ${i + 1} does not read: "${l.trim().slice(0, 40)}"`);
        bonds.push(bond(a - 1, b - 1, BOND_V2000[t] ?? 1, t, (t === 1 || t > 3) ? ({ 1: 'wedge', 4: 'wavy', 6: 'hash' }[s] || null) : null));
    }
    // Properties: charges, isotopes and radicals (which replace the atom block's), aliases.
    let chgSeen = false;
    for (let i = c + 1 + na + nb; i < lines.length; i++) {
        const l = lines[i];
        if (/^M {2}END/.test(l)) break;
        const m = /^M {2}(CHG|ISO|RAD)\s*(\d+)(.*)$/.exec(l);
        if (m) {
            if ((m[1] === 'CHG' || m[1] === 'RAD') && !chgSeen) { chgSeen = true; atoms.forEach(at => { at.charge = 0; at.rad = 0; }); }
            const p = m[3].trim().split(/\s+/).map(v => parseInt(v, 10));
            for (let k = 0; k + 1 < p.length; k += 2) {
                const at = atoms[p[k] - 1]; if (!at) continue;
                if (m[1] === 'CHG') at.charge = p[k + 1];
                else if (m[1] === 'ISO') at.iso = p[k + 1];
                else at.rad = p[k + 1] === 2 ? 1 : p[k + 1] ? 2 : 0;
            }
            continue;
        }
        const a = /^A {2}\s*(\d+)/.exec(l);
        if (a && atoms[+a[1] - 1] && lines[i + 1] != null) { alias(atoms[+a[1] - 1], lines[i + 1].trim()); i++; }
    }
    return { atoms, bonds, arrows: [], texts: [], yDown: false };
}

function v3000(lines, c) {
    // The logical lines of "M  V30 ...", joined where one ends in "-".
    const out = [];
    let buf = null;
    for (let i = c + 1; i < lines.length; i++) {
        const l = lines[i];
        if (/^M {2}END/.test(l)) break;
        const m = /^M {2}V30 ?(.*)$/.exec(l);
        if (!m) continue;
        let s = m[1];
        const more = /-\s*$/.test(s);
        if (more) s = s.replace(/-\s*$/, '');
        buf = buf == null ? s : buf + s;
        if (!more) { out.push(buf.trim()); buf = null; }
    }
    const atoms = [], bonds = [], index = new Map();
    let block = '';
    for (const l of out) {
        const b = /^(BEGIN|END)\s+(\w+)/i.exec(l);
        if (b) { block = b[1].toUpperCase() === 'BEGIN' ? b[2].toUpperCase() : ''; continue; }
        const p = tokens(l);
        if (block === 'ATOM') {
            const [idx, type, x, y, z] = p;
            const opts = kv(p.slice(6));
            if (!Number.isFinite(num(x)) || !Number.isFinite(num(y))) throw new Error(`atom ${idx} does not read: "${l.slice(0, 40)}"`);
            const at = atom(type.replace(/^"|"$/g, ''), num(x), num(y), num(z) || 0, {
                charge: parseInt(opts.CHG, 10) || 0, iso: parseInt(opts.MASS, 10) || 0,
                rad: opts.RAD === '2' ? 1 : opts.RAD ? 2 : 0,
                valence: opts.VAL == null ? null : opts.VAL === '-1' ? 0 : parseInt(opts.VAL, 10) || null,
            });
            index.set(idx, atoms.length);
            atoms.push(at);
        } else if (block === 'BOND') {
            const [idx, type, a1, a2] = p;
            const opts = kv(p.slice(4));
            const a = index.get(a1), b2 = index.get(a2), t = parseInt(type, 10);
            if (a == null || b2 == null || !(t > 0)) throw new Error(`bond ${idx} does not read: "${l.slice(0, 40)}"`);
            const cfg = parseInt(opts.CFG, 10) || 0;
            bonds.push(bond(a, b2, BOND_V2000[t] ?? 1, t, t === 1 || t > 3 ? ({ 1: 'wedge', 2: 'wavy', 3: 'hash' }[cfg] || null) : null));
        }
    }
    if (!atoms.length && !out.some(l => /^COUNTS/i.test(l))) throw new Error('no V3000 connection table');
    return { atoms, bonds, arrows: [], texts: [], yDown: false };
}

/* Space-separated tokens; quoted strings and bracketed lists kept whole. */
function tokens(l) {
    const out = [];
    const re = /"[^"]*"|\S*\([^)]*\)|\S*\[[^\]]*\]|\S+/g;
    let m;
    while ((m = re.exec(l))) out.push(m[0]);
    return out;
}
function kv(list) {
    const o = {};
    for (const t of list) { const i = t.indexOf('='); if (i > 0) o[t.slice(0, i).toUpperCase()] = t.slice(i + 1); }
    return o;
}

function atom(sym, x, y, z, more = {}) {
    let el = sym, iso = more.iso || 0;
    if (el === 'D') { el = 'H'; iso = iso || 2; }
    else if (el === 'T') { el = 'H'; iso = iso || 3; }
    const a = { el, x, y, z, charge: more.charge || 0, iso, rad: more.rad || 0, h: more.h ?? null, valence: more.valence ?? null, label: null, show: false, group: null };
    if (!IS_ELEMENT.has(el)) { a.label = sym; a.group = groupOf(sym); a.el = null; }
    return a;
}
function bond(a, b, order, type = order, stereo = null) {
    return { a, b, order, type, stereo, centre: false };
}
function alias(at, text) {
    if (!text) return;
    const g = groupOf(text);
    if (g && g.el) { at.el = g.el; at.label = null; at.group = null; return; }
    at.label = text; at.group = g; at.el = null;
}

/* ------------------------------------------------------------
   CDXML
   ------------------------------------------------------------ */
const CD_ORDER = { 1: 1, 2: 2, 3: 3, 1.5: 4, 0.5: 0, dative: 0, ionic: 0, hydrogen: 0, any: 1 };

export function parseCdxml(text) {
    if (typeof DOMParser === 'undefined') throw new Error('CDXML needs a browser');
    const doc = new DOMParser().parseFromString(String(text || '').replace(/^﻿/, ''), 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error('not well-formed XML (' + (err.textContent || '').split('\n').map(s => s.trim()).filter(Boolean)[0]?.slice(0, 100) + ')');
    const root = doc.documentElement;
    if (!root || root.nodeName !== 'CDXML') throw new Error('not a ChemDraw CDXML file');
    const atoms = [], bonds = [], arrows = [], texts = [], byId = new Map();
    const kids = (el, name) => Array.from(el.children).filter(n => n.nodeName === name);
    const pos = (el) => {
        const p = (el.getAttribute('p') || el.getAttribute('xyz') || '').trim().split(/\s+/).map(Number);
        return p.length >= 2 && p.every(Number.isFinite) ? p : null;
    };
    // Every fragment not inside a node (those are an abbreviation's own atoms), however deep in groups.
    const frags = Array.from(doc.getElementsByTagName('fragment')).filter(f => !(f.parentElement && f.parentElement.nodeName === 'n'));
    for (const f of frags) {
        for (const n of kids(f, 'n')) {
            const p = pos(n);
            if (!p) continue;
            const type = n.getAttribute('NodeType') || 'Element';
            if (type === 'ExternalConnectionPoint') continue;
            const t = kids(n, 't')[0];
            const label = t ? textOf(t) : '';
            let a;
            if (type === 'Element' || (type === 'Unspecified' && !label)) {
                const el = elementOf(parseInt(n.getAttribute('Element') || '6', 10)) || 'C';
                a = atom(el, p[0], p[1], 0, { charge: parseInt(n.getAttribute('Charge'), 10) || 0, iso: parseInt(n.getAttribute('Isotope'), 10) || 0 });
                const h = n.getAttribute('NumHydrogens');
                if (h != null && h !== '') a.h = parseInt(h, 10) || 0;
                const rad = n.getAttribute('Radical');
                if (rad && rad !== 'None') a.rad = /Doublet/i.test(rad) ? 1 : 2;
                if (t && el === 'C') a.show = true;                        // a carbon labelled by hand (CH3)
            } else {
                a = atom('*', p[0], p[1], 0);
                a.label = label || n.getAttribute('GenericNickname') || '?';
                a.runs = t ? runsOf(t) : null;
                a.cdText = t ? textBox(t, p) : null;
                a.group = innerGroup(n) || groupOf(a.label);
            }
            byId.set(n.getAttribute('id'), atoms.length);
            atoms.push(a);
        }
        for (const b of kids(f, 'b')) {
            const a1 = byId.get(b.getAttribute('B')), a2 = byId.get(b.getAttribute('E'));
            if (a1 == null || a2 == null) continue;
            const ord = (b.getAttribute('Order') || '1').split(/\s+/)[0];
            const d = b.getAttribute('Display') || '';
            let stereo = null, from = a1, to = a2;
            if (/^Wedge(Begin|End)$/.test(d)) stereo = 'wedge';
            else if (/^WedgedHash(Begin|End)$/.test(d)) stereo = 'hash';
            else if (/^HollowWedge(Begin|End)$/.test(d)) stereo = 'hollow';
            else if (/^Wavy/.test(d)) stereo = 'wavy';
            else if (d === 'Bold') stereo = 'bold';
            else if (d === 'Hash') stereo = 'hashed';
            else if (d === 'Dash') stereo = 'dash';
            if (/End$/.test(d)) [from, to] = [a2, a1];                      // the narrow end is the bond's end
            const o = CD_ORDER[ord] ?? 1;
            const bd = bond(from, to, o, ord, stereo);
            if (ord === 'hydrogen') bd.stereo = 'dash';
            if (b.getAttribute('DoublePosition') === 'Center') bd.centre = true;
            bonds.push(bd);
        }
    }
    // Reaction arrows: <arrow> (ChemDraw 13 on), else the older <graphic> line it supersedes.
    for (const ar of doc.getElementsByTagName('arrow')) {
        const h = (ar.getAttribute('Head3D') || '').split(/\s+/).map(Number), tl = (ar.getAttribute('Tail3D') || '').split(/\s+/).map(Number);
        if (h.length < 2 || tl.length < 2 || ![...h.slice(0, 2), ...tl.slice(0, 2)].every(Number.isFinite)) continue;
        arrows.push({ x1: tl[0], y1: tl[1], x2: h[0], y2: h[1], head: arrowHead(ar.getAttribute('ArrowheadHead')), tail: arrowHead(ar.getAttribute('ArrowheadTail')),
            twin: parseFloat(ar.getAttribute('ArrowShaftSpacing')) > 0 ? parseFloat(ar.getAttribute('ArrowShaftSpacing')) : 0, hollow: ar.getAttribute('ArrowheadType') === 'Hollow', nogo: !!ar.getAttribute('NoGo') });
    }
    for (const g of doc.getElementsByTagName('graphic')) {
        if (g.getAttribute('SupersededBy') || g.getAttribute('GraphicType') !== 'Line') continue;
        const bb = (g.getAttribute('BoundingBox') || '').split(/\s+/).map(Number);
        if (bb.length < 4 || !bb.every(Number.isFinite)) continue;
        const kind = g.getAttribute('ArrowType') || '';
        arrows.push({ x1: bb[2], y1: bb[3], x2: bb[0], y2: bb[1], head: /Head|Resonance|RetroSynthetic|Equilibrium/.test(kind) ? (/Half/.test(kind) || /Equilibrium/.test(kind) ? 'half-left' : 'full') : null,
            tail: /Resonance/.test(kind) ? 'full' : /Equilibrium/.test(kind) ? 'half-left' : null, twin: /Equilibrium/.test(kind) ? 4 : 0 });
    }
    // Captions: text on the page, not an atom's label.
    for (const t of doc.getElementsByTagName('t')) {
        if (t.parentElement && t.parentElement.nodeName === 'n') continue;
        const p = pos(t);
        const s = textOf(t);
        if (!p || !s.trim()) continue;
        texts.push({ ...textBox(t, p), lines: linesOf(t) });
    }
    if (!atoms.length && !arrows.length && !texts.length) throw new Error('no structure in this CDXML');
    return finish({ atoms, bonds, arrows, texts, yDown: true, format: 'cdxml', dim: '2D' });
}

function arrowHead(v) {
    if (!v || v === 'None') return null;
    return /HalfLeft/.test(v) ? 'half-left' : /HalfRight/.test(v) ? 'half-right' : 'full';
}
function textOf(t) { return Array.from(t.getElementsByTagName('s')).map(s => s.textContent).join('') || t.textContent || ''; }
/* The label's runs: its text and the ChemDraw face (32 subscript, 64 superscript, 1 bold, 2 italic). */
function runsOf(t) {
    const ss = Array.from(t.getElementsByTagName('s'));
    if (!ss.length) return [{ text: t.textContent || '', face: 0 }];
    return ss.map(s => ({ text: s.textContent || '', face: parseInt(s.getAttribute('face'), 10) || 0, size: parseFloat(s.getAttribute('size')) || 0 }));
}
function linesOf(t) {
    // A caption's lines, each a list of runs: ChemDraw breaks lines with "\n" inside the runs.
    const lines = [[]];
    for (const r of runsOf(t)) {
        const parts = r.text.split(/\r\n|\r|\n/);
        parts.forEach((p, i) => { if (i) lines.push([]); if (p) lines[lines.length - 1].push({ ...r, text: p }); });
    }
    return lines;
}
/* Where ChemDraw put a text: its origin (the baseline start, or end / middle by its justification) and its size. */
function textBox(t, p) {
    const tp = (t.getAttribute('p') || '').trim().split(/\s+/).map(Number);
    const at = tp.length >= 2 && tp.every(Number.isFinite) ? tp : p;
    const just = (t.getAttribute('Justification') || t.getAttribute('LabelJustification') || 'Left');
    const size = Math.max(...runsOf(t).map(r => r.size || 0), 0) || 10;
    const lh = parseFloat(t.getAttribute('LineHeight'));
    return { x: at[0], y: at[1], anchor: /Right/.test(just) ? 'end' : /Center/.test(just) ? 'middle' : 'start', size, lineHeight: Number.isFinite(lh) && lh > 0 ? lh : size * 1.2 };
}

/* An abbreviation node's own atoms (ChemDraw keeps them in a fragment inside the node): its formula
   and, with one attachment point, the atoms and bonds to expand it into. */
function innerGroup(n) {
    const f = Array.from(n.children).find(c => c.nodeName === 'fragment');
    if (!f) return null;
    const inner = [], ids = new Map(), ext = [];
    for (const m of Array.from(f.children).filter(c => c.nodeName === 'n')) {
        const type = m.getAttribute('NodeType') || 'Element';
        if (type === 'ExternalConnectionPoint') { ext.push(m.getAttribute('id')); continue; }
        if (type !== 'Element') return null;                 // nested abbreviations: not worked out
        const a = atom(elementOf(parseInt(m.getAttribute('Element') || '6', 10)) || 'C', 0, 0, 0, { charge: parseInt(m.getAttribute('Charge'), 10) || 0, iso: parseInt(m.getAttribute('Isotope'), 10) || 0 });
        const h = m.getAttribute('NumHydrogens');
        if (h != null && h !== '') a.h = parseInt(h, 10) || 0;
        ids.set(m.getAttribute('id'), inner.length);
        inner.push(a);
    }
    const bonds = [], attach = [];
    for (const b of Array.from(f.children).filter(c => c.nodeName === 'b')) {
        const B = b.getAttribute('B'), E = b.getAttribute('E');
        const o = CD_ORDER[(b.getAttribute('Order') || '1').split(/\s+/)[0]] ?? 1;
        if (ext.includes(B) || ext.includes(E)) { const k = ids.get(ext.includes(B) ? E : B); if (k != null) attach.push({ atom: k, order: o }); continue; }
        if (ids.has(B) && ids.has(E)) bonds.push(bond(ids.get(B), ids.get(E), o));
    }
    if (!inner.length) return null;
    return { atoms: inner, bonds, attach };
}

/* Common abbreviations, as SMILES written from the attachment atom (the first atom). */
const GROUPS = {
    Me: 'C', Et: 'CC', Pr: 'CCC', nPr: 'CCC', iPr: 'C(C)C', Bu: 'CCCC', nBu: 'CCCC', iBu: 'CC(C)C', sBu: 'C(C)CC', tBu: 'C(C)(C)C', Pent: 'CCCCC', Hex: 'CCCCCC',
    Cy: 'C1CCCCC1', Ph: 'C1=CC=CC=C1', Bn: 'CC1=CC=CC=C1', Bz: 'C(=O)C1=CC=CC=C1', Tol: 'C1=CC=C(C)C=C1', Mes: 'C1=C(C)C=C(C)C=C1C', PMB: 'CC1=CC=C(OC)C=C1',
    Ac: 'C(C)=O', OAc: 'OC(C)=O', AcO: 'OC(C)=O', OMe: 'OC', MeO: 'OC', OEt: 'OCC', EtO: 'OCC', OPh: 'OC1=CC=CC=C1', PhO: 'OC1=CC=CC=C1', OBn: 'OCC1=CC=CC=C1', BnO: 'OCC1=CC=CC=C1',
    OH: 'O', HO: 'O', SH: 'S', HS: 'S', SMe: 'SC', MeS: 'SC', NH2: 'N', H2N: 'N', NHMe: 'NC', MeHN: 'NC', NMe2: 'N(C)C', Me2N: 'N(C)C', NHAc: 'NC(C)=O', AcHN: 'NC(C)=O',
    CN: 'C#N', NC: 'C#N', NO2: 'N(=O)=O', O2N: 'N(=O)=O', CF3: 'C(F)(F)F', F3C: 'C(F)(F)F', CCl3: 'C(Cl)(Cl)Cl',
    CHO: 'C=O', OHC: 'C=O', CO2H: 'C(=O)O', HO2C: 'C(=O)O', COOH: 'C(=O)O', HOOC: 'C(=O)O', CO2Me: 'C(=O)OC', MeO2C: 'C(=O)OC', CO2Et: 'C(=O)OCC', EtO2C: 'C(=O)OCC',
    CONH2: 'C(N)=O', H2NOC: 'C(N)=O', Boc: 'C(=O)OC(C)(C)C', NHBoc: 'NC(=O)OC(C)(C)C', BocHN: 'NC(=O)OC(C)(C)C', Cbz: 'C(=O)OCC1=CC=CC=C1', Fmoc: 'C(=O)OCC1C2=CC=CC=C2C2=CC=CC=C12',
    Piv: 'C(=O)C(C)(C)C', Ts: 'S(=O)(=O)C1=CC=C(C)C=C1', OTs: 'OS(=O)(=O)C1=CC=C(C)C=C1', TsO: 'OS(=O)(=O)C1=CC=C(C)C=C1', Ms: 'S(C)(=O)=O', OMs: 'OS(C)(=O)=O', MsO: 'OS(C)(=O)=O',
    Tf: 'S(=O)(=O)C(F)(F)F', OTf: 'OS(=O)(=O)C(F)(F)F', TfO: 'OS(=O)(=O)C(F)(F)F', TMS: '[Si](C)(C)C', TBS: '[Si](C)(C)C(C)(C)C', TBDMS: '[Si](C)(C)C(C)(C)C', OTBS: 'O[Si](C)(C)C(C)(C)C', TBSO: 'O[Si](C)(C)C(C)(C)C',
    TIPS: '[Si](C(C)C)(C(C)C)C(C)C', TES: '[Si](CC)(CC)CC', Bpin: 'B1OC(C)(C)C(C)(C)O1', SO3H: 'S(=O)(=O)O', SO2Me: 'S(C)(=O)=O', COMe: 'C(C)=O', COCl: 'C(Cl)=O', N3: 'N=[N+]=[N-]',
};
const groupCache = new Map();
/* A label read as a group: { atoms, bonds, attach } from the table, or { el } when it is an element symbol, or null. */
function groupOf(label) {
    const key = String(label || '').replace(/[\s()]/g, '').replace(/[₀-₉]/g, d => String(d.charCodeAt(0) - 0x2080));
    if (IS_ELEMENT.has(key)) return { el: key };
    if (!GROUPS[key]) return null;
    if (!groupCache.has(key)) groupCache.set(key, readSmiles(GROUPS[key]));
    return groupCache.get(key);
}
/* The small SMILES of the table above, read into atoms and bonds; atom 0 attaches. */
function readSmiles(s) {
    const atoms = [], bonds = [], stack = [], rings = {};
    let prev = -1, order = 1;
    const re = /\[([A-Z][a-z]?)\]|Cl|Br|[BCNOSPFI]|[=#()]|\d|\[N\+\]|\[N-\]/g;
    let m;
    while ((m = re.exec(s))) {
        const t = m[0];
        if (t === '(') { stack.push(prev); continue; }
        if (t === ')') { prev = stack.pop(); continue; }
        if (t === '=') { order = 2; continue; }
        if (t === '#') { order = 3; continue; }
        if (/^\d$/.test(t)) {
            if (rings[t] != null) { bonds.push(bond(rings[t].a, prev, Math.max(order, rings[t].o))); delete rings[t]; }
            else rings[t] = { a: prev, o: order };
            order = 1; continue;
        }
        const charge = t === '[N+]' ? 1 : t === '[N-]' ? -1 : 0;
        const el = m[1] || (charge ? 'N' : t);
        atoms.push(atom(el, 0, 0, 0, { charge, h: m[1] || charge ? 0 : null }));
        if (m[1] === 'Si' || m[1] === 'B') atoms[atoms.length - 1].h = null;
        if (prev >= 0) bonds.push(bond(prev, atoms.length - 1, order));
        prev = atoms.length - 1; order = 1;
    }
    return { atoms, bonds, attach: [{ atom: 0, order: 1 }] };
}

/* ------------------------------------------------------------
   The model, finished: neighbours, aromatic bonds given places for
   their double bonds, implicit hydrogens.
   ------------------------------------------------------------ */
function finish(mol) {
    mol.atoms.forEach((a, i) => { a.i = i; });
    kekulize(mol.atoms, mol.bonds);
    implicitH(mol.atoms, mol.bonds);
    return mol;
}

/* Aromatic bonds (order 4) get alternating single and double bonds where a perfect matching of
   the atoms that need one exists; the ones left stay aromatic (drawn with a dashed inner line). */
function kekulize(atoms, bonds) {
    const arom = bonds.filter(b => b.order === 4);
    if (!arom.length) return;
    const deg = atoms.map(() => 0), sum = atoms.map(() => 0);
    for (const b of bonds) { for (const k of [b.a, b.b]) { deg[k]++; sum[k] += b.order === 4 ? 1 : b.order; } }
    const need = atoms.map((a, i) => {
        if (!arom.some(b => b.a === i || b.b === i) || !a.el) return false;
        const v = valences(a)[0];
        if (v == null) return false;
        const h = a.h != null ? a.h : 0;
        return v - sum[i] - h >= 1 && !(a.el === 'N' && deg[i] === 3) && !(['O', 'S', 'Se'].includes(a.el) && !a.charge);
    });
    const opts = atoms.map(() => []);
    arom.forEach((b) => { if (need[b.a] && need[b.b]) { opts[b.a].push(b); opts[b.b].push(b); } });
    const mate = new Map();
    let steps = 0;
    const solve = (soft) => {
        if (++steps > 20000) return false;
        let best = -1, bestN = Infinity;
        for (let i = 0; i < atoms.length; i++) {
            if (!need[i] || mate.has(i) || soft.has(i)) continue;
            const n = opts[i].filter(b => !mate.has(b.a === i ? b.b : b.a)).length;
            if (n < bestN) { best = i; bestN = n; }
        }
        if (best < 0) return true;
        for (const b of opts[best]) {
            const j = b.a === best ? b.b : b.a;
            if (mate.has(j) || soft.has(j)) continue;
            mate.set(best, b); mate.set(j, b);
            if (solve(soft)) return true;
            mate.delete(best); mate.delete(j);
        }
        return false;
    };
    // A pyrrole-type N given as two aromatic bonds and no H: let it go without a double bond if need be.
    const soft = new Set();
    let ok = solve(soft);
    if (!ok) {
        for (let i = 0; i < atoms.length && !ok; i++) if (need[i] && atoms[i].el !== 'C') { mate.clear(); steps = 0; soft.add(i); ok = solve(soft); if (!ok) soft.delete(i); }
    }
    if (!ok) return;
    for (const b of arom) b.order = [...mate.values()].includes(b) ? 2 : 1;
    for (const i of soft) if (atoms[i].h == null && atoms[i].el === 'N') atoms[i].h = 1;
}

/* The valences an atom can have, lowest first, its charge taken into account. */
function valences(a) {
    const c = a.charge || 0;
    switch (a.el) {
        case 'H': return c ? [0] : [1];
        case 'B': return [3 - Math.abs(c) + (c < 0 ? 2 : 0)];
        case 'C': case 'Si': case 'Ge': return [4 - Math.abs(c)];
        case 'N': case 'P': case 'As': return c > 0 ? [4] : c < 0 ? [2] : a.el === 'N' ? [3] : [3, 5];
        case 'O': return c > 0 ? [3] : c < 0 ? [1] : [2];
        case 'S': case 'Se': case 'Te': return c > 0 ? [3, 5] : c < 0 ? [1] : [2, 4, 6];
        case 'F': return c ? [0] : [1];
        case 'Cl': case 'Br': case 'I': return c ? [0] : [1, 3, 5, 7];
        default: return [null];
    }
}

function implicitH(atoms, bonds) {
    const sum = atoms.map(() => 0);
    for (const b of bonds) { const o = b.order === 4 ? 1.5 : b.order; sum[b.a] += o; sum[b.b] += o; }
    atoms.forEach((a, i) => {
        if (a.h != null) { a.hImpl = a.h; return; }
        if (!a.el) { a.hImpl = 0; return; }
        const s = Math.ceil(sum[i] - 1e-6) + (a.rad || 0);
        if (a.valence != null) { a.hImpl = Math.max(0, a.valence - s); return; }
        const vs = valences(a);
        if (vs[0] == null) { a.hImpl = 0; return; }
        const v = vs.find(x => x >= s);
        a.hImpl = v == null ? 0 : v - s;
    });
}

/* ------------------------------------------------------------
   What it is: formula and SMILES
   ------------------------------------------------------------ */
/* The graph with each abbreviation expanded into its atoms: { atoms, bonds, unknown } (unknown: a
   label that could not be expanded). */
export function expanded(mol) {
    const atoms = [], bonds = [], map = new Map();
    let unknown = '';
    mol.atoms.forEach((a, i) => {
        if (a.el) { map.set(i, atoms.length); atoms.push(a); return; }
        const g = a.group;
        if (!g || !g.atoms) { unknown = unknown || a.label || '?'; map.set(i, null); return; }
        const base = atoms.length;
        g.atoms.forEach(x => atoms.push({ ...x }));
        g.bonds.forEach(b => bonds.push({ ...b, a: b.a + base, b: b.b + base }));
        map.set(i, { base, attach: g.attach || [] });
    });
    const used = new Map();
    for (const b of mol.bonds) {
        const end = (k) => {
            const m = map.get(k);
            if (m == null) return null;
            if (typeof m === 'number') return m;
            const n = used.get(k) || 0; used.set(k, n + 1);
            const at = m.attach[n] || m.attach[0];
            return at ? m.base + at.atom : null;
        };
        const a = end(b.a), c = end(b.b);
        if (a == null || c == null) continue;
        bonds.push({ ...b, a, b: c });
    }
    // Implicit hydrogens for the atoms an abbreviation brought in (the drawn ones already have theirs).
    const fresh = atoms.filter(a => a.hImpl == null);
    if (fresh.length) {
        const copy = atoms.map(a => ({ ...a }));
        implicitH(copy, bonds);
        atoms.forEach((a, i) => { if (a.hImpl == null) atoms[i] = { ...a, hImpl: copy[i].hImpl }; });
    }
    return { atoms, bonds, unknown };
}

/* The molecular formula in Hill order (C, H, then the others alphabetically; alphabetical without
   carbon), or '' when an abbreviation or R group leaves it unknown. */
export function formulaOf(mol) {
    const g = expanded(mol);
    if (g.unknown || !g.atoms.length) return '';
    const n = {};
    for (const a of g.atoms) {
        n[a.el] = (n[a.el] || 0) + 1;
        if (a.hImpl) n.H = (n.H || 0) + a.hImpl;
    }
    const keys = Object.keys(n).sort();
    const order = n.C ? ['C', ...(n.H ? ['H'] : []), ...keys.filter(k => k !== 'C' && k !== 'H')] : keys;
    return order.map(k => k + (n[k] > 1 ? n[k] : '')).join('');
}

const ORGANIC = new Set(['B', 'C', 'N', 'O', 'P', 'S', 'F', 'Cl', 'Br', 'I']);
/* A SMILES of the molecule, without stereo: the bonds as drawn (Kekulé), components joined by '.'.
   '' when it cannot be written (an R group, an unknown label). */
export function molSmiles(mol) {
    const g = expanded(mol);
    if (g.unknown || !g.atoms.length) return '';
    const { atoms, bonds } = g;
    const adj = atoms.map(() => []);
    bonds.forEach((b, k) => { if (b.order >= 1) { adj[b.a].push(k); adj[b.b].push(k); } });
    const sumOf = atoms.map(() => 0);
    bonds.forEach(b => { if (b.order >= 1) { const o = b.order === 4 ? 1.5 : b.order; sumOf[b.a] += o; sumOf[b.b] += o; } });
    const atomText = (i) => {
        const a = atoms[i], h = a.hImpl || 0;
        if (ORGANIC.has(a.el) && !a.charge && !a.iso && !a.rad) {
            // Written bare when a SMILES reader would give it the same hydrogens.
            const s = Math.ceil(sumOf[i] - 1e-6), v = valences({ el: a.el, charge: 0 }).find(x => x >= s);
            if ((v == null ? 0 : v - s) === h) return a.el;
        }
        const c = a.charge ? (a.charge > 0 ? '+' : '-') + (Math.abs(a.charge) > 1 ? Math.abs(a.charge) : '') : '';
        return '[' + (a.iso || '') + a.el + (h ? 'H' + (h > 1 ? h : '') : '') + c + ']';
    };
    const sym = (b) => b.order === 2 ? '=' : b.order === 3 ? '#' : b.order === 4 ? ':' : '';
    // A depth-first tree; the bonds it does not take are ring closures, opened at the atom met first.
    const pre = new Array(atoms.length).fill(-1), kids = atoms.map(() => []), tree = new Array(bonds.length).fill(false);
    let n = 0;
    const visit = (i) => {
        pre[i] = n++;
        for (const k of adj[i]) {
            const j = other(bonds[k], i);
            if (pre[j] >= 0) continue;
            tree[k] = true; kids[i].push({ atom: j, bond: k });
            visit(j);
        }
    };
    const digitOf = new Map(), busy = new Set();
    const write = (i) => {
        let s = atomText(i);
        const freed = [];
        const ring = adj[i].filter(k => !tree[k]).map(k => ({ k, j: other(bonds[k], i) })).sort((p, q) => pre[p.j] - pre[q.j]);
        for (const { k, j } of ring) {
            if (pre[j] < pre[i]) { const d = digitOf.get(k); if (d != null) { s += dig(d); freed.push(d); } }
        }
        for (const { k, j } of ring) {
            if (pre[j] > pre[i]) {
                let d = 1; while (busy.has(d) || freed.includes(d)) d++;
                busy.add(d); digitOf.set(k, d);
                s += sym(bonds[k]) + dig(d);
            }
        }
        freed.forEach(d => busy.delete(d));
        kids[i].forEach((c, m) => {
            const part = sym(bonds[c.bond]) + write(c.atom);
            s += m < kids[i].length - 1 ? '(' + part + ')' : part;
        });
        return s;
    };
    const out = [];
    for (let i = 0; i < atoms.length; i++) {
        if (pre[i] >= 0) continue;
        visit(i);
        out.push(write(i));
    }
    return out.join('.');
}
const other = (b, i) => b.a === i ? b.b : b.a;
const dig = (d) => d < 10 ? String(d) : '%' + d;

/* ------------------------------------------------------------
   Reading a file of either kind
   ------------------------------------------------------------ */
export function parseChem(text, format) {
    if (format === 'cdxml') return parseCdxml(text);
    if (format === 'molfile') return parseMolfile(text);
    throw new Error('unknown structure format ' + format);
}

/* True when the file's coordinates cannot be drawn as they are: all at one point, or in 3D. */
export function needsLayout(mol) {
    const a = mol.atoms;
    if (a.length < 2) return false;
    const span = (k) => Math.max(...a.map(p => p[k])) - Math.min(...a.map(p => p[k]));
    if (span('x') < 1e-4 && span('y') < 1e-4) return true;
    return span('z') > 0.05 * Math.max(span('x'), span('y'), 1e-6);
}

