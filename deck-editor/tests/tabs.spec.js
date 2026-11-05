// Several decks open at once: one tab each, only the active deck live in the editor.
const { test, expect, fs, path, freshDeckEachTest, openDeck, readDeck, save, goTo, FIXTURE, DECK, WS } = require('./helpers');

freshDeckEachTest();

const B_FILE = 'second/index.html';
const B_PATH = path.join(WS, 'second', 'index.html');

test.beforeEach(async ({ page }) => {
    // A second deck in another folder of the workspace: a copy of the fixture with its own title.
    fs.rmSync(path.join(WS, 'second'), { recursive: true, force: true });
    fs.cpSync(path.dirname(FIXTURE), path.join(WS, 'second'), { recursive: true });
    fs.writeFileSync(B_PATH, fs.readFileSync(B_PATH, 'utf8').replace('Sample deck title', 'Second deck title').replace('Sample deck (test fixture)', 'Second deck'));
    await page.request.post('/api/trust?file=' + encodeURIComponent(B_FILE) + '&on=1');
});

const tabNames = (page) => page.locator('.deck-tab .tab-name').allTextContents();
const activeFile = (page) => page.evaluate(() => window.deckEditor.file);
async function openSecond(page) {
    await page.evaluate((f) => window.deckEditor.openDeck(f), B_FILE);
    await expect.poll(() => activeFile(page)).toBe(B_FILE);
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('.slide.active'));
}
async function editTitle(page, text) {
    await page.evaluate((text) => {
        const ed = window.deckEditor, h = ed.deck.doc.querySelector('h1');
        const before = h.innerHTML; h.textContent = text;
        ed.history.html(h, before, h.innerHTML);
    }, text);
    await expect.poll(() => page.evaluate(() => window.deckEditor.dirty)).toBe(true);
}
const title = (page) => page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').textContent);

test('tabs: opening a second deck adds a tab and keeps the first', async ({ page }) => {
    await openDeck(page);
    await expect(page.locator('.deck-tab')).toHaveCount(1);
    await openSecond(page);
    await expect(page.locator('.deck-tab')).toHaveCount(2);
    expect(await tabNames(page)).toEqual(['Sample deck (test fixture)', 'Second deck']);
    await expect(page.locator('.deck-tab.active .tab-name')).toHaveText('Second deck');
    expect(await page.evaluate(() => location.search)).toContain('second');
    // The full path is on hover.
    expect(await page.locator('.deck-tab').first().getAttribute('title')).toContain('index.html');
    // Opening the deck of a tab again brings the tab forward instead of adding another.
    await page.evaluate(() => window.deckEditor.openDeck('sample/index.html'));
    await expect.poll(() => activeFile(page)).toBe('sample/index.html');
    await expect(page.locator('.deck-tab')).toHaveCount(2);
});

test('tabs: edits survive a switch, and the save writes that deck alone without a conflict', async ({ page }) => {
    await openDeck(page);
    await openSecond(page);
    await page.click('.deck-tab >> nth=0');
    await expect.poll(() => activeFile(page)).toBe('sample/index.html');
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('h1'));
    await goTo(page, 1);
    await editTitle(page, 'Edited in A');
    await expect(page.locator('.deck-tab').first()).toHaveClass(/dirty/);

    await page.click('.deck-tab >> nth=1');
    await expect.poll(() => activeFile(page)).toBe(B_FILE);
    await expect.poll(() => page.evaluate(() => window.deckEditor.dirty)).toBe(false);
    expect(await title(page)).toBe('Second deck title');
    await expect(page.locator('.deck-tab').first()).toHaveClass(/dirty/);
    await expect(page.locator('.deck-tab').nth(1)).not.toHaveClass(/dirty/);

    await page.click('.deck-tab >> nth=0');
    await expect.poll(() => activeFile(page)).toBe('sample/index.html');
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('h1'));
    expect(await title(page)).toBe('Edited in A');
    expect(await page.evaluate(() => window.deckEditor.dirty)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.deckEditor.deck.current)).toBe(1);   // the slide it was on

    // A save comes back with no "changed on disk" conflict, and writes A only.
    const bBefore = fs.readFileSync(B_PATH, 'utf8');
    await save(page);
    await expect(page.locator('.conflict-bar')).toHaveCount(0);
    expect(readDeck()).toContain('Edited in A');
    expect(fs.readFileSync(B_PATH, 'utf8')).toBe(bBefore);
    await expect(page.locator('.deck-tab').first()).not.toHaveClass(/dirty/);
});

test('tabs: a change on disk made while the deck was in the background still raises the conflict', async ({ page }) => {
    await openDeck(page);
    await editTitle(page, 'Mine');
    await openSecond(page);
    fs.writeFileSync(DECK, fs.readFileSync(DECK, 'utf8').replace('<title>', '<!-- other program --><title>'));
    await page.click('.deck-tab >> nth=0');
    await expect.poll(() => activeFile(page)).toBe('sample/index.html');
    await expect.poll(() => page.evaluate(() => window.deckEditor.dirty)).toBe(true);
    await page.evaluate(() => window.deckEditor.save());
    await expect(page.locator('.conflict-bar')).toHaveCount(1);
});

test('tabs: closing a dirty tab asks; a clean one closes; the last one returns to the start screen', async ({ page }) => {
    await openDeck(page);
    await openSecond(page);
    await page.click('.deck-tab >> nth=0');
    await expect.poll(() => activeFile(page)).toBe('sample/index.html');
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('h1'));
    await editTitle(page, 'Unsaved');

    // Cancel keeps the tab and its edits.
    await page.click('.deck-tab.active .tab-close');
    await expect(page.locator('.tab-close-dialog')).toBeVisible();
    await page.click('.tab-close-dialog [data-c="cancel"]');
    await expect(page.locator('.deck-tab')).toHaveCount(2);
    expect(await page.evaluate(() => window.deckEditor.dirty)).toBe(true);

    // Discard closes it without writing the file; the other deck comes forward.
    await page.click('.deck-tab.active .tab-close');
    await page.click('.tab-close-dialog [data-c="discard"]');
    await expect(page.locator('.deck-tab')).toHaveCount(1);
    await expect.poll(() => activeFile(page)).toBe(B_FILE);
    expect(readDeck()).not.toContain('Unsaved');
    expect((await page.request.get('/api/draft?file=sample%2Findex.html').then(r => r.json())).exists).toBe(false);

    // The last tab, clean: back to the start screen (middle-click closes too).
    await page.locator('.deck-tab').first().click({ button: 'middle' });
    await expect(page.locator('.deck-tab')).toHaveCount(0);
    await expect(page.locator('body')).toHaveClass(/no-deck/);
    expect(await page.evaluate(() => location.search)).not.toContain('file=');
});

test('tabs: Save in the close prompt writes the file and closes the tab', async ({ page }) => {
    await openDeck(page);
    await openSecond(page);
    await page.click('.deck-tab >> nth=0');
    await expect.poll(() => activeFile(page)).toBe('sample/index.html');
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('h1'));
    await editTitle(page, 'Kept');
    // Close the dirty tab while it is in the background: the prompt saves it.
    await page.click('.deck-tab >> nth=1');
    await expect.poll(() => activeFile(page)).toBe(B_FILE);
    await page.locator('.deck-tab').first().locator('.tab-close').click();
    await page.click('.tab-close-dialog [data-c="save"]');
    await expect(page.locator('.deck-tab')).toHaveCount(1);
    await expect.poll(() => readDeck()).toContain('Kept');
});

test('tabs: a reload brings the tabs back', async ({ page }) => {
    await openDeck(page);
    await openSecond(page);
    await page.reload();
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen);
    await expect(page.locator('.deck-tab')).toHaveCount(2);
    expect(await tabNames(page)).toEqual(['Sample deck (test fixture)', 'Second deck']);
    await expect.poll(() => activeFile(page)).toBe(B_FILE);
    await page.click('.deck-tab >> nth=0');
    await expect.poll(() => activeFile(page)).toBe('sample/index.html');
    await expect(page.locator('.deck-tab.active .tab-name')).toHaveText('Sample deck (test fixture)');
});

test('tabs: Ctrl+PageDown and Ctrl+PageUp switch tabs', async ({ page }) => {
    await openDeck(page);
    await openSecond(page);
    await page.keyboard.press('Control+PageUp');
    await expect.poll(() => activeFile(page)).toBe('sample/index.html');
    await page.waitForFunction(() => !window.deckEditor.tabs.busy);
    await page.keyboard.press('Control+PageDown');
    await expect.poll(() => activeFile(page)).toBe(B_FILE);
});

test('tabs: renaming an open deck renames its tab', async ({ page }) => {
    await openDeck(page);
    await openSecond(page);
    await page.evaluate(async () => { await window.deckEditor.api.rename('sample/index.html', 'renamed.html'); window.deckEditor.tabs.renamed('sample/index.html', 'sample/renamed.html'); });
    await page.click('.deck-tab >> nth=0');
    await expect.poll(() => activeFile(page)).toBe('sample/renamed.html');
    await expect(page.locator('.deck-tab')).toHaveCount(2);
});
