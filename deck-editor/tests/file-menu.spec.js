// First run, the New deck gallery and the File menu: with no deck open the welcome screen is the
// home (no drawer over it); New deck is a large gallery of the designs with filters and a closer
// look; the File menu holds making, opening and keeping decks, Export only the exports; the
// interface says "folder", never "workspace" or ".html files".
const { test, expect, fs, path, WS, FILE, DECK_DIR, openDeck, own, freshDeckEachTest } = require('./helpers');

freshDeckEachTest();

const TEMPLATES = path.join(__dirname, '..', 'app', 'templates');
const templates = JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'templates.json'), 'utf8')).templates;
const baseName = (p) => p.split(/[\\/]/).filter(Boolean).pop();
const home = async (page) => {
    await page.goto('/');
    await page.waitForFunction(() => window.deckEditor && document.body.classList.contains('no-deck'));
};
/* The words a person can see or hear: the text, the tooltips, the placeholders, the labels. */
const uiWords = (page) => page.evaluate(() => {
    const out = [document.body.innerText];
    for (const el of document.querySelectorAll('[title], [placeholder], [aria-label]')) {
        if (el.closest('[hidden]')) continue;
        out.push(el.getAttribute('title') || '', el.getAttribute('placeholder') || '', el.getAttribute('aria-label') || '');
    }
    return out.join('\n');
});
const noJargon = async (page, where) => {
    // The test folder is called .tmp-workspace: its name and path are the user's words, not the editor's.
    const own = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');       // any case: a heading may be in capitals
    const words = (await uiWords(page)).replace(own(WS), '').replace(own(baseName(WS)), '');
    expect(words, where + ': "workspace"').not.toMatch(/workspace/i);
    expect(words, where + ': ".html files"').not.toMatch(/\.html files/i);
};

test('first run: with no deck the welcome screen is the home, with no drawer over it, even in a narrow window', async ({ page }) => {
    await page.request.post('/api/recent?file=' + encodeURIComponent(FILE));
    await page.setViewportSize({ width: 720, height: 640 });
    await home(page);
    await page.waitForTimeout(300);
    await expect(page.locator('#canvasEmpty')).toBeVisible();
    await expect(page.locator('#drawer')).toBeHidden();
    for (const id of ['btnEmptyNew', 'btnEmptyOpen', 'btnEmptyImport', 'btnEmptySample', 'btnHomeFolder']) await expect(page.locator('#' + id)).toBeVisible();
    // Nothing covers the actions: a click on New deck reaches it.
    const box = await page.locator('#btnEmptyNew').boundingBox();
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y).closest('#btnEmptyNew') !== null, [box.x + box.width / 2, box.y + box.height / 2])).toBe(true);
    // The folder by its name, the whole path on hover; the recent deck with its preview.
    await expect(page.locator('#homeFolder')).toHaveText(baseName(WS));
    await expect(page.locator('#homeFolder')).toHaveAttribute('title', WS);
    await expect(page.locator('#statusFolder')).toHaveText(baseName(WS));
    const recent = page.locator(`#homeRecent .home-deck[data-path="${FILE}"]`);
    await expect(recent).toBeVisible();
    await expect(recent.locator('.deck-thumb.filled iframe')).toHaveAttribute('sandbox', 'allow-same-origin');
    await noJargon(page, 'welcome screen');
    // A card opens its deck; closing the last tab brings the home back, still without the drawer.
    await recent.click();
    await page.waitForFunction((f) => window.deckEditor.deck.isOpen && window.deckEditor.file === f, FILE);
    await expect(page.locator('#canvasEmpty')).toBeHidden();
    await page.evaluate(() => window.deckEditor.tabs.close(window.deckEditor.tabs.tabs[0]));
    await page.waitForFunction(() => document.body.classList.contains('no-deck'));
    await expect(page.locator('#canvasEmpty')).toBeVisible();
    await expect(page.locator('#drawer')).toBeHidden();
    // Ctrl+O still opens the deck list when asked for.
    await page.keyboard.press('Control+o');
    await expect(page.locator('#drawer')).toBeVisible();
    await expect(page.locator('#drawerFolder')).toHaveText(baseName(WS));
    await expect(page.locator('#drawerFolder')).toHaveAttribute('title', WS);
    await noJargon(page, 'drawer');
});

test('an empty folder says so in plain words, on the welcome screen and in the drawer', async ({ page, request }) => {
    const empty = fs.mkdtempSync(path.join(require('os').tmpdir(), 'diapo-empty-'));
    try {
        await home(page);
        await page.evaluate((p) => { window.prompt = () => p; }, empty);      // the test server has no folder dialog: Change folder asks for a path
        await page.click('#btnHomeFolder');
        await expect(page.locator('#homeFolder')).toHaveText(baseName(empty));
        await expect(page.locator('#homeDecks')).toContainText('No decks in this folder yet');
        await page.keyboard.press('Control+o');
        await expect(page.locator('#drawerList')).toContainText('No decks in this folder yet');
        await noJargon(page, 'empty folder');
    } finally {
        await request.post('/api/workspace?path=' + encodeURIComponent(WS), { headers: own });
        fs.rmSync(empty, { recursive: true, force: true });
    }
});

test('gallery: big previews, Light / Dark and style filters, a closer look at the chosen design', async ({ page }) => {
    await home(page);
    await page.click('#btnEmptyNew');
    const gallery = page.locator('#gallery');
    await expect(gallery).toBeVisible();
    const cards = gallery.locator('.gallery-item');
    await expect(cards).toHaveCount(templates.length);
    await expect(cards.first()).toHaveAttribute('data-slug', 'blank');
    await expect(cards.first()).toHaveAttribute('aria-selected', 'true');
    expect((await cards.nth(1).locator('img').boundingBox()).width).toBeGreaterThanOrEqual(240);
    await noJargon(page, 'gallery');

    // Dark: Blank stays first, then only dark designs.
    await gallery.locator('[data-tone="dark"]').click();
    const dark = templates.filter(t => t.tone === 'dark').map(t => t.slug);
    expect(await cards.evaluateAll(cs => cs.map(c => c.dataset.slug))).toEqual(['blank', ...dark]);
    await expect(page.locator('#galleryCount')).toHaveText(`${dark.length} of ${templates.length - 1} designs`);
    // And a style on top of it.
    await gallery.locator('[data-style="Technical"]').click();
    const both = templates.filter(t => t.tone === 'dark' && t.style === 'Technical').map(t => t.slug);
    expect(both.length).toBeGreaterThan(0);
    expect(await cards.evaluateAll(cs => cs.map(c => c.dataset.slug))).toEqual(['blank', ...both]);
    // Blank, chosen and never filtered away, stays chosen. A click on a design shows it larger beside
    // the grid, with its slide count and more of its slides.
    await expect(gallery.locator('.gallery-item[aria-selected="true"]')).toHaveAttribute('data-slug', 'blank');
    const chosen = templates.find(t => t.slug === both[0]);
    await cards.nth(1).click();
    await expect(gallery.locator('.gallery-item[aria-selected="true"]')).toHaveAttribute('data-slug', chosen.slug);
    await expect(page.locator('#galleryDetail h3')).toHaveText(chosen.name);
    await expect(page.locator('#galleryDetail .gallery-meta')).toContainText(chosen.slides + ' slides');
    expect((await page.locator('#galleryDetail .gallery-cover').boundingBox()).width).toBeGreaterThan(300);
    await expect(page.locator('#galleryDetail .gallery-more .deck-thumb.filled')).toHaveCount(4);
    // Back to everything; Esc closes.
    await gallery.locator('[data-tone=""]').click();
    await gallery.locator('[data-style=""]').click();
    await expect(cards).toHaveCount(templates.length);
    await page.keyboard.press('Escape');
    await expect(gallery).toBeHidden();
});

test('gallery: a deck made from a design with the keyboard alone (Ctrl+K, arrows, Tab, the name, Enter)', async ({ page }) => {
    const dir = path.join(WS, 'keyboard-talk');
    fs.rmSync(dir, { recursive: true, force: true });
    try {
        await home(page);
        await page.keyboard.press('Control+k');
        await page.keyboard.type('new deck...');
        await expect(page.locator('.palette-item.on')).toContainText('New deck...');
        await page.keyboard.press('Enter');
        await expect(page.locator('#gallery')).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.activeElement.dataset.slug)).toBe('blank');
        // Right twice: the third design; the detail follows.
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        const slug = templates[2].slug;
        expect(await page.evaluate(() => document.activeElement.dataset.slug)).toBe(slug);
        await expect(page.locator('#galleryDetail h3')).toHaveText(templates[2].name);
        // Down a row and back up again lands on the same card.
        await page.keyboard.press('ArrowDown');
        expect(await page.evaluate(() => document.activeElement.dataset.slug)).not.toBe(slug);
        await page.keyboard.press('ArrowUp');
        expect(await page.evaluate(() => document.activeElement.dataset.slug)).toBe(slug);
        // Enter goes to the name; Enter there creates the deck and opens it.
        await page.keyboard.press('Enter');
        expect(await page.evaluate(() => document.activeElement.id)).toBe('galleryName');
        await page.keyboard.type('keyboard-talk');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.deckEditor.deck.isOpen && window.deckEditor.file === 'keyboard-talk/index.html');
        await expect(page.locator('#gallery')).toBeHidden();
        const made = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
        const tpl = fs.readFileSync(path.join(TEMPLATES, slug + '.html'), 'utf8');
        expect(made).toBe(tpl.replace(/<title([^>]*)>[\s\S]*?<\/title>/i, (m, a) => `<title${a}>Keyboard talk</title>`));
        // A palette entry for one design opens the gallery with it chosen and the name waiting.
        await page.keyboard.press('Control+k');
        await page.keyboard.type('swiss template');
        await page.keyboard.press('Enter');
        await expect(page.locator('#gallery .gallery-item[data-slug="swiss"]')).toHaveAttribute('aria-selected', 'true');
        await expect.poll(() => page.evaluate(() => document.activeElement.id)).toBe('galleryName');
        await page.keyboard.press('Escape');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('File menu: new, open, import, save, save as, previous versions, rename, duplicate, change folder; Export holds only exports', async ({ page }) => {
    // With no deck: the file actions that need one are off, the rest work.
    await home(page);
    await page.click('#btnFile');
    const menu = page.locator('#fileMenu .tb-dropdown');
    await expect(menu).toBeVisible();
    for (const f of ['new', 'open', 'openfile', 'import', 'folder']) await expect(menu.locator(`[data-f="${f}"]`)).toBeEnabled();
    for (const f of ['save', 'saveas', 'versions', 'rename', 'duplicate']) await expect(menu.locator(`[data-f="${f}"]`)).toBeDisabled();
    await expect(page.locator('#fileFolder')).toHaveText('Folder: ' + baseName(WS));
    await noJargon(page, 'File menu');
    await menu.locator('[data-f="new"]').click();
    await expect(page.locator('#gallery')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.click('#btnFile');
    await menu.locator('[data-f="open"]').click();
    await expect(page.locator('#drawer')).toBeVisible();
    await page.keyboard.press('Escape');

    // With a deck open.
    await openDeck(page);
    await page.evaluate(() => { const ed = window.deckEditor; const h = ed.deck.doc.querySelector('h1'); const b = h.innerHTML; h.innerHTML = 'From the File menu'; ed.history.html(h, b, h.innerHTML, 'Edit'); });
    await page.click('#btnFile');
    for (const f of ['save', 'saveas', 'versions', 'rename', 'duplicate']) await expect(menu.locator(`[data-f="${f}"]`)).toBeEnabled();
    await menu.locator('[data-f="save"]').click();
    await page.waitForFunction(() => !window.deckEditor.dirty);
    expect(fs.readFileSync(path.join(DECK_DIR, 'index.html'), 'utf8')).toContain('From the File menu');
    await page.click('#btnFile');
    await menu.locator('[data-f="versions"]').click();
    await expect(page.locator('.help.versions')).toBeVisible();
    await page.click('#verClose');
    // Duplicate and Rename the open deck (the test server has no dialogs: names are typed).
    await page.evaluate(() => { window.__answers = ['menu-copy.html']; window.prompt = () => window.__answers.shift(); });
    await page.click('#btnFile');
    await menu.locator('[data-f="duplicate"]').click();
    await expect.poll(() => fs.existsSync(path.join(DECK_DIR, 'menu-copy.html'))).toBe(true);
    await page.evaluate(() => { window.__answers = ['renamed.html']; });
    await page.click('#btnFile');
    await menu.locator('[data-f="rename"]').click();
    await page.waitForFunction(() => window.deckEditor.file === 'sample/renamed.html');
    await page.evaluate(() => { window.__answers = ['index.html']; });
    await page.click('#btnFile');
    await menu.locator('[data-f="rename"]').click();
    await page.waitForFunction(() => window.deckEditor.file === 'sample/index.html');
    // Save as from the menu, then Ctrl+Shift+S: both ask for a name here.
    await page.evaluate(() => { window.__answers = ['menu-saveas.html']; });
    await page.click('#btnFile');
    await menu.locator('[data-f="saveas"]').click();
    await page.waitForFunction(() => window.deckEditor.file === 'sample/menu-saveas.html');
    await page.evaluate(() => { window.__answers = ['keys-saveas.html']; });
    await page.keyboard.press('Control+Shift+S');
    await page.waitForFunction(() => window.deckEditor.file === 'sample/keys-saveas.html');
    for (const f of ['menu-copy.html', 'menu-saveas.html', 'keys-saveas.html']) fs.rmSync(path.join(DECK_DIR, f), { force: true });

    // Export: the exports only.
    await page.click('#btnExport');
    const exp = page.locator('#exportMenu .tb-dropdown');
    await expect(exp).toBeVisible();
    expect(await exp.locator('[data-x]').evaluateAll(bs => bs.map(b => b.dataset.x))).toEqual(['pdf', 'handout', 'html', 'publish', 'pptx']);
    await expect(exp).not.toContainText('Save as');
    await expect(exp).not.toContainText('Previous versions');
    await noJargon(page, 'deck open, Export menu');
});
