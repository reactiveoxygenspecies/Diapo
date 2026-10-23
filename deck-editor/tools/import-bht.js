/* ============================================================
   import-bht.js - brings templates from zarazhangrui/beautiful-html-templates
   (MIT) into the editor's file contract, as app/templates/<slug>.html.

   Run from deck-editor/:   node tools/import-bht.js [slug ...]
   (needs the source files in tools/bht-src/<slug>.html, fetched with
   --fetch, and @playwright/test for a DOM to work in).

   What it does to each source template:
   - CSS: viewport units and clamp()/min()/max() are resolved at 1920x1080
     (the editor's fixed stage), rem becomes px; the source's own stage,
     slide-switching and navigation rules go, the deck-base.css contract
     takes their place; selectors are renamed where the wrapper differs.
   - Markup: the slides move into .deck-viewport > .deck-stage, get data-name
     and the deck's reveal classes (--i) on their text blocks; page numbers
     become live counters; JS-driven decoration is either rewritten as CSS or
     kept as a small deck script with data-generated hosts.
   - Head: the editor's :root theme names (--ink, --paper, --accent ...) are
     added next to the template's own variables, so the Theme panel, swatches
     and "New slide" layouts work; the Google Fonts link stays.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const https = require('https');

const HERE = __dirname;
const APP = path.join(HERE, '..', 'app');
const SRC = path.join(HERE, 'bht-src');
const OUT = path.join(APP, 'templates');
const SKILL = path.join(HERE, '..', '..', 'skills', 'diapo-deck');
const RAW = 'https://raw.githubusercontent.com/zarazhangrui/beautiful-html-templates/main/templates/';

/* ------------------------------------------------------------
   Per-template configuration
   ------------------------------------------------------------ */
const TEMPLATES = {
    'sakura-chroma': {
        name: 'Sakura Chroma',
        tagline: 'Vintage Japanese cassette-package aesthetic: cream paper, diagonal rainbow ribbons, condensed bold type.',
        slidesRoot: '.stage',
        drop: ['*', 'html, body', 'body', '.deck', '.stage', '.slide', '.slide.active', '.nav-hint'],
        rename: [[/(^|[\s,>+~])\.stage(?![\w-])/g, '$1.deck-stage']],
        overlay: ['.deck-stage::before'],
        pagenum: { selector: '.pagenum', master: true },
        theme: {
            ink: '#3A2516', 'ink-2': '#3A2516', 'ink-3': '#8a6a52', rule: '#3A2516', paper: '#F1E6CB', 'paper-2': '#E5D6B0',
            accent: '#E5392A', 'accent-2': '#E54489', 'stage-bg': '#0e0e0e', 'slide-bg': '#F1E6CB',
            font: "'Albert Sans', 'Helvetica Neue', sans-serif", 'font-display': "'Big Shoulders Display', sans-serif",
        },
        base: `h1, h2, h3 { font-family: var(--font-display); font-weight: 900; line-height: 0.9; letter-spacing: -0.02em; color: var(--ink); }
h1 { font-size: 168px; } h2 { font-size: 112px; } h3 { font-size: 64px; }
p { font-size: 30px; line-height: 1.5; } ul, ol { font-size: 30px; line-height: 1.5; padding-left: 40px; } li { margin-bottom: 10px; }
.eyebrow { font-family: var(--font); font-size: 18px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); margin-bottom: 20px; }`,
    },
    'neo-grid-bold': {
        name: 'Neo-Grid Bold',
        tagline: 'Twelve-column card grid on grey with neon-yellow accents, black ink panels and mono tags.',
        slidesRoot: 'deck-stage',
        drop: ['html, body', 'body', 'deck-stage'],
        rename: [],
        pagenum: { selector: '.pagenum', master: false },
        theme: {
            ink: '#0A0A0A', 'ink-2': '#0A0A0A', 'ink-3': '#8A8A85', rule: '#0A0A0A', paper: '#ECECE8', 'paper-2': '#F5F4EF',
            accent: '#E6FF3D', 'accent-2': '#0A0A0A', 'stage-bg': '#1a1a1a', 'slide-bg': '#ECECE8',
            font: '"Space Grotesk", "Helvetica Neue", Helvetica, Arial, sans-serif', 'font-display': '"Space Grotesk", "Helvetica Neue", Helvetica, Arial, sans-serif',
        },
        base: `h1, h2, h3 { font-family: var(--font-display); font-weight: 700; line-height: 0.95; letter-spacing: -0.03em; color: var(--ink); }
h1 { font-size: 150px; } h2 { font-size: 96px; } h3 { font-size: 52px; }
p { font-size: 28px; line-height: 1.45; } ul, ol { font-size: 28px; line-height: 1.5; padding-left: 40px; } li { margin-bottom: 10px; }
.eyebrow { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 20px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 20px; }`,
    },
    'block-frame': {
        name: 'BlockFrame',
        tagline: 'Neobrutalist deck with pastel-neon colour blocks, chunky black borders and hard shadows.',
        slidesRoot: '.slides-container',
        drop: ['*', 'html, body', '.slides-container', '.slide.active', '.slide-counter', '@media (max-width: 1024px)', '@media (max-width: 640px)'],
        slideKeep: true,        // the source's .slide rule carries the layout (padding, flex); its display switching goes
        rename: [],
        pagenum: null,
        masterHtml: '<div class="slide-counter"><span data-page-now>1</span> / <span data-page-total>10</span></div>',
        extraCss: `.slide-counter { position: absolute; bottom: 24px; left: 24px; z-index: 5; font-family: 'Space Grotesk', monospace; font-weight: 700; font-size: 14px; letter-spacing: 0.1em; text-transform: uppercase; border: 3px solid var(--black); background: var(--white); padding: 10px 18px; box-shadow: var(--shadow-sm); }`,
        theme: {
            ink: '#000000', 'ink-2': '#000000', 'ink-3': '#555555', rule: '#000000', paper: '#FFFDF5', 'paper-2': '#FFFFFF',
            accent: '#FE90E8', 'accent-2': '#F7CB46', 'stage-bg': '#111111', 'slide-bg': '#FFFDF5',
            font: "'Inter', sans-serif", 'font-display': "'Space Grotesk', sans-serif",
        },
        base: `h1, h2, h3 { font-family: var(--font-display); font-weight: 700; line-height: 1; letter-spacing: -0.03em; color: var(--ink); }
h1 { font-size: 140px; } h2 { font-size: 88px; } h3 { font-size: 48px; }
p { font-size: 28px; line-height: 1.5; } ul, ol { font-size: 28px; line-height: 1.5; padding-left: 40px; } li { margin-bottom: 10px; }
.eyebrow { font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink); margin-bottom: 20px; }`,
    },
    'studio': {
        name: 'Studio',
        tagline: 'Black canvas with electric-yellow type; high-voltage design studio aesthetic.',
        slidesRoot: '#deck',
        drop: ['html, body', '#deck', '#nav-dots', '#slide-counter', '.nav-dot', '.nav-dot.is-active', '.nav-dot:hover'],
        slideKeep: true,
        rename: [[/\.slide\.is-active/g, '.slide.visible'], [/\[data-anim/g, '[data-fx'], [/\.slide--/g, '.slide--']],
        ownAnim: true,
        attrRename: [['data-anim', 'data-fx']],
        pagenum: null,
        theme: {
            ink: '#f5d200', 'ink-2': '#e8e8e2', 'ink-3': '#8a8a84', rule: '#3a3a36', paper: '#1c1c1c', 'paper-2': '#242422',
            accent: '#f5d200', 'accent-2': '#ffffff', 'stage-bg': '#0c0c0c', 'slide-bg': '#1c1c1c',
            font: "'Barlow', 'Helvetica Neue', Arial, sans-serif", 'font-display': "'Barlow', 'Helvetica Neue', Arial, sans-serif",
        },
        base: `h1, h2, h3 { font-family: var(--font-display); font-weight: 800; line-height: 0.92; letter-spacing: -0.03em; text-transform: uppercase; color: var(--accent); }
h1 { font-size: 200px; } h2 { font-size: 120px; } h3 { font-size: 56px; }
p { font-size: 28px; line-height: 1.5; color: var(--ink-2); } ul, ol { font-size: 28px; line-height: 1.5; padding-left: 40px; } li { margin-bottom: 10px; }
.eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 16px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 20px; }`,
    },
    '8-bit-orbit': {
        name: '8-Bit Orbit',
        tagline: 'Pixel-art neon arcade aesthetic on a deep navy void: scanlines, starfields, CRT glow.',
        slidesRoot: '.slides-container',
        drop: ['*', 'html, body', '.deck', '.slides-container', '.nav-dots', '.nav-dot', '.nav-dot.active', '.nav-dot:hover', '.slide-counter', '.nav-hint',
            '@media (max-width: 768px)', '@media (max-width: 900px)', '@media (max-width: 500px)', '@media (max-width: 700px)', '@media (max-width: 800px)', '@media (max-width: 400px)'],
        slideKeep: true,
        rename: [],
        fix: 'orbit',
        pagenum: null,
        masterHtml: '<div class="slide-counter"><span data-page-now>1</span> / <span data-page-total>10</span></div>',
        extraCss: `.slide-counter { position: absolute; bottom: 24px; right: 24px; font-family: var(--font-mono); font-size: 13px; color: var(--neon-cyan); background: rgba(10, 14, 39, 0.8); padding: 8px 20px; z-index: 5; letter-spacing: 0.15em; }
/* charts: the bars carry their value as --h / --w and grow when the slide shows */
.chart-bar-group { height: 100%; justify-content: flex-end; } .chart-bar { height: var(--h, 0%); } .slide:not(.visible) .chart-bar { height: 0%; }
.hbar-fill { width: var(--w, 0%); } .slide:not(.visible) .hbar-fill { width: 0%; }
@media print { .chart-bar { height: var(--h, 0%) !important; } .hbar-fill { width: var(--w, 0%) !important; } }`,
        theme: {
            ink: '#F4D03F', 'ink-2': '#E2D5F2', 'ink-3': '#8f9bc9', rule: '#2a3a6e', paper: '#0A0E27', 'paper-2': '#0F1B3D',
            accent: '#5EDCF4', 'accent-2': '#F0A6CA', 'stage-bg': '#05071a', 'slide-bg': '#0A0E27',
            font: "'Chakra Petch', sans-serif", 'font-display': "'Tektur', sans-serif",
        },
        base: `h1, h2, h3 { font-family: var(--font-display); font-weight: 800; line-height: 1.05; letter-spacing: 0.02em; text-transform: uppercase; color: var(--ink); }
h1 { font-size: 120px; } h2 { font-size: 80px; } h3 { font-size: 44px; }
p { font-size: 28px; line-height: 1.5; color: var(--ink-2); } ul, ol { font-size: 28px; line-height: 1.5; padding-left: 40px; } li { margin-bottom: 10px; }
.eyebrow { font-family: 'Space Mono', monospace; font-size: 18px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent); margin-bottom: 20px; }`,
    },
};

/* ------------------------------------------------------------
   CSS: resolve viewport maths at the fixed stage size
   ------------------------------------------------------------ */
const VW = 19.2, VH = 10.8, REM = 16;
function num(v) { return Math.round(v * 10) / 10; }
function toPx(arg) {
    const m = /^\s*(-?[\d.]+)\s*(px|vw|vh|vmin|vmax|rem)?\s*$/i.exec(arg);
    if (!m) return null;
    const n = parseFloat(m[1]), u = (m[2] || 'px').toLowerCase();
    if (u === 'px') return n;
    if (u === 'vw') return n * VW;
    if (u === 'vh') return n * VH;
    if (u === 'vmin') return n * Math.min(VW, VH);
    if (u === 'vmax') return n * Math.max(VW, VH);
    if (u === 'rem') return n * REM;
    return null;
}
function resolveCssMath(css) {
    // innermost clamp()/min()/max() whose arguments are all px-resolvable
    const fn = /\b(clamp|min|max)\(([^()]*)\)/;
    let guard = 0, m;
    const keep = [];
    while ((m = fn.exec(css)) && guard++ < 5000) {
        const args = m[2].split(',').map(toPx);
        let out;
        if (args.some(a => a == null)) out = `__K${keep.push(m[0]) - 1}__`;
        else if (m[1] === 'clamp') out = num(Math.min(Math.max(args[1], args[0]), args[2])) + 'px';
        else if (m[1] === 'min') out = num(Math.min(...args)) + 'px';
        else out = num(Math.max(...args)) + 'px';
        css = css.slice(0, m.index) + out + css.slice(m.index + m[0].length);
    }
    css = css.replace(/__K(\d+)__/g, (_, i) => keep[+i]);
    // bare viewport units elsewhere (inside calc(), gradients, positions)
    css = css.replace(/(-?[\d.]+)(vw|vh|vmin|vmax|rem)\b/g, (s, n) => num(toPx(s)) + 'px');
    return css;
}

/* Top-level rules of a stylesheet: [{sel, body, raw}] (at-rules kept whole). */
function splitRules(css) {
    const out = [];
    let i = 0;
    while (i < css.length) {
        const j = css.indexOf('{', i);
        if (j < 0) break;
        let depth = 1, k = j + 1;
        while (k < css.length && depth) { if (css[k] === '{') depth++; else if (css[k] === '}') depth--; k++; }
        out.push({ sel: css.slice(i, j).trim(), body: css.slice(j + 1, k - 1), raw: css.slice(i, k) });
        i = k;
    }
    return out;
}
const MECHANISM = /^(position|top|left|right|bottom|inset|width|height|min-height|min-width|opacity|visibility|pointer-events|transition|transition-[\w-]+|z-index|flex|will-change)$/;
function cleanCss(css, cfg) {
    const norm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();   // comments before a rule are part of its raw text, not its selector
    const drop = new Set(cfg.drop.map(norm));
    const parts = [];
    const rules = splitRules(css);
    // a source that shows slides with display:flex/grid on .slide.active needs that display on every slide
    const active = rules.find(r => norm(r.sel) === '.slide.active');
    const activeDisplay = active && (/display\s*:\s*([^;]+)/.exec(active.body) || [])[1];
    for (const r of rules) {
        const s = norm(r.sel);
        if (s === '.slide' && cfg.slideKeep) {
            // keep the layout the source gives every slide, not how it hides them
            const decls = r.body.split(';').map(d => d.trim()).filter(Boolean).filter(d => !MECHANISM.test(d.split(':')[0].trim()) && !/^display\s*:\s*none/.test(d));
            if (activeDisplay && activeDisplay.trim() !== 'none') decls.push('display: ' + activeDisplay.trim());
            if (decls.length) parts.push(`.slide {\n  ${decls.join(';\n  ')};\n}`);
            continue;
        }
        if (drop.has(s)) continue;
        let raw = r.raw;
        // A rule on a slide itself (.slide-5, .s-cover, .slide--split) must not undo the stage contract
        // (absolute inside the stage, 1920x1080): those declarations go, the rest stays.
        if (s.split(',').every(p => /^(section)?\.(slide|s-)[\w-]*(\.[\w-]+)*$/.test(p.trim()))) {
            raw = raw.replace(/(^|[;{\s])(position|width|height|min-height|min-width|top|left|right|bottom|inset|flex)\s*:[^;}]*;?/g, '$1');
        }
        for (const [re, to] of cfg.rename) raw = raw.replace(re, to);
        parts.push(raw.trim());
    }
    let out = parts.join('\n');
    for (const sel of cfg.overlay || []) {
        // a stage-level texture must sit over the (opaque) slides
        out = out.replace(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*{([^}]*)}'), (m, body) => sel + ' {' + body.replace(/z-index\s*:\s*[^;]+;?/, '') + ' z-index: 3; }');
    }
    return out;
}

/* ------------------------------------------------------------
   Markup, done with a real DOM in headless Chrome
   ------------------------------------------------------------ */
const DOM_SCRIPT = `(args) => {
    const { html, cfg, transformClasses } = args;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const root = doc.querySelector(cfg.slidesRoot);
    if (!root) throw new Error('no slides root ' + cfg.slidesRoot);
    const slides = Array.from(root.querySelectorAll(':scope > section.slide'));
    const hasText = (el) => (el.textContent || '').trim().length > 0;
    const decorative = (el) => el.getAttribute('aria-hidden') === 'true' || Array.from(el.classList).some(c => transformClasses.includes(c)) || /rotate|scale|translate/.test(el.style.transform || '');
    const skipTags = new Set(['ASIDE', 'SCRIPT', 'STYLE', 'BR', 'HR', 'IMG', 'SVG', 'CANVAS', 'VIDEO']);
    function tag(el, depth, counter) {
        const kids = Array.from(el.children).filter(k => !skipTags.has(k.tagName) && !decorative(k) && hasText(k) && !k.querySelector('[data-page-now]') && !k.hasAttribute('data-page-now'));
        if (kids.length === 1 && depth < 3) {
            const only = kids[0];
            const inner = Array.from(only.children).filter(k => !skipTags.has(k.tagName) && !decorative(k) && hasText(k));
            if (inner.length >= 2) { tag(only, depth + 1, counter); return; }
        }
        for (const k of kids) {
            if (k.classList.contains('reveal') || k.hasAttribute('data-fx')) continue;
            k.classList.add('reveal');
            k.style.setProperty('--i', String(counter.i++));
        }
    }
    const out = [];
    let masterPagenum = null;
    slides.forEach((s, i) => {
        s.classList.remove('active', 'is-active');
        // a readable name from the source's own labels
        let name = s.getAttribute('data-label') || '';
        if (!name) { const c = Array.from(s.classList).find(c => /^(s-|slide--|slide-\\d)/.test(c)); name = c ? c.replace(/^(s-|slide--|slide-)/, '') : ''; }
        if (!/[a-z]/i.test(name) || /^\\d+$/.test(name)) { const h = s.querySelector('h1, h2, h3, .hero, .stmt'); name = h ? h.textContent.trim().slice(0, 24) : 'slide ' + (i + 1); }
        name = name.replace(/^\\d+\\s*/, '').replace(/\\s+/g, ' ').trim().toLowerCase();
        s.setAttribute('data-name', name);
        for (const a of ['data-om-validate', 'data-slide', 'data-label']) s.removeAttribute(a);
        for (const [from, to] of cfg.attrRename || []) s.querySelectorAll('[' + from + ']').forEach(el => { el.setAttribute(to, el.getAttribute(from)); el.removeAttribute(from); });
        if (cfg.pagenum) {
            s.querySelectorAll(cfg.pagenum.selector).forEach(p => {
                if (cfg.pagenum.master) { if (!masterPagenum) masterPagenum = p.cloneNode(true); p.remove(); }
                else p.innerHTML = p.innerHTML.replace(/\\d+\\s*\\/\\s*\\d+/, '<span data-page-now>1</span> / <span data-page-total>' + slides.length + '</span>').replace(/^\\s*\\d+\\s*$/, '<span data-page-now>1</span>');
            });
        }
        // "04 / 12" written into a slide becomes a live counter (starting at 1: what the runtime writes at load, so the file round-trips)
        s.querySelectorAll('*').forEach(el => { if (el.children.length === 0 && /^\\s*\\d{1,2}\\s*\\/\\s*\\d{1,2}\\s*$/.test(el.textContent)) el.innerHTML = '<span data-page-now>1</span> / <span data-page-total>' + slides.length + '</span>'; });
        if (cfg.fix === 'orbit') {
            // the source draws stars, particles and a landscape with JS at load; written out once here
            let seed = 7 + i;
            const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
            s.querySelectorAll('.starfield').forEach(host => { const n = 30 + Math.round(rnd() * 20); host.innerHTML = Array.from({ length: n }, () => '<div class="star" style="left:' + (rnd() * 100).toFixed(1) + '%;top:' + (rnd() * 100).toFixed(1) + '%;animation-delay:' + (rnd() * 3).toFixed(2) + 's"></div>').join(''); });
            s.querySelectorAll('.pixel-particles').forEach(host => { const colours = ['var(--neon-cyan)', 'var(--neon-pink)', 'var(--neon-yellow)']; host.innerHTML = Array.from({ length: 16 }, (_, k) => '<div class="p" style="background:' + colours[k % 3] + ';left:' + (rnd() * 100).toFixed(1) + '%;top:' + (rnd() * 100).toFixed(1) + '%;animation-delay:' + (rnd() * 5).toFixed(2) + 's;animation-duration:' + (6 + rnd() * 6).toFixed(2) + 's"></div>').join(''); });
            s.querySelectorAll('.pixel-landscape').forEach(host => { const hs = [30, 50, 70, 40, 60, 35, 55, 45, 80, 25, 50, 40]; host.innerHTML = hs.map((h, k) => '<div class="mountain" style="height:' + h + 'px;width:' + (60 + (k % 3) * 20) + 'px"></div>').join(''); });
            s.querySelectorAll('.chart-bar[data-height]').forEach(b => { b.style.removeProperty('height'); b.style.setProperty('--h', b.dataset.height + '%'); b.removeAttribute('data-height'); });
            s.querySelectorAll('.hbar-fill[data-width]').forEach(b => { b.style.removeProperty('width'); b.style.setProperty('--w', b.dataset.width + '%'); b.removeAttribute('data-width'); });
            s.querySelectorAll('.chart-value[data-value]').forEach(v => { v.textContent = v.dataset.value; v.removeAttribute('data-value'); });
            s.querySelectorAll('.stat-number[data-target]').forEach(v => { v.textContent = v.dataset.target + (v.dataset.suffix || ''); v.removeAttribute('data-target'); v.removeAttribute('data-suffix'); });
            s.querySelectorAll('[id]').forEach(el => { if (/^(starfield|particles|landscape|barChart|hbarChart|statsGrid)/.test(el.id)) el.removeAttribute('id'); });
        }
        if (!cfg.ownAnim) tag(s, 0, { i: 0 });
        if (i === 0) s.classList.add('active');
    });
    // keep the source's section comments as slide dividers
    const nodes = Array.from(root.childNodes);
    let html2 = '';
    for (const n of nodes) {
        if (n.nodeType === 8 && /\\S/.test(n.data)) html2 += '\\n<!-- ' + n.data.trim().replace(/[-─═]{3,}/g, '').trim() + ' -->\\n';
        else if (n.nodeType === 1 && n.matches('section.slide')) html2 += n.outerHTML + '\\n';
    }
    let master = cfg.masterHtml ? cfg.masterHtml.replace(/data-page-total>\\d+/, 'data-page-total>' + slides.length) : '';
    if (masterPagenum) { masterPagenum.innerHTML = '<span data-page-now>1</span> / <span data-page-total>' + slides.length + '</span>'; master = masterPagenum.outerHTML; }
    return { slides: html2, master, count: slides.length };
}`;

/* ------------------------------------------------------------
   Assembly
   ------------------------------------------------------------ */
function between(text, start, end) { const i = text.indexOf(start), j = text.indexOf(end, i + start.length); return i < 0 || j < 0 ? '' : text.slice(i + start.length, j); }

async function convert(slug, page) {
    const cfg = TEMPLATES[slug];
    const src = fs.readFileSync(path.join(SRC, slug + '.html'), 'utf8');
    const fontsLink = (src.match(/<link[^>]+fonts\.googleapis\.com\/css2[^>]*>/) || [''])[0].replace(/\s*\/>$/, '>');
    let css = (src.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || []).map(s => s.replace(/^<style[^>]*>|<\/style>$/g, '')).join('\n');
    css = css.replace(/\r\n/g, '\n');
    css = resolveCssMath(css);
    css = cleanCss(css, cfg);
    // the :root block from the source stays as it is (the template's own names); ours is added before it
    const transformClasses = [];
    for (const r of splitRules(css)) if (/(^|[;\s])transform\s*:/.test(r.body)) for (const m of r.sel.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([\w-]+)/g)) transformClasses.push(m[1]);

    const dom = await page.evaluate(`(${DOM_SCRIPT})(${JSON.stringify({ html: src, cfg: { ...cfg, rename: undefined }, transformClasses })})`);

    const base = fs.readFileSync(path.join(SKILL, 'deck-base.css'), 'utf8').replace(/\r\n/g, '\n');
    const controller = fs.readFileSync(path.join(SKILL, 'deck-controller.js'), 'utf8').replace(/\r\n/g, '\n');
    const runtime = fs.readFileSync(path.join(APP, 'deck-runtime.js'), 'utf8').replace(/\r\n/g, '\n');
    const theme = Object.entries(cfg.theme).map(([k, v]) => `    --${k}: ${v};`).join('\n');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${cfg.name}</title>
<!-- ${cfg.name}: adapted from beautiful-html-templates (github.com/zarazhangrui/beautiful-html-templates, MIT)
     for the deck editor's fixed 1920x1080 stage. ${cfg.tagline} -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fontsLink}

<style>
/* ===========================================
   THEME - the editor's Theme panel lists these; the properties panel offers the
   colours as swatches. The template's own variables follow below.
   =========================================== */
:root {
${theme}

    --pad-x: 96px;
    --pad-top: 72px;
    --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --dur: 0.7s;
    --stagger: 0.12s;
    --reveal-y: 28px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

${base.trim()}

/* ===========================================
   TYPE - base styles for slides added in the editor ("New slide" keeps its tags)
   =========================================== */
${cfg.base}

/* ===========================================
   ${cfg.name.toUpperCase()} - the template's own design system
   =========================================== */
${css.trim()}
${cfg.extraCss ? '\n/* editor adaptation */\n' + cfg.extraCss + '\n' : ''}</style>
</head>
<body>

<div class="deck-viewport">
<main class="deck-stage" id="deckStage">
${dom.slides}
${dom.master ? '<!-- The master layer: shown on every slide, edited once in the editor -->\n' + dom.master + '\n' : ''}
</main>
</div>

<div class="deck-controls" aria-label="Slide controls">
    <button id="btnPrev" title="Previous">←</button>
    <span class="page"><span id="pageNow">1</span> / <span id="pageTotal">${dom.count}</span></span>
    <button id="btnNext" title="Next">→</button>
</div>

<script>
${controller.trim()}
</script>

<!-- Presentation features: P presenter, O overview, L laser, D draw, Space steps through fragments. Added by the deck editor; safe to delete. -->
<script id="deck-runtime">
${runtime.trim()}
</script>
</body>
</html>
`;
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, slug + '.html'), html);   // LF, like every text file in the repository (.gitattributes)
    return { file: slug + '.html', slides: dom.count, bytes: html.length };
}

function fetch(url, dest) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) return reject(new Error(res.statusCode + ' ' + url));
            const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { fs.writeFileSync(dest, Buffer.concat(chunks)); resolve(); });
        }).on('error', reject);
    });
}

(async () => {
    const args = process.argv.slice(2);
    const doFetch = args.includes('--fetch');
    const slugs = args.filter(a => !a.startsWith('--'));
    const list = slugs.length ? slugs : Object.keys(TEMPLATES);
    fs.mkdirSync(SRC, { recursive: true });
    if (doFetch) for (const s of list) { await fetch(RAW + s + '/template.html', path.join(SRC, s + '.html')); console.log('fetched', s); }
    const { chromium } = require('@playwright/test');
    const browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage();
    for (const s of list) console.log(await convert(s, page));
    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
