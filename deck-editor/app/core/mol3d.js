/* ============================================================
   mol3d.js - 3D molecular structures (3Dmol.js).

   A structure is a <figure data-mol3d="FORMAT"> holding the file it
   was made from (an inert <script type="chemical/x-...">, or that
   element naming a file in assets/ when the file is over 1 MB), its
   settings and camera view (data-mol3d-settings, JSON) and a picture
   of the view (<img data-mol3d-picture>, WebP at twice the box's size,
   inline). See app/deck-mol3d.js for the format: the same file reads
   the settings and draws the structure, in the editor for the picture
   and in the deck when it turns while presented.

   While editing, the slide shows the picture, so a click or a drag on
   it is the editor's. Double-click it (or Turn it... in the panel) to
   turn it: a live viewer over it, drag to turn, wheel to zoom; Done
   (Enter, Esc, a click outside) makes that view the picture. Every
   change is one undo step: the settings and the picture together.

   An STL file (a mesh, not atoms: a 3D print, a CAD part, a surface
   exported from ChimeraX) goes the same way as data-mol3d="stl", kept
   as base64 (it is often binary) and drawn as one shape.

   This module has the Insert dialog (by ID from the PDB, AlphaFold or
   PubChem through serve.py, a file, or pasted text), the panel's
   section, turn mode, file drops, and the script tags a deck with a
   turning structure carries (deck-3dmol.min.js and deck-mol3d.js,
   beside the deck, copied there by serve.py on save).
   ============================================================ */
import { loadVendor } from './vendor.js';

export const MOL3D = 'figure[data-mol3d]';
/* The script tags a deck carries when one of its structures turns while presented, in this order. */
export const MOL3D_SCRIPTS = [['deck-3dmol.min.js', 'library'], ['deck-mol3d.js', 'renderer']];
export const FILE_EXT = ['pdb', 'cif', 'mmcif', 'sdf', 'mol', 'mol2', 'xyz', 'pqr', 'stl'];
const INLINE_MAX = 1024 * 1024;              // a larger file goes to assets/
const FILE_MAX = 50 * 1024 * 1024;           // the size the server's fetch and upload take too
const PICTURE_STYLE = 'display:block;width:100%;height:100%;object-fit:contain;';
const WATER = ['HOH', 'WAT', 'DOD', 'H2O', 'SOL'];
// Left hidden when a structure comes in: what crystals are grown in, not what the protein holds.
const ADDITIVES = ['SO4', 'PO4', 'GOL', 'EDO', 'PEG', 'PG4', 'PGE', '1PE', 'P6G', 'ACT', 'ACY', 'FMT', 'DMS', 'MPD', 'TRS', 'EPE', 'MES', 'BME', 'CL', 'BR', 'IOD', 'NA', 'K', 'NO3', 'SCN', 'IMD', 'CIT', 'FLC', 'MLI', 'TAR', 'PE4', 'NH4', 'UNX'];
const LIGAND_NAMES = {
    HEM: 'haem', HEC: 'haem c', HEA: 'haem a', SF4: '[4Fe-4S] cluster', F3S: '[3Fe-4S] cluster', FES: '[2Fe-2S] cluster',
    ZN: 'zinc ion', MG: 'magnesium ion', CA: 'calcium ion', FE: 'iron ion', FE2: 'iron(II) ion', CU: 'copper ion', CU1: 'copper(I) ion',
    MN: 'manganese ion', NI: 'nickel ion', CO: 'cobalt ion', CD: 'cadmium ion', K: 'potassium ion', NA: 'sodium ion', CL: 'chloride ion',
    ATP: 'ATP', ADP: 'ADP', AMP: 'AMP', ANP: 'AMP-PNP', GTP: 'GTP', GDP: 'GDP', NAD: 'NAD', NAP: 'NADP', NDP: 'NADPH', FAD: 'FAD', FMN: 'FMN',
    SAM: 'S-adenosylmethionine', SAH: 'S-adenosylhomocysteine', NAG: 'N-acetylglucosamine', MAN: 'mannose', BMA: 'mannose', GLC: 'glucose',
    OXY: 'oxygen', CLA: 'chlorophyll a', CHL: 'chlorophyll b', BCL: 'bacteriochlorophyll a', PLP: 'pyridoxal phosphate', COA: 'coenzyme A',
    TPP: 'thiamine diphosphate', BTN: 'biotin', RET: 'retinal', SO4: 'sulfate', PO4: 'phosphate', GOL: 'glycerol', EDO: 'ethylene glycol',
    MOO: 'molybdate', MO: 'molybdenum', W: 'tungsten', CUA: 'CuA centre', HEO: 'haem o', CYC: 'phycocyanobilin', LMT: 'dodecyl maltoside',
};
const RESIDUE_NAMES = { CYS: 'Cysteines', HIS: 'Histidines', ASP: 'Aspartates', GLU: 'Glutamates', LYS: 'Lysines', ARG: 'Arginines', TYR: 'Tyrosines', TRP: 'Tryptophans', SER: 'Serines', THR: 'Threonines', MET: 'Methionines', ASN: 'Asparagines', GLN: 'Glutamines', PHE: 'Phenylalanines', GLY: 'Glycines', ALA: 'Alanines', VAL: 'Valines', LEU: 'Leucines', ILE: 'Isoleucines', PRO: 'Prolines' };
const METAL_ELEMENTS = ['Fe', 'Zn', 'Cu', 'Mg', 'Ca', 'Mn', 'Co', 'Ni', 'Mo', 'W', 'Cd', 'Hg', 'Pt', 'FE', 'ZN', 'CU', 'MG', 'CA', 'MN', 'CO', 'NI', 'MO', 'CD', 'HG', 'PT'];

export function isMol3d(el) { return !!el && typeof el.matches === 'function' && el.matches(MOL3D); }
export function mol3dOf(el) { return el && el.closest ? el.closest(MOL3D) : null; }
const pictureOf = (el) => el.querySelector(':scope > img[data-mol3d-picture]');
const holderOf = (el) => el.querySelector(':scope > script[data-mol3d-source]');
const readable = (err) => String(err && err.message || err || 'it could not be drawn').replace(/\s+/g, ' ').slice(0, 220);
const extOf = (name) => { const m = /\.([^.\\/]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; };
const isMesh = (fmt) => fmt === 'stl';
/* Bytes as base64 (an STL file is kept so), in the editor before deck-mol3d.js has loaded. */
function base64(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out);
}
/* A dropped or chosen file as the figure keeps it: its text, or base64 for an STL file. */
async function fileText(f) {
    return extOf(f.name) === 'stl' ? base64(new Uint8Array(await f.arrayBuffer())) : f.text();
}
/* Pasted text of an STL file (the text kind, "solid ... facet ..."), as the figure keeps it. */
const pastedStl = (text) => base64(new TextEncoder().encode(text));

/* ------------------------------------------------------------
   The libraries, in the editor page
   ------------------------------------------------------------ */
let rendererLoading = null;
function loadRenderer() {
    if (!rendererLoading) rendererLoading = new Promise((resolve, reject) => {
        if (window.DeckMol3d) return resolve(window.DeckMol3d);
        const s = document.createElement('script');
        s.src = 'deck-mol3d.js';
        s.onload = () => resolve(window.DeckMol3d);
        s.onerror = () => { rendererLoading = null; reject(new Error('could not load deck-mol3d.js')); };
        document.head.appendChild(s);
    });
    return rendererLoading;
}
export async function loadMol3d() {
    const [$3D, DM] = await Promise.all([loadVendor('3Dmol-min.js', () => window.$3Dmol), loadRenderer()]);
    return { $3D, DM };
}

/* ------------------------------------------------------------
   Reading a structure file
   ------------------------------------------------------------ */
/* The format of a structure file, from its name when there is one, else from its text. */
export function detectFormat(text, name = '') {
    const ext = extOf(name);
    if (ext === 'mmcif') return 'cif';
    if (FILE_EXT.includes(ext)) return ext;
    const t = String(text || '');
    const head = t.slice(0, 4000);
    if (/^\s*solid\b/.test(head) && /\bfacet\s+normal\b/.test(head)) return 'stl';
    if (/^data_/m.test(head) || /^_atom_site\./m.test(t.slice(0, 200000))) return 'cif';
    if (/@<TRIPOS>/.test(head)) return 'mol2';
    if (/^(ATOM  |HETATM|HEADER|CRYST1|MODEL )/m.test(head)) return 'pdb';
    if (/V[23]000/.test(head) || /^M {2}END/m.test(t)) return /\$\$\$\$/.test(t) ? 'sdf' : 'mol';
    const lines = head.split(/\r?\n/);
    if (/^\s*\d+\s*$/.test(lines[0] || '') && /^\s*[A-Z][a-z]?\s+-?\d/.test(lines[2] || '')) return 'xyz';
    return '';
}

/* What is wrong with a file as a 3D structure, in words, or '' when nothing is. */
export function structureProblem(text, fmt) {
    if (!String(text || '').trim()) return 'The file is empty.';
    if ((isMesh(fmt) ? text.length * 3 / 4 : text.length) > FILE_MAX) return `The file is larger than ${FILE_MAX / 1048576} MB, too large for a slide.`;
    if (!fmt) return 'This is not a structure file Diapo reads: give a .pdb, .cif, .sdf, .mol, .mol2, .xyz or .stl file.';
    if (fmt === 'sdf' || fmt === 'mol') {
        // A Molfile's atom lines: x y z element. All z at 0 is a drawing, not a 3D structure.
        const block = text.split(/^M {2}END/m)[0].split(/\r?\n/);
        const atoms = block.filter(l => /^\s*-?\d+\.\d+\s+-?\d+\.\d+\s+-?\d+\.\d+\s+[A-Z][a-z]?\b/.test(l));
        if (atoms.length > 1 && atoms.every(l => Math.abs(parseFloat(l.trim().split(/\s+/)[2])) < 1e-4)) return 'This file is flat: its coordinates are 2D. Insert it as a chemical structure, or give a file with 3D coordinates (PubChem: "3D conformer").';
    }
    return '';
}

/* A value of an mmCIF data item written on one line (or as a ;-block), or ''. */
function cifValue(text, key) {
    const re = new RegExp('^' + key.replace(/\./g, '\\.') + '[ \\t]+(.*)$|^' + key.replace(/\./g, '\\.') + '[ \\t]*\\r?\\n;([\\s\\S]*?)\\r?\\n;', 'm');
    const m = re.exec(text.slice(0, 300000));
    if (!m) return '';
    let v = (m[1] != null ? m[1] : m[2] || '').trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    return v === '?' || v === '.' ? '' : v;
}
/* The rows of an mmCIF loop as objects (only the keys asked for), or [] when it is not a loop. */
function cifLoop(text, category, keys) {
    const at = text.indexOf('\n' + category + '.');
    if (at < 0) return [];
    const before = text.lastIndexOf('loop_', at);
    if (before < 0 || text.slice(before, at).split(/\n/).some(l => l.trim() && !/^(loop_|_)/.test(l.trim()))) {
        // A single row, written as key value pairs.
        const row = {};
        keys.forEach(k => { row[k] = cifValue(text, category + '.' + k); });
        return [row];
    }
    const lines = text.slice(before + 5, before + 5 + 2000000).split(/\r?\n/);
    const names = [];
    let i = 0;
    for (; i < lines.length; i++) {
        const l = lines[i].trim();
        if (!l) continue;
        if (l.startsWith('_')) names.push(l.split(/\s+/)[0].slice(category.length + 1)); else break;
    }
    const body = [];
    for (; i < lines.length; i++) { const l = lines[i]; if (/^(#|loop_|_|data_)/.test(l.trim())) break; body.push(l); }
    const tokens = body.join('\n').match(/'(?:[^']|'(?=\S))*'|"(?:[^"]|"(?=\S))*"|^;[\s\S]*?\n;|\S+/gm) || [];
    const rows = [];
    for (let j = 0; j + names.length <= tokens.length; j += names.length) {
        const row = {};
        names.forEach((n, k) => { let v = tokens[j + k]; if (/^['"]/.test(v)) v = v.slice(1, -1); else if (v[0] === ';') v = v.slice(1, -1).trim(); if (keys.includes(n)) row[n] = v; });
        rows.push(row);
    }
    return rows;
}
const sentence = (s) => { s = String(s || '').trim().replace(/\s+/g, ' '); return /[a-z]/.test(s) ? s : s.toLowerCase(); };
const capital = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/* What a file says about itself: { id, title, organism, names: {RESN: name} }. */
export function fileFacts(text, fmt) {
    const out = { id: '', title: '', organism: '', names: {} };
    if (fmt === 'pdb' || fmt === 'pqr') {
        const title = [];
        let molecule = '';
        for (const l of text.split(/\r?\n/, 4000)) {
            const rec = l.slice(0, 6).trim();
            if (rec === 'ATOM' || rec === 'HETATM') break;
            if (rec === 'HEADER') out.id = l.slice(62, 66).trim();
            else if (rec === 'TITLE') title.push(l.slice(10).trim());
            else if (rec === 'COMPND' && !molecule) { const m = /MOLECULE:\s*(.+?);?\s*$/.exec(l.slice(10)); if (m) molecule = m[1]; }
            else if (rec === 'SOURCE' && !out.organism) { const m = /ORGANISM_SCIENTIFIC:\s*(.+?);?\s*$/.exec(l.slice(10)); if (m) out.organism = m[1]; }
            else if (rec === 'HETNAM') { const code = l.slice(11, 14).trim(); out.names[code] = ((out.names[code] || '') + ' ' + l.slice(15).trim()).trim(); }
        }
        out.title = sentence(molecule || title.join(' '));
        out.organism = capital(sentence(out.organism));
    } else if (fmt === 'cif') {
        out.id = cifValue(text, '_entry.id');
        // What the first polymer is (short: "Hemoglobin alpha chain"), else the entry's title (often a sentence).
        const entity = cifLoop(text, '_entity', ['type', 'pdbx_description']).find(r => r.type === 'polymer' && r.pdbx_description);
        const title = cifValue(text, '_struct.title');
        out.title = sentence(entity && (entity.pdbx_description.length <= 60 || !title) ? entity.pdbx_description : title).replace(/^(.{70}).+$/, '$1...');
        out.organism = capital(sentence(cifValue(text, '_entity_src_gen.pdbx_gene_src_scientific_name') || cifValue(text, '_entity_src_nat.pdbx_organism_scientific')
            || cifValue(text, '_pdbx_entity_src_syn.organism_scientific') || cifValue(text, '_ma_target_ref_db_details.organism_scientific')
            || (cifLoop(text, '_entity_src_gen', ['pdbx_gene_src_scientific_name'])[0] || {}).pdbx_gene_src_scientific_name || ''));
        for (const r of cifLoop(text, '_chem_comp', ['id', 'name'])) if (r.id && r.name) out.names[r.id.toUpperCase()] = r.name;
    } else if (fmt === 'sdf' || fmt === 'mol') {
        out.title = text.split(/\r?\n/, 1)[0].trim();
    } else if (fmt === 'mol2') {
        const m = /@<TRIPOS>MOLECULE\s*\r?\n([^\r\n]*)/.exec(text);
        out.title = m ? m[1].trim() : '';
    } else if (fmt === 'xyz') {
        out.title = (text.split(/\r?\n/, 2)[1] || '').trim().slice(0, 80);
    }
    return out;
}

/* How a ligand is called: a name everyone uses, else the file's, else its code. */
export function ligandName(resn, names = {}) {
    if (LIGAND_NAMES[resn]) return LIGAND_NAMES[resn];
    const n = names[resn];
    return n ? sentence(n).replace(/^\s*"|"\s*$/g, '').slice(0, 40) : resn;
}
const plural = (name, n) => n === 1 ? name : /ion$|cluster$|centre$/.test(name) ? name + 's' : /^[a-z][a-z -]*$/.test(name) && !/s$/.test(name) ? name + 's' : name;

/* A model read without a viewer (no WebGL context needed): its atoms, for the facts and the panel. */
function readModel($3D, text, fmt) {
    const m = new $3D.GLModel(0);
    m.addMolData(text, window.DeckMol3d.formats[fmt].lib, { keepH: true });
    return m;
}

/* Everything the dialog and the panel say about a structure: { info, facts, title, lines[], picks[], defaultPick, formula }. */
export function describe($3D, text, fmt, source = '') {
    const DM = window.DeckMol3d;
    if (isMesh(fmt)) {
        const info = DM.meshInfo(text);
        const named = info.name && !/^(ascii|binary|stl|mesh|model|object|exported|solid)\b/i.test(info.name) ? info.name : '';
        const out = { info, facts: { id: '', title: '', organism: '', names: {} }, lines: [], picks: [], defaultPick: '', formula: '' };
        // Called by its file's name (what people save a part as), else by the name inside it.
        const fromFile = /\.stl$/i.test(source) ? source.replace(/\.stl$/i, '').replace(/_+/g, ' ').trim() : '';
        out.title = capital(fromFile || named || '3D model');
        if (named && named !== out.title) out.lines.push(named);
        const size = info.size.map(n => n >= 100 ? Math.round(n) : n >= 1 ? Math.round(n * 10) / 10 : Math.round(n * 1000) / 1000);
        out.lines.push(`${info.triangles.toLocaleString('en')} triangles · ${size.join(' × ')} across`);
        return out;
    }
    const model = readModel($3D, text, fmt);
    const info = DM.analyse(model);
    const facts = fileFacts(text, fmt);
    const atoms = model.selectedAtoms({});
    if (!atoms.length) throw new Error('No atoms were found in this file.');
    const out = { info, facts, lines: [], picks: [], defaultPick: '', formula: '' };
    if (info.small) {
        const count = {};
        atoms.forEach(a => { count[a.elem] = (count[a.elem] || 0) + 1; });
        const order = ['C', 'H', ...Object.keys(count).filter(e => e !== 'C' && e !== 'H').sort()];
        out.formula = order.filter(e => count[e]).map(e => e + (count[e] > 1 ? count[e] : '')).join('');
        // PubChem's files are named by their CID on the first line.
        const cid = /^\d+$/.test(facts.title) ? facts.title : '';
        out.title = capital(facts.title && !cid ? facts.title : String(source || 'Molecule').replace(/^PubChem\s+|,.*$|\.(sdf|mol2?|xyz|pdb|cif)$/gi, '') || 'Molecule');
        if (source) out.lines.push(source + (cid && !/^PubChem/.test(source) ? ' · PubChem CID ' + cid : ''));
        else if (cid) out.lines.push('PubChem CID ' + cid);
        out.lines.push(`${out.formula} · ${atoms.length} atoms`);
        return out;
    }
    const id = facts.id || '';
    out.title = [id, capital(facts.title)].filter(Boolean).join(' · ') || capital(source) || 'Structure';
    const from = [facts.organism, source].filter(Boolean).join(' · ');
    if (from) out.lines.push(from);
    const chains = info.chains.length;
    const parts = [`${chains} chain${chains === 1 ? '' : 's'}`, `${info.residues} residues`];
    for (const l of info.ligands.filter(l => !ADDITIVES.includes(l.resn)).slice(0, 3)) parts.push(`${l.count} ${plural(ligandName(l.resn, facts.names), l.count)}`);
    out.lines.push(parts.join(' · '));
    // Pick out: the kinds of residue that hold the ligands (within 4.5 Å of them), most first.
    const held = info.ligands.filter(l => !ADDITIVES.includes(l.resn)).map(l => l.resn);
    const kinds = {};
    if (held.length) {
        const near = model.selectedAtoms({ hetflag: false, within: { distance: 4.5, sel: { resn: held, hetflag: true } } });
        const seen = new Set();
        near.forEach(a => { const k = a.chain + ':' + a.resi; if (!seen.has(k)) { seen.add(k); kinds[a.resn] = (kinds[a.resn] || 0) + 1; } });
        out.picks.push({ value: 'site', label: 'Residues around the ligands, as sticks' });
    }
    // The residues bound to a metal (within 3 Å of it: the cysteines of an iron-sulfur cluster, the
    // histidine under a haem's iron) come first, and the commonest of them starts picked out.
    const bound = {};
    if (held.length) {
        const seen = new Set();
        model.selectedAtoms({ hetflag: false, within: { distance: 3.0, sel: { elem: METAL_ELEMENTS, hetflag: true } } }).forEach(a => {
            const k = a.chain + ':' + a.resi; if (!seen.has(k)) { seen.add(k); bound[a.resn] = (bound[a.resn] || 0) + 1; }
        });
    }
    const order = (o) => Object.entries(o).filter(([r]) => RESIDUE_NAMES[r]).sort((a, b) => b[1] - a[1]).map(([r]) => r);
    let ranked = [...new Set([...order(bound), ...order(kinds)])].slice(0, 4);
    if (!ranked.length) ranked = ['CYS', 'HIS'].filter(r => atoms.some(a => a.resn === r && !a.hetflag));
    ranked.forEach(r => out.picks.push({ value: r, label: RESIDUE_NAMES[r] + ', as sticks' }));
    const top = order(bound)[0];
    if (top && /^(CYS|HIS|ASP|GLU)$/.test(top) && bound[top] >= 2) out.defaultPick = top;
    return out;
}

/* Settings for a structure just read: the style it starts as, colours, ligands shown but additives. */
export function startSettings(d, style = '') {
    if (d.info.mesh) return { style: 'solid', colour: 'deck', ligands: { hidden: [] }, water: false, hydrogens: false, pick: '', present: 'still', speed: 0.4, view: null, bg: 'slide' };
    const small = d.info.small;
    return {
        style: style || (small ? 'ballstick' : 'cartoon'), colour: small ? 'element' : 'chain',
        ligands: { hidden: small ? [] : d.info.ligands.map(l => l.resn).filter(r => ADDITIVES.includes(r)) },
        water: false, hydrogens: small, pick: small ? '' : d.defaultPick, present: 'still', speed: 0.4, view: null, bg: 'slide',
    };
}

/* ------------------------------------------------------------
   The picture
   ------------------------------------------------------------ */
function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}
/* What the picture of a figure is made from: the file, the look, the view, the box, the ground
   (and the deck's colours when it takes them). Turning while presented does not change it. */
export function mol3dKey(el) {
    const DM = window.DeckMol3d, s = DM.settings(el), h = holderOf(el);
    const look = { ...s }; delete look.present; delete look.speed;
    const text = h ? (h.getAttribute('src') || (h.textContent.length + ':' + h.textContent.slice(0, 200) + h.textContent.slice(-200))) : '';
    const parts = [el.getAttribute('data-mol3d'), JSON.stringify(look), hash(text), el.clientWidth, el.clientHeight, s.bg === 'none' ? '' : DM.ground(el)];
    if (s.colour === 'deck') parts.push(DM.palette(el).join(','));
    return 'm' + hash(parts.join('|'));
}

/* The structure file's text of a figure, read once per file. */
const texts = new WeakMap();
export async function sourceText(el) {
    const h = holderOf(el);
    const token = h ? (h.getAttribute('src') || h.textContent) : '';
    const was = texts.get(el);
    if (was && was.token === token) return was.text;
    await loadRenderer();
    const text = await window.DeckMol3d.source(el);
    texts.set(el, { token, text });
    return text;
}

/* A picture of the structure as the figure would show it, at twice its size: { src, view }.
   `settings` in place of the figure's own; `rotation` (a quaternion) turns a fitted view. */
export async function paint(el, { settings = null, text = null, format = null, rotation = null } = {}) {
    const { $3D, DM } = await loadMol3d();
    const w = Math.round(el.clientWidth), h = Math.round(el.clientHeight);
    if (w < 8 || h < 8) throw new Error('the structure has no size yet');
    if (text == null) text = await sourceText(el);
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-${w + 4000}px;top:0;width:${w}px;height:${h}px;pointer-events:none;`;
    host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);
    let r = null;
    try {
        r = await DM.build($3D, el, host, text, { settings: settings || DM.settings(el), format: format || DM.formatOf(el), config: { preserveDrawingBuffer: true } });
        if (rotation) { const v = r.viewer.getView(); r.viewer.setView(v.slice(0, 4).concat(rotation)); }
        r.viewer.render();
        const out = document.createElement('canvas');
        out.width = w * 2; out.height = h * 2;
        const g = out.getContext('2d');
        g.drawImage(r.viewer.getCanvas(), 0, 0, out.width, out.height);
        if (r.settings.bg === 'none' && blank(out)) throw new Error("this browser draws nothing on a see-through background, so the structure keeps the slide's colour");
        let src = out.toDataURL('image/webp', 0.9);
        if (!/^data:image\/webp/.test(src)) src = out.toDataURL('image/png');
        return { src, view: r.viewer.getView().map(n => Math.round(n * 1e5) / 1e5) };
    } finally {
        if (r) DM.dispose(r.viewer);
        host.remove();
    }
}

/* True when nothing at all was drawn on a canvas (every pixel see-through): some browsers' WebGL
   draws nothing on a transparent background. */
function blank(canvas) {
    const t = document.createElement('canvas');
    t.width = 96; t.height = Math.max(1, Math.round(96 * canvas.height / canvas.width));
    const g = t.getContext('2d');
    g.drawImage(canvas, 0, 0, t.width, t.height);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return false;
    return true;
}

/* The figure's picture made again, as the editor's own work (a resize, an undo): not an undo step. */
async function repaint(el) {
    const img = pictureOf(el); if (!img) return;
    const r = await paint(el);
    img.setAttribute('src', r.src);
    img.setAttribute('data-key', mol3dKey(el));
}

/* Every structure in `root` whose picture is out of date, drawn again; the ones that could not be. */
let refreshing = Promise.resolve();
export function refreshMol3d(root) {
    const run = async () => {
        const bad = [];
        if (!root) return bad;
        const list = isMol3d(root) ? [root] : Array.from(root.querySelectorAll(MOL3D));
        for (const el of list) {
            if (!el.isConnected || el.hasAttribute('data-ed-probe') || el.hasAttribute('data-ed-turning')) continue;
            if (el.clientWidth < 8 || el.clientHeight < 8) continue;          // not laid out (a slide the deck hides with display: none)
            try {
                await loadRenderer();
                const img = pictureOf(el);
                if (img && img.getAttribute('data-key') === mol3dKey(el)) continue;
                await repaint(el);
            } catch (err) { bad.push({ el, message: readable(err) }); }
        }
        return bad;
    };
    refreshing = refreshing.then(run, run);
    return refreshing;
}

/* ------------------------------------------------------------
   In the deck
   ------------------------------------------------------------ */
/* A new structure for this deck, not on a slide yet: the file (inline, or the assets/ path it was
   uploaded to), its settings and an empty picture; `paint` fills it once it has its box. */
export function createMol3d(app, { text, format, settings, src = '', alt = '' }) {
    const doc = app.deck.doc;
    const el = doc.createElement('figure');
    el.setAttribute('data-mol3d', format);
    el.setAttribute('data-mol3d-settings', JSON.stringify(settings));
    const w = Math.min(800, Math.round(app.deck.stageW * 0.42)), h = Math.min(Math.round(w * 0.82), Math.round(app.deck.stageH * 0.7));
    app.insert.place(el, w, h);
    el.style.cssText += 'margin:0;';
    const img = doc.createElement('img');
    img.setAttribute('data-mol3d-picture', '');
    img.setAttribute('alt', alt);
    img.setAttribute('style', PICTURE_STYLE);
    el.appendChild(img);
    el.appendChild(makeHolder(doc, format, text, src));
    return el;
}
function makeHolder(doc, format, text, src) {
    const holder = doc.createElement('script');
    holder.setAttribute('type', window.DeckMol3d.formats[format].mime);
    holder.setAttribute('data-mol3d-source', '');
    if (src) holder.setAttribute('src', src);
    else if (isMesh(format)) holder.textContent = '\n' + (text.replace(/\s+/g, '').match(/.{1,100}/g) || []).join('\n') + '\n';     // base64, in lines
    else holder.textContent = '\n' + window.DeckMol3d.escape(text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')) + '\n';
    return holder;
}

/* A file over 1 MB is kept in the deck's assets/ folder; the figure names it. */
async function keepLarge(app, text, format, name) {
    if (text.length <= INLINE_MAX) return '';
    const dir = app.deck.file.includes('/') ? app.deck.file.slice(0, app.deck.file.lastIndexOf('/')) : '';
    const base = (String(name || 'structure').replace(/\.[^.]+$/, '').replace(/[^\w.\- ()]/g, '_') || 'structure');
    const file = isMesh(format) ? new File([window.DeckMol3d.bytes(text)], base + '.stl', { type: 'model/stl' })
        : new File([text], base + '.' + (format === 'cif' ? 'cif' : format), { type: 'text/plain' });
    const r = await app.api.upload(dir, [file]);
    if (!r.files || !r.files.length) throw new Error('the file could not be kept in assets/');
    return r.files[0];
}

/* Put a structure on the current slide: the picture drawn where it will sit, then inserted for
   good, one undo step. Returns the figure. */
export async function insertStructure(app, { text, format, settings, alt = '', name = '', rotation = null, at = null }) {
    await loadMol3d();
    if (!app.deck.currentSlide) throw new Error('open a deck first');
    const src = await keepLarge(app, text, format, name);
    const el = createMol3d(app, { text, format, settings, src, alt });
    if (at) app.insert.fresh.set(el, { ...(app.insert.fresh.get(el) || {}), at });
    el.setAttribute('data-ed-probe', '');
    el.style.visibility = 'hidden';
    app.deck.currentSlide.appendChild(el);
    try {
        const r = await paint(el, { settings, text, format, rotation });
        const img = pictureOf(el);
        img.setAttribute('src', r.src);
        el.setAttribute('data-mol3d-settings', JSON.stringify({ ...settings, view: r.view }));
        img.setAttribute('data-key', mol3dKey(el));
    } finally {
        el.remove();
        el.removeAttribute('data-ed-probe');
        el.style.visibility = '';
    }
    texts.set(el, { token: src || holderOf(el).textContent, text });
    app.insert.add(el, 'Insert 3D structure');
    app.selection.select(el);
    return el;
}

/* The script tags of a deck with a turning structure, in the saved text (`body` is the copy being
   serialised): added when a structure is set to turn or to be dragged, taken out when none is. */
export function syncMol3dScripts(body) {
    const doc = body.ownerDocument;
    const tags = Array.from(body.querySelectorAll('script[data-deck-mol3d]'));
    const live = Array.from(body.querySelectorAll('.deck-stage ' + MOL3D)).some(el => {
        try { const p = JSON.parse(el.getAttribute('data-mol3d-settings') || '{}').present; return p === 'turns' || p === 'drag'; } catch (e) { return false; }
    });
    if (!live) {
        for (const t of tags) { const before = t.previousSibling; if (before && before.nodeType === 3 && !before.textContent.trim()) before.remove(); t.remove(); }
        return;
    }
    for (const [src, role] of MOL3D_SCRIPTS) {
        if (tags.some(t => t.getAttribute('data-deck-mol3d') === role)) continue;
        const s = doc.createElement('script');
        s.setAttribute('src', src);
        s.setAttribute('data-deck-mol3d', role);
        body.append('\n', s);
    }
}

/* 3Dmol and the renderer in the deck the editor shows, for Preview (see ensureDeckPlots in plot.js):
   inline, in the head, which is never written back. */
let libTexts = null;
export async function ensureDeckMol3d(deck) {
    const doc = deck.doc, win = deck.win;
    const live = (el) => { try { return /^(turns|drag)$/.test(JSON.parse(el.getAttribute('data-mol3d-settings') || '{}').present); } catch (e) { return false; } };
    if (!doc || !Array.from(doc.querySelectorAll('.deck-stage ' + MOL3D)).some(live)) return;
    if (!win.$3Dmol || !win.DeckMol3d) {
        if (!libTexts) libTexts = Promise.all(['vendor/3Dmol-min.js', 'deck-mol3d.js'].map(u => fetch(u).then(r => { if (!r.ok) throw new Error('could not load ' + u); return r.text(); })));
        let both;
        try { both = await libTexts; } catch (err) { libTexts = null; throw err; }
        if (deck.doc !== doc) return;
        [!win.$3Dmol, !win.DeckMol3d].forEach((missing, i) => {
            if (!missing) return;
            const s = doc.createElement('script');
            s.setAttribute('data-ed-mol3d', '');
            s.textContent = '\n' + both[i].replace(/\r\n?/g, '\n').trim() + '\n';     // the form serve.py knows the hash of
            doc.head.appendChild(s);
        });
    }
    if (win.DeckMol3d) win.DeckMol3d.sync();
}

/* The look a change in the panel or the turn mode gives a figure: its settings and its picture,
   one undo step. */
async function commit(app, el, settings, label) {
    const img = pictureOf(el);
    const before = el.getAttribute('data-mol3d-settings');
    const r = await paint(el, { settings });
    const json = JSON.stringify({ ...settings, view: settings.view ? r.view : settings.view });
    app.history.begin(label);
    if (json !== before) app.history.attr(el, 'data-mol3d-settings', json, label);
    if (img) { app.history.attr(img, 'src', r.src, label); app.history.attr(img, 'data-key', mol3dKey(el), label); }
    app.history.end();
}

/* ------------------------------------------------------------
   Insert > 3D structure...: by ID, from a file or pasted; a turning
   preview, what was found, the style it starts as.
   ------------------------------------------------------------ */
const SITES = {
    pdb: { site: 'rcsb.org', label: 'Protein Data Bank: a PDB ID (1FDN)', ph: '1FDN', what: 'this ID', name: 'Protein Data Bank' },
    alphafold: { site: 'alphafold.ebi.ac.uk', label: 'AlphaFold: a UniProt ID (P00195)', ph: 'P00195', what: 'the prediction for this ID', name: 'AlphaFold' },
    pubchem: { site: 'pubchem.ncbi.nlm.nih.gov', label: 'PubChem: a name or CID (caffeine)', ph: 'caffeine', what: 'this name', name: 'PubChem' },
};
const GLOBE = '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2.2 2.2 3.2 4.7 3.2 7.5s-1 5.3-3.2 7.5c-2.2-2.2-3.2-4.7-3.2-7.5s1-5.3 3.2-7.5z"/></svg>';

export function openMol3dDialog(app, { replace = null, file = null } = {}) {
    document.querySelectorAll('.help.mol3d-dialog').forEach(h => h.remove());
    if (!app.deck.isOpen || !app.deck.currentSlide) return null;
    const h = document.createElement('div');
    h.className = 'help mol3d-dialog';
    h.setAttribute('role', 'dialog'); h.setAttribute('aria-modal', 'true'); h.setAttribute('aria-label', replace ? 'Replace the 3D structure' : 'Insert a 3D structure');
    h.innerHTML = `<div class="help-card mol3d-card">
        <h2>${replace ? 'Replace the 3D structure' : 'Insert a 3D structure'}</h2>
        <div class="m3-left">
          <div class="help-tabs" role="tablist"><button data-tab="web" class="on" role="tab">From an ID</button><button data-tab="file" role="tab">From a file</button><button data-tab="paste" role="tab">Paste</button></div>
          <div data-pane="web">
            <label class="m3-lab" for="m3Where">Where from</label>
            <div class="insp-field"><select id="m3Where">${Object.entries(SITES).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}</select></div>
            <label class="m3-lab" for="m3Id">ID</label>
            <div class="m3-row"><div class="insp-field"><input type="text" id="m3Id" spellcheck="false" autocomplete="off" placeholder="1FDN"></div><button class="tb-btn primary" id="m3Fetch">Fetch</button></div>
            <div class="m3-net">${GLOBE}<span id="m3Net"></span></div>
          </div>
          <div data-pane="file" hidden>
            <div class="m3-drop" id="m3Drop" tabindex="0">Drop a structure file here, or <a href="#" id="m3Choose">choose one</a><br><span class="m3-mono">.cif .pdb .sdf .mol .mol2 .xyz .stl</span><br><span class="m3-small">From the PDB, AlphaFold, PubChem, ChemDraw 3D, RDKit, ORCA or Gaussian; .stl meshes from CAD, 3D printing or ChimeraX.</span></div>
            <input type="file" id="m3File" accept=".cif,.mmcif,.pdb,.pqr,.sdf,.mol,.mol2,.xyz,.stl" hidden>
            <div class="insp-hint">Dropping a structure file on a slide does the same and skips this dialog.</div>
          </div>
          <div data-pane="paste" hidden>
            <textarea id="m3Paste" class="insp-notes theme-css" rows="10" spellcheck="false" autocomplete="off" placeholder="Paste the contents of a .pdb, .cif, .sdf or .xyz file" aria-label="The structure file's text"></textarea>
          </div>
          <div class="m3-err" id="m3Err" role="status" hidden></div>
        </div>
        <div class="m3-right">
          <div class="m3-pv" id="m3Pv"><div class="m3-empty" id="m3Empty">Type an ID and press Fetch, drop a file, or paste one. It shows here before it goes on the slide.</div></div>
          <div class="m3-meta" id="m3Meta"></div>
          <div class="insp-row m3-start"><label>Start as</label><div class="insp-field insp-seg" id="m3Start"><button data-v="" class="on">Cartoon</button><button data-v="sticks">Sticks</button><button data-v="surface">Surface</button></div></div>
        </div>
        <div class="m3-foot"><span class="m3-hint" id="m3Hint">Nothing to insert yet.</span><button class="tb-btn" id="m3Cancel">Cancel</button><button class="tb-btn primary" id="m3Insert" disabled>${replace ? 'Replace' : 'Insert'}</button></div>
    </div>`;
    document.body.appendChild(h);
    const $ = (id) => h.querySelector('#' + id);
    let got = null, probe = null, pv = null, seq = 0, closed = false;
    const tab = (t) => {
        h.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
        h.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t; });
    };
    const error = (msg) => { $('m3Err').hidden = !msg; $('m3Err').textContent = msg || ''; };
    const where = () => {
        const s = SITES[$('m3Where').value];
        $('m3Id').placeholder = s.ph;
        $('m3Net').innerHTML = `Fetch asks <b>${s.site}</b> for ${s.what}, once, and sends nothing else. The structure is then kept in the deck and works offline.`;
    };
    const dropPreview = () => { if (pv) { window.DeckMol3d.dispose(pv.viewer); pv = null; } h.querySelectorAll('.m3-live').forEach(n => n.remove()); if (probe) { probe.remove(); probe = null; } };
    const empty = (text) => { dropPreview(); $('m3Empty').hidden = false; $('m3Empty').textContent = text; $('m3Meta').innerHTML = ''; $('m3Insert').disabled = true; $('m3Hint').textContent = 'Nothing to insert yet.'; got = null; };
    const close = () => { if (closed) return; closed = true; watcher.disconnect(); dropPreview(); h.remove(); };
    const watcher = new MutationObserver(() => { if (!h.isConnected) close(); });
    watcher.observe(document.body, { childList: true });

    /* A structure read: shown turning in the preview, with what it holds. */
    async function show(text, name, source) {
        const n = ++seq;
        error('');
        const format = detectFormat(text, name);
        if (isMesh(format) && !name) text = pastedStl(text);      // pasted: the text kind of STL
        const problem = structureProblem(text, format);
        if (problem) { empty('Nothing to show.'); error(problem); return; }
        try {
            const { $3D, DM } = await loadMol3d();
            if (n !== seq || closed) return;
            const d = describe($3D, text, format, source);
            const start = $('m3Start').querySelector('.on').dataset.v;
            const settings = startSettings(d, start);
            dropPreview();
            // The figure-to-be, on the slide but out of sight: the preview takes its ground and the deck's colours.
            probe = createMol3d(app, { text: '', format, settings, src: 'about:blank' });
            probe.setAttribute('data-ed-probe', ''); probe.style.visibility = 'hidden';
            app.deck.currentSlide.appendChild(probe);
            const host = document.createElement('div');
            host.className = 'm3-live';
            $('m3Pv').appendChild(host);
            $('m3Empty').hidden = true;
            const r = await DM.build($3D, probe, host, text, { settings, format });
            if (n !== seq || closed) { DM.dispose(r.viewer); return; }
            pv = r;
            r.viewer.spin('y', 0.5);
            host.addEventListener('pointerdown', () => r.viewer.spin(false), { once: true });     // the user's turn stays put
            $('m3Pv').style.background = DM.ground(probe);
            got = { text, format, name, d, source };
            $('m3Meta').innerHTML = `<b></b>${d.lines.map(() => '<br><span></span>').join('')}`;
            $('m3Meta').querySelector('b').textContent = d.title;
            $('m3Meta').querySelectorAll('span').forEach((s, i) => { s.textContent = d.lines[i]; });
            const first = $('m3Start').querySelector('[data-v=""]');
            first.textContent = d.info.small ? 'Ball and stick' : 'Cartoon';
            $('m3Start').closest('.m3-start').hidden = !!d.info.mesh;       // a mesh starts solid
            $('m3Insert').disabled = false;
            $('m3Hint').textContent = 'Drag the preview to turn it. You can change all of this later in the panel.';
        } catch (err) {
            if (n !== seq || closed) return;
            empty('Nothing to show.');
            error('This file could not be read as a structure: ' + readable(err));
        }
    }
    async function restyle() {
        if (!got || !pv) return;
        const { DM, $3D } = await loadMol3d();
        const s = startSettings(got.d, $('m3Start').querySelector('.on').dataset.v);
        await DM.apply($3D, pv.viewer, pv.model, s, pv.info, DM.palette(probe));
        pv.viewer.render();
    }
    async function readFile(f) {
        if (!f) return;
        if (f.size > FILE_MAX) { empty('Nothing to show.'); error(`${f.name} is larger than ${FILE_MAX / 1048576} MB, too large for a slide.`); return; }
        $('m3Drop').classList.add('full');
        $('m3Drop').innerHTML = '<b></b> · ' + Math.max(1, Math.round(f.size / 1024)) + ' KB<br><span class="m3-small">' + '<a href="#" id="m3Choose">choose another</a></span>';
        $('m3Drop').querySelector('b').textContent = f.name;
        $('m3Choose').addEventListener('click', (e) => { e.preventDefault(); $('m3File').click(); });
        await show(await fileText(f), f.name, f.name);
    }
    async function fetchIt() {
        const from = $('m3Where').value, id = $('m3Id').value.trim();
        if (!id) { $('m3Id').focus(); return; }
        const b = $('m3Fetch');
        b.disabled = true; b.textContent = 'Fetching...';
        error('');
        try {
            const r = await app.api.structure(from, id);
            if (closed) return;
            const site = SITES[from];
            const source = from === 'pubchem' ? `PubChem ${id}, 3D conformer` : from === 'alphafold' ? `AlphaFold ${r.name}` : site.name;
            await show(r.text, r.name + '.' + r.format, source);
            if (got) got.from = { site: from, id: r.name };
        } catch (err) {
            if (!closed) { empty('Nothing fetched.'); error(err.message); }
        } finally { b.disabled = false; b.textContent = 'Fetch'; }
    }
    h.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => tab(b.dataset.tab)));
    $('m3Where').addEventListener('change', where);
    $('m3Fetch').addEventListener('click', fetchIt);
    $('m3Id').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fetchIt(); } });
    $('m3Choose').addEventListener('click', (e) => { e.preventDefault(); $('m3File').click(); });
    $('m3Drop').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('m3File').click(); } });
    $('m3File').addEventListener('change', () => { const f = $('m3File').files[0]; $('m3File').value = ''; readFile(f); });
    // A file dropped on the dialog is the dialog's, not the slide's.
    h.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }, true);
    h.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) { tab('file'); readFile(f); } }, true);
    let pasteTimer = 0;
    $('m3Paste').addEventListener('input', () => { clearTimeout(pasteTimer); pasteTimer = setTimeout(() => { if ($('m3Paste').value.trim()) show($('m3Paste').value, '', 'Pasted'); else empty('Type an ID and press Fetch, drop a file, or paste one. It shows here before it goes on the slide.'); }, 300); });
    $('m3Start').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $('m3Start').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); restyle(); });
    h.addEventListener('click', (e) => { if (e.target === h || e.target.id === 'm3Cancel') close(); });
    $('m3Insert').addEventListener('click', async () => {
        if (!got || $('m3Insert').disabled) return;
        $('m3Insert').disabled = true;
        $('m3Hint').textContent = replace ? 'Replacing...' : 'Inserting...';
        const settings = startSettings(got.d, $('m3Start').querySelector('.on').dataset.v);
        settings.source = got.from ? `${SITES[got.from.site].name} ${got.from.id}` : got.source || got.name || '';
        const rotation = pv ? pv.viewer.getView().slice(4) : null;
        try {
            if (replace) await replaceStructure(app, replace, { text: got.text, format: got.format, settings, name: got.name, rotation, alt: altOf(got.d) });
            else await insertStructure(app, { text: got.text, format: got.format, settings, name: got.name, rotation, alt: altOf(got.d) });
            close();
        } catch (err) { error('The structure could not be put on the slide: ' + readable(err)); $('m3Insert').disabled = false; }
    });
    where();
    if (file) { tab('file'); readFile(file); }
    setTimeout(() => $('m3Id').focus(), 0);
    return h;
}
const altOf = (d) => (d.info.mesh ? '3D model: ' : '3D structure: ') + d.title + (d.info.small && d.formula ? ' (' + d.formula + ')' : '');

/* Another file in the same box: the place, size and way of presenting stay; the rest starts again. */
export async function replaceStructure(app, el, { text, format, settings, name = '', rotation = null, alt = '' }) {
    const old = DMsettings(el);
    settings = { ...settings, present: old.present, speed: old.speed, bg: old.bg };
    const src = await keepLarge(app, text, format, name);
    const holder = makeHolder(app.deck.doc, format, text, src);
    // Drawn with the new file in place, then put back so that history records the change.
    const was = { fmt: el.getAttribute('data-mol3d'), holder: holderOf(el) };
    el.setAttribute('data-mol3d', format);
    const r = await paint(el, { settings, text, format, rotation });
    el.setAttribute('data-mol3d', was.fmt);
    const label = 'Replace 3D structure';
    app.history.begin(label);
    app.history.attr(el, 'data-mol3d', format, label);
    app.history.attr(el, 'data-mol3d-settings', JSON.stringify({ ...settings, view: r.view }), label);
    if (was.holder) app.history.remove(was.holder, label);
    app.history.insert(holder, el, null, label);
    const img = pictureOf(el);
    app.history.attr(img, 'src', r.src, label);
    app.history.attr(img, 'alt', alt, label);
    app.history.attr(img, 'data-key', mol3dKey(el), label);
    app.history.end();
    texts.set(el, { token: src || holder.textContent, text });
    app.selection.select(el);
}
const DMsettings = (el) => window.DeckMol3d.settings(el);

/* Structure files dropped on a slide: each one inserted at the drop, as from the dialog. */
export async function insertFiles(app, files, point = null) {
    const done = [];
    for (const [i, f] of files.entries()) {
        if (f.size > FILE_MAX) throw new Error(`${f.name} is larger than ${FILE_MAX / 1048576} MB`);
        const text = await fileText(f);
        const format = detectFormat(text, f.name);
        const problem = structureProblem(text, format);
        if (problem) throw new Error(f.name + ': ' + problem);
        const { $3D } = await loadMol3d();
        const d = describe($3D, text, format, f.name);
        const settings = { ...startSettings(d), source: f.name };
        done.push(await insertStructure(app, { text, format, settings, name: f.name, alt: altOf(d), at: point ? { x: point.x + i * 24, y: point.y + i * 24 } : null }));
    }
    return done;
}

/* ============================================================
   Mol3dSection - the 3D structure part of the properties panel.
   ============================================================ */
const COLOURS = [['chain', 'By chain'], ['rainbow', 'Rainbow, start to end'], ['ss', 'Helices and sheets'], ['element', 'By element'], ['deck', "The deck's colours"]];
const SMALL_COLOURS = [['element', 'By element'], ['deck', "The deck's colours"]];
const MESH_COLOURS = [['deck', "The deck's colour"], ['plain', 'Light grey']];
const MESH_STYLES = [['solid', 'Solid'], ['glass', 'See-through'], ['wire', 'Wireframe']];

export class Mol3dSection {
    constructor(app, root) {
        this.app = app;
        this.deck = app.deck;
        this.root = root;
        this.el = null;
        this.facts = new WeakMap();      // figure -> { token, d }: read once per file
        this.busy = Promise.resolve();
        root.innerHTML = `
          <h4>3D structure</h4>
          <div class="m3-meta" id="m3pMeta"></div>
          <div class="insp-btns"><button class="mini-btn" id="m3pReplace" title="Another structure in the same box">Replace...</button><button class="mini-btn" id="m3pSave" title="Save the structure as a file">Save the file...</button></div>
          <div class="insp-row"><label>Style</label><div class="insp-field insp-seg" id="m3pStyle"></div></div>
          <div class="insp-row"><label for="m3pColour">Colour</label><div class="insp-field"><select id="m3pColour"></select></div></div>
          <div class="theme-sub" id="m3pShowSub">Show</div>
          <div id="m3pLigands"></div>
          <label class="align-toslide" id="m3pWaterRow"><input type="checkbox" id="m3pWater"> <span>Water</span></label>
          <label class="align-toslide" id="m3pHRow"><input type="checkbox" id="m3pH"> <span>Hydrogens</span></label>
          <div class="insp-row" id="m3pPickRow"><label for="m3pPick">Pick out</label><div class="insp-field"><select id="m3pPick"></select></div></div>
          <div class="theme-sub">View</div>
          <div class="theme-row"><button class="mini-btn" id="m3pTurn" title="Drag to turn, scroll to zoom; the view becomes the picture">Turn it...</button><button class="mini-btn" id="m3pFit" title="The whole structure, centred">Fit</button><span class="insp-hint" style="margin:0">or double-click it</span></div>
          <label class="align-toslide" title="The structure on the slide itself, with no background of its own. The slide's colour is used where the browser cannot draw it so"><input type="checkbox" id="m3pClear"> <span>See-through background</span></label>
          <div class="m3-pic"><img id="m3pStill" alt=""><div class="insp-hint" style="margin:0">This view is the picture used in the PDF, in PowerPoint, and when the deck shows without its scripts.</div></div>
          <div class="theme-sub">While presenting</div>
          <div class="insp-field insp-seg" id="m3pPresent"><button data-v="still">Still</button><button data-v="turns">Turns slowly</button><button data-v="drag">Drag to turn</button></div>
          <div class="m3-speed" id="m3pSpeedRow"><span>Speed</span><input type="range" min="0.1" max="1.5" step="0.1" id="m3pSpeed" aria-label="Speed"></div>
          <div class="insp-hint" id="m3pPresentHint"></div>
          <div class="insp-hint insp-state insp-warn" id="m3pError" role="status"></div>`;
        const $ = (id) => root.querySelector('#' + id);
        this.$ = $;
        $('m3pStyle').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.change({ style: b.dataset.v }, 'Structure style'); });
        $('m3pColour').addEventListener('change', () => this.change({ colour: $('m3pColour').value }, 'Structure colour'));
        $('m3pWater').addEventListener('change', () => this.change({ water: $('m3pWater').checked }, 'Show water'));
        $('m3pH').addEventListener('change', () => this.change({ hydrogens: $('m3pH').checked }, 'Show hydrogens'));
        $('m3pPick').addEventListener('change', () => this.change({ pick: $('m3pPick').value }, 'Pick out residues'));
        $('m3pLigands').addEventListener('change', (e) => {
            const box = e.target.closest('input[data-resn]'); if (!box) return;
            const s = DMsettings(this.el), hidden = new Set(s.ligands.hidden);
            if (box.checked) hidden.delete(box.dataset.resn); else hidden.add(box.dataset.resn);
            this.change({ ligands: { hidden: Array.from(hidden) } }, 'Show ligands');
        });
        $('m3pPresent').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.option({ present: b.dataset.v }, 'While presenting'); });
        $('m3pSpeed').addEventListener('change', () => this.option({ speed: +$('m3pSpeed').value }, 'Turning speed'));
        $('m3pTurn').addEventListener('click', () => { if (app.mol3d.turning) app.mol3d.finish(); else if (this.el) app.mol3d.turn(this.el); });
        $('m3pClear').addEventListener('change', () => this.change({ bg: $('m3pClear').checked ? 'none' : 'slide' }, 'Structure background'));
        $('m3pFit').addEventListener('click', () => { if (this.el) { if (app.mol3d.turning) app.mol3d.fit(); else this.change({ view: null }, 'Fit the structure'); } });
        $('m3pReplace').addEventListener('click', () => { if (this.el) openMol3dDialog(app, { replace: this.el }); });
        $('m3pSave').addEventListener('click', () => this.saveFile());
    }

    _error(msg) { this.$('m3pError').textContent = msg || ''; }

    /* A change of look: settings and picture, one undo step (in turn mode, the viewer follows). */
    change(part, label) {
        const el = this.el; if (!el) return;
        const run = async () => {
            if (!el.isConnected) return;
            const s = { ...DMsettings(el), ...part };
            try {
                if (this.app.mol3d.turning) { await this.app.mol3d.restyle(s); s.view = this.app.mol3d.view(); }
                await commit(this.app, el, s, label);
                this._error('');
            } catch (err) { this._error('The structure could not be drawn: ' + readable(err) + '.'); }
            if (this.el === el) this.sync(el);
        };
        this.busy = this.busy.then(run, run);
        return this.busy;
    }
    /* How it shows while presenting: the settings only, the picture stays. One undo step. */
    option(part, label) {
        const el = this.el; if (!el) return;
        const s = { ...DMsettings(el), ...part };
        this.app.history.attr(el, 'data-mol3d-settings', JSON.stringify(s), label);
        this.sync(el);
    }

    async saveFile() {
        const el = this.el; if (!el) return;
        try {
            const text = await sourceText(el), fmt = el.getAttribute('data-mol3d') || 'pdb';
            const s = DMsettings(el);
            const name = (String(s.source || '').split(/\s+/).pop() || 'structure').replace(/\.[^.]+$/, '').replace(/[^\w.\-]+/g, '_') || 'structure';
            const a = document.createElement('a');
            a.href = URL.createObjectURL(isMesh(fmt) ? new Blob([window.DeckMol3d.bytes(text)], { type: 'model/stl' }) : new Blob([text], { type: 'text/plain' }));
            a.download = name + '.' + fmt;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        } catch (err) { this._error('The file could not be read: ' + readable(err) + '.'); }
    }

    focus() { this.$('m3pTurn').focus(); }

    async sync(el) {
        const m = el && isMol3d(el) ? el : null;
        this.el = m;
        this.root.hidden = !m;
        if (!m) return;
        const $ = this.$;
        const s = DMsettings(m);
        const img = pictureOf(m);
        $('m3pStill').src = img ? img.getAttribute('src') || '' : '';
        $('m3pStill').style.background = '';
        $('m3pPresent').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === (s.present || 'still')));
        $('m3pSpeedRow').hidden = s.present !== 'turns';
        $('m3pSpeed').value = String(s.speed || 0.4);
        $('m3pPresentHint').textContent = s.present === 'turns' ? 'Turns while its slide is up. Printed and in PowerPoint, it is the picture above.'
            : s.present === 'drag' ? 'You can turn and zoom it with the mouse while presenting; it starts from the view above.'
                : 'Shows the picture: no script in the deck, nothing to load.';
        $('m3pTurn').textContent = this.app.mol3d && this.app.mol3d.turning ? 'Done' : 'Turn it...';
        // What the file holds: read once per file, then the rows that depend on it.
        let d = null;
        const h = holderOf(m), token = h ? (h.getAttribute('src') || h.textContent.length + ':' + h.textContent.slice(0, 300)) : '';
        const seen = this.facts.get(m);
        if (seen && seen.token === token) d = seen.d;
        else {
            try {
                const { $3D } = await loadMol3d();
                d = describe($3D, await sourceText(m), window.DeckMol3d.formatOf(m), s.source || '');
                this.facts.set(m, { token, d });
            } catch (err) { this._error('The structure file could not be read: ' + readable(err) + '.'); }
            if (this.el !== m) return;
        }
        const small = d ? d.info.small : false, mesh = isMesh(window.DeckMol3d.formatOf(m));
        const meta = $('m3pMeta');
        meta.innerHTML = '';
        if (d) {
            const b = document.createElement('b'); b.textContent = d.title; meta.appendChild(b);
            d.lines.forEach(l => { meta.appendChild(document.createElement('br')); meta.appendChild(document.createTextNode(l)); });
        }
        meta.appendChild(document.createElement('br'));
        const kept = document.createElement('span'); kept.className = 'm3-kept';
        kept.textContent = h && h.getAttribute('src') ? 'Kept beside the deck: ' + h.getAttribute('src') : 'Kept in the deck';
        meta.appendChild(kept);
        const styles = mesh ? MESH_STYLES : small ? [['ballstick', 'Ball and stick'], ['sticks', 'Sticks'], ['spheres', 'Spheres'], ['surface', 'Surface']] : [['cartoon', 'Cartoon'], ['sticks', 'Sticks'], ['spheres', 'Spheres'], ['surface', 'Surface']];
        const style = s.style || styles[0][0];
        $('m3pStyle').innerHTML = styles.map(([v, l]) => `<button data-v="${v}"${v === style ? ' class="on"' : ''}>${l}</button>`).join('');
        const colours = mesh ? MESH_COLOURS : small ? SMALL_COLOURS : COLOURS;
        $('m3pColour').innerHTML = colours.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
        $('m3pColour').value = colours.some(c => c[0] === s.colour) ? s.colour : colours[0][0];
        $('m3pH').checked = s.hydrogens == null ? small : !!s.hydrogens;
        $('m3pClear').checked = s.bg === 'none';
        $('m3pWaterRow').hidden = small || mesh || !(d && d.info.water);
        $('m3pShowSub').hidden = $('m3pHRow').hidden = mesh;        // a mesh has no atoms to show or hide
        $('m3pWater').checked = !!s.water;
        const lig = $('m3pLigands');
        lig.innerHTML = '';
        if (d && !small) for (const l of d.info.ligands) {
            const row = document.createElement('label'); row.className = 'align-toslide';
            const box = document.createElement('input'); box.type = 'checkbox'; box.dataset.resn = l.resn; box.checked = !s.ligands.hidden.includes(l.resn);
            const t = document.createElement('span'); t.textContent = capital(plural(ligandName(l.resn, d.facts.names), l.count)) + ` (${l.resn}${l.count > 1 ? ', ' + l.count : ''})`;
            row.append(box, ' ', t); lig.appendChild(row);
        }
        $('m3pPickRow').hidden = small || mesh || !d || !d.picks.length;
        if (d && !small) {
            const opts = [{ value: '', label: 'Nothing' }, ...d.picks];
            if (s.pick && !opts.some(o => o.value === s.pick)) opts.push({ value: s.pick, label: s.pick + ', as sticks' });
            $('m3pPick').innerHTML = '';
            opts.forEach(o => { const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; $('m3pPick').appendChild(op); });
            $('m3pPick').value = s.pick || '';
        }
    }
}

/* ============================================================
   Turn mode: a live viewer over the structure while the user
   turns it; Done makes its view the picture (one undo step).
   ============================================================ */
export class Mol3dEditor {
    constructor(app) {
        this.app = app;
        this.deck = app.deck;
        this.selection = app.selection;
        this.t = null;                  // the session while turning
        const redraw = () => { if (this.t) this.place(); };
        window.addEventListener('editor:zoom', redraw);
        window.addEventListener('resize', redraw);
        this.selection.canvas.addEventListener('scroll', redraw);
        this.deck.addEventListener('slide', () => this.finish());
        window.addEventListener('editor:before-save', () => this.finish(false));
        window.addEventListener('editor:before-step', () => this.finish(false));
        // A double-click on a structure turns it.
        this.selection.addEventListener('edit-text', (e) => { if (isMol3d(e.detail.el) && !this.t) this.turn(e.detail.el); });
        // Pictures drawn again when the box or the deck's look changes (a resize, an undo, a new theme).
        let timer = 0;
        const stale = () => {
            clearTimeout(timer);
            timer = setTimeout(async () => {
                const doc = this.deck.doc;
                if (!this.deck.isOpen || !doc.querySelector(MOL3D)) return;
                const bad = await refreshMol3d(this.deck.stage).catch(() => []);
                if (this.deck.doc !== doc) return;
                for (const b of bad) if (app.problems && !app.problems.items.some(p => p.kind === 'drawn' && p.el === b.el)) app.problems.add({ kind: 'drawn', what: '3D structure', message: b.message, url: '', el: b.el });
                if (app.selection.single && isMol3d(app.selection.single)) app.inspector.sync();
            }, 400);
        };
        window.addEventListener('editor:open', stale);
        app.history.addEventListener('change', stale);
        this.deck.addEventListener('overrides', stale);
        window.addEventListener('editor:preview', (e) => {
            if (e.detail && this.deck.isOpen) ensureDeckMol3d(this.deck).catch((err) => app.toast('The 3D structures stay pictures in this preview: ' + err.message, { error: true, ms: 5000 }));
        });
    }
    get turning() { return !!this.t; }

    async turn(el) {
        if (this.t || !isMol3d(el)) return false;
        const cs = this.deck.win.getComputedStyle(el);
        if ((parseFloat(el.style.rotate) || 0) !== 0 || (cs.transform && cs.transform !== 'none' && !/^matrix\(1, 0, 0, 1,/.test(cs.transform))) {
            this.app.toast('Turning works on a structure that is not rotated on the slide: set Rotate to 0 first.', { ms: 5000 });
            return false;
        }
        if (this.app.textEdit) this.app.textEdit.commit();
        this.selection.select(el);
        this.selection.enabled = false;
        this.selection.overlay.classList.add('mol3d-turning');
        el.setAttribute('data-ed-turning', '');
        const layer = document.createElement('div');
        layer.className = 'mol3d-turn-layer';
        layer.innerHTML = `<div class="mol3d-turn-host"></div>`;
        const bar = document.createElement('div');
        bar.className = 'mol3d-turn-bar';
        bar.innerHTML = `<span>Turning the structure: drag to turn · scroll to zoom · <kbd>Ctrl</kbd>+drag to move</span><button class="mol3d-ghost" data-act="fit">Fit</button><button data-act="done">Done</button>`;
        this.selection.overlay.appendChild(layer);
        document.body.appendChild(bar);
        const host = layer.querySelector('.mol3d-turn-host');
        this.t = { el, layer, bar, host, viewer: null, before: el.getAttribute('data-mol3d-settings') };
        layer.addEventListener('pointerdown', (e) => { if (!host.contains(e.target)) { e.stopPropagation(); this.finish(); } });
        ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'dblclick', 'contextmenu', 'click'].forEach(type => host.addEventListener(type, (e) => { e.stopPropagation(); if (type === 'contextmenu') e.preventDefault(); }, { passive: type !== 'contextmenu' }));
        bar.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.act === 'fit') this.fit(); else this.finish(); });
        this.place();
        this.app.inspector.sync();
        try {
            const { $3D, DM } = await loadMol3d();
            const text = await sourceText(el);
            if (!this.t || this.t.el !== el) return false;
            const r = await DM.build($3D, el, host, text, { settings: { ...DM.settings(el), bg: 'slide' } });     // over the editor, not in the slide: on the slide's colour
            if (!this.t || this.t.el !== el) { DM.dispose(r.viewer); return false; }
            this.t.viewer = r.viewer; this.t.model = r.model; this.t.info = r.info;
        } catch (err) {
            this.app.toast('The structure could not be shown: ' + readable(err), { error: true, ms: 5000 });
            this.finish(false);
            return false;
        }
        return true;
    }

    /* The viewer over the figure's box on screen, the bar above the canvas. */
    place() {
        const t = this.t; if (!t) return;
        const r = this.selection.toOverlay(this.deck.stageRect(t.el));
        Object.assign(t.host.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
        const c = this.selection.canvas.getBoundingClientRect();
        Object.assign(t.bar.style, { left: (c.left + c.width / 2) + 'px', top: (c.top + 12) + 'px' });
        if (t.viewer) { t.viewer.resize(); t.viewer.render(); }
    }
    view() { return this.t && this.t.viewer ? this.t.viewer.getView() : null; }
    fit() { if (this.t && this.t.viewer) { this.t.viewer.zoomTo(); this.t.viewer.render(); } }
    async restyle(settings) {
        const t = this.t; if (!t || !t.viewer) return;
        const { $3D, DM } = await loadMol3d();
        await DM.apply($3D, t.viewer, t.model, settings, t.info, DM.palette(t.el));
        t.viewer.render();
    }

    /* Leave turn mode; `keep` false leaves the view as it was. */
    async finish(keep = true) {
        const t = this.t; if (!t) return;
        this.t = null;
        const view = t.viewer ? t.viewer.getView().map(n => Math.round(n * 1e5) / 1e5) : null;
        if (t.viewer) window.DeckMol3d.dispose(t.viewer);
        t.layer.remove(); t.bar.remove();
        this.selection.overlay.classList.remove('mol3d-turning');
        this.selection.enabled = true;
        t.el.removeAttribute('data-ed-turning');
        if (t.el.isConnected) this.selection.select(t.el);
        if (keep && view && t.el.isConnected) {
            const s = DMsettings(t.el);
            if (JSON.stringify(s.view) !== JSON.stringify(view)) {
                try { await commit(this.app, t.el, { ...s, view }, 'Turn 3D structure'); }
                catch (err) { this.app.toast('The picture could not be drawn: ' + readable(err), { error: true, ms: 5000 }); }
            }
        }
        this.app.inspector.sync();
    }

    /* Keys while turning: Enter and Esc finish. Returns true when the key was used. */
    handleKey(e) {
        if (!this.t) return false;
        if (e.ctrlKey || e.metaKey) { this.finish(); return false; }
        if (e.key === 'Enter' || e.key === 'Escape') { this.finish(); return true; }
        return true;
    }
}
