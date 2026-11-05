// Theme > Deck CSS: the deck's own style blocks, editable from the Theme tab.
const { test, expect, fs, freshDeckEachTest, DECK_DIR, openDeck, readDeck, save } = require('./helpers');
const path = require('path');

freshDeckEachTest();

const eyebrowColour = (page) => page.evaluate(() => window.deckEditor.deck.win.getComputedStyle(window.deckEditor.deck.doc.querySelector('.eyebrow')).color);
const openCode = async (page) => {
    await page.click('#btnTheme');
    await expect(page.locator('#thCode')).toBeVisible();
    if (!(await page.locator('#thCode').evaluate(d => d.open))) await page.locator('#thCode summary').click();
    await expect(page.locator('.th-deckcss').first()).toBeVisible();
};
const countStyles = (text) => (text.match(/<style\b/gi) || []).length;

test('theme code: collapsed by default, remembered once opened', async ({ page }) => {
    await openDeck(page);
    await page.click('#btnTheme');
    await expect(page.locator('#thCode')).toBeVisible();
    expect(await page.locator('#thCode').evaluate(d => d.open)).toBe(false);
    await page.locator('#thCode summary').click();
    await expect(page.locator('.th-deckcss')).toHaveCount(1);
    const text = await page.locator('.th-deckcss').inputValue();
    expect(text).toContain('.eyebrow {');
    expect(text).not.toContain('deck-editor');
    await openDeck(page);
    await page.click('#btnTheme');
    expect(await page.locator('#thCode').evaluate(d => d.open)).toBe(true);
});

test('theme code: a hard-coded colour changes on the canvas, undo restores, save writes it once, reopen shows it once', async ({ page }) => {
    await openDeck(page);
    const original = readDeck();
    const before = await eyebrowColour(page);
    await openCode(page);
    const box = page.locator('.th-deckcss').first();
    const text = await box.inputValue();
    expect(text).toContain('color: var(--accent); margin-bottom: 24px;');
    await box.fill(text.replace('color: var(--accent); margin-bottom: 24px;', 'color: #8e1c2f; margin-bottom: 24px;'));
    await box.press('Control+Enter');
    expect(await eyebrowColour(page)).toBe('rgb(142, 28, 47)');

    // One undo step
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await eyebrowColour(page)).toBe(before);
    expect(await box.inputValue()).toBe(text);
    await page.evaluate(() => window.deckEditor.history.redo());
    expect(await eyebrowColour(page)).toBe('rgb(142, 28, 47)');

    await save(page);
    const saved = readDeck();
    expect(saved).toContain('color: #8e1c2f; margin-bottom: 24px;');
    expect(saved).not.toContain('color: var(--accent); margin-bottom: 24px;');
    expect(countStyles(saved)).toBe(countStyles(original));
    // Only that one declaration differs from the original file
    expect(saved.replace('color: #8e1c2f; margin-bottom: 24px;', 'color: var(--accent); margin-bottom: 24px;')).toBe(original);

    await openDeck(page);
    expect(await eyebrowColour(page)).toBe('rgb(142, 28, 47)');
    await openCode(page);
    await expect(page.locator('.th-deckcss')).toHaveCount(1);
    expect(await page.locator('.th-deckcss').inputValue()).toContain('color: #8e1c2f;');
    // Saving again changes nothing: no duplicate block
    await page.evaluate(() => window.deckEditor.history.undo());
    await page.evaluate(() => window.deckEditor.history.redo());
    await save(page);
    expect(readDeck()).toBe(saved);
});

test('theme code: applies on leaving the box, thumbnails follow, Tab indents', async ({ page }) => {
    await openDeck(page);
    await openCode(page);
    const box = page.locator('.th-deckcss').first();
    await box.focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Tab');
    expect((await box.inputValue()).startsWith('    ')).toBe(true);
    await page.keyboard.press('Shift+Tab');
    expect((await box.inputValue()).startsWith('    ')).toBe(false);
    const text = await box.inputValue();
    await box.fill(text.replace('color: var(--accent); margin-bottom: 24px;', 'color: #00aa55; margin-bottom: 24px;'));
    await page.locator('#thCss').focus();                     // leaving the box applies it
    await expect.poll(() => eyebrowColour(page)).toBe('rgb(0, 170, 85)');
    // The thumbnails load the changed CSS
    await expect.poll(async () => page.evaluate(() => {
        const f = document.querySelector('.thumb-frame');
        if (!f || !f.contentDocument) return '';
        const el = f.contentDocument.querySelector('.eyebrow');
        return el ? f.contentWindow.getComputedStyle(el).color : '';
    })).toBe('rgb(0, 170, 85)');
});

test('theme code: several style blocks each get a box, invalid CSS is kept and flagged, no duplicate block after save', async ({ page }) => {
    const deck = path.join(DECK_DIR, 'index.html');
    let html = fs.readFileSync(deck, 'utf8');
    html = html.replace('</head>', '<style>\n.slide h2 { letter-spacing: 3px; }\n</style>\n</head>');
    fs.writeFileSync(deck, html);
    await openDeck(page);
    await openCode(page);
    await expect(page.locator('.th-deckcss')).toHaveCount(2);
    const second = page.locator('.th-deckcss').nth(1);
    expect(await second.inputValue()).toContain('letter-spacing: 3px');
    const bad = '.slide h2 { letter-spacing: 5px; }\n.broken { color: red;\n';
    await second.fill(bad);
    await second.press('Control+Enter');
    expect(await second.inputValue()).toBe(bad);               // kept as typed
    await expect(page.locator('.th-deckcss-n.warn')).toHaveCount(1);
    await save(page);
    const saved = readDeck();
    expect(countStyles(saved)).toBe(countStyles(html));
    expect(saved).toContain('.slide h2 { letter-spacing: 5px; }\n.broken { color: red;\n</style>');
    await openDeck(page);
    await openCode(page);
    await expect(page.locator('.th-deckcss')).toHaveCount(2);
});
