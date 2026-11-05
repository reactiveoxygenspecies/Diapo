// Slide strip: Delete, and Ctrl+C / X / V of whole slides, within a deck and between decks.
const { test, expect, fs, path, freshDeckEachTest, DECK_DIR, WS, openDeck } = require('./helpers');

freshDeckEachTest();

const count = (page) => page.evaluate(() => window.deckEditor.deck.slides.length);
const names = (page) => page.evaluate(() => window.deckEditor.deck.slides.map(s => s.getAttribute('data-name')));
const stripItem = (page, i) => page.locator('#stripList .strip-item').nth(i);

async function openOther(page, file) {
    await page.request.post('/api/trust?file=' + encodeURIComponent(file) + '&on=1');
    await page.evaluate((f) => window.deckEditor.openDeck(f, { discard: true }), file);
    await page.waitForFunction((f) => window.deckEditor.file === f && window.deckEditor.deck.isOpen && window.deckEditor.deck.slides.length > 0, file);
    await page.waitForTimeout(900);
}

test('Delete in the strip removes the picked slides as one undo step', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => { const a = window.deckEditor; a.strip.addSlide(2).setAttribute('data-name', 'x1'); a.strip.addSlide(3).setAttribute('data-name', 'x2'); });
    await page.waitForTimeout(500);
    const before = await names(page);
    expect(before.length).toBe(5);
    await stripItem(page, 1).click();
    await stripItem(page, 2).click({ modifiers: ['Control'] });
    await expect(page.locator('#stripList .strip-item.picked')).toHaveCount(2);
    await page.keyboard.press('Delete');
    expect(await names(page)).toEqual([before[0], ...before.slice(3)]);
    await page.keyboard.press('Control+z');
    expect(await names(page)).toEqual(before);                 // one Ctrl+Z restores both
    // Backspace too, for a single slide.
    await stripItem(page, 1).click();
    await page.keyboard.press('Backspace');
    expect((await names(page)).length).toBe(before.length - 1);
    await page.keyboard.press('Control+z');
    expect(await names(page)).toEqual(before);
});

test('Delete leaves canvas elements and text fields alone, and never empties the deck', async ({ page }) => {
    await openDeck(page);
    const n = await count(page);
    // A canvas selection: Delete removes the element, not the slide.
    await stripItem(page, 0).click();
    await page.evaluate(() => { const a = window.deckEditor; a.selection.select(a.deck.currentSlide.querySelector('h1')); });
    await page.keyboard.press('Delete');
    expect(await count(page)).toBe(n);
    expect(await page.evaluate(() => !window.deckEditor.deck.currentSlide.querySelector('h1'))).toBe(true);
    await page.keyboard.press('Control+z');
    // Typing in a panel field.
    await stripItem(page, 1).click();
    const field = page.locator('input[type=text]:visible').first();
    if (await field.count()) { await field.click(); await page.keyboard.press('Delete'); }
    expect(await count(page)).toBe(n);
    // Every slide picked: refused.
    await stripItem(page, 0).click();
    await stripItem(page, n - 1).click({ modifiers: ['Shift'] });
    await page.keyboard.press('Delete');
    expect(await count(page)).toBe(n);
});

test('copy, cut and paste slides within a deck', async ({ page }) => {
    await openDeck(page);
    const before = await names(page);
    await stripItem(page, 0).click();
    await stripItem(page, 1).click({ modifiers: ['Shift'] });
    await page.keyboard.press('Control+c');
    await stripItem(page, 2).click();
    await page.keyboard.press('Control+v');
    await page.waitForFunction((n) => window.deckEditor.deck.slides.length === n, before.length + 2);
    expect(await names(page)).toEqual([...before.slice(0, 3), before[0], before[1], ...before.slice(3)]);
    await page.keyboard.press('Control+z');
    expect(await names(page)).toEqual(before);                 // one undo step
    // Cut the last slide and paste it after the first.
    await stripItem(page, before.length - 1).click();
    await page.keyboard.press('Control+x');
    expect((await names(page)).length).toBe(before.length - 1);
    await stripItem(page, 0).click();
    await page.keyboard.press('Control+v');
    await page.waitForFunction((n) => window.deckEditor.deck.slides.length === n, before.length);
    expect((await names(page))[1]).toBe(before[before.length - 1]);
    // No duplicate ids afterwards.
    expect(await page.evaluate(() => { const ids = Array.from(window.deckEditor.deck.doc.querySelectorAll('[id]')).map(e => e.id); return ids.length - new Set(ids).size; })).toBe(0);
});

test('slides pasted into another deck bring their pictures and element CSS along', async ({ page }) => {
    // Deck B: the same slides in another folder, without the picture file.
    const dirB = path.join(WS, 'deckb');
    fs.rmSync(dirB, { recursive: true, force: true });
    fs.cpSync(DECK_DIR, dirB, { recursive: true });
    fs.rmSync(path.join(dirB, 'assets'), { recursive: true, force: true });
    fs.rmSync(path.join(dirB, '.deck-editor'), { recursive: true, force: true });
    await openDeck(page);
    const withImg = 0;
    await page.evaluate((i) => {
        const s = window.deckEditor.deck.slides[i], el = s.ownerDocument.createElement('img');
        el.setAttribute('src', 'assets/shape.svg'); el.setAttribute('data-id', 'el-copyme'); el.setAttribute('data-css', 'opacity: 0.5;'); el.setAttribute('style', 'position:absolute;left:10px;top:10px;width:100px');
        s.appendChild(el);
    }, withImg);
    await stripItem(page, withImg).click();
    await page.keyboard.press('Control+c');
    await openOther(page, 'deckb/index.html');       // the same page, as from the Decks drawer
    const n = await count(page);
    await stripItem(page, 0).click();
    await page.keyboard.press('Control+v');
    await page.waitForFunction((n) => window.deckEditor.deck.slides.length === n + 1, n);
    const pasted = await page.evaluate(() => {
        const img = window.deckEditor.deck.slides[1].querySelector('img[data-id]');
        return { src: img.getAttribute('src'), css: img.getAttribute('data-css'), resolved: img.src };
    });
    expect(pasted.css).toBe('opacity: 0.5;');
    expect(pasted.src).toBe('assets/shape.svg');
    expect(pasted.resolved).toContain('/deck/deckb/assets/shape.svg');
    await page.waitForFunction(() => window.deckEditor.deck.slides[1].querySelector('img[data-id]').naturalWidth > 0);
    expect(fs.existsSync(path.join(dirB, 'assets', 'shape.svg'))).toBe(true);
    await page.keyboard.press('Control+z');
    expect(await count(page)).toBe(n);
});

test('a file the upload refuses is addressed relative to the target deck', async ({ page }) => {
    await openDeck(page);
    const dirC = path.join(WS, 'deepc', 'sub');
    fs.rmSync(path.join(WS, 'deepc'), { recursive: true, force: true });
    fs.mkdirSync(dirC, { recursive: true });
    fs.copyFileSync(path.join(DECK_DIR, 'index.html'), path.join(dirC, 'index.html'));
    await page.evaluate(() => {
        const s = window.deckEditor.deck.slides[0];
        const d = window.deckEditor.deck.doc.createElement('div');
        d.style.cssText = 'background-image:url(assets/missing.dat)'; s.appendChild(d);
    });
    await stripItem(page, 0).click();
    await page.keyboard.press('Control+c');
    await openOther(page, 'deepc/sub/index.html');
    await stripItem(page, 0).click();
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => window.deckEditor.history.top && /Paste slide/.test(window.deckEditor.history.top.label));
    const bg = await page.evaluate(() => window.deckEditor.deck.slides[1].lastElementChild.getAttribute('style'));
    expect(bg).toContain('../../sample/assets/missing.dat');
});
