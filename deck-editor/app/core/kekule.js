/* ============================================================
   kekule.js - aromatic SMILES written with alternating bonds.

   SmilesDrawer draws an aromatic ring (c1ccccc1) with a circle
   inside; chemists mostly draw it with alternating double bonds, as
   ChemDraw does. kekulize() rewrites the SMILES that way before it
   is drawn: the aromatic atoms in capitals, a double bond placed on
   every atom that needs one (a perfect matching over the aromatic
   bonds, found by a small backtracking search). What it cannot do
   (a ring that has no such matching, a reaction, anything odd) comes
   back unchanged, and is then drawn with circles as before.
   ============================================================ */

const TOKEN = /\[[^\]]*\]|Br|Cl|[BCNOPSFI]|[bcnops]|\*|%\d\d|\d|[-=#$:\/\\.]|[()]/y;
const VALENCE = { b: 3, c: 4, n: 3, o: 2, p: 3, s: 2, se: 2, as: 3 };
const ORDER = { '-': 1, '/': 1, '\\': 1, '=': 2, '#': 3, '$': 4 };

export function kekulize(smiles) {
    try { return run(smiles); } catch (e) { return smiles; }
}

function run(smiles) {
    if (!/[bcnops]/.test(smiles.replace(/\[[^\]]*\]/g, m => /^\[\d*(se|as|[bcnops])/.test(m) ? 'c' : '')) || /[>]/.test(smiles)) return smiles;
    // Tokens
    const toks = [];
    TOKEN.lastIndex = 0;
    while (TOKEN.lastIndex < smiles.length) {
        const at = TOKEN.lastIndex, m = TOKEN.exec(smiles);
        if (!m || m.index !== at) return smiles;                 // something this does not read: leave it be
        toks.push(m[0]);
    }
    // Atoms and bonds
    const atoms = [], bonds = [], rings = new Map(), stack = [];
    let prev = -1, bondTok = -1;
    toks.forEach((t, i) => {
        if (t === '(') { stack.push(prev); return; }
        if (t === ')') { prev = stack.pop(); return; }
        if (t === '.') { prev = -1; bondTok = -1; return; }
        if (t.length === 1 && t in ORDER || t === ':') { bondTok = i; return; }
        if (/^(%\d\d|\d)$/.test(t)) {
            const open = rings.get(t);
            if (open) { rings.delete(t); addBond(open.atom, prev, open.bondTok >= 0 ? open.bondTok : bondTok, i, true); }
            else rings.set(t, { atom: prev, bondTok });
            bondTok = -1;
            return;
        }
        const a = atomOf(t, i);
        atoms.push(a);
        if (prev >= 0) addBond(prev, atoms.length - 1, bondTok, i, false);
        prev = atoms.length - 1; bondTok = -1;
    });
    if (rings.size || stack.length) return smiles;
    function addBond(a, b, tokIdx, insertAt, ring) {
        const sym = tokIdx >= 0 ? toks[tokIdx] : '';
        const aromatic = atoms[a].aromatic && atoms[b].aromatic && (sym === '' || sym === ':');
        bonds.push({ a, b, sym, tokIdx, insertAt, ring, aromatic, order: aromatic ? 0 : (ORDER[sym] || 1) });
    }
    // Which aromatic atoms need a double bond: room left after their bonds and hydrogens.
    const need = atoms.map((a, i) => {
        if (!a.aromatic) return false;
        let used = a.h;
        for (const b of bonds) if (b.a === i || b.b === i) used += b.aromatic ? 1 : b.order;
        return a.valence - used >= 1;
    });
    // A perfect matching of those atoms over aromatic bonds between them.
    const options = atoms.map(() => []);
    bonds.forEach((b, k) => { if (b.aromatic && need[b.a] && need[b.b]) { options[b.a].push(k); options[b.b].push(k); } });
    const mate = new Array(atoms.length).fill(-1), chosen = new Set();
    let steps = 0;
    const solve = () => {
        if (++steps > 50000) throw new Error('too long');
        let best = -1, bestN = Infinity;
        for (let i = 0; i < atoms.length; i++) {
            if (!need[i] || mate[i] >= 0) continue;
            const n = options[i].filter(k => mate[other(bonds[k], i)] < 0).length;
            if (n < bestN) { best = i; bestN = n; if (n === 0) return false; }
        }
        if (best < 0) return true;
        for (const k of options[best]) {
            const j = other(bonds[k], best);
            if (mate[j] >= 0) continue;
            mate[best] = j; mate[j] = best; chosen.add(k);
            if (solve()) return true;
            mate[best] = -1; mate[j] = -1; chosen.delete(k);
        }
        return false;
    };
    if (!solve()) return smiles;
    // Written back: capitals, and '=' on the chosen bonds (in place of ':' or before the second atom / ring digit).
    const out = toks.slice();
    for (const a of atoms) if (a.aromatic) out[a.tok] = a.upper;
    bonds.forEach((b, k) => {
        if (!b.aromatic) return;
        const sym = chosen.has(k) ? '=' : '';
        if (b.tokIdx >= 0) out[b.tokIdx] = sym;
        else if (sym) out[b.insertAt] = sym + out[b.insertAt];
    });
    return out.join('');
}

const other = (b, i) => b.a === i ? b.b : b.a;

function atomOf(t, tok) {
    if (t[0] !== '[') {
        const aromatic = /^[bcnops]$/.test(t);
        return { tok, aromatic, valence: VALENCE[t] || 0, h: 0, upper: t.toUpperCase() };
    }
    const m = /^\[(\d*)(se|as|[bcnops]|[A-Z][a-z]?|\*)(.*)\]$/.exec(t);
    if (!m) return { tok, aromatic: false };
    const el = m[2], rest = m[3];
    const aromatic = el in VALENCE && el === el.toLowerCase();
    if (!aromatic) return { tok, aromatic: false };
    const hm = /H(\d*)/.exec(rest), h = hm ? (hm[1] ? +hm[1] : 1) : 0;
    const cm = /([+-])(\d*)$/.exec(rest.replace(/:\d+$/, '')), charge = cm ? (cm[1] === '+' ? 1 : -1) * (cm[2] ? +cm[2] : (rest.match(/[+-]/g) || []).length) : 0;
    let valence = VALENCE[el];
    if (el === 'c') valence = charge ? 3 : 4;
    else if (el === 'b') valence = charge < 0 ? 4 : 3;
    else valence += charge;
    const upper = '[' + m[1] + el.charAt(0).toUpperCase() + el.slice(1) + rest + ']';
    return { tok, aromatic: true, valence, h, upper };
}
