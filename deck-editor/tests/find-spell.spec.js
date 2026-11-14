// Find and replace across the deck (Ctrl+F / Ctrl+H) and the spelling option.
const { test, expect, freshDeckEachTest, openDeck, readDeck, save } = require('./helpers');

freshDeckEachTest();

/* The deck as the tests use it: slide 3 gets formatting inside its list items. */
async function prepare(page) {
    await openDeck(page);
    await page.evaluate(() => {
        const lis = window.deckEditor.deck.slides[2].querySelectorAll('li');
        lis[1].innerHTML = 'Second <b>point</b> here';
        lis[2].innerHTML = 'Thi<b>rd</b> point';
    });
}
const bar = (page) => page.locator('#findBar');
async function openFind(page, text, { replace = false, options = [] } = {}) {
    await page.keyboard.press(replace ? 'Control+h' : 'Control+f');
    await expect(bar(page)).toBeVisible();
    for (const o of options) await bar(page).locator(`[data-o="${o}"]`).check();
    await bar(page).locator('.find-in').fill(text);
}
const count = (page) => bar(page).locator('.find-count');
const slideNow = (page) => page.evaluate(() => window.deckEditor.deck.current);
const slideHtml = (page) => page.evaluate(() => window.deckEditor.deck.slides.map(s => s.innerHTML).join('\n'));

test('Ctrl+F finds across slides, steps with Enter and Shift+Enter, selects and highlights', async ({ page }) => {
    await prepare(page);
    await openFind(page, 'point');
    await expect(count(page)).toHaveText('1 of 4');
    await expect.poll(() => slideNow(page)).toBe(2);
    expect(await page.evaluate(() => window.deckEditor.selection.single.tagName)).toBe('H2');
    expect(await page.evaluate(() => window.deckEditor.deck.win.CSS.highlights.has('diapo-find-current'))).toBe(true);
    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('2 of 4');
    await expect.poll(() => page.evaluate(() => window.deckEditor.selection.single.textContent)).toBe('First point');
    await page.keyboard.press('Shift+Enter');
    await expect(count(page)).toHaveText('1 of 4');
    // Matches on other slides: the title slide has none, so a word from it moves the view back.
    await bar(page).locator('.find-in').fill('Sample');
    await expect(count(page)).toHaveText('1 of 1');
    await expect.poll(() => slideNow(page)).toBe(0);
});

test('Match case and Whole word narrow the matches', async ({ page }) => {
    await prepare(page);
    await openFind(page, 'point');
    await expect(count(page)).toHaveText('1 of 4');
    await bar(page).locator('[data-o="wholeWord"]').check();
    await expect(count(page)).toHaveText(/of 3$/);             // "points" is not the word
    await bar(page).locator('[data-o="matchCase"]').check();
    await bar(page).locator('.find-in').fill('Point');
    await expect(count(page)).toHaveText('No matches');
    await bar(page).locator('.find-in').fill('First point');
    await expect(count(page)).toHaveText('1 of 1');
});

test('Speaker notes are searched only when asked for; skipped slides and hidden elements are searched', async ({ page }) => {
    await prepare(page);
    await openFind(page, 'Notes for slide');
    await expect(count(page)).toHaveText('No matches');
    await bar(page).locator('[data-o="notes"]').check();
    await expect(count(page)).toHaveText('1 of 1');
    await expect.poll(() => slideNow(page)).toBe(0);
    await expect(bar(page).locator('.find-note')).toContainText('speaker notes');
    // A skipped slide and a hidden element.
    await page.evaluate(() => {
        const d = window.deckEditor.deck;
        d.slides[2].setAttribute('data-skip', '');
        d.slides[2].querySelector('li').setAttribute('data-hidden', '1');
    });
    await bar(page).locator('.find-in').fill('First point');
    await expect(count(page)).toHaveText('1 of 1');
    await expect.poll(() => slideNow(page)).toBe(2);
    await expect(bar(page).locator('.find-note')).toContainText('hidden');
});

test('Replace changes one match; undo puts it back', async ({ page }) => {
    await prepare(page);
    const before = await slideHtml(page);
    await openFind(page, 'point', { replace: true });
    await bar(page).locator('.replace-in').fill('dot');
    await expect(count(page)).toHaveText('1 of 4');
    await bar(page).locator('[data-a="replace"]').click();
    // The first match was "Three points": replaced; the bar moved on to the next.
    await expect.poll(() => page.evaluate(() => window.deckEditor.deck.slides[2].querySelector('h2').textContent)).toBe('Three dots');
    await expect(count(page)).toHaveText('1 of 3');
    expect(await page.evaluate(() => window.deckEditor.deck.slides[2].querySelector('li').textContent)).toBe('First point');
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await slideHtml(page)).toBe(before);
});

test('Replace all is one undo step and keeps the formatting', async ({ page }) => {
    await prepare(page);
    const before = await slideHtml(page);
    await openFind(page, 'point', { replace: true });
    await bar(page).locator('.replace-in').fill('dot');
    const steps = await page.evaluate(() => window.deckEditor.history.undoStack.length);
    await bar(page).locator('[data-a="replaceAll"]').click();
    const lis = await page.evaluate(() => Array.from(window.deckEditor.deck.slides[2].querySelectorAll('li')).map(l => l.innerHTML));
    expect(lis).toEqual(['First dot', 'Second <b>dot</b> here', 'Thi<b>rd</b> dot']);
    expect(await page.evaluate(() => window.deckEditor.history.undoStack.length)).toBe(steps + 1);
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await slideHtml(page)).toBe(before);
    await page.evaluate(() => window.deckEditor.history.redo());
    expect(await page.evaluate(() => window.deckEditor.deck.slides[2].querySelector('h2').textContent)).toBe('Three dots');
});

test('A match across two formatting runs is skipped and counted', async ({ page }) => {
    await prepare(page);
    await openFind(page, 'third', { replace: true });
    await expect(count(page)).toHaveText('1 of 1');
    await bar(page).locator('.replace-in').fill('3rd');
    const before = await slideHtml(page);
    await bar(page).locator('[data-a="replaceAll"]').click();
    expect(await slideHtml(page)).toBe(before);
    await expect(page.locator('.toast')).toContainText('skipped 1');
    await expect(count(page)).toHaveText('1 found');
});

test('The highlight is never in the saved file (Highlight API and the fallback)', async ({ page }) => {
    await prepare(page);
    await openFind(page, 'point');
    await expect(count(page)).toHaveText('1 of 4');
    await save(page);
    let html = readDeck();
    expect(html).not.toMatch(/diapo-find|find-box|findBar/);
    // The fallback: boxes in the editor's layer, nothing in the deck's document.
    await page.evaluate(() => { const f = window.deckEditor.find; f.useApi = false; f._paint(); });
    await expect(page.locator('#stageWrap .find-box').first()).toBeVisible();
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('.find-box') === null && !window.deckEditor.deck.win.CSS.highlights.has('diapo-find-current'))).toBe(true);
    await page.evaluate(() => window.deckEditor.history.forceDirty());
    await save(page);
    html = readDeck();
    expect(html).not.toMatch(/diapo-find|find-box|findBar/);
});

test('Esc closes the bar and gives back the selection; the palette has Find and Replace', async ({ page }) => {
    await prepare(page);
    await page.evaluate(() => { const a = window.deckEditor; a.selection.select(a.deck.currentSlide.querySelector('h1')); });
    await openFind(page, 'point');
    await expect.poll(() => slideNow(page)).toBe(2);
    await page.keyboard.press('Escape');
    await expect(bar(page)).toHaveCount(0);
    await expect.poll(() => slideNow(page)).toBe(0);
    expect(await page.evaluate(() => window.deckEditor.selection.single.tagName)).toBe('H1');
    expect(await page.evaluate(() => window.deckEditor.deck.win.CSS.highlights.has('diapo-find'))).toBe(false);
    await page.keyboard.press('Control+k');
    await page.locator('.palette-input').fill('replace...');
    await page.keyboard.press('Enter');
    await expect(bar(page).locator('.replace-in')).toBeVisible();
});

test('Spelling: on while a text is edited, never in the saved file, and a Look option', async ({ page }) => {
    await openDeck(page);
    await expect(page.locator('#btnSpellState')).toHaveText('on');
    const state = await page.evaluate(() => {
        const a = window.deckEditor, p = a.deck.currentSlide.querySelector('h1');
        const idle = p.hasAttribute('spellcheck');
        a.textEdit.start(p);
        const editing = p.getAttribute('spellcheck');
        const saved = a.deck.serialize();
        const inFile = /spellcheck/.test(saved);
        a.textEdit.commit();
        return { idle, editing, inFile, after: p.hasAttribute('spellcheck') };
    });
    expect(state).toEqual({ idle: false, editing: 'true', inFile: false, after: false });
    // Off from the Look menu: remembered, and a text edited then is not checked.
    await page.locator('#btnLook').click();
    await page.locator('[data-opt="spell"]').click();
    await expect(page.locator('#btnSpellState')).toHaveText('off');
    expect(await page.evaluate(() => localStorage.getItem('deck-editor-spell'))).toBe('0');
    expect(await page.evaluate(() => { const a = window.deckEditor, p = a.deck.currentSlide.querySelector('h1'); a.textEdit.start(p); const v = p.getAttribute('spellcheck'); a.textEdit.commit(); return v; })).toBe('false');
    await page.evaluate(() => localStorage.setItem('deck-editor-spell', '1'));
    // Saving while an element is still being edited leaves the attribute out of the file too.
    await page.evaluate(() => { const a = window.deckEditor; a.textEdit.start(a.deck.currentSlide.querySelector('h1')); });
    await page.evaluate(() => window.deckEditor.textEdit.el.setAttribute('spellcheck', 'true'));
    await page.evaluate(() => window.deckEditor.save());
    expect(readDeck()).not.toMatch(/spellcheck/);
});
