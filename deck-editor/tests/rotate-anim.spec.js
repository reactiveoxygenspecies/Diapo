// Directional entrance animations move along the screen's directions, whatever the element's rotation.
const { test, expect, freshDeckEachTest, openDeck, save, FILE } = require('./helpers');

freshDeckEachTest();

/* Centre of the title on the page at the first and last frame of its animation. */
const sample = () => {
    const h = (window.deckEditor ? window.deckEditor.deck.doc : document).querySelector('h1');
    const a = h.getAnimations().find(x => /^de-/.test(x.animationName));
    const centre = () => { const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    a.pause();
    a.currentTime = 0;
    const from = centre();
    a.currentTime = a.effect.getComputedTiming().endTime - 1;
    const to = centre();
    return { from, to, name: a.animationName };
};

async function animate(page, preset, deg) {
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('h1')));
    await page.fill('#inspRot', String(deg));
    await page.locator('#inspRot').dispatchEvent('change');
    await page.click(`#animGrid [data-anim="${preset}"]`);
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('h1').getAnimations().some(x => /^de-/.test(x.animationName)));
}

for (const deg of [0, 90, 180, -90, 37]) {
    test(`fade down / fade left start above / to the right on screen when rotated ${deg} degrees`, async ({ page }) => {
        await openDeck(page);
        await page.evaluate(() => { const a = window.deckEditor; a.selection.select(a.deck.doc.querySelector('h1')); a.selection.nudge(40, 30); });    // the editor's own position must survive
        await animate(page, 'fade-down', deg);
        let s = await page.evaluate(sample);
        expect(s.name).toBe('de-fade-down');
        expect(s.from.x).toBeCloseTo(s.to.x, 0);
        expect(s.from.y).toBeLessThan(s.to.y - 5);          // starts above (40 stage px, scaled by the preview)
        expect(await page.evaluate(() => getComputedStyle(window.deckEditor.deck.doc.querySelector('h1')).translate)).toBe('40px 30px');
        await animate(page, 'fade-left', deg);
        s = await page.evaluate(sample);
        expect(s.from.y).toBeCloseTo(s.to.y, 0);
        expect(s.from.x).toBeGreaterThan(s.to.x + 5);        // "fade left" comes from the right
    });
}

test('a rotated element in the saved deck also moves along the screen', async ({ page, context }) => {
    await openDeck(page);
    await animate(page, 'fade-down', 90);
    await save(page);
    const deck = await context.newPage();
    await deck.goto('/deck/' + FILE);
    await deck.waitForSelector('.slide.active.visible');
    await deck.waitForFunction(() => document.querySelector('h1').getAnimations().some(x => /^de-/.test(x.animationName)));
    const s = await deck.evaluate(sample);
    expect(s.from.x).toBeCloseTo(s.to.x, 0);
    expect(s.from.y).toBeLessThan(s.to.y - 5);
    await deck.close();
});
