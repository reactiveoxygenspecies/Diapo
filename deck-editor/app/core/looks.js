/* ============================================================
   looks.js - the ready-made looks of the Theme panel: the colours,
   fonts and margins of the bundled designs, put onto any deck.

   app/templates/looks.json (written by tools/build-templates.py)
   holds each design's :root colour, font and size variables, named
   the editor's way (ink, ink-2, rule, paper, accent, font,
   font-display, pad-x...), and the Google families its fonts need.

   lookVars(deck, look) works out what a look changes in a deck:
   - a variable the look has under the same name takes its value
     (every deck made in Diapo, and decks made from that design);
   - any other is matched by its role: what its name says (bg,
     text, border, primary...), whether it is vivid enough to be an
     accent, what the deck's CSS uses it for (color, background,
     border) and how light it is next to the slide's own background
     and text. A background darker than the slide's text side (an
     inverted panel) takes the look's text colour and the text on it
     the look's background, so contrast survives the swap;
   - a variable that points at another, var(--x), follows it, and
     what cannot be matched (state colours such as danger or
     success, sizes other than the margins) is left alone.
   ============================================================ */
import { colourKey } from './dom.js';

let cache = null;
export async function loadLooks() {
    if (!cache) cache = fetch('/templates/looks.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : { looks: [] }).then(j => j.looks || []).catch(() => { cache = null; return []; });
    return cache;
}

const MOTION = new Set(['dur', 'ease-out', 'stagger', 'reveal-y']);
const COLOUR_RE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i;
const GENERIC_FONT = /\b(serif|sans-serif|monospace|cursive|fantasy|system-ui)\b/i;

/* What a variable is, from its value: a colour, a font stack or a length (or null). */
function kindOf(name, value) {
    const v = String(value).trim();
    if (COLOUR_RE.test(v) || /^(transparent|white|black)$/i.test(v)) return 'colour';
    if ((/font|family|typeface/i.test(name) || GENERIC_FONT.test(v)) && /[a-z]/i.test(v) && !/^\d/.test(v) && !/^var\(/.test(v)) return 'font';
    if (/^-?[\d.]+(px|em|rem|%|vw|vh)$/i.test(v)) return 'length';
    return null;
}

/* [r, g, b] (0-255) of a colour the deck resolves, and its lightness and colourfulness. */
function rgbOf(deck, value) {
    const probe = deck.doc.createElement('i');
    probe.style.color = value;
    deck.doc.body.appendChild(probe);
    const c = deck.win.getComputedStyle(probe).color;
    probe.remove();
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(c);
    return m ? [+m[1], +m[2], +m[3]] : null;
}
/* Lightness as the eye sees it (CIE L*, 0 to 100): mid grey is near 50, so "nearer the
   background than the text" means what it looks like. */
function lightness([r, g, b]) {
    const lin = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}
function chroma([r, g, b]) { return (Math.max(r, g, b) - Math.min(r, g, b)) / 255; }

/* Role from the name alone, or null. */
const SKIP = /(danger|error|success|warn|warning|positive|negative|info|ok|good|bad|shadow|overlay|scrim)/i;
function roleFromName(name) {
    const n = '-' + name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/_/g, '-') + '-';
    const has = (words) => new RegExp(`-(${words})(?=-|\\d)`).test(n);
    if (has('stage')) return 'stage';
    if (has('accent|primary|brand|highlight|pop|hot|tint|key')) return 'accent';
    if (has('border|rule|line|lines|divider|stroke|hairline|outline|grid')) return 'lines';
    if (has('bg|background|paper|surface|canvas|page|slide|base|panel|card')) return 'background';
    if (has('ink|text|fg|foreground|copy|body|heading|title|muted|subtle|caption|color|colour')) return 'text';
    return null;
}

/* How the deck's own CSS uses each variable: counts of color / background / border declarations. */
function usage(deck) {
    const out = new Map();
    const text = deck.deckStyles().map(b => b.css).join('\n');
    for (const m of text.matchAll(/([\w-]+)\s*:\s*([^;{}]*var\(--[\w-]+[^;{}]*)/g)) {
        const prop = m[1].toLowerCase();
        const kind = prop === 'color' ? 'text'
            : /^background/.test(prop) || prop === 'fill' ? 'background'
            : /^(border|outline)/.test(prop) || prop === 'stroke' ? 'lines' : null;
        if (!kind) continue;
        for (const v of m[2].matchAll(/var\(--([\w-]+)/g)) {
            const u = out.get(v[1]) || { text: 0, background: 0, lines: 0 };
            u[kind]++;
            out.set(v[1], u);
        }
    }
    return out;
}

/* The look's value for a role (the n-th of that role in the deck). */
function roleValue(vars, role, n) {
    const pick = (...names) => { for (const k of names) if (vars[k] != null) return vars[k]; return null; };
    if (role === 'text') return pick(['ink', 'ink-2', 'ink-3'][Math.min(n, 2)], 'ink');
    if (role === 'background') return pick(n ? 'paper-2' : 'paper', 'slide-bg', 'paper');
    if (role === 'inverted-background') return pick('ink');
    if (role === 'inverted-text') return pick('paper', 'slide-bg');
    if (role === 'lines') return pick(n ? 'rule-2' : 'rule', 'rule');
    if (role === 'stage') return pick('stage-bg');
    if (role === 'accent') {
        const accents = Object.keys(vars).filter(k => /^accent(-\d+)?$/.test(k)).map(k => vars[k]);
        return accents.length ? accents[n % accents.length] : null;
    }
    if (role === 'font-body') return pick('font', 'font-body');
    if (role === 'font-display') return pick('font-display', 'font-heading', 'font');
    if (role === 'font-mono') return pick('font-mono');
    if (role === 'font-hand') return pick('font-hand', 'font-display', 'font');
    return null;
}

/* What applying the look changes: { vars: {name: value}, considered, matched, families }.
   `considered` counts the deck's colour, font and margin variables, `matched` those given a value. */
export function lookVars(deck, look) {
    const lv = look.vars || {};
    const own = deck.rootProperties({ effective: false }).filter(p => !p.added && !MOTION.has(p.name));
    const byName = new Map(own.map(p => [p.name, p.value]));
    const out = {};
    let considered = 0;
    const loose = [];     // colour and font variables with no same-named partner in the look
    for (const p of own) {
        const v = String(p.value).trim();
        const alias = /^var\(--([\w-]+)\)$/.exec(v);
        // A pointer to another variable follows it, unless the look sets this one itself (slide-bg).
        let kind = kindOf(p.name, alias && byName.has(alias[1]) ? byName.get(alias[1]) : v);
        if (!kind) continue;
        if (kind === 'length' && lv[p.name] == null) continue;     // sizes only by name: a deck's own spacing scale means nothing to a look
        considered++;
        if (lv[p.name] != null) { out[p.name] = lv[p.name]; continue; }
        if (alias) { considered--; continue; }
        loose.push({ name: p.name, value: v, kind });
    }

    // Colours: the slide's own background and text colour say which side is light.
    const slide = deck.doc.querySelector('.deck-stage .slide') || deck.doc.body;
    const cs = deck.win.getComputedStyle(slide);
    const bgRgb = rgbOf(deck, cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) ? cs.backgroundColor : deck.win.getComputedStyle(deck.doc.body).backgroundColor) || [255, 255, 255];
    const textRgb = rgbOf(deck, cs.color) || [0, 0, 0];
    const Lb = lightness(bgRgb), Lt = lightness(textRgb);
    const used = usage(deck);
    const counts = {};
    const take = (role) => { const n = counts[role] || 0; counts[role] = n + 1; return n; };
    const colours = [];
    for (const x of loose.filter(l => l.kind === 'colour')) {
        if (SKIP.test(x.name)) continue;
        const rgb = rgbOf(deck, x.value);
        if (!rgb) continue;
        const L = lightness(rgb), nearText = Math.abs(L - Lt) < Math.abs(L - Lb);
        let role = roleFromName(x.name);
        if (!role && chroma(rgb) >= 0.25) role = 'accent';
        if (!role) {
            const u = used.get(x.name);
            if (u && (u.text || u.background || u.lines)) role = u.lines >= u.text && u.lines >= u.background ? 'lines' : u.background > u.text ? 'background' : 'text';
        }
        if (!role) role = nearText ? 'text' : 'background';
        // A panel on the text's side of the lightness scale is inverted, and so is the text on it.
        if (role === 'background' && nearText) role = 'inverted-background';
        else if (role === 'text' && !nearText) role = 'inverted-text';
        colours.push({ ...x, role, L, accentN: /accent-?(\d+)$/i.exec(x.name) });
    }
    // Text in order of contrast with the slide (strongest first), backgrounds nearest the slide first.
    const rank = new Map();
    const order = { text: (a, b) => Math.abs(b.L - Lb) - Math.abs(a.L - Lb), background: (a, b) => Math.abs(a.L - Lb) - Math.abs(b.L - Lb) };
    for (const [role, cmp] of Object.entries(order)) colours.filter(c => c.role === role).sort(cmp).forEach((c, i) => rank.set(c, i));
    for (const c of colours) {
        const n = rank.has(c) ? rank.get(c) : c.role === 'accent' && c.accentN ? Math.max(0, +c.accentN[1] - 1) : take(c.role);
        const v = roleValue(lv, c.role, n);
        if (v != null) out[c.name] = v;
    }
    for (const x of loose.filter(l => l.kind === 'font')) {
        const n = x.name.toLowerCase();
        const role = /(mono|code)/.test(n) ? 'font-mono' : /(hand|script)/.test(n) ? 'font-hand' : /(display|head|title|hero)/.test(n) ? 'font-display' : 'font-body';
        const v = roleValue(lv, role, 0);
        if (v != null) out[x.name] = v;
    }
    const matched = Object.keys(out).length;
    // A value the deck already has is no change.
    for (const [k, v] of Object.entries(out)) {
        const cur = deck.overrides.vars[k] != null ? deck.overrides.vars[k] : byName.get(k);
        if (cur != null && sameValue(cur, v)) delete out[k];
    }
    const families = new Set();
    for (const [k, v] of Object.entries(out)) if (kindOf(k, v) === 'font') families.add(String(v).split(',')[0].trim().replace(/^["']|["']$/g, ''));
    return { vars: out, considered, matched, families: [...families] };
}
function sameValue(a, b) {
    const x = String(a).trim(), y = String(b).trim();
    return x === y || (COLOUR_RE.test(x) && colourKey(x) === colourKey(y));
}

/* The colours a card shows: background first, then text and the accents, one of each. */
export function lookStrip(vars) {
    const names = ['paper', 'slide-bg', 'ink', 'accent', 'accent-2', 'accent-3', 'paper-2'];
    const out = [], seen = new Set();
    for (const n of names) {
        const v = vars[n];
        if (!v || !COLOUR_RE.test(String(v).trim())) continue;
        const k = colourKey(v);
        if (seen.has(k)) continue;
        seen.add(k); out.push(v);
    }
    // A saved theme may use other names: fall back to whatever colours it has.
    if (out.length < 3) for (const v of Object.values(vars)) { if (out.length >= 5) break; if (COLOUR_RE.test(String(v).trim()) && !seen.has(colourKey(v))) { seen.add(colourKey(v)); out.push(v); } }
    return out.slice(0, 5);
}
/* The heading font of a set of variables (the display font, else the body font). */
export function lookFont(vars) {
    const v = vars['font-display'] || vars['font-heading'] || vars.font || vars['font-body'] || Object.entries(vars).find(([k, x]) => kindOf(k, x) === 'font')?.[1];
    return v ? String(v) : '';
}
