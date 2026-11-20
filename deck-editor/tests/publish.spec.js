// Export > Publish...: the menu item, the palette entry, the dialog with a typed folder path (the
// tests have no native dialog), the not-empty confirmation and the steps for the free hosts.
const { test, expect, fs, path, WS, openDeck, freshDeckEachTest, own } = require('./helpers');
const os = require('os');

freshDeckEachTest();

const DEFAULT_SITE = path.join(WS, 'sample-site');
test.afterEach(() => { fs.rmSync(DEFAULT_SITE, { recursive: true, force: true }); fs.rmSync(DEFAULT_SITE + '.zip', { force: true }); });

const listing = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => path.relative(dir, path.join(e.parentPath || e.path, e.name)).replace(/\\/g, '/')).sort();

test('Export > Publish... writes the folder from a typed path and walks the user to a free host', async ({ page }) => {
    const out = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'diapo-publish-')));     // long names, as the server gives them (not RUNNER~1)
    const site = path.join(out, 'my-talk');
    try {
        await openDeck(page);
        await page.locator('#btnExport').click();
        const item = page.locator('#exportMenu').getByRole('button', { name: 'Publish...' });
        await expect(item).toBeVisible();
        await item.click();
        const dialog = page.getByRole('dialog', { name: 'Publish this deck' });
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('#pubDest')).toHaveValue(DEFAULT_SITE);          // <deck folder>-site beside the deck's folder
        await expect(dialog.locator('#pubFonts')).toBeChecked();                      // the sample deck links Google Fonts
        await dialog.locator('#pubFonts').uncheck();                                  // no network in the tests

        // No native dialog here: Choose folder... says to type the path.
        await dialog.getByRole('button', { name: 'Choose folder...' }).click();
        await expect(page.locator('.toast')).toContainText('type the folder');

        await dialog.locator('#pubDest').fill(site);
        await dialog.getByLabel('Also make a .zip').check();
        await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
        await expect(dialog.getByRole('heading', { name: 'Your site is ready' })).toBeVisible();
        await expect(dialog.locator('.pub-path').first()).toHaveText(fs.realpathSync(out) + path.sep + 'my-talk');

        const files = listing(site);
        expect(files).toContain('index.html');
        expect(files).toContain('assets/shape.svg');
        expect(files.filter(f => /\.bak$|\.~draft$|\.deck-editor/.test(f))).toEqual([]);
        expect(fs.existsSync(site + '.zip')).toBe(true);
        // Not the editor's copy of the page: no draft, no backups next to it.
        expect(fs.readFileSync(path.join(site, 'index.html'), 'utf8')).toContain('deck-stage');

        // The three ways to put it online, and the links open only through the fixed-address route.
        await expect(dialog).toContainText('Netlify Drop');
        await expect(dialog).toContainText('GitHub Pages');
        await expect(dialog).toContainText('Any web host');
        for (const [name, key] of [['app.netlify.com/drop', 'netlify-drop'], ['a new repository', 'github-new']]) {
            const [req] = await Promise.all([page.waitForRequest(r => r.url().includes('/api/open-link')), dialog.getByRole('button', { name }).click()]);
            expect(new URL(req.url()).searchParams.get('page')).toBe(key);
        }
        await dialog.getByRole('button', { name: 'Show the folder' }).click();          // answered, but no window opens in the tests
        await expect(page.locator('.toast.error, .toast.err')).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Done' }).click();
        await expect(dialog).toHaveCount(0);

        // Publishing again into the same folder asks first; nothing is written until it is confirmed.
        fs.writeFileSync(path.join(site, 'mine.txt'), 'keep');
        fs.rmSync(path.join(site, 'index.html'));
        await page.keyboard.press('Control+k');
        await page.keyboard.type('Publish');
        await page.keyboard.press('Enter');
        const again = page.getByRole('dialog', { name: 'Publish this deck' });
        await expect(again).toBeVisible();
        await again.locator('#pubDest').fill(site);
        await again.getByRole('button', { name: 'Publish', exact: true }).click();
        await expect(again.locator('#pubAsk')).toContainText('already has files in it');
        expect(fs.existsSync(path.join(site, 'index.html'))).toBe(false);
        await again.getByRole('button', { name: 'Publish into it anyway' }).click();
        await expect(again.getByRole('heading', { name: 'Your site is ready' })).toBeVisible();
        expect(fs.existsSync(path.join(site, 'index.html'))).toBe(true);
        expect(fs.readFileSync(path.join(site, 'mine.txt'), 'utf8')).toBe('keep');
    } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('Publish: the server only shows folders it just wrote and only opens its two host pages', async ({ request }) => {
    expect((await request.post('/api/publish/reveal?path=' + encodeURIComponent(WS), { headers: own })).status()).toBe(403);
    expect((await request.post('/api/open-link?page=netlify-drop', { headers: own })).ok()).toBe(true);
    const r = await (await request.post('/api/open-link?page=https://evil.example/', { headers: own })).json();
    expect(r.url).toContain('github.com/reactiveoxygenspecies/Diapo');
    // Like the other POST routes, only from the editor's own origin.
    expect((await request.post('/api/publish?file=sample/index.html', { headers: { Origin: 'http://evil.example' }, data: 'x' })).status()).toBe(403);
    expect((await request.post('/api/publish/reveal?path=' + encodeURIComponent(WS), { headers: { Origin: 'http://evil.example' } })).status()).toBe(403);
});
