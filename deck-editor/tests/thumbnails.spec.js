// The slide strip's thumbnails: they must all draw, whatever the network, panel state or edit rate.
const { test, expect, freshDeckEachTest, openDeck, FILE } = require('./helpers');

freshDeckEachTest();

/* Every strip item in (or near) view has a loaded frame with its slide in it. */
const visibleState = (page) => page.evaluate(() => {
    const s = window.deckEditor.strip, r = s.list.getBoundingClientRect();
    const out = { vis: 0, bad: [] };
    for (const it of s.itemList()) {
        const b = it.getBoundingClientRect();
        if (!b.height || b.bottom < r.top || b.top > r.bottom) continue;
        out.vis++;
        const f = it.querySelector('iframe');
        let ok = false;
        try { const d = f && f.contentDocument; ok = !!(d && d.URL === 'about:srcdoc' && d.readyState === 'complete' && d.querySelector('.slide') && d.querySelector('.slide').getBoundingClientRect().width > 100); } catch (e) { /* not drawn */ }
        if (!ok) out.bad.push(s.indexOf(it));
    }
    return out;
});
const settled = async (page) => { await expect.poll(async () => (await visibleState(page)).bad.length, { timeout: 8000 }).toBe(0); };
const grow = (page, n) => page.evaluate((n) => { const s = window.deckEditor.strip; for (let i = 0; i < n; i++) s.duplicateSlide(i % 3); }, n);

test('thumbnails draw although a font stylesheet from another server hangs', async ({ page }) => {
    // Google Fonts in the deck's head blocked every thumbnail's first paint until it answered.
    await page.request.post('/api/trust?file=' + encodeURIComponent(FILE) + '&on=1');
    let held = 0;
    await page.route(/fonts\.googleapis\.com/, async (route) => { held++; await new Promise(r => setTimeout(r, 15000)); await route.abort().catch(() => {}); });
    await page.goto('/?file=' + FILE, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen, null, { timeout: 30000 });
    await settled(page);
    const srcdoc = await page.evaluate(() => window.deckEditor.strip.itemList()[0].querySelector('iframe').srcdoc);
    expect(srcdoc).not.toMatch(/<link[^>]*rel="stylesheet"[^>]*googleapis|<link[^>]*googleapis[^>]*rel="stylesheet"/);
    expect(held).toBeGreaterThan(0);
});

test('thumbnails: a 52-slide deck scrolled through draws every thumbnail', async ({ page }) => {
    await openDeck(page);
    await grow(page, 49);
    expect(await page.evaluate(() => window.deckEditor.strip.itemList().length)).toBe(52);
    for (let y = 0; y <= 9000; y += 200) {
        await page.evaluate((y) => { window.deckEditor.strip.list.scrollTop = y; }, y);
        await page.waitForTimeout(30);
    }
    await settled(page);
    await page.evaluate(() => { window.deckEditor.strip.list.scrollTop = 0; });
    await settled(page);
});

test('thumbnails: a strip hidden when the deck opens draws once it is shown', async ({ page }) => {
    await page.addInitScript(() => { try { if (!sessionStorage.getItem('shown')) localStorage.setItem('deck-editor-panels', JSON.stringify({ strip: false })); } catch (e) { /* ignore */ } });
    await openDeck(page);
    await page.evaluate(() => sessionStorage.setItem('shown', '1'));
    expect(await page.locator('#stripList').isVisible()).toBe(false);
    await page.click('#btnToggleStrip');
    await settled(page);
    const k = await page.evaluate(() => { const f = document.querySelector('.thumb-frame'); return [parseFloat(f.style.transform.replace('scale(', '')), f.parentElement.clientWidth / 1920]; });
    expect(k[0]).toBeGreaterThan(0);
    expect(Math.abs(k[0] - k[1])).toBeLessThan(0.002);
});

test('thumbnails: moving a slide does not reload the other frames', async ({ page }) => {
    await openDeck(page);
    await grow(page, 6);
    await settled(page);
    await page.evaluate(() => { window.deckEditor.strip.itemList().forEach(it => { const f = it.querySelector('iframe'); if (f) f._mark = 1; }); });
    await page.evaluate(() => window.deckEditor.strip.moveSlide(0, 8));
    await page.waitForTimeout(600);
    const lost = await page.evaluate(() => window.deckEditor.strip.itemList().filter(it => { const f = it.querySelector('iframe'); return f && !f._mark; }).length);
    expect(lost).toBe(0);
    await settled(page);
});

test('thumbnails: rapid add, delete, undo and redo leave no blank thumbnail', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => { const e = window.deckEditor; for (let i = 0; i < 30; i++) e.strip.addSlide(0); for (let i = 0; i < 10; i++) e.strip.deleteSlide(2); for (let i = 0; i < 8; i++) e.history.undo(); for (let i = 0; i < 3; i++) e.history.redo(); });
    await settled(page);
});

test('thumbnails: undoing an edit on a slide that is not current redraws its thumbnail', async ({ page }) => {
    await openDeck(page);
    await settled(page);
    const text = await page.evaluate(() => {
        const e = window.deckEditor, s = e.deck.slides[1];
        const h = s.querySelector('h1, h2, h3, p, li');
        const before = h.innerHTML; h.innerHTML = 'ZZ-thumb-marker'; e.history.html(h, before, 'ZZ-thumb-marker');
        return h.textContent;
    });
    expect(text).toBe('ZZ-thumb-marker');
    const inThumb = () => page.evaluate(() => window.deckEditor.strip.itemList()[1].querySelector('iframe').contentDocument.body.textContent.includes('ZZ-thumb-marker'));
    await expect.poll(inThumb, { timeout: 4000 }).toBe(true);
    await page.evaluate(() => { window.deckEditor.deck.goTo(0); window.deckEditor.history.undo(); });
    await expect.poll(inThumb, { timeout: 4000 }).toBe(false);
});
