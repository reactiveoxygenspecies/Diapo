// The deck's look: the Theme panel, fonts, slide size, the master layer, the Code section, the editor's own look.
// Run with: npx playwright test   (from the deck-editor folder)
const { test, expect, fs, path, freshDeckEachTest, DECK_DIR, FILE, centre, drag, goTo, openDeck, own, readDeck, save, stagePoint, stageRect } = require('./helpers');

freshDeckEachTest();

/* ------------------------------------------------------------
   11. Theme overrides
   ------------------------------------------------------------ */
test('11 theme: variables, base styles and custom CSS go into one override block; reset removes it', async ({ page }) => {
    await openDeck(page);
    const original = readDeck();
    await page.click('#btnTheme');
    await expect(page.locator('.theme-var[data-var="accent"]')).toBeVisible();
    const field = page.locator('.theme-var[data-var="accent"] .theme-text');
    await field.fill('#8e1c2f');
    await field.dispatchEvent('change');
    const eyebrow = await page.evaluate(() => window.deckEditor.deck.win.getComputedStyle(window.deckEditor.deck.doc.querySelector('.eyebrow')).color);
    expect(eyebrow).toBe('rgb(142, 28, 47)');
    const size = page.locator('.theme-base tr[data-sel="h1"] td[data-prop="font-size"] input');
    await size.fill('90');
    await size.dispatchEvent('change');
    await page.locator('#thCss').fill('.slide p { letter-spacing: 1px; }');
    await page.locator('#thCss').dispatchEvent('change');
    await save(page);
    const saved = readDeck();
    const block = /<style id="deck-editor-overrides">[\s\S]*?<\/style>/.exec(saved);
    expect(block).not.toBeNull();
    expect(block[0]).toContain('--accent: #8e1c2f;');
    expect(block[0]).toContain('.deck-stage .slide h1 {');
    expect(block[0]).toContain('.slide p { letter-spacing: 1px; }');
    expect(saved.indexOf('</head>')).toBeGreaterThan(block.index);
    expect(saved.replace(block[0], '').replace(/\n\n<\/head>/, '\n</head>')).toBe(original);

    // Reloading reads the block back; reset removes it and the file is the original again.
    await openDeck(page);
    await page.click('#btnTheme');
    await expect(page.locator('.theme-var[data-var="accent"]')).toHaveClass(/set/);
    await page.locator('#themeBody [data-act="reset"]').click();
    await save(page);
    expect(readDeck()).toBe(original);
});

/* ------------------------------------------------------------
   17. Fonts
   ------------------------------------------------------------ */
test('17 fonts: the picker adds a Google family with the weights it has, the block round-trips, undo removes both', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => { const d = window.deckEditor.deck; window.deckEditor.selection.select(d.doc.querySelector('.slide.active h1')); });
    await expect(page.locator('#inspFont')).toHaveText('Montserrat');
    // Weights come from what the deck loads plus what Google has for the family (Montserrat has 100-900).
    const weights = await page.locator('#inspWeight option').allTextContents();
    expect(weights.some(t => t.startsWith('900'))).toBe(true);
    await page.click('#inspFont');
    await expect(page.locator('.fontpick')).toBeVisible();
    await page.fill('.fontpick-search', 'lobster');
    await expect(page.locator('.fontpick-item[data-name="Lobster"]')).toHaveCount(1);
    await page.click('.fontpick-item[data-name="Lobster"]');
    await expect(page.locator('.fontpick')).toBeHidden();
    await expect(page.locator('#inspFont')).toHaveText('Lobster');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('.slide.active h1').style.fontFamily)).toBe('Lobster, sans-serif');
    // Lobster only has 400: the weight menu says so.
    expect((await page.locator('#inspWeight option').allTextContents()).filter(t => /^\d/.test(t))).toEqual(['400 regular']);
    const block = () => page.evaluate(() => { const s = window.deckEditor.deck.doc.getElementById('deck-editor-fonts'); return s ? s.textContent : ''; });
    expect(await block()).toContain('@import url("https://fonts.googleapis.com/css2?family=Lobster:wght@400&display=swap")');
    await save(page);
    const saved = readDeck();
    expect(saved).toContain('<style id="deck-editor-fonts">');
    expect(saved).toContain('family=Lobster:wght@400');
    expect(saved.indexOf('deck-editor-fonts')).toBeLessThan(saved.indexOf('</head>'));
    expect(saved).toContain('rel="stylesheet">');                       // the deck's own link is untouched
    // Reopen: the state is read back from the block.
    await openDeck(page);
    expect(await page.evaluate(() => window.deckEditor.deck.fonts.google)).toEqual({ Lobster: { weights: [400], italics: [] } });
    await page.waitForFunction(() => Array.from(window.deckEditor.deck.doc.fonts).some(f => f.family.includes('Lobster')));
    // One undo step removes the style and the font block together.
    await page.evaluate(() => { const d = window.deckEditor.deck; window.deckEditor.selection.select(d.doc.querySelector('.slide.active h1')); });
    await page.click('#inspFont');
    await page.click('.fontpick-item[data-name="Inter"]');
    expect(await block()).toContain('Inter');
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await block()).not.toContain('Inter');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('.slide.active h1').style.fontFamily)).toBe('Lobster, sans-serif');
});

test('18 fonts: download into fonts/ makes the deck self-contained; Use Google Fonts again restores the link', async ({ page }) => {
    let online = true;
    try { await fetch('https://fonts.googleapis.com/css2?family=Lobster', { signal: AbortSignal.timeout(5000) }); } catch (e) { online = false; }
    test.skip(!online, 'needs Google Fonts');
    await openDeck(page);
    await page.keyboard.press('Control+t');
    await expect(page.locator('#thFonts')).toContainText('Montserrat');
    await expect(page.locator('#thFonts')).toContainText('loaded online');
    await page.click('#thFontActs [data-act=host]');
    await expect(page.locator('#thFonts')).toContainText('in fonts/', { timeout: 60000 });
    const fontsDir = path.join(DECK_DIR, 'fonts');
    expect(fs.existsSync(fontsDir)).toBe(true);
    expect(fs.readdirSync(fontsDir).some(f => /^Montserrat-400-latin\.woff2$/.test(f))).toBe(true);
    await save(page);
    let saved = readDeck();
    expect(saved).toContain('<!--deck-editor:hosted <link href="https://fonts.googleapis.com/css2?family=Montserrat');
    expect(saved).toMatch(/@font-face \{ font-family: 'Montserrat'; font-style: normal; font-weight: 400; font-display: swap; src: url\(fonts\/Montserrat-400-latin\.woff2\)/);
    expect(saved.replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/<link href="https:\/\/fonts\.googleapis/);
    // The standalone file loads the faces from fonts/ (no Google request needed).
    const requests = [];
    page.on('request', r => { if (/googleapis|gstatic/.test(r.url())) requests.push(r.url()); });
    await openDeck(page);
    expect(requests).toEqual([]);
    expect(await page.evaluate(() => Array.from(window.deckEditor.deck.doc.fonts).some(f => f.family.includes('Montserrat') && f.status === 'loaded'))).toBe(true);
    // Back to Google: the comment becomes a link again and the faces go.
    await page.keyboard.press('Control+t');
    await page.click('#thFontActs [data-act=unhost]');
    await save(page);
    saved = readDeck();
    expect(saved).not.toContain('deck-editor:hosted');
    expect(saved).not.toContain('@font-face');
    expect(saved).toMatch(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Montserrat[^>]*rel="stylesheet">/);
    expect(saved).not.toContain('deck-editor-fonts');
});

test('19 fonts: own font files are copied into fonts/, described from their tables, embeddable and removable', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => { const d = window.deckEditor.deck; window.deckEditor.selection.select(d.doc.querySelector('.slide.active h1')); });
    await page.click('#inspFont');
    // A real font file: Georgia Bold from Windows, or any .ttf we can find.
    const candidates = ['C:/Windows/Fonts/georgiab.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'];
    const fontFile = candidates.find(f => fs.existsSync(f));
    test.skip(!fontFile, 'no font file to upload on this machine');
    await page.locator('.fontpick input[type=file]').setInputFiles(fontFile);
    await expect(page.locator('.fontadd-row')).toHaveCount(1);
    const row = page.locator('.fontadd-row');
    const family = await row.locator('input[type=text]').inputValue();
    expect(family.length).toBeGreaterThan(2);                        // read from the name table, not the file name
    expect(await row.locator('select').inputValue()).toBe('700');
    await row.locator('input[type=text]').fill('Test Face');
    await page.click('[data-form=add]');
    await expect(page.locator('.fontpick')).toBeHidden();
    await expect(page.locator('#inspFont')).toHaveText('Test Face');
    expect(fs.readdirSync(path.join(DECK_DIR, 'fonts'))).toEqual([path.basename(fontFile).replace(/\.ttf$/i, '.ttf')]);
    expect(await page.evaluate(() => window.deckEditor.deck.fonts.own)).toMatch(/@font-face \{ font-family: 'Test Face'; font-style: normal; font-weight: 700; font-display: swap; src: url\(fonts\/\w+\.ttf\) format\('truetype'\); \}/);
    await page.waitForFunction(() => Array.from(window.deckEditor.deck.doc.fonts).some(f => f.family.includes('Test Face') && f.status === 'loaded'));
    await save(page);
    expect(readDeck()).toContain('/* own font files (added in the deck editor) */');
    // Reopen: listed as your file; embed writes it into the HTML; remove drops it.
    await openDeck(page);
    await page.keyboard.press('Control+t');
    await expect(page.locator('#thFonts')).toContainText('Test Face');
    await expect(page.locator('#thFonts')).toContainText('your file, in fonts/');
    await page.click('#thFontActs [data-act=embed]');
    await expect(page.locator('#thFonts')).toContainText('your file, embedded', { timeout: 60000 });
    expect(await page.evaluate(() => window.deckEditor.deck.fonts.own)).toContain('url(data:font/ttf;base64,');
    await page.click('#thFonts [data-remove="Test Face"]');
    await expect(page.locator('#thFonts')).not.toContainText('Test Face');
    await save(page);
    expect(readDeck()).not.toMatch(/@font-face[^}]*Test Face/);      // the h1 still names it inline; the face is gone
});

test('34 look: the editor look is picked from the status bar, applies to the chrome only, and is remembered across reloads', async ({ page }) => {
    await openDeck(page);
    const topbar = () => page.evaluate(() => getComputedStyle(document.getElementById('topbar')).backgroundColor);
    // Ink is the default look.
    await expect(page.locator('html')).toHaveAttribute('data-look', 'ink');
    expect(await topbar()).toBe('rgb(27, 29, 39)');
    await page.click('#btnLook');
    await expect(page.locator('#lookMenu [data-look="ink"]')).toHaveClass(/on/);
    await page.click('#lookMenu [data-look="clean"]');
    await expect(page.locator('#lookMenu .tb-dropdown')).toBeHidden();
    await expect(page.locator('html')).not.toHaveAttribute('data-look');
    expect(await topbar()).toBe('rgb(255, 255, 255)');
    // The deck itself is untouched: nothing to save, no look attribute leaks into the deck document.
    expect(await page.evaluate(() => window.deckEditor.dirty)).toBe(false);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.documentElement.hasAttribute('data-look'))).toBe(false);
    await page.reload();
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen);
    await expect(page.locator('html')).not.toHaveAttribute('data-look');
    await page.click('#btnLook');
    await page.click('#lookMenu [data-look="slate"]');
    expect(await topbar()).toBe('rgb(47, 58, 68)');
    // Dark: the panels and the canvas go dark too, and the browser's own controls follow.
    await page.click('#btnLook');
    await page.click('#lookMenu [data-look="dark"]');
    expect(await topbar()).toBe('rgb(20, 20, 24)');
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('inspector')).backgroundColor)).toBe('rgb(28, 28, 33)');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
    await page.click('#btnLook');
    await page.click('#lookMenu [data-look="ink"]');
    await expect(page.locator('html')).toHaveAttribute('data-look', 'ink');
    expect(await topbar()).toBe('rgb(27, 29, 39)');
});

test('35 slide size: Theme > Slide size resizes the stage, thumbnails and the saved file; undo and reload keep it right', async ({ page }) => {
    await openDeck(page);
    const wrap = () => page.evaluate(() => { const w = document.getElementById('stageWrap'); return [w.style.width, w.style.height]; });
    const size = () => page.evaluate(() => [window.deckEditor.deck.stageW, window.deckEditor.deck.stageH]);
    expect(await size()).toEqual([1920, 1080]);
    // The editor scales the stage itself: exactly the zoom, no translation.
    expect(await page.evaluate(() => window.deckEditor.deck.win.getComputedStyle(window.deckEditor.deck.stage).transform)).toMatch(/^matrix\(([\d.]+), 0, 0, \1, 0, 0\)$/);

    await page.click('#btnTheme');
    await expect(page.locator('#thSize')).toBeVisible();
    expect(await page.locator('#thSize').inputValue()).toBe('1920x1080');
    await page.selectOption('#thSize', '1440x1080');
    await page.waitForTimeout(500);
    expect(await size()).toEqual([1440, 1080]);
    const [w, h] = await wrap();
    expect(Math.abs(parseFloat(w) / parseFloat(h) - 4 / 3)).toBeLessThan(0.02);
    // Thumbnails take the stage's proportions; the deck's own controller now reads the stage.
    const thumb = await page.locator('.strip-item .thumb').first().boundingBox();
    expect(Math.abs(thumb.width / thumb.height - 4 / 3)).toBeLessThan(0.05);
    expect(await page.evaluate(() => window.deckEditor.deck.scaleScriptAssumesDefault())).toBe(false);
    // A new slide's layout is stretched to the stage: nothing sticks out on the right.
    await page.evaluate(() => window.deckEditor.strip.addSlide(window.deckEditor.deck.current, 'two-columns'));
    await page.waitForTimeout(500);
    const rights = await page.evaluate(() => Array.from(window.deckEditor.deck.currentSlide.querySelectorAll('[style*="left"]')).map(e => parseFloat(e.style.left) + parseFloat(e.style.width)));
    expect(rights.length).toBeGreaterThan(1);
    const maxRight = Math.max(...rights);
    expect(maxRight).toBeLessThanOrEqual(1440);

    await save(page);
    const saved = readDeck();
    expect(saved).toMatch(/\.deck-stage, \.deck-stage \.slide \{ width: 1440px; height: 1080px; \}/);
    expect(saved).toContain('const factor = Math.min(vw / sw, vh / sh);');
    expect(saved).not.toContain('--ed-zoom');

    // Reload: still 4:3. Back to 16:9 removes the rule from the file.
    await openDeck(page);
    expect(await size()).toEqual([1440, 1080]);
    await page.click('#btnTheme');
    await page.selectOption('#thSize', '1920x1080');
    await page.waitForTimeout(300);
    expect(await size()).toEqual([1920, 1080]);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(await size()).toEqual([1440, 1080]);
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(300);
    await save(page);
    expect(readDeck()).not.toContain('stage size');
});

test('36 master layer: a footer on every slide is inserted, edited once for all slides, hidden per slide, shown in thumbnails and printed on each page', async ({ page }) => {
    await openDeck(page);
    expect(await page.evaluate(() => window.deckEditor.deck.masterElements.length)).toBe(0);
    await expect(page.locator('#inspMasterRow')).toBeHidden();
    // Insert > Footer on every slide: a stage-level element, its text selected.
    await page.click('#btnInsert');
    await page.click('[data-insert="master-footer"]');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.deckEditor.deck.masterElements.length)).toBe(1);
    expect(await page.evaluate(() => window.deckEditor.selection.items[0].textContent)).toBe('Footer text');
    await expect(page.locator('#inspRole')).toContainText('on every slide');
    await expect(page.locator('#inspMasterRow')).toBeHidden();      // an element is selected, not the slide
    // Edit the text in place (it is a normal text edit, one undo step).
    await page.evaluate(() => { const A = window.deckEditor; const t = A.deck.doc.querySelector('.deck-footer [data-edit]'); A.textEdit.start(t); t.textContent = 'Lab meeting'; A.textEdit.commit(); });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('.deck-footer [data-edit]').textContent)).toBe('Lab meeting');
    // Clicking the footer on the canvas selects it (pointer-events are on while editing).
    await page.keyboard.press('Escape');
    const c = await centre(page, '.deck-footer [data-edit]');
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.deckEditor.selection.items[0] && window.deckEditor.selection.items[0].textContent)).toBe('Lab meeting');
    // A master layer that covers the stage (corner prints in a full-size div): its empty ground
    // does not take the click, the heading under it does; the prints do. Send to back on the
    // layer stacks it against other master elements only, never under the active slide.
    await page.evaluate(() => { const d = window.deckEditor.deck; const f = d.doc.querySelector('.deck-footer'); f.style.cssText = 'position:absolute;inset:0;z-index:5'; const t = f.querySelector('[data-edit]'); t.style.cssText = 'position:absolute;left:96px;top:44px'; });
    await page.waitForTimeout(200);
    const h = await centre(page, 'h1');
    await page.mouse.click(h.x, h.y);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.deckEditor.selection.items[0] && window.deckEditor.selection.items[0].tagName)).toBe('H1');
    const p = await centre(page, '.deck-footer [data-edit]');
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.deckEditor.selection.items[0] && window.deckEditor.selection.items[0].textContent)).toBe('Lab meeting');
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.set([ed.deck.doc.querySelector('.deck-footer')]); ed.editops.layer('back'); });
    expect(await page.evaluate(() => { const d = window.deckEditor.deck; const f = d.doc.querySelector('.deck-footer'); return { z: d.win.getComputedStyle(f).zIndex, prev: f.previousElementSibling.className }; })).toEqual({ z: '5', prev: 'slide body-slide' });
    // While the heading is being edited the layer's ground lets the mouse through as well: a click
    // in the text moves the caret and a drag selects, instead of ending the edit; the mark that
    // does it is not saved.
    await page.mouse.dblclick(h.x, h.y);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => !!window.deckEditor.textEdit.el)).toBe(true);
    const hr = await stageRect(page, 'h1');
    const a = await stagePoint(page, hr.x + 8, hr.y + hr.h / 2), b = await stagePoint(page, hr.x + hr.w * 0.4, hr.y + hr.h / 2);
    await page.mouse.click(a.x, a.y);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => { const ed = window.deckEditor; const s = ed.deck.win.getSelection(); return { editing: !!ed.textEdit.el, caretInText: !!ed.textEdit.el && ed.textEdit.el.contains(s.anchorNode), collapsed: s.isCollapsed }; })).toEqual({ editing: true, caretInText: true, collapsed: true });
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.deckEditor.deck.win.getSelection().toString().length)).toBeGreaterThan(2);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('[data-ed-ground]').length)).toBe(1);
    expect(await page.evaluate(() => window.deckEditor.deck.serialize())).not.toContain('data-ed-ground');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('[data-ed-ground]').length)).toBe(0);
    await page.evaluate(() => window.deckEditor.selection.clear());
    // The counter follows the slide shown; slide 2 opts out of the master.
    await goTo(page, 1);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('[data-page-now]').textContent)).toBe('2');
    await page.evaluate(() => window.deckEditor.selection.clear());
    await expect(page.locator('#inspMasterRow')).toBeVisible();
    await page.uncheck('#inspShowMaster');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.deckEditor.deck.win.getComputedStyle(window.deckEditor.deck.doc.querySelector('.deck-footer')).visibility)).toBe('hidden');
    await goTo(page, 0);
    expect(await page.evaluate(() => window.deckEditor.deck.win.getComputedStyle(window.deckEditor.deck.doc.querySelector('.deck-footer')).visibility)).toBe('visible');
    // Thumbnails carry the footer with their own number; slide 2's hides it.
    await page.waitForTimeout(800);
    const thumbs = await page.evaluate(() => Array.from(document.querySelectorAll('.thumb-frame')).map(f => { const d = f.contentDocument, m = d && d.querySelector('.deck-footer'); return m ? { n: m.querySelector('[data-page-now]').textContent, vis: f.contentWindow.getComputedStyle(m).visibility } : null; }));
    expect(thumbs[0]).toEqual({ n: '1', vis: 'visible' });
    expect(thumbs[1]).toEqual({ n: '2', vis: 'hidden' });
    // Saved: the footer once, in the stage, counter reset; the slide keeps data-no-master and the block its rule.
    await save(page);
    const saved = readDeck();
    expect(saved.match(/class="deck-footer"/g).length).toBe(1);
    expect(saved).toMatch(/<\/section>\s*<div class="deck-footer"/);
    expect(saved).toContain('<b data-page-now="">1</b>');
    expect(saved).toContain('data-no-master');
    expect(saved).toContain('.deck-stage:has(> .slide.active[data-no-master])');
    expect(saved).not.toContain('data-print-master');
    // The printable copy stamps the footer into each page except the one that opted out.
    const printable = await page.evaluate(() => window.deckEditor.exporter.printableHtml());
    expect(printable).toContain('data-print-master');
    const frame = await page.evaluate(async (html) => {
        const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;left:-5000px;width:1920px;height:1080px'; document.body.appendChild(f); f.srcdoc = html;
        await new Promise(r => f.addEventListener('load', r));
        for (let i = 0; i < 100 && !f.contentDocument.documentElement.hasAttribute('data-print-ready'); i++) await new Promise(r => setTimeout(r, 100));
        const out = Array.from(f.contentDocument.querySelectorAll('.deck-stage > .slide')).map(s => Array.from(s.querySelectorAll('[data-print-master] [data-page-now]')).map(e => e.textContent));
        f.remove(); return out;
    }, printable);
    expect(frame[0]).toEqual(['1']);
    expect(frame[1]).toEqual([]);
    expect(frame[2]).toEqual(['3']);
});

test('37 theme colours: a colour added in the Theme panel is a :root variable in the override block, a swatch everywhere, and removable', async ({ page }) => {
    await openDeck(page);
    await page.click('#btnTheme');
    await expect(page.locator('#thNewName')).toBeVisible();
    await page.fill('#thNewName', 'Brand 2');
    await page.fill('#thNewColour', '#ff5722');
    await page.click('[data-act="addcolour"]');
    await page.waitForTimeout(300);
    await expect(page.locator('.theme-var[data-var="brand-2"]')).toHaveClass(/added/);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.getElementById('deck-editor-overrides').textContent)).toContain('--brand-2: #ff5722;');
    // Taken names are refused; an empty name gets a generated one.
    await page.fill('#thNewName', 'brand-2');
    await page.click('[data-act="addcolour"]');
    await expect(page.locator('.toast')).toContainText('already a variable');
    await page.fill('#thNewName', '');
    await page.click('[data-act="addcolour"]');
    await page.waitForTimeout(200);
    await expect(page.locator('.theme-var[data-var="colour-1"]')).toBeVisible();
    // The swatches of the properties panel know it.
    await page.click('#btnTheme');
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('.slide.active h1')));
    await page.waitForTimeout(300);
    await expect(page.locator('#inspSwatches .insp-swatch[data-c="var(--brand-2)"]')).toHaveCount(1);
    await save(page);
    expect(readDeck()).toContain('--brand-2: #ff5722;');
    // Remove it with the x; the swatch goes too.
    await page.click('#btnTheme');
    await page.click('.theme-var[data-var="brand-2"] .insp-clear');
    await page.waitForTimeout(300);
    await expect(page.locator('.theme-var[data-var="brand-2"]')).toHaveCount(0);
    await page.click('#btnTheme');
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('.slide.active h1')));
    await page.waitForTimeout(300);
    await expect(page.locator('#inspSwatches .insp-swatch[data-c="var(--brand-2)"]')).toHaveCount(0);
    await save(page);
    expect(readDeck()).not.toContain('--brand-2');
});

test('38 motion: the Theme panel drives the reveal (duration, easing, stagger, distance) and the slide transition; old decks get the compatibility rules', async ({ page }) => {
    await openDeck(page);
    const original = readDeck();
    await page.click('#btnTheme');
    // The motion variables are not in the variable list any more; slide-bg (var(--paper)) is a colour.
    await expect(page.locator('#thMotion')).toBeVisible();
    expect(await page.locator('.theme-var[data-var="dur"]').count()).toBe(0);
    expect(await page.locator('.theme-var[data-var="ease-out"]').count()).toBe(0);
    await expect(page.locator('.theme-var[data-var="slide-bg"]')).toHaveAttribute('data-kind', 'colour');
    // Values come from the deck's own :root (and the template defaults for what it lacks).
    expect(await page.inputValue('#thDur')).toBe('0.7');
    expect(await page.inputValue('#thEase')).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
    expect(await page.inputValue('#thStagger')).toBe('0.12');
    expect(await page.inputValue('#thDist')).toBe('28');
    const setRange = async (id, v) => { await page.locator(id).fill(v); await page.locator(id).dispatchEvent('change'); };
    await setRange('#thDur', '1.2');
    await page.selectOption('#thEase', 'linear');
    await setRange('#thStagger', '0.3');
    await setRange('#thDist', '80');
    const sub = () => page.evaluate(() => { const d = window.deckEditor.deck; const p = d.doc.querySelector('.sub'); const cs = d.win.getComputedStyle(p); return { delay: cs.transitionDelay, duration: cs.transitionDuration, timing: cs.transitionTimingFunction, vars: { ...d.overrides.vars }, rules: Object.keys(d.overrides.rules) }; });
    let s = await sub();
    expect(s.vars).toEqual({ dur: '1.2s', 'ease-out': 'linear', stagger: '0.3s', 'reveal-y': '80px' });
    expect(s.delay).toBe('0.6s');                                        // --i:2 * 0.3s, through the compatibility rule
    expect(s.duration).toBe('1.2s, 1.2s');
    expect(s.timing).toBe('linear, linear');
    expect(s.rules).toContain('&:not(.visible) .reveal');                // this fixture predates --stagger / --reveal-y
    await expect(page.locator('#thMotionHint')).toContainText('predates');
    // Transition: deck default and duration are attributes on the stage; Play animates both slides.
    await page.selectOption('#thTrans', 'slide');
    await setRange('#thTransDur', '0.8');
    expect(await page.evaluate(() => [window.deckEditor.deck.stage.getAttribute('data-transition'), window.deckEditor.deck.stage.getAttribute('data-transition-duration')])).toEqual(['slide', '0.8']);
    await expect(page.locator('#inspTransitionDeck')).toHaveValue('slide');   // the properties panel agrees
    await page.evaluate(() => window.deckEditor.addRuntimeScript());
    await goTo(page, 1);
    await page.click('#themeBody [data-act="playTrans"]');
    expect(await page.evaluate(() => window.deckEditor.deck.slides.slice(0, 2).map(s => s.getAnimations().length))).toEqual([1, 1]);
    await save(page);
    const saved = readDeck();
    expect(saved).toContain('--stagger: 0.3s;');
    expect(saved).toContain('.deck-stage .slide:not(.visible) .reveal {');
    expect(saved).toContain('transition-delay: calc(var(--i, 0) * var(--stagger, 0.12s));');
    expect(saved).toContain('data-transition="slide" data-transition-duration="0.8"');
    // Reopen: parsed back, and clearing stagger and distance drops the compatibility rules again.
    await openDeck(page);
    await page.click('#btnTheme');
    await expect(page.locator('.theme-slider[data-motion="stagger"]')).toHaveClass(/set/);
    expect((await sub()).rules.length).toBe(4);
    await page.click('.theme-slider[data-motion="stagger"] .insp-clear');
    await page.click('.theme-slider[data-motion="reveal-y"] .insp-clear');
    s = await sub();
    expect(s.rules).toEqual([]);
    expect(s.delay).toBe('0.24s');                                       // back to the deck's 0.12s step
    await page.locator('#themeBody [data-act="reset"]').click();
    await page.selectOption('#thTrans', '');
    await setRange('#thTransDur', '0.5');
    await save(page);
    const back = readDeck();
    expect(back).not.toContain('deck-editor-overrides');
    expect(back).not.toMatch(/<main class="deck-stage"[^>]*data-transition/);
    expect(back.replace(/\n<script id="deck-runtime">[\s\S]*?<\/script>/, '')).toBe(original);
});

/* ------------------------------------------------------------
   44. The Code section: markup and matching rules to read, CSS of one's own for an element
   ------------------------------------------------------------ */
test('44 code: the Code section shows the markup and the rules that style the element; CSS typed for it is applied, scoped, saved and comes back', async ({ page, context }) => {
    await openDeck(page);
    const c = await centre(page, 'h1');
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(200);
    // Closed by default; open, it shows the element's HTML and the deck's rules that match it, later ones last.
    expect(await page.evaluate(() => document.getElementById('inspCode').open)).toBe(false);
    await page.click('#inspCode summary');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.getElementById('inspCodeHtml').value)).toMatch(/^<h1 class="reveal"[^>]*data-edit[^>]*>Sample deck title<\/h1>$/);
    // The markup is a field: changed, the element is replaced by what was typed and selected again; one undo step.
    const markup = await page.evaluate(() => document.getElementById('inspCodeHtml').value);
    await page.fill('#inspCodeHtml', markup.replace('Sample deck title', 'Sample <em>deck</em> title').replace('class="reveal"', 'class="reveal big"'));
    await page.locator('#inspCodeHtml').dispatchEvent('change');
    await page.waitForTimeout(200);
    const replaced = await page.evaluate(() => { const ed = window.deckEditor; const h = ed.deck.doc.querySelector('h1'); return { html: h.outerHTML, selected: ed.selection.single === h, count: ed.deck.doc.querySelectorAll('h1').length }; });
    expect(replaced.html).toMatch(/^<h1 class="reveal big"[^>]*>Sample <em>deck<\/em> title<\/h1>$/);
    expect(replaced.selected).toBe(true);
    expect(replaced.count).toBe(1);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').outerHTML)).toBe(markup);
    // Two elements, or none, are refused; the field shows the markup again.
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('h1')));
    await page.fill('#inspCodeHtml', '<b>one</b><i>two</i>');
    await page.locator('#inspCodeHtml').dispatchEvent('change');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').outerHTML)).toBe(markup);
    expect(await page.evaluate(() => document.getElementById('inspCodeHtml').value)).toBe(markup);
    const rules = await page.evaluate(() => document.getElementById('inspCodeRules').textContent);
    expect(rules).toContain('h1 { font-size: 104px;');
    expect(rules.indexOf('h1 { font-size: 104px;')).toBeLessThan(rules.indexOf('.title-slide h1 {'));
    // The cells are for copying: click one, Ctrl+A selects its text (not the slide's elements).
    await page.click('#inspCodeRules');
    await page.keyboard.press('Control+a');
    const words = (s) => s.replace(/\s+/g, ' ').trim();                 // Firefox spaces the lines of a selection its own way
    expect(words(await page.evaluate(() => window.getSelection().toString()))).toBe(words(rules));
    expect(await page.evaluate(() => window.deckEditor.selection.items.length)).toBe(1);
    // The box starts as the deck's declarations for the element (later rules winning), dimmed; left so, it is nothing of the element's.
    const start = await page.evaluate(() => ({ value: document.getElementById('inspCodeCss').value, dim: document.getElementById('inspCodeCss').classList.contains('insp-code-start') }));
    expect(start.dim).toBe(true);
    expect(start.value).toContain('font-size: 104px;');
    expect(start.value).toContain('max-width: 1400px;');
    expect(start.value.indexOf('font-size')).toBeLessThan(start.value.indexOf('max-width'));
    await page.locator('#inspCodeCss').dispatchEvent('change');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').hasAttribute('data-css'))).toBe(false);
    // An effect on something inside the element (a band whose text scrolls) is listed as such,
    // and comes into the box as a nested rule, so it is changed from the element that holds it.
    await page.evaluate(() => { const d = window.deckEditor.deck.doc; const st = d.createElement('style'); st.id = 'tst-inside'; st.textContent = 'html:not(.deck-editing) .who span { animation: pulse 2s infinite; } @keyframes pulse { to { opacity: 0.5; } }'; d.head.appendChild(st); });
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('.who')));
    await page.waitForTimeout(200);
    const who = await page.evaluate(() => ({ rules: document.getElementById('inspCodeRules').textContent, box: document.getElementById('inspCodeCss').value }));
    expect(who.rules).toContain('(on the span inside) (when presenting)');
    expect(who.rules).toContain('@keyframes pulse');
    expect(who.box).toMatch(/& span \{\n    animation: 2s (ease 0s )?infinite (normal none running )?pulse;\n\}/);   // Firefox writes the short form
    expect(who.box).toContain('@keyframes pulse');
    // Edited there, the nested rule is written inside the element's block and applies to the span when presenting.
    await page.fill('#inspCodeCss', '& span { animation: pulse 1s infinite; }\n@keyframes pulse { to { opacity: 0.2; } }');
    await page.locator('#inspCodeCss').dispatchEvent('change');
    await page.waitForTimeout(200);
    const nestedBlock = await page.evaluate(() => window.deckEditor.deck.doc.getElementById('deck-editor-overrides').textContent);
    // The keyframes typed there are the element's own: renamed for it, the deck's `pulse` left alone.
    expect(nestedBlock).toMatch(/html:not\(\.deck-editing\) \[data-id="(el-\d+)"\]:not\(#_\) \{\n    & span \{ animation: pulse--\1 1s infinite; \}\n\}\n@keyframes pulse--\1 \{ to \{ opacity: 0\.2; \} \}/);
    await page.check('#inspCodeLive');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => { const ed = window.deckEditor; return ed.deck.win.getComputedStyle(ed.deck.doc.querySelector('.who span')).animationName; })).toMatch(/^pulse--el-\d+$/);
    await page.evaluate(() => { const ed = window.deckEditor; ed.deck.doc.getElementById('tst-inside').remove(); });
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('.who').hasAttribute('data-css'))).toBe(false);
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('h1')));
    await page.waitForTimeout(200);
    // CSS of one's own: declarations go on the element, the @keyframes stands on its own; only when not editing, unless asked.
    const css = 'animation: ticker 18s linear infinite;\n@keyframes ticker { to { translate: -50% 0; } }';
    await page.fill('#inspCodeCss', css);
    await page.locator('#inspCodeCss').dispatchEvent('change');
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => { const ed = window.deckEditor; const h = ed.deck.doc.querySelector('h1'); const ov = ed.deck.doc.getElementById('deck-editor-overrides'); return { css: h.getAttribute('data-css'), id: h.getAttribute('data-id'), block: ov ? ov.textContent : '', anim: ed.deck.win.getComputedStyle(h).animationName, rules: document.getElementById('inspCodeRules').textContent }; });
    expect(state.css).toBe(css);
    expect(state.id).toMatch(/^el-\d+$/);
    expect(state.block).toContain('/* element styles (managed by the deck editor) */');
    expect(state.block).toContain(`html:not(.deck-editing) [data-id="${state.id}"]:not(#_) {\n    animation: ticker--${state.id} 18s linear infinite;\n}`);
    expect(state.block).toContain(`@keyframes ticker--${state.id} { to { translate: -50% 0; } }`);
    expect(state.anim).toBe('none');                                       // still while editing
    expect(state.rules).not.toContain('[data-id=');                        // the element's own CSS is in the box, not in the deck's list
    await page.check('#inspCodeLive');
    await page.waitForTimeout(200);
    const live = await page.evaluate(() => { const ed = window.deckEditor; const h = ed.deck.doc.querySelector('h1'); return { anim: ed.deck.win.getComputedStyle(h).animationName, block: ed.deck.doc.getElementById('deck-editor-overrides').textContent, rules: document.getElementById('inspCodeRules').textContent }; });
    expect(live.anim).toBe('ticker--' + state.id);
    expect(live.rules).toContain('@keyframes ticker');                    // the keyframes the running animation uses are listed
    expect(live.block).toContain(`\n[data-id="${state.id}"]:not(#_) {`);
    expect(live.block).not.toContain('html:not(.deck-editing) [data-id=');
    await page.uncheck('#inspCodeLive');
    // Saved: the attribute on the element, the block in the head; the deck on its own runs it. Back in the editor the field shows the text.
    await save(page);
    const saved = readDeck();
    expect(saved).toContain('data-css="animation: ticker 18s linear infinite;');
    expect(saved).toContain('/* element styles (managed by the deck editor) */');
    expect(saved).toContain('/* end element styles */');
    const deck = await context.newPage();
    await deck.goto('/deck/' + FILE);
    await deck.waitForSelector('.slide.active.visible');
    expect(await deck.evaluate(() => getComputedStyle(document.querySelector('h1')).animationName)).toBe('ticker--' + state.id);
    await deck.close();
    await openDeck(page);
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(200);
    await page.click('#inspCode summary');
    expect(await page.evaluate(() => document.getElementById('inspCodeCss').value)).toBe(css);
    expect(await page.evaluate(() => (window.deckEditor.deck.doc.getElementById('deck-editor-overrides') || {}).textContent || '')).toContain('@keyframes ticker');
    // Cleared: attribute and block gone; the saved file is back to what it was but for the id.
    await page.fill('#inspCodeCss', '');
    await page.locator('#inspCodeCss').dispatchEvent('change');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').hasAttribute('data-css'))).toBe(false);
    expect(await page.evaluate(() => (window.deckEditor.deck.doc.getElementById('deck-editor-overrides') || { textContent: '' }).textContent)).not.toContain('element styles');
    expect(await page.evaluate(() => document.getElementById('inspCodeCss').value)).toContain('font-size: 104px;');   // back to the start text
    await save(page);
    expect(readDeck()).not.toContain('element styles');
});

test('45 code: animations are changed per element from the Code box (timing, keyframes), play when they would, and the element\'s CSS outranks the deck\'s', async ({ page, context }) => {
    await openDeck(page);
    const pick = (sel) => page.evaluate((s) => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector(s)), sel);
    const box = () => page.evaluate(() => document.getElementById('inspCodeCss').value);
    await pick('.sub');
    await page.waitForTimeout(200);
    await page.click('#inspCode summary');
    await page.waitForTimeout(100);
    // A deck reveal: the box keeps its transition (to change) but not what the reveal changes, so the reveal still runs once edited.
    const reveal = await box();
    expect(reveal).toContain('font-size: 36px;');
    expect(reveal).toContain('transition:');
    expect(reveal).not.toMatch(/^(opacity|transform):/m);
    // Two elements spin; the box shows the preset as values, with its keyframes, and the rule is listed.
    await pick('h1');
    await page.waitForTimeout(200);
    await page.click('#animGrid [data-anim="spin"]');
    await pick('.sub');
    await page.waitForTimeout(200);
    await page.click('#animGrid [data-anim="spin"]');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.getElementById('animDurLabel').textContent)).toBe('Cycle');
    expect(await box()).toContain('animation: de-spin 6s linear 0s infinite;');
    expect(await box()).toContain('@keyframes de-spin');
    expect(await page.evaluate(() => document.getElementById('inspCodeRules').textContent)).toContain('(the Animation section)');
    // Changed there: faster, backwards, half a turn, and a colour over the deck's `.sub` rule.
    await page.fill('#inspCodeCss', 'color: rgb(255, 0, 0);\nanimation: de-spin 2s linear 0s infinite reverse;\n@keyframes de-spin { from { transform: rotate(0deg); } to { transform: rotate(180deg); } }');
    await page.locator('#inspCodeCss').dispatchEvent('change');
    await page.waitForTimeout(200);
    const id = await page.evaluate(() => window.deckEditor.deck.doc.querySelector('.sub').getAttribute('data-id'));
    const block = await page.evaluate(() => window.deckEditor.deck.doc.getElementById('deck-editor-overrides').textContent);
    expect(block).toContain(`html:not(.deck-editing) [data-id="${id}"]:not(#_) {\n    color: rgb(255, 0, 0);\n}`);
    expect(block).toContain(`html:not(.deck-editing) .slide.visible [data-id="${id}"]:not(#_):not([data-fragment]),\nhtml:not(.deck-editing) .deck-stage [data-fragment].visible[data-id="${id}"]:not(#_) {\n    animation: de-spin--${id} 2s linear 0s infinite reverse;\n}`);
    expect(block).toContain(`@keyframes de-spin--${id} {`);
    expect(await page.evaluate(() => document.getElementById('animNow').textContent)).toContain('Its own CSS');
    await page.check('#inspCodeLive');
    await page.waitForTimeout(200);
    const look = await page.evaluate(() => { const ed = window.deckEditor; const cs = (s) => ed.deck.win.getComputedStyle(ed.deck.doc.querySelector(s)); const a = cs('.sub'), b = cs('h1'); return { name: a.animationName, dur: a.animationDuration, dir: a.animationDirection, color: a.color, other: b.animationName + ' ' + b.animationDuration }; });
    expect(look).toEqual({ name: 'de-spin--' + id, dur: '2s', dir: 'reverse', color: 'rgb(255, 0, 0)', other: 'de-spin 6s' });
    // Saved, the deck on its own plays it when the slide shows.
    await save(page);
    const deck = await context.newPage();
    await deck.goto('/deck/' + FILE);
    await deck.waitForSelector('.slide.active.visible');
    expect(await deck.evaluate(() => { const a = getComputedStyle(document.querySelector('.sub')); return a.animationName + ' ' + a.animationDuration; })).toBe('de-spin--' + id + ' 2s');
    expect(await deck.evaluate(() => getComputedStyle(document.querySelector('h1')).animationName)).toBe('de-spin');
    await deck.close();
});
