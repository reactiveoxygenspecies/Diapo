// The fonts installed on this machine (queryLocalFonts). Headless Chrome enumerates
// none, so this file runs headed, and only when asked for:
//     set DECK_LOCAL_FONTS=1 && npx playwright test tests/fonts-local.spec.js
// It needs Windows (it looks for Georgia) and can take a while the first time.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-deck', 'index.html');
const DECK_DIR = path.join(__dirname, '.tmp-workspace', 'sample');
const FILE = 'sample/index.html';

test.use({ headless: false });
test.setTimeout(120000);
test.beforeEach(() => {
    fs.copyFileSync(FIXTURE, path.join(DECK_DIR, 'index.html'));
    fs.rmSync(path.join(DECK_DIR, 'fonts'), { recursive: true, force: true });
});
async function openDeck(page) {
    await page.goto('/?file=' + FILE);
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('.slide.active.visible'));
    await page.waitForTimeout(900);
}

test('20 fonts: an installed font is copied into the deck when picked', async ({ page, context }) => {
    test.skip(process.platform !== 'win32' || !process.env.DECK_LOCAL_FONTS, 'opt-in: set DECK_LOCAL_FONTS=1 (needs a visible Chrome and Windows fonts)');
    await openDeck(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Browser.grantPermissions', { permissions: ['localFonts'], origin: 'http://127.0.0.1:8811' });
    await page.evaluate(() => { const d = window.deckEditor.deck; window.deckEditor.selection.select(d.doc.querySelector('.slide.active h1')); });
    await page.click('#inspFont');
    await page.click('.fontpick-acts [data-do=local]');
    // Enumerating the installed fonts can take a while the first time.
    await expect(page.locator('.fontpick-item[data-local="Georgia"]')).toHaveCount(1, { timeout: 60000 });
    await page.click('.fontpick-item[data-local="Georgia"]');
    await expect(page.locator('#inspFont')).toHaveText('Georgia', { timeout: 30000 });
    const files = fs.readdirSync(path.join(DECK_DIR, 'fonts'));
    expect(files.length).toBeGreaterThanOrEqual(2);                  // regular and bold at least
    expect(files.every(f => /^Georgia-/.test(f))).toBe(true);
    const own = await page.evaluate(() => window.deckEditor.deck.fonts.own);
    expect(own).toMatch(/font-family: 'Georgia'; font-style: normal; font-weight: 400/);
    expect(own).toMatch(/font-family: 'Georgia'; font-style: normal; font-weight: 700/);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('.slide.active h1').style.fontFamily)).toBe('Georgia, sans-serif');
});
