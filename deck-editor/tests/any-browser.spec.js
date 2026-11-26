// Diapo in any browser: where it opens (a setting), stopping when the tab closes (the page's
// heartbeat, File > Quit Diapo) and saving a PDF through the browser's own print dialog when
// there is no Chrome or Edge. The server side of the quit logic is tests/test_quit.py.
const { test, expect, openDeck, freshDeckEachTest } = require('./helpers');

freshDeckEachTest();

const openAbout = async (page) => {
    await page.getByRole('button', { name: '?', exact: true }).click();
    await page.getByRole('tab', { name: 'About Diapo' }).click();
};
const status = async (page) => (await (await page.request.get('/api/status')).json());

test('the About dialog chooses where Diapo opens, for the next start', async ({ page }) => {
    try {
        expect((await status(page)).open_in).toBe('window');                         // its own window by default
        await openDeck(page);
        await openAbout(page);
        const where = page.getByLabel('Open Diapo in');
        await expect(where).toHaveValue('window');
        await expect(page.locator('#helpAbout')).toContainText('Takes effect the next time Diapo starts');
        await where.selectOption('browser');
        await expect.poll(async () => (await status(page)).open_in).toBe('browser');
        await page.reload();
        await page.waitForFunction(() => window.deckEditor.openIn === 'browser');                 // the start-up status has come in
        await openAbout(page);
        await expect(page.getByLabel('Open Diapo in')).toHaveValue('browser');        // kept
        // Anything but the two words is refused.
        const bad = await page.request.post('/api/open-settings?in=elsewhere');
        expect(bad.status()).toBe(400);
        expect((await status(page)).open_in).toBe('browser');
    } finally {
        await page.request.post('/api/open-settings?in=window');
    }
});

test('every page tells the server it is open, and says so when it closes', async ({ page }) => {
    const calls = [];
    page.on('request', (r) => { if (r.url().includes('/api/heartbeat')) calls.push(r.url()); });
    await page.addInitScript(() => { window.DIAPO_BEAT_MS = 200; });
    await openDeck(page);
    await expect.poll(() => calls.filter(u => !u.includes('bye=1')).length).toBeGreaterThan(2);       // at once, then every few seconds
    const id = new URL(calls[0]).searchParams.get('id');
    expect(id).toBeTruthy();
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));                            // what closing the tab does
    await expect.poll(() => calls.some(u => u.includes('bye=1') && u.includes('id=' + id))).toBe(true);
});

test('when the server cannot be reached the page says so, and the message goes when it can again', async ({ page }) => {
    await page.addInitScript(() => { window.DIAPO_BEAT_MS = 150; });
    await openDeck(page);
    await page.route('**/api/heartbeat*', (r) => r.abort());
    const bar = page.locator('.gone-bar');
    await expect(bar).toContainText('Diapo is not running any more');
    await expect(bar.getByRole('button', { name: 'reload this page' })).toBeVisible();
    await page.unroute('**/api/heartbeat*');
    await expect(bar).toHaveCount(0);
});

test('File > Quit Diapo stops Diapo and says the tab can be closed', async ({ page }) => {
    await openDeck(page);
    let quit = 0, beats = 0;
    await page.route('**/api/quit', (r) => { quit++; r.fulfill({ json: { ok: true } }); });          // the test server must stay up
    page.on('request', (r) => { if (r.url().includes('/api/heartbeat')) beats++; });
    await page.click('#btnFile');
    await expect(page.locator('#fileMenu [data-f="quit"]')).toHaveText('Quit Diapo');
    await page.locator('#fileMenu [data-f="quit"]').click();
    await expect(page.getByRole('heading', { name: 'Diapo has stopped' })).toBeVisible();
    await expect(page.locator('body')).toContainText('You can close this tab');
    expect(quit).toBe(1);
    const after = beats;
    await page.waitForTimeout(400);
    expect(beats).toBe(after);                                                                         // no more calls once stopped
});

test('Quit Diapo asks first when there is unsaved work, saves it, and stays running when it is refused', async ({ page }) => {
    await openDeck(page);
    let quit = 0;
    await page.route('**/api/quit', (r) => { quit++; r.fulfill({ json: { ok: true } }); });
    await page.evaluate(() => { const h = window.deckEditor.deck.doc.querySelector('h1'); const before = h.innerHTML; h.innerHTML = 'Quit title'; window.deckEditor.history.html(h, before, h.innerHTML, 'Edit'); });
    expect(await page.evaluate(() => window.deckEditor.dirty)).toBe(true);

    const asked = [];
    let answer = false;
    page.on('dialog', (d) => { asked.push(d.message()); answer ? d.accept() : d.dismiss(); });
    await page.click('#btnFile');
    await page.locator('#fileMenu [data-f="quit"]').click();
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toContain('Save your changes and stop Diapo?');
    await page.waitForTimeout(300);
    expect(quit).toBe(0);                                                                              // refused: still running, still unsaved
    expect(await page.evaluate(() => window.deckEditor.dirty)).toBe(true);
    await expect(page.getByRole('heading', { name: 'Diapo has stopped' })).toHaveCount(0);

    answer = true;
    await page.click('#btnFile');
    await page.locator('#fileMenu [data-f="quit"]').click();
    await expect(page.getByRole('heading', { name: 'Diapo has stopped' })).toBeVisible();
    expect(quit).toBe(1);
    const disk = await (await page.request.get('/deck/sample/index.html')).text();
    expect(disk).toContain('Quit title');                                                              // saved before it stopped
});

test('Quit Diapo does not stop when the save does not go through', async ({ page }) => {
    await openDeck(page);
    let quit = 0;
    await page.route('**/api/quit', (r) => { quit++; r.fulfill({ json: { ok: true } }); });
    await page.route('**/api/save*', (r) => r.fulfill({ status: 500, json: { ok: false, error: 'disk full' } }));
    await page.evaluate(() => { const h = window.deckEditor.deck.doc.querySelector('h1'); const before = h.innerHTML; h.innerHTML = 'Unsaved'; window.deckEditor.history.html(h, before, h.innerHTML, 'Edit'); });
    page.on('dialog', (d) => d.accept());
    await page.click('#btnFile');
    await page.locator('#fileMenu [data-f="quit"]').click();
    await expect(page.locator('.toast')).toContainText('Diapo was not stopped');
    expect(quit).toBe(0);
});

/* ------------------------------------------------------------
   PDF through the browser's print dialog
   ------------------------------------------------------------ */
const noChrome = (page) => page.route('**/api/pdf*', (r) => r.fulfill({ status: 501, json: { ok: false, error: 'no Chrome or Edge on this computer', reason: 'no-chrome' } }));

test('without Chrome or Edge the PDF says which options to pick in this browser before the print dialog opens', async ({ page }, info) => {
    await openDeck(page);
    await noChrome(page);
    await page.evaluate(() => { window.__printed = 0; window.deckEditor.exporter.printDialog = async () => { window.__printed++; }; });   // the real dialog cannot be driven

    // Cancel: nothing opens.
    let pending = page.evaluate(() => window.deckEditor.exporter.pdf({ to: 'x.pdf' }));
    const card = page.locator('.print-guide');
    await expect(card).toBeVisible();
    const firefox = info.project.name === 'firefox';
    if (firefox) {
        await expect(card).toContainText('Save as PDF in Firefox');
        await expect(card).toContainText('Destination: "Save to PDF"');
        await expect(card).toContainText('Margins: "None"');
        await expect(card).toContainText('Print backgrounds: on');
    } else {
        await expect(card).toContainText('Destination: "Save as PDF"');
        await expect(card).toContainText('Margins: "None"');
        await expect(card).toContainText('Background graphics: on');
    }
    await page.keyboard.press('Escape');
    expect(await pending).toEqual({ cancelled: true });
    await expect(card).toHaveCount(0);
    expect(await page.evaluate(() => window.__printed)).toBe(0);

    // Go on: the print dialog opens.
    pending = page.evaluate(() => window.deckEditor.exporter.pdf({ to: 'x.pdf' }));
    await card.getByRole('button', { name: 'Open the print dialog' }).click();
    expect(await pending).toEqual({ printed: true });
    expect(await page.evaluate(() => window.__printed)).toBe(1);
});

test('the print options are worded for each browser', async ({ page }) => {
    await openDeck(page);
    const guide = (ua) => page.evaluate(async (ua) => (await import('/core/printguide.js')).printGuide(ua), ua);
    const UA = {
        firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
        chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
        safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
        other: 'SomeBrowser/1.0',
    };
    const g = {};
    for (const [k, ua] of Object.entries(UA)) g[k] = await guide(ua);
    expect(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.browser]))).toEqual({ firefox: 'firefox', chrome: 'chrome', edge: 'edge', safari: 'safari', other: 'other' });
    expect(g.firefox.steps).toEqual(['Destination: "Save to PDF"', 'Margins: "None"', 'Print backgrounds: on (under More settings)']);
    expect(g.chrome.steps).toEqual(['Destination: "Save as PDF"', 'Margins: "None" (under More settings)', 'Background graphics: on (under More settings)']);
    expect(g.edge.steps[0]).toBe('Printer: "Save as PDF"');
    expect(g.edge.steps.join()).toContain('Background graphics');
    expect(g.safari.steps.join()).toContain('Save as PDF');
    expect(g.safari.steps.join()).toContain('Print backgrounds');
});
