// 3D structures (Insert > 3D structure..., or a .pdb / .cif / .mol2 / .xyz / .stl file dropped on a slide):
// a <figure data-mol3d> holding the structure file (never run), its settings and view as JSON, and a
// picture of the view. The picture is what shows while editing, in the PDF, in PowerPoint and
// wherever scripts do not run; "Turns slowly" and "Drag to turn" show it live while presenting,
// with 3Dmol.js beside the deck running as one of Diapo's own scripts (no "Trust this deck").
// Nothing here reaches the internet: the one fetch (by ID) is answered by a stub.
const { test, expect, fs, path, WS, own, freshDeckEachTest, save } = require('./helpers');

const FIX = path.join(__dirname, 'fixtures', 'mol3d');
const PDB = path.join(FIX, 'zinc-helix.pdb');
const SDF = path.join(FIX, 'ethanol-3d.sdf');
const XYZ = path.join(FIX, 'water.xyz');
const FLAT = path.join(FIX, 'benzene-2d.mol');

async function newDeck(page, name) {
    fs.rmSync(path.join(WS, name), { recursive: true, force: true });
    const r = await page.request.post('/api/new?path=' + encodeURIComponent(name + '/index.html'), { headers: own });
    expect(r.ok()).toBeTruthy();
    await open(page, name);
}
async function open(page, name, file = 'index.html') {
    await page.goto('/?file=' + name + '/' + file);
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('.slide.active.visible'));
    await page.waitForTimeout(400);
}
/* Insert > 3D structure..., From a file: the preview draws, Insert puts it on the slide. */
async function insertFile(page, file, { start = null } = {}) {
    await page.click('#btnInsert');
    await page.click('[data-insert="mol3d"]');
    await page.click('.mol3d-dialog [data-tab="file"]');
    await page.setInputFiles('#m3File', file);
    await expect(page.locator('#m3Insert')).toBeEnabled({ timeout: 15000 });
    await expect(page.locator('.mol3d-dialog .m3-live canvas')).toHaveCount(1);
    if (start) await page.click(`#m3Start [data-v="${start}"]`);
    await page.click('#m3Insert');
    await expect(page.locator('.mol3d-dialog')).toHaveCount(0, { timeout: 15000 });
    await page.waitForFunction(() => { const s = window.deckEditor.selection.single; return s && s.matches('figure[data-mol3d]') && s.querySelector('img[data-mol3d-picture]').getAttribute('src'); });
}
const mol = (page, fn, arg) => page.evaluate(([src, arg]) => {
    const el = window.deckEditor.deck.doc.querySelector('figure[data-mol3d]');
    return new Function('el', 'arg', 'return (' + src + ')(el, arg)')(el, arg);
}, [fn.toString(), arg]);
const settingsOf = (page) => mol(page, (el) => JSON.parse(el.getAttribute('data-mol3d-settings')));
const pictureSrc = (page) => mol(page, (el) => el.querySelector('img[data-mol3d-picture]').getAttribute('src'));
/* How much of the picture is not the ground: the share of pixels that differ from its corner. */
const inked = (page) => mol(page, async (el) => {
    const img = el.querySelector('img[data-mol3d-picture]');
    const i = new Image(); i.src = img.getAttribute('src'); await i.decode();
    const c = document.createElement('canvas'); c.width = 200; c.height = Math.round(200 * i.height / i.width);
    const g = c.getContext('2d'); g.drawImage(i, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data, n = d.length / 4;
    let k = 0;
    for (let p = 0; p < d.length; p += 4) if (Math.abs(d[p] - d[0]) + Math.abs(d[p + 1] - d[1]) + Math.abs(d[p + 2] - d[2]) + Math.abs(d[p + 3] - d[3]) > 30) k++;
    return { share: k / n, w: i.width, h: i.height, corner: [d[0], d[1], d[2], d[3]] };
});

freshDeckEachTest();

test('mol3d: a PDB file becomes a 3D structure with its file, settings and picture, and the panel redraws it', async ({ page }) => {
    await newDeck(page, 'mol3d-pdb');
    await insertFile(page, PDB);

    const made = await mol(page, (el) => ({
        format: el.getAttribute('data-mol3d'), id: !!el.getAttribute('data-id'), position: el.style.position, w: el.offsetWidth, h: el.offsetHeight,
        holder: el.querySelector('script[data-mol3d-source]').type, text: el.querySelector('script[data-mol3d-source]').textContent,
        alt: el.querySelector('img').alt, src: el.querySelector('img').getAttribute('src').slice(0, 15), key: el.querySelector('img').getAttribute('data-key'),
    }));
    expect(made).toMatchObject({ format: 'pdb', id: true, position: 'absolute', holder: 'chemical/x-pdb', src: 'data:image/webp' });
    expect(made.text).toContain('HETATM');
    expect(made.alt).toMatch(/^3D structure: 9ZZZ · Zinc helix/);
    const s = await settingsOf(page);
    expect(s).toMatchObject({ style: 'cartoon', colour: 'chain', present: 'still', water: false, source: 'zinc-helix.pdb' });
    expect(s.view).toHaveLength(8);
    const pic = await inked(page);
    expect(pic.w).toBe(made.w * 2);                 // twice the box
    expect(pic.share).toBeGreaterThan(0.01);        // something was drawn
    expect(pic.corner[3]).toBe(255);                // on the slide's own colour

    // The panel: what the file holds, the zinc named from it, cysteines to pick out.
    await expect(page.locator('#inspMol3d')).toBeVisible();
    await expect(page.locator('#m3pMeta')).toContainText('9ZZZ · Zinc helix');
    await expect(page.locator('#m3pMeta')).toContainText('Escherichia coli');
    await expect(page.locator('#m3pMeta')).toContainText('1 chain · 14 residues · 1 zinc ion');
    await expect(page.locator('#m3pLigands')).toContainText('Zinc ion (ZN)');
    await expect(page.locator('#m3pPick option[value="CYS"]')).toHaveCount(1);
    await expect(page.locator('#m3pWaterRow')).toBeVisible();

    // Style and colour: each a new picture, each one undo step.
    const before = await pictureSrc(page);
    await page.click('#m3pStyle [data-v="sticks"]');
    await expect.poll(async () => (await settingsOf(page)).style).toBe('sticks');
    const sticks = await pictureSrc(page);
    expect(sticks).not.toBe(before);
    await page.selectOption('#m3pColour', 'rainbow');
    await expect.poll(async () => (await settingsOf(page)).colour).toBe('rainbow');
    expect(await pictureSrc(page)).not.toBe(sticks);
    await page.check('#m3pWater');
    await expect.poll(async () => (await settingsOf(page)).water).toBe(true);
    await page.uncheck('#m3pLigands input[data-resn="ZN"]');
    await expect.poll(async () => (await settingsOf(page)).ligands.hidden).toEqual(['ZN']);
    await page.selectOption('#m3pPick', 'CYS');
    await expect.poll(async () => (await settingsOf(page)).pick).toBe('CYS');
    await page.evaluate(() => window.deckEditor.history.undo());
    await page.evaluate(() => window.deckEditor.history.undo());
    await page.evaluate(() => window.deckEditor.history.undo());
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await settingsOf(page)).toMatchObject({ style: 'sticks', colour: 'chain' });
    expect(await pictureSrc(page)).toBe(sticks);
    await page.evaluate(() => window.deckEditor.history.undo());
    expect((await settingsOf(page)).style).toBe('cartoon');
    expect(await pictureSrc(page)).toBe(before);
});

test('mol3d: double-click turns it, Done keeps the view as the picture; save and reopen keep everything, Still has no script', async ({ page }) => {
    await newDeck(page, 'mol3d-turn');
    await insertFile(page, PDB);
    const s0 = await settingsOf(page), pic0 = await pictureSrc(page);

    // Turn mode: a live viewer over the structure, the bar, a drag turns it.
    const box = await page.locator('#overlay .ov-main').boundingBox();
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('.mol3d-turn-bar')).toBeVisible();
    await expect(page.locator('.mol3d-turn-host canvas')).toHaveCount(1);
    await page.waitForFunction(() => window.deckEditor.mol3d.view());
    const host = await page.locator('.mol3d-turn-host').boundingBox();
    await page.mouse.move(host.x + host.width / 2, host.y + host.height / 2);
    await page.mouse.down();
    await page.mouse.move(host.x + host.width / 2 + 120, host.y + host.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await page.mouse.move(host.x + host.width / 2, host.y + host.height / 2);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(200);
    await page.click('.mol3d-turn-bar button:has-text("Done")');
    await expect(page.locator('.mol3d-turn-bar')).toHaveCount(0);
    await expect.poll(async () => JSON.stringify((await settingsOf(page)).view)).not.toBe(JSON.stringify(s0.view));
    const turned = await settingsOf(page), pic1 = await pictureSrc(page);
    expect(pic1).not.toBe(pic0);
    // One undo step back to the view and the picture it had.
    await page.evaluate(() => window.deckEditor.history.undo());
    expect((await settingsOf(page)).view).toEqual(s0.view);
    expect(await pictureSrc(page)).toBe(pic0);
    await page.evaluate(() => window.deckEditor.history.redo());
    // Esc leaves turn mode too.
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('.mol3d-turn-bar')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.mol3d-turn-bar')).toHaveCount(0);

    await save(page);
    const dir = path.join(WS, 'mol3d-turn');
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    expect(html).toContain('<script type="chemical/x-pdb" data-mol3d-source="">');
    expect(html).not.toContain('data-deck-mol3d');             // Still: no script at all
    expect(html).not.toContain('deck-mol3d.js');
    expect(html).not.toContain('data-ed-');
    expect(fs.existsSync(path.join(dir, 'deck-3dmol.min.js'))).toBe(false);
    await save(page);
    expect(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).toBe(html);

    await open(page, 'mol3d-turn');
    expect(await settingsOf(page)).toEqual(turned);
    expect(await pictureSrc(page)).toBe(pic1);
    expect(await mol(page, (el) => el.querySelector('script[data-mol3d-source]').textContent)).toContain('ATOM      1  N   ALA A   1');
    // Its picture is current: nothing is drawn again on opening.
    await page.waitForTimeout(800);
    expect(await pictureSrc(page)).toBe(pic1);
    expect(await page.evaluate(() => document.getElementById('problemsBadge').hidden)).toBe(true);
});

test('mol3d: Turns slowly carries deck-mol3d.js and 3Dmol beside the deck, trusted, live in Preview only while its slide shows', async ({ page }) => {
    await newDeck(page, 'mol3d-live');
    await insertFile(page, PDB);
    await page.click('#m3pPresent [data-v="turns"]');
    expect((await settingsOf(page)).present).toBe('turns');
    await expect(page.locator('#m3pSpeedRow')).toBeVisible();
    await save(page);
    const dir = path.join(WS, 'mol3d-live');
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    expect(html).toContain('<script src="deck-3dmol.min.js" data-deck-mol3d="library"></script>\n<script src="deck-mol3d.js" data-deck-mol3d="renderer"></script>\n</body>');
    expect(fs.readFileSync(path.join(dir, 'deck-3dmol.min.js')).equals(fs.readFileSync(path.join(__dirname, '..', 'app', 'vendor', '3Dmol-min.js')))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'deck-mol3d.js')).equals(fs.readFileSync(path.join(__dirname, '..', 'app', 'deck-mol3d.js')))).toBe(true);

    await open(page, 'mol3d-live');
    expect(await page.evaluate(() => window.deckEditor.deck.trust)).toMatchObject({ trusted: false, scripts: 0 });
    await expect(page.locator('.bar.trust-bar')).toHaveCount(0);
    expect(await page.evaluate(() => { const w = window.deckEditor.deck.win; return { lib: typeof w.$3Dmol, renderer: !!w.DeckMol3d }; })).toEqual({ lib: 'object', renderer: true });
    await page.waitForTimeout(1200);
    expect(await mol(page, (el) => el.querySelectorAll('.deck-mol3d-live').length)).toBe(0);     // a picture while editing

    // Preview: live and turning; the picture is hidden behind it.
    await page.keyboard.press('F5');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-mol3d] > .deck-mol3d-live.ready canvas'));
    const v0 = await mol(page, (el) => el.ownerDocument.defaultView.DeckMol3d && el.__deckMol3d.viewer.getView().join(','));
    await page.waitForTimeout(500);
    const v1 = await mol(page, (el) => el.__deckMol3d.viewer.getView().join(','));
    expect(v1).not.toBe(v0);
    expect(await mol(page, (el) => getComputedStyle(el.querySelector('img')).visibility)).toBe('hidden');
    // The next slide: leaving stops the viewer (after the transition); coming back starts it again.
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => !window.deckEditor.deck.doc.querySelector('.deck-mol3d-live'), null, { timeout: 5000 });
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-mol3d] > .deck-mol3d-live.ready canvas'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.deckEditor.deck.doc.querySelector('.deck-mol3d-live'));
    expect(await page.evaluate(() => window.deckEditor.dirty)).toBe(false);
});

test('mol3d: Drag to turn keeps the wheel over the structure, even on a slide with steps; the deck stays on its slide', async ({ page }) => {
    await newDeck(page, 'mol3d-drag');
    await insertFile(page, PDB);
    await page.click('#m3pPresent [data-v="drag"]');
    // A text that shows in a step, so the wheel would otherwise step the slide.
    await page.evaluate(() => {
        const ed = window.deckEditor, el = ed.insert.text('A step');
        ed.history.attr(el, 'data-fragment', '');
    });
    await page.evaluate(() => window.deckEditor.strip.addSlide && window.deckEditor.strip.addSlide());
    await page.evaluate(() => window.deckEditor.deck.goTo(0));
    await save(page);
    await open(page, 'mol3d-drag');
    await page.keyboard.press('F5');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-mol3d] > .deck-mol3d-live.ready canvas'));
    const frame = page.frameLocator('#deckFrame');
    const area = await frame.locator('figure[data-mol3d] .deck-mol3d-live').boundingBox();
    const z0 = await mol(page, (el) => el.__deckMol3d.viewer.getView()[3]);
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(300);
    const z1 = await mol(page, (el) => el.__deckMol3d.viewer.getView()[3]);
    expect(z1).not.toBe(z0);                                     // zoomed
    expect(await page.evaluate(() => window.deckEditor.deck.current)).toBe(0);
    expect(await page.evaluate(() => { const rt = window.deckEditor.deck.win.deckRuntime; return rt && rt.version; })).toBe(17);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('[data-fragment]').classList.contains('visible'))).toBe(false);   // the step did not show
    await page.keyboard.press('Escape');
});

test('mol3d: an SDF with 3D coordinates and an XYZ file come in as small molecules; a flat Molfile is refused', async ({ page }) => {
    await newDeck(page, 'mol3d-small');
    await insertFile(page, SDF);
    expect(await mol(page, (el) => el.getAttribute('data-mol3d'))).toBe('sdf');
    expect(await settingsOf(page)).toMatchObject({ style: 'ballstick', colour: 'element', hydrogens: true });
    await expect(page.locator('#m3pMeta')).toContainText('Ethanol');
    await expect(page.locator('#m3pMeta')).toContainText('C2H6O · 9 atoms');
    await expect(page.locator('#m3pStyle [data-v="ballstick"]')).toHaveText('Ball and stick');
    await expect(page.locator('#m3pPickRow')).toBeHidden();
    expect((await inked(page)).share).toBeGreaterThan(0.005);
    await page.click('#m3pStyle [data-v="spheres"]');
    await expect.poll(async () => (await settingsOf(page)).style).toBe('spheres');
    // See-through: the picture has no ground of its own (where the browser draws it so; Chrome and Firefox do).
    await page.check('#m3pClear');
    await expect.poll(async () => (await settingsOf(page)).bg).toBe('none');
    const clear = await inked(page);
    expect(clear.corner[3]).toBe(0);
    expect(clear.share).toBeGreaterThan(0.005);

    await page.evaluate(() => { const ed = window.deckEditor; ed.history.remove(ed.deck.doc.querySelector('figure[data-mol3d]')); });
    await insertFile(page, XYZ);
    expect(await mol(page, (el) => el.getAttribute('data-mol3d'))).toBe('xyz');
    await expect(page.locator('#m3pMeta')).toContainText('H2O · 3 atoms');

    // A 2D Molfile: said in words, Insert stays off.
    await page.click('#btnInsert');
    await page.click('[data-insert="mol3d"]');
    await page.click('.mol3d-dialog [data-tab="file"]');
    await page.setInputFiles('#m3File', FLAT);
    await expect(page.locator('#m3Err')).toContainText('flat');
    await expect(page.locator('#m3Insert')).toBeDisabled();
    await page.click('#m3Cancel');
});

test('mol3d: Fetch asks the server for the ID (stubbed here) and says when the site cannot be reached; pasting works too', async ({ page }) => {
    await newDeck(page, 'mol3d-fetch');
    const pdb = fs.readFileSync(PDB, 'utf8');
    const asked = [];
    await page.route('**/api/structure?**', (route) => {
        const u = new URL(route.request().url());
        asked.push(u.searchParams.get('from') + ':' + u.searchParams.get('id'));
        if (u.searchParams.get('id') === '0OFF') return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, error: "Diapo couldn't reach rcsb.org. Check the connection, or download the file from the site and drop it in the From a file tab." }) });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, text: pdb, format: 'pdb', name: '9ZZZ', site: 'rcsb.org', url: 'https://files.rcsb.org/download/9ZZZ.cif' }) });
    });
    await page.click('#btnInsert');
    await page.click('[data-insert="mol3d"]');
    await expect(page.locator('#m3Net')).toContainText('rcsb.org');
    await page.selectOption('#m3Where', 'pubchem');
    await expect(page.locator('#m3Net')).toContainText('pubchem.ncbi.nlm.nih.gov');
    await page.selectOption('#m3Where', 'pdb');
    await page.fill('#m3Id', '0OFF');
    await page.click('#m3Fetch');
    await expect(page.locator('#m3Err')).toContainText("couldn't reach rcsb.org");
    await expect(page.locator('#m3Insert')).toBeDisabled();
    await page.fill('#m3Id', '9zzz');
    await page.click('#m3Fetch');
    await expect(page.locator('#m3Insert')).toBeEnabled({ timeout: 15000 });
    await expect(page.locator('#m3Meta')).toContainText('Protein Data Bank');
    await page.click('#m3Start [data-v="surface"]');
    await page.click('#m3Insert');
    await expect(page.locator('.mol3d-dialog')).toHaveCount(0, { timeout: 20000 });
    expect(asked).toEqual(['pdb:0OFF', 'pdb:9zzz']);
    expect(await settingsOf(page)).toMatchObject({ style: 'surface', source: 'Protein Data Bank 9ZZZ' });
    expect((await inked(page)).share).toBeGreaterThan(0.01);

    // Paste: the text of a file.
    await page.click('#btnInsert');
    await page.click('[data-insert="mol3d"]');
    await page.click('.mol3d-dialog [data-tab="paste"]');
    await page.fill('#m3Paste', fs.readFileSync(XYZ, 'utf8'));
    await expect(page.locator('#m3Insert')).toBeEnabled({ timeout: 15000 });
    await page.click('#m3Insert');
    await expect(page.locator('.mol3d-dialog')).toHaveCount(0, { timeout: 15000 });
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('figure[data-mol3d]').length)).toBe(2);
});

test('mol3d: a structure file dropped on the slide is inserted where it lands', async ({ page }) => {
    await newDeck(page, 'mol3d-drop');
    const text = fs.readFileSync(PDB, 'utf8');
    const box = await page.locator('#canvas').boundingBox();
    const dt = await page.evaluateHandle((t) => { const d = new DataTransfer(); d.items.add(new File([t], 'zinc-helix.pdb', { type: '' })); return d; }, text);
    await page.dispatchEvent('#canvas', 'dragover', { dataTransfer: dt, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
    await page.dispatchEvent('#canvas', 'drop', { dataTransfer: dt, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
    await page.waitForFunction(() => { const el = window.deckEditor.deck.doc.querySelector('figure[data-mol3d]'); return el && el.querySelector('img').getAttribute('src'); }, null, { timeout: 15000 });
    expect(await mol(page, (el) => el.getAttribute('data-mol3d'))).toBe('pdb');
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('figure[data-mol3d]').length)).toBe(0);
});

test('mol3d: PowerPoint, the PDF copy and the single-file export use the picture; the export runs live on its own', async ({ page, browser }) => {
    await newDeck(page, 'mol3d-export');
    await insertFile(page, PDB);
    await page.click('#m3pPresent [data-v="turns"]');

    const printable = await page.evaluate(async () => { await window.deckEditor.exporter.helpersReady; return window.deckEditor.exporter.printableHtml(); });
    expect(printable).toContain('data-mol3d-picture');
    expect(printable).not.toContain('data-deck-mol3d');
    const spec = await page.evaluate(async () => { const { PptxCollector } = await import('/core/pptx.js'); return new PptxCollector(window.deckEditor).collect(() => {}); });
    const item = spec.slides[0].items.find(i => i.name === '3D structure');
    expect(item).toMatchObject({ kind: 'pic' });
    expect(item.src.data).toMatch(/^data:image\/png/);           // WebP goes to PowerPoint as PNG
    expect(item.alt).toMatch(/^3D structure: 9ZZZ/);

    const r = await page.evaluate(() => window.deckEditor.exporter.standalone({ to: 'mol3d-standalone.html', fonts: false }));
    expect(r.notes.join(' ')).not.toMatch(/mol3d|3dmol/i);
    const out = path.join(WS, 'mol3d-export', 'mol3d-standalone.html');
    const html = fs.readFileSync(out, 'utf8');
    expect(html).not.toMatch(/<script[^>]*\ssrc=/);
    expect(html).toContain('<script data-deck-mol3d="library">');
    expect(html).toContain('<script data-deck-mol3d="renderer">');
    const alone = path.join(WS, 'elsewhere-mol3d');
    fs.mkdirSync(alone, { recursive: true });
    fs.copyFileSync(out, path.join(alone, 'talk.html'));
    const ctx = await browser.newContext({ offline: true });
    const solo = await ctx.newPage();
    await solo.goto('file:///' + path.join(alone, 'talk.html').replace(/\\/g, '/'));
    await solo.waitForFunction(() => document.querySelector('figure[data-mol3d] > .deck-mol3d-live.ready canvas'), null, { timeout: 15000 });
    await ctx.close();
    await open(page, 'mol3d-export', 'mol3d-standalone.html');
    expect(await page.evaluate(() => window.deckEditor.deck.trust)).toMatchObject({ trusted: false, scripts: 0 });
    await expect(page.locator('.bar.trust-bar')).toHaveCount(0);
});

test('mol3d: a file over 1 MB is kept in assets/; Publish copies it and the single file writes it in', async ({ page }) => {
    await newDeck(page, 'mol3d-big');
    // The helix with fifteen thousand waters round it: about 1.2 MB of text.
    const lines = fs.readFileSync(PDB, 'utf8').trim().split('\n').filter(l => l !== 'END');
    for (let i = 0; i < 15000; i++) {
        const x = (i % 30) * 3 - 45, y = Math.floor(i / 30) % 30 * 3 - 45, z = Math.floor(i / 900) * 3 - 20;
        lines.push('HETATM' + String(1000 + i).padStart(5) + '  O   HOH B' + String(1 + i % 9999).padStart(4) + '    ' + [x, y, z].map(v => v.toFixed(3).padStart(8)).join('') + '  1.00 30.00           O');
    }
    const big = lines.join('\n') + '\nEND\n';
    expect(big.length).toBeGreaterThan(1024 * 1024);
    await page.evaluate(async (t) => {
        const { insertFiles } = await import('/core/mol3d.js');
        await insertFiles(window.deckEditor, [new File([t], 'helix-in-water.pdb')]);
    }, big);
    const holder = await mol(page, (el) => ({ src: el.querySelector('script[data-mol3d-source]').getAttribute('src'), text: el.querySelector('script[data-mol3d-source]').textContent }));
    expect(holder).toEqual({ src: 'assets/helix-in-water.pdb', text: '' });
    expect(fs.readFileSync(path.join(WS, 'mol3d-big', 'assets', 'helix-in-water.pdb'), 'utf8')).toBe(big);
    await expect(page.locator('#m3pMeta')).toContainText('Kept beside the deck: assets/helix-in-water.pdb');
    await expect(page.locator('#m3pWaterRow')).toBeVisible();
    await page.check('#m3pWater');                                // read from the file in assets/, drawn again
    await expect.poll(async () => (await settingsOf(page)).water).toBe(true);
    await save(page);

    const out = path.join(WS, 'mol3d-big-site');
    fs.rmSync(out, { recursive: true, force: true });
    const html = await page.evaluate(() => window.deckEditor.serialize());
    const r = await page.request.post('/api/publish?file=mol3d-big/index.html&to=' + encodeURIComponent(out), { headers: { ...own, 'Content-Type': 'text/html; charset=utf-8' }, data: html });
    expect(r.ok()).toBeTruthy();
    expect(fs.readFileSync(path.join(out, 'assets', 'helix-in-water.pdb'), 'utf8')).toBe(big);

    const x = await page.evaluate(() => window.deckEditor.exporter.standalone({ to: 'big-standalone.html', fonts: false }));
    expect(x.notes.join(' ')).not.toMatch(/helix-in-water/);
    const single = fs.readFileSync(path.join(WS, 'mol3d-big', 'big-standalone.html'), 'utf8');
    expect(single).toMatch(/<script type="chemical\/x-pdb" data-mol3d-source="">\nHEADER/);
    expect(single).not.toContain('assets/helix-in-water.pdb');
});

// STL: a mesh (a 3D print, a CAD part, a surface exported from ChimeraX), not atoms. Kept as base64.
const TORUS = path.join(FIX, 'torus-binary.stl');           // binary, 576 triangles, 80 x 80 x 20
const PYRAMID = path.join(FIX, 'pyramid-ascii.stl');        // text, 6 triangles, 20 x 20 x 15
const stlBytes = (page) => mol(page, (el) => Array.from(window.DeckMol3d.bytes(el.querySelector('script[data-mol3d-source]').textContent)));

test('mol3d: an STL model, binary or text, comes in as one shape kept as base64, with its own styles; save, reopen, paste and drop', async ({ page }) => {
    await newDeck(page, 'mol3d-stl');
    await page.click('#btnInsert');
    await page.click('[data-insert="mol3d"]');
    await page.click('.mol3d-dialog [data-tab="file"]');
    await page.setInputFiles('#m3File', TORUS);
    await expect(page.locator('#m3Insert')).toBeEnabled({ timeout: 15000 });
    await expect(page.locator('#m3Meta')).toContainText('Torus-binary');
    await expect(page.locator('#m3Meta')).toContainText('576 triangles · 80 × 80 × 20 across');
    await expect(page.locator('.mol3d-dialog .m3-start')).toBeHidden();       // a mesh starts solid
    await page.click('#m3Insert');
    await expect(page.locator('.mol3d-dialog')).toHaveCount(0, { timeout: 15000 });
    await page.waitForFunction(() => { const s = window.deckEditor.selection.single; return s && s.matches('figure[data-mol3d]') && s.querySelector('img[data-mol3d-picture]').getAttribute('src'); });

    expect(await mol(page, (el) => [el.getAttribute('data-mol3d'), el.querySelector('script[data-mol3d-source]').getAttribute('type'), el.querySelector('img').getAttribute('alt')]))
        .toEqual(['stl', 'model/stl', '3D model: Torus-binary']);
    expect(await stlBytes(page)).toEqual(Array.from(fs.readFileSync(TORUS)));
    expect(await settingsOf(page)).toMatchObject({ style: 'solid', colour: 'deck', source: 'torus-binary.stl' });
    expect((await inked(page)).share).toBeGreaterThan(0.02);
    // The panel: a mesh's styles and colours, nothing about atoms.
    await expect(page.locator('#m3pMeta')).toContainText('torus-part');
    await expect(page.locator('#m3pStyle button')).toHaveText(['Solid', 'See-through', 'Wireframe']);
    await expect(page.locator('#m3pColour option')).toHaveText(["The deck's colour", 'Light grey']);
    for (const id of ['#m3pShowSub', '#m3pHRow', '#m3pWaterRow', '#m3pPickRow']) await expect(page.locator(id)).toBeHidden();
    const solid = await pictureSrc(page);
    await page.click('#m3pStyle [data-v="wire"]');
    await expect.poll(async () => (await settingsOf(page)).style).toBe('wire');
    await expect.poll(() => pictureSrc(page)).not.toBe(solid);
    await page.selectOption('#m3pColour', 'plain');
    await expect.poll(async () => (await settingsOf(page)).colour).toBe('plain');
    const pic = await pictureSrc(page), settings = await settingsOf(page);

    await save(page);
    const html = fs.readFileSync(path.join(WS, 'mol3d-stl', 'index.html'), 'utf8');
    expect(html).toMatch(/<script type="model\/stl" data-mol3d-source="">\n[A-Za-z0-9+/]{100}\n/);
    await open(page, 'mol3d-stl');
    expect(await settingsOf(page)).toEqual(settings);
    expect(await stlBytes(page)).toEqual(Array.from(fs.readFileSync(TORUS)));
    await page.waitForTimeout(800);
    expect(await pictureSrc(page)).toBe(pic);                     // current: not drawn again on opening
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('figure[data-mol3d]')));
    await expect(page.locator('#m3pMeta')).toContainText('576 triangles');

    // The text kind, pasted.
    await page.click('#btnInsert');
    await page.click('[data-insert="mol3d"]');
    await page.click('.mol3d-dialog [data-tab="paste"]');
    const ascii = fs.readFileSync(PYRAMID, 'utf8');
    await page.fill('#m3Paste', ascii);
    await expect(page.locator('#m3Insert')).toBeEnabled({ timeout: 15000 });
    await expect(page.locator('#m3Meta')).toContainText('Pyramid');
    await expect(page.locator('#m3Meta')).toContainText('6 triangles · 20 × 20 × 15 across');
    await page.click('#m3Insert');
    await expect(page.locator('.mol3d-dialog')).toHaveCount(0, { timeout: 15000 });
    const pasted = await page.evaluate(() => { const el = window.deckEditor.selection.single; return new TextDecoder().decode(window.DeckMol3d.bytes(el.querySelector('script[data-mol3d-source]').textContent)); });
    expect(pasted).toBe(ascii);

    // Dropped on the slide.
    const bytes = Array.from(fs.readFileSync(TORUS));
    const box = await page.locator('#canvas').boundingBox();
    const dt = await page.evaluateHandle((b) => { const d = new DataTransfer(); d.items.add(new File([new Uint8Array(b)], 'ring.stl', { type: '' })); return d; }, bytes);
    await page.dispatchEvent('#canvas', 'dragover', { dataTransfer: dt, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
    await page.dispatchEvent('#canvas', 'drop', { dataTransfer: dt, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelectorAll('figure[data-mol3d="stl"] img[src]').length === 3, null, { timeout: 15000 });

    // A file that is not one: said in words.
    await page.click('#btnInsert');
    await page.click('[data-insert="mol3d"]');
    await page.click('.mol3d-dialog [data-tab="file"]');
    await page.setInputFiles('#m3File', { name: 'broken.stl', mimeType: 'model/stl', buffer: Buffer.from('not a mesh at all') });
    await expect(page.locator('#m3Err')).toContainText('not an STL file');
    await expect(page.locator('#m3Insert')).toBeDisabled();
    await page.click('#m3Cancel');
});

test('mol3d: an STL over 1 MB is kept in assets/ as it was; the single file writes it in as base64 and turns offline', async ({ page, browser }) => {
    await newDeck(page, 'mol3d-stl-big');
    // 21,000 small triangles scattered in a box: 1.05 MB, binary.
    const n = 21000, buf = Buffer.alloc(84 + 50 * n);
    buf.write('scattered', 0);
    buf.writeUInt32LE(n, 80);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let t = 0; t < n; t++) {
        const c = [rnd() * 100, rnd() * 60, rnd() * 40];
        const corners = [c, [c[0] + 2, c[1], c[2]], [c[0], c[1] + 2, c[2]]];
        corners.forEach((v, i) => v.forEach((x, k) => buf.writeFloatLE(x, 84 + 50 * t + 12 + 12 * i + 4 * k)));
    }
    expect(buf.length).toBeGreaterThan(1024 * 1024);
    const name = 'big part.stl';
    await page.evaluate(async ([b, name]) => {
        const { insertFiles } = await import('/core/mol3d.js');
        await insertFiles(window.deckEditor, [new File([new Uint8Array(b)], name)]);
    }, [Array.from(buf), name]);
    expect(await mol(page, (el) => el.querySelector('script[data-mol3d-source]').getAttribute('src'))).toBe('assets/' + name);
    expect(fs.readFileSync(path.join(WS, 'mol3d-stl-big', 'assets', name)).equals(buf)).toBe(true);
    await expect(page.locator('#m3pMeta')).toContainText('21,000 triangles');
    await page.click('#m3pStyle [data-v="glass"]');                // read back from assets/, drawn again
    await expect.poll(async () => (await settingsOf(page)).style).toBe('glass');
    await page.click('#m3pPresent [data-v="turns"]');
    await save(page);

    const r = await page.evaluate(() => window.deckEditor.exporter.standalone({ to: 'stl-standalone.html', fonts: false }));
    expect(r.notes.join(' ')).not.toMatch(/big part/);
    const single = fs.readFileSync(path.join(WS, 'mol3d-stl-big', 'stl-standalone.html'), 'utf8');
    expect(single).not.toContain('assets/' + name);
    const m = /<script type="model\/stl" data-mol3d-source="">\n([\s\S]*?)\n<\/script>/.exec(single);
    expect(Buffer.from(m[1].replace(/\s+/g, ''), 'base64').equals(buf)).toBe(true);
    const alone = path.join(WS, 'elsewhere-stl');
    fs.mkdirSync(alone, { recursive: true });
    fs.copyFileSync(path.join(WS, 'mol3d-stl-big', 'stl-standalone.html'), path.join(alone, 'part.html'));
    const ctx = await browser.newContext({ offline: true });
    const solo = await ctx.newPage();
    await solo.goto('file:///' + path.join(alone, 'part.html').replace(/\\/g, '/'));
    await solo.waitForFunction(() => document.querySelector('figure[data-mol3d] > .deck-mol3d-live.ready canvas'), null, { timeout: 20000 });
    await ctx.close();
});
