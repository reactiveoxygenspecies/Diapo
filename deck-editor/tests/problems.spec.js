// The "problems" list in the status bar follows the document: a broken picture inserted later is
// listed, Show selects it, deleting it clears the entry and undo brings it back.
const { test, expect, freshDeckEachTest, goTo, openDeck } = require('./helpers');

freshDeckEachTest();

const badgeText = (page) => page.evaluate(() => { const b = document.getElementById('problemsBadge'); return b.hidden ? null : b.textContent; });

async function insertBroken(page, slideIndex, src = 'assets/nope.png') {
    await page.evaluate(([i, src]) => {
        const ed = window.deckEditor;
        const slide = ed.deck.slides[i];
        const img = ed.deck.doc.createElement('img');
        img.id = 'tst-broken';
        img.setAttribute('src', src);
        img.style.cssText = 'position:absolute;left:200px;top:200px;width:300px;height:200px';
        ed.history.insert(img, slide);
    }, [slideIndex, src]);
}

test('problems: a broken picture inserted later is listed, shown, cleared on delete and back on undo', async ({ page }) => {
    await openDeck(page);
    await goTo(page, 1);
    expect(await badgeText(page)).toBeNull();
    await insertBroken(page, 1);
    await expect.poll(() => badgeText(page)).toBe('1 problem');

    // Show from another slide: goes to the slide and selects the picture.
    await goTo(page, 0);
    await page.click('#problemsBadge');
    await expect(page.locator('.problems .problem')).toContainText('on slide 2');
    await page.click('.problems [data-select]');
    await expect.poll(() => page.evaluate(() => { const ed = window.deckEditor; return ed.deck.current + ':' + (ed.selection.single && ed.selection.single.id); })).toBe('1:tst-broken');

    // Delete it: the entry goes, the badge hides.
    await page.evaluate(() => window.deckEditor.editops.remove());
    await expect.poll(() => badgeText(page)).toBeNull();
    // Undo brings the same node back, which fires no new error: it is found by the rescan.
    await page.evaluate(() => window.deckEditor.history.undo());
    await expect.poll(() => badgeText(page)).toBe('1 problem');
});

test('problems: a stale entry for a detached element is dropped when the panel opens', async ({ page }) => {
    await openDeck(page);
    await goTo(page, 1);
    await insertBroken(page, 1);
    await expect.poll(() => badgeText(page)).toBe('1 problem');
    // Gone behind the editor's back (no history step), as with a removed paste.
    await page.evaluate(() => window.deckEditor.deck.doc.getElementById('tst-broken').remove());
    await page.evaluate(() => window.deckEditor.problems.open());
    expect(await badgeText(page)).toBeNull();
    await expect(page.locator('.problems')).toHaveCount(0);
});

test('problems: Remove deletes a missing picture in one undo step', async ({ page }) => {
    await openDeck(page);
    await goTo(page, 1);
    await insertBroken(page, 1);
    await expect.poll(() => badgeText(page)).toBe('1 problem');
    const depth = () => page.evaluate(() => window.deckEditor.history.undoStack.length);
    const d0 = await depth();
    await page.click('#problemsBadge');
    await page.click('.problems [data-remove]');
    expect(await depth()).toBe(d0 + 1);
    expect(await page.evaluate(() => !!window.deckEditor.deck.doc.getElementById('tst-broken'))).toBe(false);
    await expect.poll(() => badgeText(page)).toBeNull();
    await page.evaluate(() => window.deckEditor.history.undo());
    await expect.poll(() => badgeText(page)).toBe('1 problem');
});

test('problems: a broken picture in the master layer says so and Show selects it', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => {
        const ed = window.deckEditor;
        const img = ed.deck.doc.createElement('img');
        img.id = 'tst-master'; img.setAttribute('src', 'assets/nologo.png');
        img.style.cssText = 'position:absolute;left:40px;top:20px;width:100px;height:60px';
        ed.history.insert(img, ed.deck.stage);
    });
    await expect.poll(() => badgeText(page)).toBe('1 problem');
    await page.click('#problemsBadge');
    await expect(page.locator('.problems .problem')).toContainText('on every slide');
    await page.click('.problems [data-select]');
    await expect.poll(() => page.evaluate(() => { const s = window.deckEditor.selection.single; return s && s.id; })).toBe('tst-master');
});
