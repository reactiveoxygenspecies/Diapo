// "Check for updates": the About dialog, the command palette entries, the optional start-up
// check. The server reads its "latest release" from a stub file (DIAPO_UPDATE_URL, set in
// playwright.config.js), so these tests never touch the network.
const { test, expect, fs, path, WS, openDeck, freshDeckEachTest } = require('./helpers');

freshDeckEachTest();

const STUB = path.join(WS, 'update-stub.json');
const release = (tag, extra = {}) => ({ tag_name: tag, published_at: '2026-12-01T09:00:00Z', body: '## Highlights\n- **Check for updates** in the About dialog\n- Smaller fixes', ...extra });
const stub = (data) => fs.writeFileSync(STUB, typeof data === 'string' ? data : JSON.stringify(data));
const openAbout = async (page) => {
    await page.getByRole('button', { name: '?', exact: true }).click();
    await page.getByRole('tab', { name: 'About Diapo' }).click();
};

test.afterAll(() => fs.rmSync(STUB, { force: true }));

test('the start-up check is on by default, shows a notice for a newer release (once a day), and can be turned off', async ({ page }) => {
    stub(release('v9.0.0'));
    const status = async () => (await (await page.request.get('/api/status')).json()).update_auto;
    expect(await status()).toBe(true);                                               // on by default
    await openDeck(page);
    const notice = page.locator('.update-notice');
    await expect(notice).toContainText('Diapo 9.0.0 is available');
    await notice.getByRole('button', { name: "See what's new" }).click();
    await expect(page.locator('#aboutResult')).toContainText('Diapo 9.0.0 is available');
    await expect(page.getByLabel('Check for updates when Diapo starts')).toBeChecked();
    await page.keyboard.press('Escape');

    // The check was made just now: a second start within the day asks nothing.
    await page.reload();
    await page.waitForTimeout(500);
    await expect(notice).toHaveCount(0);

    await openAbout(page);
    await page.getByLabel('Check for updates when Diapo starts').uncheck();
    await expect.poll(status).toBe(false);
    await page.reload();
    await openAbout(page);
    await expect(page.getByLabel('Check for updates when Diapo starts')).not.toBeChecked();
    await page.getByLabel('Check for updates when Diapo starts').check();
    await expect.poll(status).toBe(true);
});

test('Check for updates is filled with the look\'s accent colour', async ({ page }) => {
    await openDeck(page);
    await openAbout(page);
    const btn = page.getByRole('button', { name: 'Check for updates' });
    const accent = await page.evaluate(() => {
        const probe = document.createElement('i'); probe.style.color = 'var(--accent)'; document.body.appendChild(probe);
        const c = getComputedStyle(probe).color; probe.remove(); return c;
    });
    await expect(btn).toHaveCSS('background-color', accent);
});

test('About Diapo: version, newer release with notes and the page button, same version, errors', async ({ page }) => {
    await openDeck(page);
    await expect(page.locator('#brandVersion')).toContainText('v');
    const version = (await (await page.request.get('/api/status')).json()).app;

    // The keyboard map is still what "?" opens first.
    await page.getByRole('button', { name: '?', exact: true }).click();
    await expect(page.locator('.help-card kbd', { hasText: 'Ctrl' }).first()).toBeVisible();
    await page.getByRole('tab', { name: 'About Diapo' }).click();
    await expect(page.locator('#helpAbout h2')).toHaveText('Diapo ' + version);
    await expect(page.locator('#helpAbout')).toContainText('Released');

    stub(release('v99.0.0'));
    await page.getByRole('button', { name: 'Check for updates' }).click();
    const result = page.locator('#aboutResult');
    await expect(result).toContainText('Diapo 99.0.0 is available (released');
    await expect(result).toContainText('Check for updates in the About dialog');      // the start of the notes, as plain text
    await expect(result).not.toContainText('**');
    await expect(result).toContainText('diapo.exe');
    await expect(result).toContainText('git pull');
    const [req] = await Promise.all([
        page.waitForRequest(r => r.url().includes('/api/open-link')),
        page.getByRole('button', { name: 'Open the release page' }).click(),
    ]);
    expect(req.url()).toContain('page=release');
    expect(req.url()).toContain('tag=99.0.0');

    stub(release('v' + version));
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(result).toHaveText(`You have the latest version (${version}).`);

    stub('this is not json');
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(result).toContainText('not what Diapo expected');

    fs.rmSync(STUB, { force: true });                                                  // no answer at all
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(result).toContainText('Could not reach GitHub');

    await page.keyboard.press('Escape');
    await expect(page.locator('.help')).toHaveCount(0);
});

test('Ctrl+K has "About Diapo" and "Check for updates"', async ({ page }) => {
    stub(release('v99.0.0'));
    await openDeck(page);
    await expect(page.locator('#brandVersion')).toContainText('v');
    await page.keyboard.press('Control+k');
    await page.locator('.palette-input').fill('check for updates');
    await page.keyboard.press('Enter');
    await expect(page.locator('#aboutResult')).toContainText('Diapo 99.0.0 is available');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await page.locator('.palette-input').fill('about diapo');
    await page.keyboard.press('Enter');
    await expect(page.locator('#helpAbout')).toBeVisible();
});

test('only the editor page may ask for the check or open a link', async ({ page }) => {
    const bad = { headers: { Origin: 'http://evil.example', 'Sec-Fetch-Site': 'cross-site' } };
    expect((await page.request.post('/api/update-check', bad)).status()).toBe(403);
    expect((await page.request.post('/api/open-link?page=guide', bad)).status()).toBe(403);
    expect((await page.request.post('/api/update-settings?auto=1', bad)).status()).toBe(403);
});
