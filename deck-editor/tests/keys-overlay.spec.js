// The "?" list of keys while presenting: in the editor's Preview, in a saved deck opened on its own, in the presenter window.
// Run with: DIAPO_TEST_PORT=... npx playwright test tests/keys-overlay.spec.js   (from the deck-editor folder)
const { test, expect, fs, path, freshDeckEachTest, FILE, openDeck, readDeck, save } = require('./helpers');

freshDeckEachTest();

const APP = path.join(__dirname, '..', 'app');
const ROOT = path.join(__dirname, '..', '..');

/* A deck saved with the presentation features script, and the editor opened on it again so the script runs in the iframe. */
async function deckWithRuntime(page) {
    await openDeck(page);
    await page.evaluate(() => window.deckEditor.addRuntimeScript());
    await page.waitForFunction(() => window.deckEditor.deck.doc.getElementById('deck-runtime'));
    await save(page);
    await openDeck(page);
    await page.waitForFunction(() => window.deckEditor.deck.win.deckRuntime);
}

test('K1 runtime version 17 is the same in the app, the Diapo Format, the skill and every template', async () => {
    const app = fs.readFileSync(path.join(APP, 'deck-runtime.js'), 'utf8');
    expect(app).toMatch(/version: 17 \}/);
    expect(fs.readFileSync(path.join(ROOT, 'diapo-format', 'deck-runtime.js'), 'utf8')).toBe(app);
    expect(fs.readFileSync(path.join(ROOT, 'skills', 'diapo-deck', 'deck-runtime.js'), 'utf8')).toBe(app);
    const dir = path.join(APP, 'templates');
    // The ones tools/build-templates.py makes (blank.html and a source in tools/templates-src); the imported third-party decks keep the edition they came with.
    const sources = new Set(fs.readdirSync(path.join(__dirname, '..', 'tools', 'templates-src')).filter(f => f.endsWith('.html')));
    const names = fs.readdirSync(dir).filter(f => f === 'blank.html' || sources.has(f));
    expect(names.length).toBeGreaterThan(20);
    for (const f of names) expect(fs.readFileSync(path.join(dir, f), 'utf8'), f).toContain(app.trim());
});

test('K2 Preview: ? opens the list, Esc or ? or a click closes it, it is never saved, and the header says so', async ({ page }) => {
    await deckWithRuntime(page);
    await page.click('#btnPreview');
    await expect(page.locator('.preview-hint')).toHaveText('Preview | Esc to return to the editor | ? for keys');
    const inDeck = (fn, arg) => page.evaluate(fn, arg);
    const open = () => inDeck(() => !!window.deckEditor.deck.doc.querySelector('.deck-keys'));
    // No first-open hint inside Preview (the header already says it).
    expect(await inDeck(() => !!window.deckEditor.deck.doc.querySelector('.deck-keyhint'))).toBe(false);
    await page.keyboard.press('Shift+/');
    expect(await open()).toBe(true);
    const dlg = page.frameLocator('#deckFrame').locator('.deck-keys [role="dialog"]');
    await expect(dlg).toBeVisible();
    const text = await dlg.innerText();
    for (const w of ['MOVE', 'SHOW', 'DRAW', 'Presenter view', 'Overview', 'Laser', 'Hide or show the arrows', 'Home', 'End']) expect(text).toContain(w);
    expect(await inDeck(() => document.activeElement === window.deckEditor.deck.iframe && window.deckEditor.deck.doc.activeElement.getAttribute('role'))).toBe('dialog');
    await page.keyboard.press('Escape');
    expect(await open()).toBe(false);
    expect(await inDeck(() => window.deckEditor.preview)).toBe(true);       // Esc closed the list only
    await page.keyboard.press('?');
    expect(await open()).toBe(true);
    await page.keyboard.press('?');
    expect(await open()).toBe(false);
    await page.keyboard.press('?');
    await page.locator('#deckFrame').click({ position: { x: 5, y: 5 } });     // a click outside the panel
    expect(await open()).toBe(false);
    // Draw mode: the list opens over it, Esc closes the list first and drawing second.
    await page.keyboard.press('d');
    await page.keyboard.press('?');
    expect(await open()).toBe(true);
    expect(await inDeck(() => !!window.deckEditor.deck.doc.querySelector('.deck-draw'))).toBe(true);
    await page.keyboard.press('Escape');                                      // the list first,
    expect(await inDeck(() => !!window.deckEditor.deck.doc.querySelector('.deck-draw'))).toBe(true);
    await page.keyboard.press('Escape');                                      // then drawing
    expect(await inDeck(() => !!window.deckEditor.deck.doc.querySelector('.deck-draw'))).toBe(false);
    // Left open and Preview ended another way: it goes with Preview, and a save keeps nothing of it.
    await page.keyboard.press('?');
    expect(await open()).toBe(true);
    await page.evaluate(() => window.deckEditor.setPreview(false));
    expect(await open()).toBe(false);
    await page.evaluate(() => window.deckEditor.deck.win.deckRuntime.openKeys());   // even if one is there when the deck is saved
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.doc.querySelector('h1')); ed.selection.nudge(1, 0); });
    await save(page);
    const saved = readDeck();
    const body = saved.replace(/<script id="deck-runtime">[\s\S]*?<\/script>/, '');   // the script itself names them; the markup must not
    expect(body).not.toContain('deck-keys');
    expect(body).not.toContain('deck-keyhint');
    expect(body).not.toContain('Press ? for keys');
});

test('K3 a saved deck opened on its own: the hint shows once and fades; ? lists the keys; print and PDF carry neither', async ({ page, context }) => {
    await deckWithRuntime(page);
    const deck = await context.newPage();
    await deck.goto('/deck/' + FILE);
    await deck.waitForSelector('.slide.active.visible');
    await deck.waitForFunction(() => window.deckRuntime && window.deckRuntime.version >= 16);
    const hint = deck.locator('.deck-keyhint');
    await expect(hint).toHaveText('Press ? for keys');
    await expect(hint).toHaveAttribute('role', 'status');
    // Neither the hint nor the list reaches paper.
    await deck.emulateMedia({ media: 'print' });
    expect(await deck.evaluate(() => getComputedStyle(document.querySelector('.deck-keyhint')).display)).toBe('none');
    await deck.emulateMedia({ media: 'screen' });
    await expect(hint).toHaveCount(0, { timeout: 7000 });                    // gone after about 4 s (plus the fade)
    // ? and Shift+/ open and close it; Esc and a click close it; the deck's keys still work with it open.
    await deck.keyboard.press('?');
    const dlg = deck.locator('.deck-keys [role="dialog"]');
    await expect(dlg).toBeVisible();
    expect(await dlg.getAttribute('aria-label')).toBe('Keys');
    expect(await deck.evaluate(() => document.activeElement.getAttribute('role'))).toBe('dialog');
    await deck.emulateMedia({ media: 'print' });
    await expect(dlg).toBeHidden();
    await deck.emulateMedia({ media: 'screen' });
    const at = () => deck.evaluate(() => Array.from(document.querySelectorAll('.slide')).findIndex(s => s.classList.contains('active')));
    await deck.keyboard.press('ArrowRight');
    await expect.poll(at).toBe(1);
    await deck.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await deck.keyboard.press('Shift+/');
    await expect(dlg).toBeVisible();
    await deck.keyboard.press('?');
    await expect(dlg).toHaveCount(0);
    await deck.keyboard.press('?');
    await deck.mouse.click(4, 4);
    await expect(dlg).toHaveCount(0);
    // Every key it names is a real one.
    await deck.keyboard.press('?');
    const text = await deck.locator('.deck-keys').innerText();
    expect(text).toContain('Presenter view');
    await deck.keyboard.press('Escape');
    expect(await deck.evaluate(() => !!document.querySelector('.deck-keys') || !!document.querySelector('.deck-overview'))).toBe(false);
    await deck.keyboard.press('o');
    expect(await deck.evaluate(() => !!document.querySelector('.deck-overview'))).toBe(true);
    await deck.close();
});

test('K4 a deck in a frame (a presenter preview) shows no hint', async ({ page, context }) => {
    await deckWithRuntime(page);
    const host = await context.newPage();
    await host.goto('/presenter.html');
    const hosted = await host.evaluate((file) => new Promise((done) => {
        const f = document.createElement('iframe');
        f.src = '/deck/' + file;
        f.onload = () => setTimeout(() => done(!!f.contentDocument.querySelector('.deck-keyhint')), 300);
        document.body.appendChild(f);
    }), FILE);
    expect(hosted).toBe(false);
    await host.close();
});

test('K5 the presenter window answers ? with its own keys', async ({ page, context }) => {
    await openDeck(page);
    const win = await context.newPage();
    await win.goto('/presenter.html');
    await win.keyboard.press('?');
    const dlg = win.locator('.deck-keys [role="dialog"]');
    await expect(dlg).toBeVisible();
    const text = await dlg.innerText();
    expect(text).toContain('Next step');
    expect(text).toContain('Home');
    await win.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await win.keyboard.press('Shift+/');
    await expect(dlg).toBeVisible();
    await win.mouse.click(3, 3);
    await expect(dlg).toHaveCount(0);
    await win.close();
});
