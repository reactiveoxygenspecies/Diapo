// Keep the screen on: the editor and the presenter window hold the browser's Screen Wake Lock
// while they are in front (core/wakelock.js), on by default, switched off from the Look menu.
// A headless browser has no screen to keep on, so navigator.wakeLock is a stand-in here that
// counts requests and releases and, like the real one, lets go when the page is hidden.
const { test, expect, freshDeckEachTest, openDeck, save, DECK, FILE } = require('./helpers');

freshDeckEachTest();

const fakeWakeLock = () => (refuse) => {
    {
        window.__wake = { requests: 0, released: 0, live: [] };
        let hidden = false;
        Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
        Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => hidden });
        const release = (s) => {
            if (s.released) return;
            s.released = true; window.__wake.released++;
            window.__wake.live = window.__wake.live.filter(x => x !== s);
            s.dispatchEvent(new Event('release'));
        };
        window.__setHidden = (h) => {
            hidden = h;
            if (h) [...window.__wake.live].forEach(release);           // the browser lets go of it when hidden
            document.dispatchEvent(new Event('visibilitychange'));
        };
        Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => ({
            request: async (type) => {
                window.__wake.requests++;
                if (refuse || type !== 'screen' || hidden) throw new DOMException('refused', 'NotAllowedError');
                const s = new EventTarget();
                s.released = false; s.type = type;
                s.release = async () => release(s);
                window.__wake.live.push(s);
                return s;
            },
        }) });
    };
}
const wake = (page) => page.evaluate(() => ({ requests: window.__wake.requests, released: window.__wake.released, live: window.__wake.live.length }));

test('wake lock: held by default while the editor is in front, asked again when it comes back, released when switched off', async ({ page, context }) => {
    await context.addInitScript(fakeWakeLock(), false);
    await openDeck(page);
    await expect.poll(() => wake(page)).toMatchObject({ live: 1 });
    // The Look menu says so.
    await page.click('#btnLook');
    await expect(page.locator('#btnWake')).toHaveClass(/\bon\b/);
    await expect(page.locator('#btnWakeState')).toHaveText('on');
    // Hidden (another tab, minimised): the browser lets go; back in front, it is asked for again.
    await page.evaluate(() => window.__setHidden(true));
    await expect.poll(() => wake(page)).toMatchObject({ live: 0 });
    await page.evaluate(() => window.__setHidden(false));
    await expect.poll(() => wake(page)).toMatchObject({ live: 1 });
    // Switched off: released and not asked for again, also after a reload.
    await page.click('#btnWake');
    await expect(page.locator('#btnWakeState')).toHaveText('off');
    await expect.poll(() => wake(page)).toMatchObject({ live: 0 });
    expect(await page.evaluate(() => localStorage.getItem('deck-editor-wake'))).toBe('0');
    await page.evaluate(() => { window.__setHidden(true); window.__setHidden(false); });
    await page.waitForTimeout(200);
    expect((await wake(page)).live).toBe(0);
    await page.reload();
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.wake);
    await page.waitForTimeout(200);
    expect(await wake(page)).toMatchObject({ requests: 0, live: 0 });
    // On again: held again.
    await page.click('#btnLook');
    await page.click('#btnWake');
    await expect.poll(() => wake(page)).toMatchObject({ live: 1 });
});

test('wake lock: the presenter window holds it too and follows the setting', async ({ page, context }) => {
    await context.addInitScript(fakeWakeLock(), false);
    await openDeck(page);
    await page.click('#btnPresenter');
    const [presenter] = await Promise.all([context.waitForEvent('page'), page.click('#presenterMenu [data-p="open"]')]);
    await presenter.waitForLoadState();
    await expect.poll(() => wake(presenter)).toMatchObject({ live: 1 });
    // Switched off in the editor: the presenter window lets go too.
    await page.bringToFront();
    await page.click('#btnLook');
    await page.click('#btnWake');
    await expect.poll(() => wake(presenter)).toMatchObject({ live: 0 });
    await presenter.close();
});

test('wake lock: a browser that refuses it (battery saver) is asked once, not over and over', async ({ page, context }) => {
    await context.addInitScript(fakeWakeLock(), true);
    await openDeck(page);
    await expect.poll(() => wake(page)).toMatchObject({ requests: 1 });
    await page.waitForTimeout(300);
    expect(await wake(page)).toMatchObject({ requests: 1, live: 0 });
});

test('wake lock: a browser without it works as before and the Look menu says so', async ({ page, context }) => {
    await context.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => undefined }); });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openDeck(page);
    await page.click('#btnLook');
    await expect(page.locator('#btnWakeState')).toHaveText('not in this browser');
    expect(errors).toEqual([]);
});

test('wake lock: a deck opened on its own keeps the screen on (always), from the server and from file://; inside the editor it leaves it to the editor', async ({ page, context }) => {
    await context.addInitScript(fakeWakeLock(), false);
    await openDeck(page);
    await page.evaluate(() => window.deckEditor.addRuntimeScript());
    await page.waitForFunction(() => window.deckEditor.deck.win.deckRuntime && window.deckEditor.deck.win.deckRuntime.version === 15);
    await save(page);
    // In the editor's frame the runtime asks for nothing, in edit mode or in Preview.
    await page.evaluate(() => window.deckEditor.setPreview(true));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.deckEditor.deck.win.__wake.requests)).toBe(0);
    await page.evaluate(() => window.deckEditor.setPreview(false));
    // The editor's own setting does not reach a deck opened on its own: it is always on there.
    await page.click('#btnLook');
    await page.click('#btnWake');

    for (const url of ['/deck/' + FILE, 'file:///' + DECK.replace(/\\/g, '/')]) {
        const deck = await context.newPage();
        await deck.goto(url);
        await deck.waitForFunction(() => window.deckRuntime && window.deckRuntime.version === 15);
        await expect.poll(() => wake(deck)).toMatchObject({ live: 1 });
        // Hidden: the browser lets go; back in front, asked for again.
        await deck.evaluate(() => window.__setHidden(true));
        await expect.poll(() => wake(deck)).toMatchObject({ live: 0 });
        await deck.evaluate(() => window.__setHidden(false));
        await expect.poll(() => wake(deck)).toMatchObject({ live: 1, requests: 2 });
        await deck.close();
    }
});
