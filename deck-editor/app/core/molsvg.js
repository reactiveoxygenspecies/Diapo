/* ============================================================
   molsvg.js - a structure drawn from its own 2D coordinates.

   The model comes from chemfile.js (a Molfile, an SDF record, a
   CDXML page). It is drawn as SmilesDrawer draws a SMILES in chem.js,
   with SmilesDrawer's own numbers, so the two kinds look alike on a
   slide: bonds 30 units long (the file's median bond is scaled to
   it) and 1.2 thick with round caps; double bonds 5.1 apart, the
   inner line of a ring bond 80% long, a bond off a ring or at a
   chain end centred on its two atoms; triple bonds 3.4 apart; wedges
   0.6 to 5.75 wide, hashes every 3.75; atom labels 11pt in the
   figure's font, hydrogens and charges written beside them, bonds
   stopped 8.25 short of a label. Carbon and bonds are currentColor;
   other atoms take the colours chem.js passes in, and a bond into
   one fades into its colour as SmilesDrawer's do (a radial
   gradient). CDXML reaction arrows and captions are drawn too.
   Returns markup: chem.js puts it in the figure's <svg>.
   ============================================================ */

const L = 30, THICK = 1.2, SPACING = 5.1, SHORT = 0.8, TRIPLE = 3.4, CLIP = 8.25;
const WEDGE0 = 0.6, WEDGE1 = 3 + 11 / 4, HASH_STEP = 3.75, HASH_W = 5.5;
const FONT_PX = 11 * 4 / 3;                     // 11pt, SmilesDrawer's label size
const SUB = '₀₁₂₃₄₅₆₇₈₉', SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sub = (n) => String(n).replace(/\d/g, d => SUB[d]);
const sup = (s) => String(s).replace(/\d/g, d => SUP[d]).replace(/\+/g, '⁺').replace(/-/g, '⁻');

// Arial's advance widths in em, to centre an atom's symbol on its place (the font is the deck's, so near enough).
const W = { A: .667, B: .667, C: .722, D: .722, E: .667, F: .611, G: .778, H: .722, I: .278, J: .5, K: .667, L: .556, M: .833, N: .722, O: .778, P: .667, Q: .778, R: .722, S: .667, T: .611, U: .722, V: .667, W: .944, X: .667, Y: .667, Z: .611,
    a: .556, b: .556, c: .5, d: .556, e: .556, f: .278, g: .556, h: .556, i: .222, j: .222, k: .5, l: .222, m: .833, n: .556, o: .556, p: .556, q: .556, r: .333, s: .5, t: .278, u: .556, v: .5, w: .722, x: .5, y: .5, z: .5 };
const widthOf = (s, px = FONT_PX) => Array.from(String(s)).reduce((w, ch) => w + (W[ch] ?? (/[0-9]/.test(ch) ? .556 : /[⁰-⁹₀-₉⁺⁻•]/.test(ch) ? .42 : .6)), 0) * px;

const r2 = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* The drawing of `mol`: { body (the <svg>'s content), box: { x, y, w, h } (its viewBox) }.
   colours: { N: '#...', O: '#...' } by element, upper-case keys ({} for one colour); circles: aromatic rings as circles. */
export function drawMol(mol, { colours = {}, circles = false } = {}) {
    const atoms = mol.atoms, bonds = mol.bonds;
    // Scale: the median bond to SmilesDrawer's 30.
    const lens = bonds.map(b => Math.hypot(atoms[b.a].x - atoms[b.b].x, atoms[b.a].y - atoms[b.b].y)).filter(d => d > 1e-6).sort((p, q) => p - q);
    const med = lens.length ? lens[lens.length >> 1] : (mol.format === 'cdxml' ? 14.4 : 1.5);
    const k = L / med, flip = mol.yDown ? 1 : -1;
    const P = atoms.map(a => ({ x: a.x * k, y: a.y * k * flip }));
    const nb = atoms.map(() => []);
    bonds.forEach((b, i) => { nb[b.a].push(i); nb[b.b].push(i); });
    const deg = nb.map(l => l.length);
    const uid = Math.random().toString(36).slice(2, 7).replace(/^\d/, 'm');
    const ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const grow = (x, y, r = 0) => { ext.x0 = Math.min(ext.x0, x - r); ext.y0 = Math.min(ext.y0, y - r); ext.x1 = Math.max(ext.x1, x + r); ext.y1 = Math.max(ext.y1, y + r); };
    P.forEach(p => grow(p.x, p.y));

    // Rings: the smallest one through each bond (for the side of a double bond and the circles).
    const rings = findRings(bonds, nb);
    const ringOf = bonds.map((b, i) => {
        const list = rings.filter(r => r.bonds.includes(i));
        if (!list.length) return null;
        list.sort((p, q) => p.atoms.length - q.atoms.length || dbl(q) - dbl(p));
        return list[0];
    });
    function dbl(r) { return r.bonds.filter(i => bonds[i].order === 2 || bonds[i].order === 4).length; }
    rings.forEach(r => {
        r.c = r.atoms.reduce((s, i) => ({ x: s.x + P[i].x / r.atoms.length, y: s.y + P[i].y / r.atoms.length }), { x: 0, y: 0 });
        // Aromatic: every bond given as aromatic, or six atoms with three double bonds, alternating.
        r.aromatic = r.bonds.every(i => bonds[i].order === 4) || (r.atoms.length === 6 && r.bonds.filter(i => bonds[i].order === 2).length === 3 && r.bonds.every(i => bonds[i].order <= 2) && alternating(r));
    });
    function alternating(r) {
        return r.atoms.every(i => r.bonds.filter(b => (bonds[b].a === i || bonds[b].b === i) && bonds[b].order === 2).length === 1);
    }
    const circled = new Set();
    if (circles) rings.forEach(r => { if (r.aromatic) r.bonds.forEach(i => circled.add(i)); });
    // Aromatic bonds no Kekulé form was found for are drawn in their ring with a dashed inner line.

    // Labels: which atoms show one, what it says and where.
    const colourOf = (el) => el && colours[String(el).toUpperCase()] || null;
    const labels = atoms.map((a, i) => labelFor(a, i));
    function labelFor(a, i) {
        const dx = nb[i].reduce((s, bi) => s + P[other(bonds[bi], i)].x - P[i].x, 0);
        const dir = deg[i] && dx > 1 ? 'left' : 'right';
        if (!a.el) {
            // An abbreviation or an R group: its text, where ChemDraw put it when it says.
            const runs = (a.runs || [{ text: a.label || '?', face: 0 }]).map(r => ({ text: r.face & 32 ? sub(r.text) : r.face & 64 ? sup(r.text) : r.text, fill: null }));
            const text = runs.map(r => r.text).join('');
            let x, y, anchor;
            if (a.cdText) {
                const rr = FONT_PX / (a.cdText.size * k);
                x = P[i].x + (a.cdText.x * k - P[i].x) * rr; y = P[i].y + (a.cdText.y * k - P[i].y) * rr; anchor = a.cdText.anchor;
            } else if (dir === 'right') { x = P[i].x - widthOf(text[0]) / 2; y = P[i].y + 0.36 * FONT_PX; anchor = 'start'; }
            else { x = P[i].x + widthOf(text[text.length - 1]) / 2; y = P[i].y + 0.36 * FONT_PX; anchor = 'end'; }
            return { runs, x, y, anchor, width: widthOf(text) };
        }
        const shown = a.el !== 'C' || a.show || a.charge || a.iso || a.rad || deg[i] === 0;
        if (!shown) return null;
        const h = a.hImpl || 0;
        const charge = a.charge ? sup((Math.abs(a.charge) > 1 ? Math.abs(a.charge) : '') + (a.charge > 0 ? '+' : '-')) : '';
        const pre = a.iso ? sup(a.iso) : '';
        const core = pre + a.el + charge + (a.rad ? '•' : '');
        const hs = h ? 'H' + (h > 1 ? sub(h) : '') : '';
        const fill = colourOf(a.el);
        const y = P[i].y + 0.36 * FONT_PX;
        if (!hs && !pre && !charge && !a.rad) return { runs: [{ text: a.el, fill }], x: P[i].x, y, anchor: 'middle', width: widthOf(a.el) };
        if (dir === 'right') return { runs: [{ text: core, fill }, ...(hs ? [{ text: hs, fill: null }] : [])], x: P[i].x - widthOf(pre) - widthOf(a.el) / 2, y, anchor: 'start', width: widthOf(core + hs) };
        return { runs: [...(hs ? [{ text: hs, fill: null }] : []), { text: core, fill }], x: P[i].x + widthOf(a.el) / 2 + widthOf(charge + (a.rad ? '•' : '')), y, anchor: 'end', width: widthOf(core + hs) };
    }
    const clipAt = (i) => labels[i] ? CLIP : 0;

    // Gradients: a bond into a coloured atom fades into its colour, as SmilesDrawer draws it.
    const defs = [];
    const grad = atoms.map((a, i) => {
        const c = a.el && a.el !== 'C' && a.el !== 'H' ? colourOf(a.el) : null;
        if (!c || !deg[i]) return null;
        const id = `${uid}-atom-${i}`;
        defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${r2(P[i].x)}" cy="${r2(P[i].y)}" r="${L}"><stop offset="20%" stop-color="${c}"></stop><stop offset="80%" stop-color="currentColor"></stop></radialGradient>`);
        return `url(#${id})`;
    });

    const out = [];
    const line = (x1, y1, x2, y2, stroke, extra = '', width = THICK) => {
        out.push(`<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"${extra}></line>`);
        grow(x1, y1, width); grow(x2, y2, width);
    };
    // A line along a bond, `off` to its side, from t0 to t1 of its length, stopped short of labels.
    function seg(bi, off, t0 = 0, t1 = 1, extra = '', width = THICK) {
        const b = bonds[bi], p = P[b.a], q = P[b.b];
        const len = Math.hypot(q.x - p.x, q.y - p.y); if (len < 1e-6) return;
        const ux = (q.x - p.x) / len, uy = (q.y - p.y) / len, nx = -uy, ny = ux;
        const ca = clipAt(b.a), cb = clipAt(b.b);
        let s = t0 * len, e = t1 * len;
        if (ca) s = Math.max(s, Math.sqrt(Math.max(0, ca * ca - off * off)));
        if (cb) e = Math.min(e, len - Math.sqrt(Math.max(0, cb * cb - off * off)));
        if (e - s < 0.5) return;
        const at = (t) => ({ x: p.x + ux * t + nx * off, y: p.y + uy * t + ny * off });
        const A = at(s), B = at(e);
        const ga = grad[b.a], gb = grad[b.b];
        if (ga && gb) { const M = at(len / 2); if (len / 2 > s) line(A.x, A.y, M.x, M.y, ga, extra, width); if (len / 2 < e) line(M.x, M.y, B.x, B.y, gb, extra, width); }
        else line(A.x, A.y, B.x, B.y, ga || gb || 'currentColor', extra, width);
    }
    // The side a double bond's second line goes: into its ring, or towards the substituents.
    function side(bi) {
        const b = bonds[bi], p = P[b.a], q = P[b.b];
        const len = Math.hypot(q.x - p.x, q.y - p.y) || 1, nx = -(q.y - p.y) / len, ny = (q.x - p.x) / len;
        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        const r = ringOf[bi];
        if (r) return Math.sign(nx * (r.c.x - mx) + ny * (r.c.y - my)) || 1;
        if (b.centre || deg[b.a] === 1 || deg[b.b] === 1) return 0;
        let s = 0;
        for (const i of [b.a, b.b]) for (const o of nb[i]) { if (o === bi) continue; const j = other(bonds[o], i); s += Math.sign(nx * (P[j].x - mx) + ny * (P[j].y - my)); }
        return Math.sign(s);
    }

    bonds.forEach((b, bi) => {
        const p = P[b.a], q = P[b.b];
        const len = Math.hypot(q.x - p.x, q.y - p.y); if (len < 1e-6) return;
        const ux = (q.x - p.x) / len, uy = (q.y - p.y) / len, nx = -uy, ny = ux;
        const fill = grad[b.b] || grad[b.a] || 'currentColor';
        const st = b.order === 1 || b.order === 0 ? b.stereo : null;
        if (st === 'wedge' || st === 'hollow') {
            const s = clipAt(b.a), e = len - clipAt(b.b);
            if (e - s < 0.5) return;
            const w = (t) => WEDGE0 + (WEDGE1 - WEDGE0) * t / len;
            const pt = (t, sgn) => `${r2(p.x + ux * t + nx * w(t) * sgn)},${r2(p.y + uy * t + ny * w(t) * sgn)}`;
            out.push(st === 'wedge' ? `<polygon points="${pt(s, 1)} ${pt(e, 1)} ${pt(e, -1)} ${pt(s, -1)}" fill="${fill}"></polygon>`
                : `<polygon points="${pt(s, 1)} ${pt(e, 1)} ${pt(e, -1)} ${pt(s, -1)}" fill="none" stroke="${fill}" stroke-width="${THICK}" stroke-linejoin="round"></polygon>`);
            grow(q.x, q.y, WEDGE1);
            return;
        }
        if (st === 'hash' || st === 'hashed') {
            const s = clipAt(b.a), e = len - clipAt(b.b) + 0.01;
            for (let t = Math.max(HASH_STEP, s); t <= e; t += HASH_STEP) {
                const hw = st === 'hash' ? Math.max(0.6, HASH_W * t / len) : HASH_W * 0.6;
                const cx = p.x + ux * t, cy = p.y + uy * t;
                line(cx - nx * hw, cy - ny * hw, cx + nx * hw, cy + ny * hw, fill);
            }
            return;
        }
        if (st === 'wavy') {
            const s = clipAt(b.a), e = len - clipAt(b.b);
            const n = Math.max(3, Math.round((e - s) / 4)), step = (e - s) / n;
            let d = `M${r2(p.x + ux * s)} ${r2(p.y + uy * s)}`;
            for (let j = 1; j <= n; j++) { const t = s + step * j; d += ` A${r2(step / 2)} ${r2(step / 2)} 0 0 ${j % 2} ${r2(p.x + ux * t)} ${r2(p.y + uy * t)}`; }
            out.push(`<path d="${d}" fill="none" stroke="${fill}" stroke-width="${THICK}" stroke-linecap="round"></path>`);
            grow(p.x, p.y, 3); grow(q.x, q.y, 3);
            return;
        }
        if (st === 'bold') { seg(bi, 0, 0, 1, '', 4); return; }
        if (st === 'dash' || (b.order === 0 && b.type === 'hydrogen')) { seg(bi, 0, 0, 1, ' stroke-dasharray="2.5 3"'); return; }
        if (circled.has(bi) || b.order === 1 || b.order === 0) { seg(bi, 0); return; }
        if (b.order === 3) { seg(bi, 0); seg(bi, TRIPLE); seg(bi, -TRIPLE); return; }
        // Double, or aromatic with no Kekulé form: into the ring, else to the substituents' side, else centred.
        const sd = side(bi);
        const inner = b.order === 4 ? ' stroke-dasharray="2.5 2.5"' : '';
        if (sd) { seg(bi, 0); seg(bi, sd * SPACING, (1 - SHORT) / 2, (1 + SHORT) / 2, inner); }
        else { seg(bi, SPACING / 2); seg(bi, -SPACING / 2, 0, 1, inner); }
    });
    // The circles: inside each aromatic ring, as SmilesDrawer draws them (its inner radius less the bond spacing).
    if (circles) rings.forEach(r => {
        if (!r.aromatic) return;
        const rad = Math.min(...r.bonds.map(i => distToLine(r.c, P[bonds[i].a], P[bonds[i].b]))) - SPACING;
        if (rad > 2) out.push(`<circle cx="${r2(r.c.x)}" cy="${r2(r.c.y)}" r="${r2(rad)}" stroke="currentColor" stroke-width="${THICK}" fill="none"></circle>`);
    });

    // Atom labels.
    const texts = [];
    labels.forEach((lb) => {
        if (!lb) return;
        const spans = lb.runs.map(r => `<tspan fill="${r.fill || 'currentColor'}">${esc(r.text)}</tspan>`).join('');
        texts.push(`<text x="${r2(lb.x)}" y="${r2(lb.y)}" fill="currentColor" dominant-baseline="alphabetic"${lb.anchor === 'start' ? '' : ` text-anchor="${lb.anchor}"`} style="font-size: 11pt; font-family: inherit">${spans}</text>`);
        const x0 = lb.anchor === 'start' ? lb.x : lb.anchor === 'end' ? lb.x - lb.width : lb.x - lb.width / 2;
        grow(x0, lb.y - FONT_PX * 0.75); grow(x0 + lb.width, lb.y + FONT_PX * 0.25);
    });

    // CDXML's page: reaction arrows and captions, on the same scale.
    const extra = [];
    for (const a of mol.arrows || []) {
        const x1 = a.x1 * k, y1 = a.y1 * k, x2 = a.x2 * k, y2 = a.y2 * k;
        const len = Math.hypot(x2 - x1, y2 - y1); if (len < 1) continue;
        const ux = (x2 - x1) / len, uy = (y2 - y1) / len, lx = uy, ly = -ux;       // (lx, ly): the arrow's left, on screen
        const shaft = (ox, oy, from, to) => { extra.push(`<line x1="${r2(from.x + ox)}" y1="${r2(from.y + oy)}" x2="${r2(to.x + ox)}" y2="${r2(to.y + oy)}" stroke="currentColor" stroke-width="${THICK}" stroke-linecap="round"></line>`); };
        const head = (tip, dx, dy, kind, hollow) => {
            const hl = 10, hw = 3.5, bx = tip.x - dx * hl, by = tip.y - dy * hl, px = dy, py = -dx;   // (px, py): left of the head's direction
            const left = `${r2(bx + px * hw)},${r2(by + py * hw)}`, right = `${r2(bx - px * hw)},${r2(by - py * hw)}`, t = `${r2(tip.x)},${r2(tip.y)}`, mid = `${r2(tip.x - dx * hl * 0.8)},${r2(tip.y - dy * hl * 0.8)}`;
            const pts = kind === 'half-left' ? `${t} ${left} ${mid}` : kind === 'half-right' ? `${t} ${mid} ${right}` : `${t} ${left} ${mid} ${right}`;
            extra.push(`<polygon points="${pts}" fill="${hollow ? 'none' : 'currentColor'}" stroke="currentColor" stroke-width="${hollow ? THICK : 0.5}" stroke-linejoin="round"></polygon>`);
        };
        const T = { x: x1, y: y1 }, H = { x: x2, y: y2 };
        if (a.twin) {
            const o = Math.max(2.5, a.twin * k / 2);
            shaft(lx * o, ly * o, T, H); shaft(-lx * o, -ly * o, T, H);
            if (a.head) head({ x: H.x + lx * o, y: H.y + ly * o }, ux, uy, a.head, a.hollow);
            if (a.tail) head({ x: T.x - lx * o, y: T.y - ly * o }, -ux, -uy, a.tail, a.hollow);
            grow(x1, y1, o + 4); grow(x2, y2, o + 4);
        } else {
            shaft(0, 0, T, H);
            if (a.head) head(H, ux, uy, a.head, a.hollow);
            if (a.tail) head(T, -ux, -uy, a.tail, a.hollow);
            grow(x1, y1, 4); grow(x2, y2, 4);
        }
    }
    for (const t of mol.texts || []) {
        // Captions as ChemDraw sizes them against its 10 pt labels: the same size as the atom labels here.
        const px = t.size * FONT_PX / 10, lh = t.lineHeight * FONT_PX / 10;
        t.lines.forEach((runs, n) => {
            if (!runs.length) return;
            const x = t.x * k, y = t.y * k + n * lh;
            const text = runs.map(r => r.face & 32 ? sub(r.text) : r.face & 64 ? sup(r.text) : r.text).join('');
            const spans = runs.map(r => `<tspan${r.face & 1 ? ' font-weight="bold"' : ''}${r.face & 2 ? ' font-style="italic"' : ''}>${esc(r.face & 32 ? sub(r.text) : r.face & 64 ? sup(r.text) : r.text)}</tspan>`).join('');
            extra.push(`<text x="${r2(x)}" y="${r2(y)}" fill="currentColor"${t.anchor === 'start' ? '' : ` text-anchor="${t.anchor}"`} style="font-size: ${r2(px)}px; font-family: inherit">${spans}</text>`);
            const w = widthOf(text, px), x0 = t.anchor === 'start' ? x : t.anchor === 'end' ? x - w : x - w / 2;
            grow(x0, y - px * 0.75); grow(x0 + w, y + px * 0.25);
        });
    }

    if (!Number.isFinite(ext.x0)) { ext.x0 = 0; ext.y0 = 0; ext.x1 = 10; ext.y1 = 10; }
    const pad = 4;
    const box = { x: r2(ext.x0 - pad), y: r2(ext.y0 - pad), w: r2(ext.x1 - ext.x0 + 2 * pad), h: r2(ext.y1 - ext.y0 + 2 * pad) };
    const body = (defs.length ? `<defs>${defs.join('')}</defs>` : '') + `<g>${out.join('')}</g><g>${texts.join('')}</g>` + (extra.length ? `<g>${extra.join('')}</g>` : '');
    return { body, box };
}

const other = (b, i) => b.a === i ? b.b : b.a;

function distToLine(c, p, q) {
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return Math.abs((q.x - p.x) * (p.y - c.y) - (p.x - c.x) * (q.y - p.y)) / len;
}

/* The smallest ring through each bond (up to 8 atoms): { atoms, bonds }, each ring once. */
function findRings(bonds, nb) {
    const seen = new Map();
    bonds.forEach((b, bi) => {
        // Breadth first from b.a to b.b without this bond.
        const prev = new Map([[b.a, -1]]), q = [b.a], depth = new Map([[b.a, 0]]);
        while (q.length) {
            const i = q.shift();
            if (i === b.b) break;
            if (depth.get(i) >= 7) continue;
            for (const o of nb[i]) {
                if (o === bi) continue;
                const j = other(bonds[o], i);
                if (prev.has(j)) continue;
                prev.set(j, o); depth.set(j, depth.get(i) + 1); q.push(j);
            }
        }
        if (!prev.has(b.b)) return;
        const ra = [b.b], rb = [bi];
        let i = b.b;
        while (i !== b.a) { const o = prev.get(i); rb.push(o); i = other(bonds[o], i); ra.push(i); }
        if (ra.length < 3) return;
        const key = [...ra].sort((x, y) => x - y).join(',');
        if (!seen.has(key)) seen.set(key, { atoms: ra, bonds: rb });
    });
    return [...seen.values()];
}
