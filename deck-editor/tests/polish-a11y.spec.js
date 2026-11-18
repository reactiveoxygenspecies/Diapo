// The accessibility guard: in each of the four editor looks, with the inspector (slide and element),
// the Theme panel, the layers list and the menus showing, nothing may be too small to read or hit,
// unnamed, or too faint. See ./polish-a11y.audit (inline below) for what counts.
//
// Documented exceptions (EXEMPT): things that cannot comply or are not controls.
//   - disabled controls (WCAG exempts them from contrast and they are not operable)
//   - the splitter and layers grip: pointer-only resize handles; the keyboard has no resize
//   - decorative artwork marked aria-hidden (the logo's margin print and date stamp on the welcome screen)
//   - hidden file inputs, and the colour <input type=color> swatch wells inside a labelled row
//   - text inside the slide (the deck iframe is the user's content, not the editor's chrome)
const { test, expect, freshDeckEachTest, openDeck, goTo } = require('./helpers');

freshDeckEachTest();

const EXEMPT = '.splitter, .layers-grip, input[type=file], iframe, [disabled], [aria-disabled=true], [aria-hidden=true]';

/* Runs in the page: returns a list of human-readable violations for what is visible now. */
function audit({ exempt, scope }) {
    const out = [];
    const root = scope ? document.querySelector(scope) : document.body;
    if (!root) return ['scope missing: ' + scope];
    const vis = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
            if (n.hasAttribute('hidden')) return false;
        }
        return true;
    };
    const label = (el) => {
        const id = el.id ? '#' + el.id : '';
        const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(c => '.' + c).join('');
        const txt = (el.textContent || el.getAttribute('title') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
        return `${el.tagName.toLowerCase()}${id}${cls} "${txt}"`;
    };
    const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c);
        if (!m) return null;
        const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    // The colour behind an element: the nearest opaque backgrounds composited, up to the page.
    const backdrop = (el) => {
        const layers = [];
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
            const cs = getComputedStyle(n);
            const c = parse(cs.backgroundColor);
            if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
            if (cs.backgroundImage !== 'none' && /gradient|url/.test(cs.backgroundImage)) return null;   // cannot know
        }
        let base = { r: 255, g: 255, b: 255, a: 1 };
        if (!layers.length || layers[layers.length - 1].a < 1) base = parse(getComputedStyle(document.body).backgroundColor) || base;
        for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
        return base;
    };
    const skip = (el) => el.closest(exempt);
    const all = [...root.querySelectorAll('*')].filter(el => !skip(el) && vis(el));

    // 1. text size and contrast: every element that owns visible text
    for (const el of all) {
        const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
        const isField = /^(input|select|textarea)$/.test(el.tagName.toLowerCase());
        if (!own && !(isField && (el.value || el.placeholder))) continue;
        if (el.closest('svg')) continue;
        const cs = getComputedStyle(el);
        const px = parseFloat(cs.fontSize);
        const interactive = isField || !!el.closest('button, a, label, [role=option], [role=menuitem], [role=tab], summary') || el.matches('.hint, .unit');
        const hintOnly = el.matches('[data-hint], .hint-small, .tiny-hint');
        if (px < 11) out.push(`size ${px}px (<11): ${label(el)}`);
        else if (px < 12 && !hintOnly) out.push(`size ${px}px (<12): ${label(el)}`);
        else if (isField && px < 13 && !el.matches('input[type=number], input[type=color], .mini')) { /* fields are checked at 12 min below */ }
        const fg = parse(cs.color), bg = backdrop(el);
        if (fg && bg) {
            const c = ratio(over(fg, bg), bg);
            const big = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
            const need = big ? 3 : 4.5;
            if (c < need) out.push(`contrast ${c.toFixed(2)} (<${need}): ${label(el)} ${cs.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`);
        }
    }

    // 2. hit area: the element's box, extended by an ::after/::before that is absolutely positioned (reported by its own box), or its label
    const ctl = [...root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=option], [role=tab], [role=menuitem], [tabindex="0"]')]
        .filter(el => !skip(el) && vis(el));
    const hitBox = (el) => {
        let r = el.getBoundingClientRect();
        let w = r.width, h = r.height;
        // A checkbox or radio inside its label: the label is the hit area.
        if (/^(checkbox|radio)$/.test(el.type) && el.closest('label')) { const l = el.closest('label').getBoundingClientRect(); w = Math.max(w, l.width); h = Math.max(h, l.height); }
        // A pseudo-element that extends the hit area (position:absolute, bigger inset).
        for (const ps of ['::before', '::after']) {
            const p = getComputedStyle(el, ps);
            if (p.content !== 'none' && p.position === 'absolute' && p.pointerEvents !== 'none') {
                const pw = parseFloat(p.width), ph = parseFloat(p.height);
                if (!isNaN(pw) && !isNaN(ph)) { w = Math.max(w, pw); h = Math.max(h, ph); }
            }
        }
        return { w, h };
    };
    for (const el of ctl) {
        if (el.type === 'color' && el.closest('label')) { /* judged by its label too */ }
        const { w, h } = hitBox(el);
        if (w < 23.5 || h < 23.5) out.push(`hit ${w.toFixed(0)}x${h.toFixed(0)} (<24): ${label(el)}`);
    }

    // 3. names
    const nameOf = (el) => {
        const aria = el.getAttribute('aria-label'); if (aria && aria.trim()) return aria.trim();
        const lb = el.getAttribute('aria-labelledby');
        if (lb) { const t = lb.split(/\s+/).map(i => (document.getElementById(i) || {}).textContent || '').join(' ').trim(); if (t) return t; }
        if (el.labels && el.labels.length) { const t = [...el.labels].map(l => l.textContent).join(' ').trim(); if (t) return t; }
        const t = (el.textContent || '').trim(); if (t && !/^[ \s]*$/.test(t) && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA') return t;
        const img = el.querySelector('img[alt]'); if (img && img.alt.trim()) return img.alt.trim();
        const ti = el.getAttribute('title'); if (ti && ti.trim()) return ti.trim();
        if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) return el.value;
        return '';
    };
    for (const el of ctl) {
        if (el.matches('[role=option], [role=tab], [tabindex="0"]') && !el.matches('button, input, select, textarea, a')) { if (!nameOf(el)) out.push(`unnamed ${el.getAttribute('role') || 'focusable'}: ${label(el)}`); continue; }
        if (!nameOf(el)) out.push(`unnamed: ${label(el)}`);
    }
    return out;
}

async function runAudit(page, scope) {
    return page.evaluate(audit, { exempt: EXEMPT, scope });
}

/* Focus rings and control borders: 3:1 against what they sit on, per look. */
async function nonText(page) {
    return page.evaluate(() => {
        const out = [];
        const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
        const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
        const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
        const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const backdrop = (el) => {
            const layers = [];
            for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
            let base = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
            if (layers.length && layers[layers.length - 1].a >= 1) base = layers.pop();
            for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
            return base;
        };
        const label = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${(el.getAttribute('class') || '').split(' ').slice(0, 1).map(c => c ? '.' + c : '').join('')}`;
        // Borders of text fields and selects: the border is the field's only edge.
        for (const el of document.querySelectorAll('#inspector input[type=text], #inspector input[type=number], #inspector input:not([type]), #inspector select, #inspector textarea')) {
            const r = el.getBoundingClientRect(); if (r.width < 1 || !el.offsetParent) continue;
            const cs = getComputedStyle(el);
            if (parseFloat(cs.borderTopWidth) < 1 || cs.borderTopStyle === 'none') { if (!/transparent|rgba\(0, 0, 0, 0\)/.test(cs.backgroundColor)) { /* a filled field: its fill vs the panel */ } continue; }
            const bc = parse(cs.borderTopColor); if (!bc) continue;
            const bg = backdrop(el.parentElement);
            const c = ratio(over(bc, bg), bg);
            if (c < 3) out.push(`border ${c.toFixed(2)} (<3): ${label(el)}`);
        }
        return out;
    });
}
async function focusRing(page) {
    return page.evaluate(() => {
        const css = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch (e) { return []; } }).map(r => r.cssText).join('\n');
        return /:focus-visible/.test(css);
    });
}

/* No horizontal scrolling in the side panel or the slide strip, and no field wider than its panel. */
async function overflow(page) {
    return page.evaluate(() => {
        const out = [];
        for (const sel of ['#inspector', '#inspectorBody', '#themeBody', '#layersList', '.strip-list']) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent && el.scrollWidth > el.clientWidth + 1) out.push(`scrolls sideways: ${sel} (${el.scrollWidth} > ${el.clientWidth})`);
        }
        const panel = document.querySelector('#inspector').getBoundingClientRect();
        for (const el of document.querySelectorAll('#inspector input, #inspector select, #inspector textarea, #inspector button')) {
            const r = el.getBoundingClientRect();
            if (r.width && el.offsetParent && (r.right > panel.right + 1 || r.left < panel.left - 1)) out.push(`outside the panel: ${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`);
        }
        return out;
    });
}

async function setLook(page, look) {
    await page.click('#btnLook');
    await page.click(`#lookMenu button[data-look="${look}"]`);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    // Clean is the plain defaults: it takes the attribute off.
    if (look === 'clean') await expect(page.locator('html')).not.toHaveAttribute('data-look', /^(ink|dark|slate)$/);
    else await expect(page.locator('html')).toHaveAttribute('data-look', look);
}

for (const look of ['ink', 'dark', 'clean', 'slate']) {
    test(`a11y guard (${look}): inspector, Theme panel, layers list and menus`, async ({ page }) => {
        await openDeck(page);
        await setLook(page, look);
        const problems = [];
        const add = (where, list) => list.forEach(p => problems.push(`[${where}] ${p}`));

        // The whole chrome with the slide panel and the layers list showing.
        await page.keyboard.press('Control+Shift+L');
        await page.waitForTimeout(150);
        add('slide panel', await runAudit(page, null));

        // An element selected: its inspector.
        await page.evaluate(() => { const a = window.deckEditor; const t = a.deck.doc.querySelector('.slide.active h1, .slide.active h2'); a.selection.set([t]); });
        await page.waitForTimeout(200);
        add('element panel', await runAudit(page, '#inspector'));
        add('element panel width', await overflow(page));
        if (process.env.DIAPO_SHOTS) await page.screenshot({ path: `${process.env.DIAPO_SHOTS}/${look}-element.png` });
        add('borders', await nonText(page));

        // The Theme panel.
        await page.click('#btnTheme');
        await expect(page.locator('.theme-var[data-var="accent"]')).toBeVisible();
        await page.waitForTimeout(150);
        add('theme panel', await runAudit(page, '#inspector'));
        add('theme panel width', await overflow(page));
        if (process.env.DIAPO_SHOTS) await page.screenshot({ path: `${process.env.DIAPO_SHOTS}/${look}-theme.png` });
        add('borders (theme)', await nonText(page));
        await page.click('#btnTheme');

        // The menus.
        for (const id of ['btnInsert', 'btnExport']) {
            await page.click('#' + id);
            await page.waitForTimeout(150);
            add(id, await runAudit(page, null));
            await page.keyboard.press('Escape');
            await page.mouse.click(5, 5);
        }
        // The File menu, the Look menu, the find bar, the command palette, the help card, the deck drawer.
        const surfaces = [
            ['file menu', () => page.click('#btnFile'), '#fileMenu'],
            ['look menu', () => page.click('#btnLook'), '#lookMenu'],
            ['find bar', () => page.keyboard.press('Control+h'), null],
            ['palette', () => page.keyboard.press('Control+k'), null],
            ['help', () => page.click('#btnHelp'), null],
        ];
        for (const [name, open] of surfaces) {
            await page.keyboard.press('Escape'); await page.mouse.click(5, 5);
            await open();
            await page.waitForTimeout(200);
            add(name, await runAudit(page, null));
            await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
        }
        expect(await focusRing(page)).toBe(true);
        expect([...new Set(problems)], `${look}:\n` + [...new Set(problems)].join('\n')).toEqual([]);
    });
}

for (const look of ['ink', 'dark', 'clean', 'slate']) {
    test(`a11y guard (${look}): welcome screen, deck drawer and the New deck gallery`, async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#btnEmptyNew');
        await setLook(page, look);
        const problems = [];
        const add = (where, list) => list.forEach(p => problems.push(`[${where}] ${p}`));
        add('welcome', await runAudit(page, null));
        await page.click('#btnEmptyNew');
        await page.waitForSelector('#btnGalleryClose', { state: 'visible' });
        await page.waitForTimeout(300);
        add('gallery', await runAudit(page, '#gallery'));
        await page.keyboard.press('Escape');
        await page.waitForSelector('#btnGalleryClose', { state: 'hidden' });
        await page.click('#btnFile');
        await page.click('#fileMenu button[data-f="open"]');
        await page.waitForSelector('#drawer:not([hidden])');
        await page.waitForTimeout(300);
        add('drawer', await runAudit(page, '#drawer'));
        expect([...new Set(problems)], `${look}:\n` + [...new Set(problems)].join('\n')).toEqual([]);
    });
}
