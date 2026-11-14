// Slide strip: moving several picked slides at once (drag, menu, keys, palette), into sections,
// one undo step each, without reloading the other thumbnails; and the strip's numbers' contrast.
const { test, expect, freshDeckEachTest, openDeck } = require('./helpers');

freshDeckEachTest();

const names = (page) => page.evaluate(() => window.deckEditor.deck.slides.map(s => s.getAttribute('data-name')));
const item = (page, i) => page.locator('#stripList .strip-item').nth(i);
const picked = (page) => page.evaluate(() => window.deckEditor.strip.itemList().filter(it => it.classList.contains('picked')).map(it => it._slide.getAttribute('data-name')));
const current = (page) => page.evaluate(() => window.deckEditor.deck.currentSlide.getAttribute('data-name'));

/* The fixture's three slides and blank ones after them, named s1, s2, ... in order. */
async function deckOf(page, n) {
    await openDeck(page);
    await page.evaluate((n) => {
        const a = window.deckEditor;
        while (a.deck.slides.length < n) a.strip.addSlide(a.deck.slides.length - 1);
        a.deck.slides.forEach((s, i) => s.setAttribute('data-name', 's' + (i + 1)));
        a.strip.rebuild();
    }, n);
    // Adding a slide goes to it a moment later: let that land before going back to the first.
    await page.waitForTimeout(200);
    await page.evaluate(() => window.deckEditor.deck.goTo(0));
    await page.waitForFunction(() => window.deckEditor.deck.current === 0);
    await page.waitForTimeout(300);
    return names(page);
}
/* Click a thumbnail (with modifiers) and wait for a plain click's slide change. */
async function clickItem(page, i, modifiers = []) {
    await item(page, i).click({ modifiers });
    if (!modifiers.length) await page.waitForFunction((i) => window.deckEditor.deck.current === i, i);
}
async function dragTo(page, fromIndex, y, check = null) {
    const b = await item(page, fromIndex).locator('.thumb').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 10, { steps: 2 });
    await page.mouse.move(b.x + b.width / 2, y, { steps: 8 });
    if (check) await check();
    await page.mouse.up();
}

test('dragging a picked slide takes the picked ones along as a block, one undo step', async ({ page }) => {
    const before = await deckOf(page, 6);
    expect(before).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    await clickItem(page, 1);
    await clickItem(page, 3, ['Control']);
    expect(await picked(page)).toEqual(['s2', 's4']);
    // Drop in the upper half of s6: before it.
    const t = await item(page, 5).boundingBox();
    await dragTo(page, 1, t.y + 6, async () => {
        await expect(page.locator('.strip-drag-badge')).toHaveText('2 slides');
        await expect(page.locator('#stripList .strip-item.dragging')).toHaveCount(2);
        await expect(item(page, 5)).toHaveClass(/drop-before/);
    });
    expect(await names(page)).toEqual(['s1', 's3', 's5', 's2', 's4', 's6']);
    await expect(page.locator('.strip-drag-badge')).toHaveCount(0);
    expect(await picked(page)).toEqual(['s2', 's4']);                 // the pick survives the move
    expect(await page.locator('#stripList .n').allTextContents()).toEqual(['1', '2', '3', '4', '5', '6']);
    await page.keyboard.press('Control+z');
    expect(await names(page)).toEqual(before);                        // one step
    await page.keyboard.press('Control+y');
    expect(await names(page)).toEqual(['s1', 's3', 's5', 's2', 's4', 's6']);
    // An unpicked slide dragged goes alone: s6 to the top.
    const top = await item(page, 0).boundingBox();
    await dragTo(page, 5, top.y + 4);
    expect(await names(page)).toEqual(['s6', 's1', 's3', 's5', 's2', 's4']);
});

test('dropping on or just under a section heading puts the slides in that section', async ({ page }) => {
    await deckOf(page, 6);
    await page.evaluate(() => { const a = window.deckEditor; a.deck.slides[3].setAttribute('data-section', 'Part B'); a.strip.syncStructure(); });
    await expect(page.locator('.strip-section .name')).toHaveText('Part B');
    await clickItem(page, 0);
    await clickItem(page, 1, ['Shift']);
    expect(await picked(page)).toEqual(['s1', 's2']);
    const section = (page) => page.evaluate(() => window.deckEditor.deck.slides.map(s => s.getAttribute('data-section') || ''));
    // Onto the heading's lower half: in, first in the section; the heading moves to the first of them.
    let h = await page.locator('.strip-section').boundingBox();
    await dragTo(page, 0, h.y + h.height - 2, async () => { await expect(page.locator('.strip-section')).toHaveClass(/drop-into/); });
    expect(await names(page)).toEqual(['s3', 's1', 's2', 's4', 's5', 's6']);
    expect(await section(page)).toEqual(['', 'Part B', '', '', '', '']);
    await expect(page.locator('.strip-section .count')).toHaveText('5');
    await page.keyboard.press('Control+z');                           // order and section name together
    expect(await names(page)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(await section(page)).toEqual(['', '', '', 'Part B', '', '']);
    // Just under the heading (the first slide's upper half): in as well.
    const first = await item(page, 3).boundingBox();
    await dragTo(page, 0, first.y + 4);
    expect(await names(page)).toEqual(['s3', 's1', 's2', 's4', 's5', 's6']);
    expect(await section(page)).toEqual(['', 'Part B', '', '', '', '']);
    await page.keyboard.press('Control+z');
    // Above the heading (its upper half): at the end of the section before, the heading stays.
    h = await page.locator('.strip-section').boundingBox();
    await dragTo(page, 0, h.y + 2, async () => { await expect(page.locator('.strip-section')).toHaveClass(/drop-before/); });
    expect(await names(page)).toEqual(['s3', 's1', 's2', 's4', 's5', 's6']);
    expect(await section(page)).toEqual(['', '', '', 'Part B', '', '']);
});

test('the menu moves a scattered pick the PowerPoint way, and Move to... takes a number or a section', async ({ page }) => {
    const before = await deckOf(page, 6);
    await clickItem(page, 1);
    await clickItem(page, 3, ['Control']);
    await clickItem(page, 4, ['Control']);
    expect(await picked(page)).toEqual(['s2', 's4', 's5']);
    const menu = async (i, label) => { await item(page, i).click({ button: 'right' }); const b = page.locator('.strip-menu button', { hasText: label }); return b; };
    // Up: s2 passes s1, the block s4-s5 passes s3.
    let b = await menu(3, 'Move 3 slides up');
    await b.click();
    expect(await names(page)).toEqual(['s2', 's1', 's4', 's5', 's3', 's6']);
    b = await menu(0, 'Move 3 slides up');
    await b.click();
    expect(await names(page)).toEqual(['s2', 's4', 's5', 's1', 's3', 's6']);          // s2 at the top stays, the block stops against it
    b = await menu(0, 'Move 3 slides up');
    await expect(b).toBeDisabled();                                                     // nothing can go further
    await expect(page.locator('.strip-menu button', { hasText: 'Move 3 slides to top' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('.strip-menu')).toHaveCount(0);
    expect(await picked(page)).toEqual(['s2', 's4', 's5']);                             // Esc closed the menu, the pick stays
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect(await names(page)).toEqual(before);
    // To bottom, then Move to... slide 2.
    b = await menu(1, 'Move 3 slides to bottom');
    await b.click();
    expect(await names(page)).toEqual(['s1', 's3', 's6', 's2', 's4', 's5']);
    b = await menu(3, 'Move 3 slides to...');
    await b.click();
    const input = page.locator('.strip-moveto input');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('4');
    await input.fill('2');
    await page.keyboard.press('Enter');
    expect(await names(page)).toEqual(['s1', 's2', 's4', 's5', 's3', 's6']);
    // Move to the end of a section.
    await page.evaluate(() => { const a = window.deckEditor; a.deck.slides[0].setAttribute('data-section', 'Intro'); a.deck.slides[4].setAttribute('data-section', 'Outro'); a.strip.syncStructure(); });
    b = await menu(1, 'Move 3 slides to...');
    await b.click();
    await page.locator('.strip-moveto button', { hasText: 'Outro' }).click();
    expect(await names(page)).toEqual(['s1', 's3', 's6', 's2', 's4', 's5']);
    expect(await picked(page)).toEqual(['s2', 's4', 's5']);
    await page.keyboard.press('Control+z');
    expect(await names(page)).toEqual(['s1', 's2', 's4', 's5', 's3', 's6']);
    // The palette: "move to 1".
    await page.keyboard.press('Control+k');
    await page.keyboard.type('move to 1');
    await expect(page.locator('.palette-item.on .palette-label')).toHaveText('Move 3 slides to...');
    await page.keyboard.press('Enter');
    expect(await names(page)).toEqual(['s2', 's4', 's5', 's1', 's3', 's6']);
});

test('Shift+arrows grow the pick, Ctrl+arrows move it, Esc clears it', async ({ page }) => {
    const before = await deckOf(page, 6);
    await clickItem(page, 2);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    expect(await picked(page)).toEqual(['s3', 's4', 's5']);
    await expect.poll(() => current(page)).toBe('s5');
    await page.keyboard.press('Shift+ArrowUp');
    expect(await picked(page)).toEqual(['s3', 's4']);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Control+ArrowDown');
    expect(await names(page)).toEqual(['s1', 's2', 's6', 's3', 's4', 's5']);
    await page.keyboard.press('Control+ArrowDown');                                    // at the end: nothing moves
    expect(await names(page)).toEqual(['s1', 's2', 's6', 's3', 's4', 's5']);
    await page.keyboard.press('Control+ArrowUp');
    await page.keyboard.press('Control+ArrowUp');
    expect(await names(page)).toEqual(['s1', 's3', 's4', 's5', 's2', 's6']);
    expect(await picked(page)).toEqual(['s3', 's4', 's5']);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect(await names(page)).toEqual(before);
    await page.keyboard.press('Control+y');
    expect(await names(page)).toEqual(['s1', 's2', 's6', 's3', 's4', 's5']);
    await page.keyboard.press('Escape');
    expect(await picked(page)).toEqual([]);
    // Without a pick Ctrl+Up moves the current slide alone.
    await expect.poll(() => current(page)).toBe('s5');
    await page.keyboard.press('Control+ArrowUp');
    expect(await names(page)).toEqual(['s1', 's2', 's6', 's3', 's5', 's4']);
});

/* Every strip item in view has a drawn thumbnail. */
const allDrawn = (page) => page.evaluate(() => {
    const s = window.deckEditor.strip, r = s.list.getBoundingClientRect();
    return s.itemList().filter(it => { const b = it.getBoundingClientRect(); return b.height && b.bottom > r.top && b.top < r.bottom; })
        .every(it => { const f = it.querySelector('iframe'); try { return f && f.contentDocument.URL === 'about:srcdoc' && f.contentDocument.readyState === 'complete' && f.contentDocument.querySelector('.slide'); } catch (e) { return false; } });
});

test('a group move reloads no thumbnail but the moved ones, and the strip scrolls to them', async ({ page }) => {
    await deckOf(page, 12);
    await expect.poll(() => allDrawn(page), { timeout: 8000 }).toBe(true);
    // Each thumbnail's document is marked: a reloaded frame has a new one.
    await page.evaluate(() => { window.deckEditor.strip.itemList().forEach(it => { const f = it.querySelector('iframe'); if (f && f.contentDocument) f.contentDocument._mark = 1; }); });
    const result = await page.evaluate(() => {
        const a = window.deckEditor, sl = a.deck.slides;
        a.strip.setSelection([sl[1], sl[4], sl[6]]);
        a.deck.goTo(4);
        return true;
    });
    expect(result).toBe(true);
    await page.waitForFunction(() => window.deckEditor.deck.current === 4);
    await page.evaluate(() => window.deckEditor.strip.moveSelected('bottom'));
    await page.waitForTimeout(600);
    const reloaded = await page.evaluate(() => window.deckEditor.strip.itemList().filter(it => { const f = it.querySelector('iframe'); return f && f.contentDocument && !f.contentDocument._mark; }).map(it => it._slide.getAttribute('data-name')));
    for (const n of reloaded) expect(['s2', 's5', 's7']).toContain(n);
    expect(await names(page)).toEqual(['s1', 's3', 's4', 's6', 's8', 's9', 's10', 's11', 's12', 's2', 's5', 's7']);
    // The moved slides are in view at the bottom of the strip, still picked.
    const inView = await page.evaluate(() => {
        const s = window.deckEditor.strip, r = s.list.getBoundingClientRect();
        return s.itemList().slice(-3).every(it => { const b = it.getBoundingClientRect(); return b.top >= r.top - 1 && b.bottom <= r.bottom + 1; });
    });
    expect(inView).toBe(true);
    expect(await picked(page)).toEqual(['s2', 's5', 's7']);
    // And back to the top: the strip scrolls up to them.
    await page.evaluate(() => window.deckEditor.strip.moveSelected('top'));
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => { const s = window.deckEditor.strip, r = s.list.getBoundingClientRect(), b = s.itemList()[0].getBoundingClientRect(); return b.top >= r.top - 1; })).toBe(true);
    await expect.poll(() => allDrawn(page), { timeout: 8000 }).toBe(true);
});

test('the strip\'s slide numbers reach 4.5:1 on the panel in every look', async ({ page }) => {
    await deckOf(page, 3);
    const ratios = await page.evaluate(() => {
        const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
        const lum = (c) => { const v = rgb(c).map(x => x / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const out = {};
        for (const look of ['ink', 'dark', 'clean', 'slate']) {
            if (look === 'clean') delete document.documentElement.dataset.look; else document.documentElement.dataset.look = look;
            const bg = getComputedStyle(document.getElementById('strip')).backgroundColor;
            const plain = document.querySelector('#stripList .strip-item:not(.current) .n');
            const cur = document.querySelector('#stripList .strip-item.current .n');
            out[look] = [ratio(getComputedStyle(plain).color, bg), ratio(getComputedStyle(cur).color, bg)];
        }
        return out;
    });
    for (const [look, [plain, cur]] of Object.entries(ratios)) {
        expect(plain, look + ' slide number').toBeGreaterThanOrEqual(4.5);
        expect(cur, look + ' current slide number').toBeGreaterThanOrEqual(4.5);
    }
});
