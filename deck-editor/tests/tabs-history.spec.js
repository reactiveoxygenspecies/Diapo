// Undo history follows a deck through tab switches: the deck left in the background keeps its
// document (parked, hidden) and its history, and both come back with its tab.
const { test, expect, fs, path, freshDeckEachTest, openDeck, FIXTURE, WS } = require('./helpers');

freshDeckEachTest();

const A_FILE = 'sample/index.html';
const B_FILE = 'second/index.html';
const B_PATH = path.join(WS, 'second', 'index.html');

test.beforeEach(async ({ page }) => {
    fs.rmSync(path.join(WS, 'second'), { recursive: true, force: true });
    fs.cpSync(path.dirname(FIXTURE), path.join(WS, 'second'), { recursive: true });
    fs.writeFileSync(B_PATH, fs.readFileSync(B_PATH, 'utf8').replace('Sample deck title', 'Second deck title').replace('Sample deck (test fixture)', 'Second deck'));
    await page.request.post('/api/trust?file=' + encodeURIComponent(B_FILE) + '&on=1');
});

const ed = (page, fn, arg) => page.evaluate(fn, arg);
const activeFile = (page) => ed(page, () => window.deckEditor.file);
const dirty = (page) => ed(page, () => window.deckEditor.dirty);
const title = (page) => ed(page, () => window.deckEditor.deck.doc.querySelector('h1').textContent);
const slideIds = (page) => ed(page, () => window.deckEditor.deck.slides.map(s => s.querySelector('h1, h2') ? s.querySelector('h1, h2').textContent.trim() : ''));
const accent = (page) => ed(page, () => window.deckEditor.deck.overrides.vars.accent || '');
const canUndo = (page) => ed(page, () => window.deckEditor.history.canUndo);
const undo = (page) => ed(page, () => { window.deckEditor.history.undo(); });
const redo = (page) => ed(page, () => { window.deckEditor.history.redo(); });
const draftExists = async (page, file) => (await page.request.get('/api/draft?file=' + encodeURIComponent(file)).then(r => r.json())).exists;

async function switchTo(page, i, file) {
    await page.click(`.deck-tab >> nth=${i}`);
    await expect.poll(() => activeFile(page)).toBe(file);
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && !window.deckEditor.tabs.busy && window.deckEditor.deck.doc.querySelector('h1'));
}
async function openBoth(page) {
    await openDeck(page);
    await page.evaluate((f) => window.deckEditor.openDeck(f), B_FILE);
    await expect.poll(() => activeFile(page)).toBe(B_FILE);
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && !window.deckEditor.tabs.busy && window.deckEditor.deck.doc.querySelector('.slide.active'));
}
async function editTitle(page, text) {
    await ed(page, (text) => {
        const e = window.deckEditor, h = e.deck.doc.querySelector('h1');
        const before = h.innerHTML; h.textContent = text;
        e.history.html(h, before, h.innerHTML);
    }, text);
    await expect.poll(() => dirty(page)).toBe(true);
}

test('tab history: a text edit is undone and redone after a switch, and B keeps its own', async ({ page }) => {
    await openBoth(page);
    await switchTo(page, 0, A_FILE);
    await editTitle(page, 'Edited in A');
    await switchTo(page, 1, B_FILE);
    expect(await canUndo(page)).toBe(false);             // A's steps are not B's
    await editTitle(page, 'Edited in B');
    await switchTo(page, 0, A_FILE);
    expect(await title(page)).toBe('Edited in A');
    expect(await canUndo(page)).toBe(true);
    await undo(page);
    expect(await title(page)).toBe('Sample deck title');
    await redo(page);
    expect(await title(page)).toBe('Edited in A');
    // B's history is untouched by all that.
    await switchTo(page, 1, B_FILE);
    expect(await title(page)).toBe('Edited in B');
    await undo(page);
    expect(await title(page)).toBe('Second deck title');
    expect(await canUndo(page)).toBe(false);
    // Only one deck frame is shown; the parked one is hidden.
    expect(await ed(page, () => [...document.querySelectorAll('#stageWrap iframe')].map(f => f.hidden))).toEqual([false, true]);
});

test('tab history: a slide reorder and a theme change are undone after a switch', async ({ page }) => {
    await openBoth(page);
    await switchTo(page, 0, A_FILE);
    const order = await slideIds(page);
    await ed(page, () => window.deckEditor.strip.moveSlide(0, 2));
    const moved = await slideIds(page);
    expect(moved).not.toEqual(order);
    await ed(page, () => window.deckEditor.theme._change('Theme: accent', (o) => { o.vars.accent = '#123456'; }));
    expect(await accent(page)).toBe('#123456');

    await switchTo(page, 1, B_FILE);
    expect(await accent(page)).toBe('');
    await switchTo(page, 0, A_FILE);
    expect(await accent(page)).toBe('#123456');
    await undo(page);
    expect(await accent(page)).toBe('');
    expect(await ed(page, () => window.deckEditor.deck.doc.getElementById('deck-editor-overrides')?.textContent || '')).not.toContain('#123456');
    expect(await slideIds(page)).toEqual(moved);
    await undo(page);
    expect(await slideIds(page)).toEqual(order);
    await redo(page);
    expect(await slideIds(page)).toEqual(moved);
    await redo(page);
    expect(await accent(page)).toBe('#123456');
    // The strip shows the deck that came back, in its order.
    await expect(page.locator('#stripList .strip-item')).toHaveCount(moved.length);
});

test('tab history: undoing back to the saved state after a switch makes the deck clean and drops its draft', async ({ page }) => {
    await openBoth(page);
    await switchTo(page, 0, A_FILE);
    await editTitle(page, 'Unsaved in A');
    await switchTo(page, 1, B_FILE);
    expect(await draftExists(page, A_FILE)).toBe(true);    // written when the tab was left
    await expect(page.locator('.deck-tab').first()).toHaveClass(/dirty/);
    await switchTo(page, 0, A_FILE);
    expect(await dirty(page)).toBe(true);
    await undo(page);
    await expect.poll(() => dirty(page)).toBe(false);
    await expect(page.locator('.deck-tab').first()).not.toHaveClass(/dirty/);
    await expect.poll(() => draftExists(page, A_FILE)).toBe(false);
    // Redo makes it dirty again, as without the switch.
    await redo(page);
    await expect.poll(() => dirty(page)).toBe(true);
});

test('tab history: closing a tab drops its history; the deck opened again starts with none', async ({ page }) => {
    await openBoth(page);
    await switchTo(page, 0, A_FILE);
    await editTitle(page, 'Edited in A');
    await switchTo(page, 1, B_FILE);
    // Close A in the background, discarding its edits: its parked frame goes with it.
    await page.locator('.deck-tab').first().locator('.tab-close').click();
    await page.click('.tab-close-dialog [data-c="discard"]');
    await expect(page.locator('.deck-tab')).toHaveCount(1);
    expect(await ed(page, () => document.querySelectorAll('#stageWrap iframe').length)).toBe(1);
    await page.evaluate((f) => window.deckEditor.openDeck(f), A_FILE);
    await expect.poll(() => activeFile(page)).toBe(A_FILE);
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && !window.deckEditor.tabs.busy && window.deckEditor.deck.doc.querySelector('h1'));
    expect(await title(page)).toBe('Sample deck title');
    expect(await canUndo(page)).toBe(false);
    expect(await dirty(page)).toBe(false);
});

test('tab history: a clean background deck changed on disk is read again', async ({ page }) => {
    await openBoth(page);
    await switchTo(page, 0, A_FILE);
    await editTitle(page, 'Saved in A');
    await page.evaluate(() => window.deckEditor.save());
    await expect.poll(() => dirty(page)).toBe(false);
    await switchTo(page, 1, B_FILE);
    const deck = path.join(WS, 'sample', 'index.html');
    fs.writeFileSync(deck, fs.readFileSync(deck, 'utf8').replace('Saved in A', 'Changed elsewhere'));
    await switchTo(page, 0, A_FILE);
    await expect.poll(() => title(page)).toBe('Changed elsewhere');
    expect(await canUndo(page)).toBe(false);
});

test('tab history: the history keeps its last 200 steps, and the saved point stays right', async ({ page }) => {
    await openDeck(page);
    const r = await ed(page, () => {
        const h = window.deckEditor.history, el = window.deckEditor.deck.doc.querySelector('h1');
        for (let i = 0; i < 205; i++) h.attr(el, 'data-n', String(i));
        const kept = h.undoStack.length;
        while (h.canUndo) h.undo();
        return { kept, dirty: h.isDirty, n: el.getAttribute('data-n') };
    });
    // The first five steps are gone: undoing everything stops at step 5, which is not the saved state.
    expect(r).toEqual({ kept: 200, dirty: true, n: '4' });
});
