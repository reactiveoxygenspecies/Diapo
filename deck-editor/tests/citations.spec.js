// Citations and picture credits: the deck's library (CSL-JSON in the deck), citations put in from the popover
// (Alt+[) or typed as Pandoc keys ([@key]), written in a CSL style when the deck is edited; references at the foot
// of the slides, the Sources slide (references and picture credits, continued on more slides when long); a
// picture's credit in the panel, filled in from where it came from, and shown beside it in five looks.
// Run with: npx playwright test tests/citations.spec.js   (from the deck-editor folder)
const { test, expect, freshDeckEachTest, readDeck, save, openDeck, goTo, PORT } = require('./helpers');

freshDeckEachTest();

const BIB = `@article{szostak2001, author={Szostak, Jack W. and Bartel, David P. and Luisi, P. Luigi}, title={Synthesizing life}, journal={Nature}, volume={409}, number={6818}, pages={387--390}, year={2001}, doi={10.1038/35053176}}
@article{mansy2008, author={Mansy, Sheref S. and Schrum, Jason P. and Krishnamurthy, Mathangi and Tob{\\'e}, Sylvia and Treco, Douglas A. and Szostak, Jack W.}, title={Template-directed synthesis of a genetic polymer in a model protocell}, journal={Nature}, volume={454}, number={7200}, pages={122--125}, year={2008}, doi={10.1038/nature07018}}
@article{hanczyc2003, author={Hanczyc, Martin M. and Fujikawa, Shelly M. and Szostak, Jack W.}, title={Experimental models of primitive cellular compartments: encapsulation, growth, and division}, journal={Science}, volume={302}, number={5645}, pages={618--622}, year={2003}}`;

/* Import BIB through Insert > Citation library... > Paste. */
async function importBib(page) {
    await page.locator('#btnInsert').click();
    await page.locator('[data-insert="cite-library"]').click();
    await expect(page.locator('.citelib')).toBeVisible();
    await page.locator('#clPasteBtn').click();
    await page.locator('#clPasteText').fill(BIB);
    await page.locator('#clPasteAdd').click();
    await expect(page.locator('#clMsg')).toHaveText('the pasted text: 3 added.');
    await expect(page.locator('#clRows tr')).toHaveCount(3);
    await page.locator('#clDone').click();
    await expect(page.locator('.citelib')).toHaveCount(0);
}
async function editEnd(page, sel) {
    await page.evaluate((sel) => {
        const ed = window.deckEditor, el = ed.deck.doc.querySelector(sel);
        ed.selection.select(el);
        ed.textEdit.start(el);
        const r = ed.deck.doc.createRange(); r.selectNodeContents(el); r.collapse(false);
        const s = ed.deck.win.getSelection(); s.removeAllRanges(); s.addRange(r);
    }, sel);
    await page.waitForFunction(() => window.deckEditor.textEdit.el);
}
const cites = (page, sel = 'p.sub') => page.evaluate((sel) => Array.from(window.deckEditor.deck.doc.querySelector(sel).querySelectorAll('span[data-cite]')).map(s => [s.getAttribute('data-cite'), s.innerHTML]), sel);
const pass = (page) => page.evaluate(() => window.deckEditor.sources.run());

test('citations: library, popover, typed keys, styles, foot of the slide, Sources slide, saved as plain text', async ({ page }) => {
    test.setTimeout(120000);
    await openDeck(page);
    await importBib(page);
    // The library is CSL-JSON on the stage, one undo step.
    expect(await page.evaluate(() => window.deckEditor.history.top.label)).toBe('Import references');
    const lib = await page.evaluate(() => JSON.parse(window.deckEditor.deck.doc.getElementById('deck-references').textContent));
    expect(lib.map(i => i.id)).toEqual(['szostak2001', 'mansy2008', 'hanczyc2003']);
    expect(lib[1].author[3].family).toBe('Tobé');

    // The popover: Alt+[ in a text, search, tick, Enter.
    await editEnd(page, 'p.sub');
    await page.keyboard.press('Alt+BracketLeft');
    await expect(page.locator('.citepop')).toBeVisible();
    await expect(page.locator('.citepop-q')).toBeFocused();
    await page.keyboard.type('synthesizing');
    await expect(page.locator('.citepop-item')).toHaveCount(1);
    await page.keyboard.press('Enter');                             // nothing ticked: Enter takes the highlighted one
    await expect(page.locator('.citepop')).toHaveCount(0);
    await expect.poll(() => cites(page)).toEqual([['[@szostak2001]', '(Szostak et al., 2001)']]);
    expect(await page.evaluate(() => window.deckEditor.history.top.label)).toBe('Insert citation');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('p.sub').textContent.replace(/​/g, ''))).toBe('Subtitle or author (Szostak et al., 2001)');

    // Typed: [@ opens the list, Enter takes a key, the closing bracket makes the citation.
    await page.keyboard.type(' and [@han');
    await expect(page.locator('.citeac')).toBeVisible();
    await expect(page.locator('.citeac-item')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await page.keyboard.type(', p. 620]');
    await expect(page.locator('.citeac')).toHaveCount(0);
    await expect.poll(() => cites(page)).toEqual([['[@szostak2001]', '(Szostak et al., 2001)'], ['[@hanczyc2003, p. 620]', '(Hanczyc et al., 2003, p. 620)']]);
    // Ctrl+Z gives the typed text back, Ctrl+Y the citation.
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('p.sub').textContent)).toContain('[@hanczyc2003, p. 620]');
    await page.keyboard.press('Control+y');
    await expect.poll(async () => (await cites(page)).length).toBe(2);
    // A press on a citation opens it; "In the sentence" makes it narrative.
    await editEnd(page, 'p.sub');
    await page.evaluate(() => { const ed = window.deckEditor; ed.citePop.open({ span: ed.deck.doc.querySelector('p.sub span[data-cite]') }); });
    await page.locator('.citepop-form [data-m="narrative"]').click();
    await expect(page.locator('.citepop-code')).toHaveValue('@szostak2001');
    await expect(page.locator('.citepop-preview')).toHaveText('Szostak et al. (2001)');
    await page.locator('.citepop [data-act="ok"]').click();
    await expect.poll(async () => (await cites(page))[0]).toEqual(['@szostak2001', 'Szostak et al. (2001)']);
    await page.keyboard.press('Escape');

    // Another style rewrites every citation: Nature numbers them in order of first citation.
    await page.evaluate(() => { const ed = window.deckEditor; ed.history.attr(ed.deck.stage, 'data-csl-style', 'nature', 'Citation style'); });
    await pass(page);
    expect(await cites(page)).toEqual([['@szostak2001', 'Szostak et al.<sup>1</sup>'], ['[@hanczyc2003, p. 620]', '<sup>2</sup>']]);

    // The foot of the slide lists what it cites.
    await page.evaluate(() => { const ed = window.deckEditor; ed.history.attr(ed.deck.stage, 'data-cite-foot', '', 'References at the foot'); });
    await pass(page);
    const foot = await page.evaluate(() => window.deckEditor.deck.doc.querySelector('.slide[data-name="title"] > .deck-slide-refs[data-slide-refs][data-locked]').innerHTML);
    expect(foot).toBe('<ol><li><sup>1</sup>Szostak et al., <i>Nature</i> 409, 387 (2001)</li><li><sup>2</sup>Hanczyc et al., <i>Science</i> 302, 618 (2003)</li></ol>');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('.slide[data-name="chart"] > .deck-slide-refs'))).toBeNull();

    // The Sources slide: added at the end, its list written in the style.
    await page.locator('#btnInsert').click();
    await page.locator('[data-insert="sources"]').click();
    await expect.poll(() => page.evaluate(() => { const s = window.deckEditor.deck.doc.querySelector('.slide[data-sources]'); return s ? s.querySelectorAll('.csl-entry').length : -1; })).toBe(2);
    const src = await page.evaluate(() => { const s = window.deckEditor.deck.doc.querySelector('.slide[data-sources]'); return { last: s === window.deckEditor.deck.slides.at(-1), title: s.querySelector('h1, h2').textContent, text: s.querySelector('[data-sources-body]').textContent.replace(/\s+/g, ' ').trim() }; });
    expect(src.last).toBe(true);
    expect(src.title).toBe('References');
    expect(src.text).toContain('Szostak, J. W., Bartel, D. P. & Luisi, P. L. Synthesizing life. Nature 409, 387–390 (2001).');
    expect(src.text).toContain('Hanczyc, M. M., Fujikawa, S. M. & Szostak, J. W.');
    // "Everything in the library" adds the uncited one.
    await page.evaluate(() => { const ed = window.deckEditor; ed.history.attr(ed.deck.doc.querySelector('.slide[data-sources]'), 'data-sources-list', 'all', 'Sources slide'); });
    await pass(page);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('.slide[data-sources] .csl-entry').length)).toBe(3);

    // Saved: plain text and data, no editing marks; opened again, nothing has to change.
    await save(page);
    const html = readDeck();
    expect(html).toContain('<script type="application/vnd.citationstyles.csl+json" id="deck-references">');
    expect(html).toContain('<span data-cite="@szostak2001">Szostak et al.<sup>1</sup></span>');
    expect(html).toContain('data-csl-style="nature"');
    expect(html).toContain('data-cite-foot=""');
    expect(html).toContain('/* citations and credits (managed by the deck editor) */');
    expect(html).not.toMatch(/contenteditable="false"|data-cite-missing/);
    await openDeck(page);
    await pass(page);
    expect(await page.evaluate(() => window.deckEditor.dirty)).toBe(false);
    expect(await cites(page)).toEqual([['@szostak2001', 'Szostak et al.<sup>1</sup>'], ['[@hanczyc2003, p. 620]', '<sup>2</sup>']]);
});

test('citations: a key the library lacks shows as typed; a DOI adds a reference; renaming a key follows the text', async ({ page }) => {
    await page.route('**/api/cite/doi?**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, item: {
        type: 'article-journal', title: 'Synthesis of activated pyrimidine ribonucleotides in prebiotically plausible conditions', DOI: '10.1038/nature08013',
        author: [{ family: 'Powner', given: 'Matthew W.', affiliation: [] }, { family: 'Gerland', given: 'Béatrice' }, { family: 'Sutherland', given: 'John D.' }],
        'container-title': 'Nature', volume: '459', page: '239-242', issued: { 'date-parts': [[2009, 5]] }, reference: [{ key: 'x' }] } }) }));
    await openDeck(page);
    await editEnd(page, 'p.sub');
    await page.keyboard.type(' [@powner2009]');
    // Not in the library: no citation is made from typing alone.
    expect(await cites(page)).toEqual([]);
    await page.keyboard.press('Alt+BracketLeft');
    await page.keyboard.type('10.1038/nature08013');
    await expect(page.locator('.citepop-doi')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('.citepop-code')).toHaveValue('[@powner2009]');
    const item = await page.evaluate(() => JSON.parse(window.deckEditor.deck.doc.getElementById('deck-references').textContent)[0]);
    expect(item.id).toBe('powner2009');
    expect(item.reference).toBeUndefined();                     // only the fields the styles read are kept
    expect(item.author[0].affiliation).toBeUndefined();
    await page.keyboard.press('Enter');
    await expect.poll(() => cites(page)).toEqual([['[@powner2009]', '(Powner et al., 2009)']]);
    await page.keyboard.press('Escape');

    // A citation whose key is missing keeps its typed text.
    await page.evaluate(() => { const ed = window.deckEditor, s = ed.deck.doc.querySelector('p.sub span[data-cite]'); ed.history.attr(s, 'data-cite', '[@nobody1999]', 'x'); });
    await pass(page);
    expect(await cites(page)).toEqual([['[@nobody1999]', '[@nobody1999]']]);
    expect(await page.evaluate(() => [...window.deckEditor.sources.missing])).toEqual(['nobody1999']);
    await page.evaluate(() => window.deckEditor.history.undo());
    await pass(page);
    expect(await cites(page)).toEqual([['[@powner2009]', '(Powner et al., 2009)']]);

    // Renaming the key in the library changes the citations with it, as one undo step.
    await page.evaluate(() => window.deckEditor.openCiteLibrary({ select: 'powner2009' }));
    await page.locator('#clKey').fill('powner09');
    await page.locator('#clKey').press('Enter');
    await expect(page.locator('#clMsg')).toContainText('powner09');
    await page.locator('#clDone').click();
    await pass(page);
    expect(await cites(page)).toEqual([['[@powner09]', '(Powner et al., 2009)']]);
    expect(await page.evaluate(() => window.deckEditor.history.top.label)).toBe('Change citation key');
});

test('picture credits: the panel, captions in five looks, the Sources slide, filled in from an address', async ({ page }) => {
    test.setTimeout(90000);
    await page.route('**/api/credit/commons?**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, by: 'A. Photographer', from: 'Wikimedia Commons', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Vesicles.png' }) }));
    await openDeck(page);
    await goTo(page, 2);
    // A picture inserted from Commons: the site and the address at once, the author and licence from Commons.
    const shape = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Vesicles.png';
    await page.evaluate((url) => { const ed = window.deckEditor; window.__img = ed.insert.image('assets/shape.svg', 'Vesicles'); return import('/core/credits.js').then(m => m.creditFromUrl(ed, window.__img, url)); }, shape);
    const attrs = () => page.evaluate(() => ['by', 'from', 'license', 'url'].map(n => window.__img.getAttribute('data-credit-' + n)));
    expect(await attrs()).toEqual(['A. Photographer', 'Wikimedia Commons', 'CC BY-SA 4.0', 'https://commons.wikimedia.org/wiki/File:Vesicles.png']);
    // The panel shows it, and changes it.
    await page.evaluate(() => { window.deckEditor.selection.select(window.__img); window.deckEditor.inspector.sync(); });
    await expect(page.locator('#inspCredit')).toBeVisible();
    await expect(page.locator('#crBy')).toHaveValue('A. Photographer');
    await page.locator('#crBy').fill('B. Photographer');
    await page.locator('#crBy').press('Enter');
    expect((await attrs())[0]).toBe('B. Photographer');
    expect(await page.evaluate(() => window.deckEditor.history.top.label)).toBe('Picture credit');

    // Captions: one element beside the picture, in each look; none while the deck shows none.
    await pass(page);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('.deck-credit').length)).toBe(0);
    const caption = (look) => page.evaluate(async (look) => {
        const ed = window.deckEditor;
        ed.history.attr(ed.deck.stage, 'data-credits', look, 'Image credits');
        await ed.sources.run();
        const c = ed.deck.currentSlide.querySelector('.deck-credit'), f = ed.deck.currentSlide.querySelector('.deck-slide-refs');
        const box = ed.deck.stageRect(window.__img), cr = c && ed.deck.stageRect(c);
        return { cls: c && c.className, text: c && c.textContent, foot: f && f.textContent, locked: c && c.hasAttribute('data-locked'), box, cr };
    }, look);
    let c = await caption('corner');
    expect(c.cls).toBe('deck-credit corner');
    expect(c.text).toBe('B. Photographer · Wikimedia Commons · CC BY-SA 4.0');
    expect(c.locked).toBe(true);
    expect(Math.abs(c.cr.x + c.cr.w - (c.box.x + c.box.w - 12))).toBeLessThan(1.5);     // inside the bottom-right corner
    expect(Math.abs(c.cr.y + c.cr.h - (c.box.y + c.box.h - 12))).toBeLessThan(1.5);
    c = await caption('under');
    expect(Math.abs(c.cr.y - (c.box.y + c.box.h + 8))).toBeLessThan(1.5);
    expect(Math.abs(c.cr.x - c.box.x)).toBeLessThan(1.5);
    c = await caption('edge');
    expect(c.cr.x).toBeGreaterThanOrEqual(c.box.x + c.box.w);                             // outside, along the right edge
    c = await caption('footer');
    expect(c.cls).toBeNull();
    expect(c.foot).toBe('Image: B. Photographer · Wikimedia Commons · CC BY-SA 4.0');
    c = await caption('info');
    expect(c.cls).toBe('deck-credit info');
    expect(c.text).toBe('iB. Photographer · Wikimedia Commons · CC BY-SA 4.0');
    // The bubble shows on hover only; the print copy of the credit is in the foot.
    const shown = await page.evaluate(() => { const d = window.deckEditor.deck.doc, s = d.querySelector('.deck-credit.info > span'); return window.deckEditor.deck.win.getComputedStyle(s).display; });
    expect(shown).toBe('none');
    expect(c.foot).toBe('Image: B. Photographer · Wikimedia Commons · CC BY-SA 4.0');
    // Moved, the picture takes its credit along.
    await page.evaluate(async () => { const ed = window.deckEditor; ed.history.attr(ed.deck.stage, 'data-credits', 'corner', 'x'); ed.history.style(window.__img, (el) => { el.style.left = '200px'; el.style.top = '600px'; }); await ed.sources.run(); });
    c = await caption('corner');
    expect(Math.abs(c.cr.x + c.cr.w - (c.box.x + c.box.w - 12))).toBeLessThan(1.5);
    // Not shown on this picture; deleted, its caption goes; undone, it is back.
    await page.locator('#crShow').uncheck();
    await pass(page);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('.deck-credit').length)).toBe(0);
    await page.locator('#crShow').check();
    await page.evaluate(async () => { const ed = window.deckEditor; ed.history.remove(window.__img, 'Delete'); await ed.sources.run(); });
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('.deck-credit').length)).toBe(0);
    await page.evaluate(async () => { window.deckEditor.history.undo(); await window.deckEditor.sources.run(); });
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('.deck-credit').length)).toBe(1);

    // The Sources slide lists the pictures by slide; the deck script's own picture (data-svg) is not one.
    await page.evaluate(() => import('/core/citepanel.js').then(m => m.addSourcesSlide(window.deckEditor)));
    await pass(page);
    const listed = await page.evaluate(() => Array.from(window.deckEditor.deck.doc.querySelectorAll('.slide[data-sources] .deck-sources-credits li')).map(li => li.textContent));
    expect(listed).toEqual(['Slide 3. Vesicles: B. Photographer · Wikimedia Commons · CC BY-SA 4.0 commons.wikimedia.org/wiki/File:Vesicles.png']);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('.slide[data-sources] h2').textContent)).toBe('Picture credits');

    // Saved with the deck, editing marks off; the Sources slide can stop being updated.
    await save(page);
    const html = readDeck();
    for (const a of ['data-credit-by="B. Photographer"', 'data-credit-from="Wikimedia Commons"', 'data-credit-license="CC BY-SA 4.0"']) expect(html).toContain(a);
    expect(html).toMatch(/<div data-credit-for="[^"]+" data-locked="" data-name="Credit" class="deck-credit corner" style="right:\d+px;bottom:\d+px;">B\. Photographer/);
    await page.evaluate(() => { window.deckEditor.deck.goTo(window.deckEditor.deck.slides.length - 1); return import('/core/citepanel.js').then(m => m.stopSources(window.deckEditor)); });
    await page.evaluate(async () => { const ed = window.deckEditor; ed.history.attr(window.__img, 'data-credit-by', 'C. Other', 'x'); await ed.sources.run(); });
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('.deck-sources').textContent)).toContain('B. Photographer');
});

test('picture credits: a picture dragged in from a page is credited to its address', async ({ page }) => {
    await openDeck(page);
    await goTo(page, 2);
    const url = 'http://127.0.0.1:' + PORT + '/deck/sample/assets/shape.svg';
    await page.evaluate((url) => {
        const ed = window.deckEditor, stage = ed.deck.stage, r = stage.getBoundingClientRect();
        const dt = new DataTransfer();
        dt.setData('text/uri-list', url);
        dt.setData('text/html', `<img src="${url}" alt="">`);
        stage.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 200, clientY: r.top + 200 }));
    }, url);
    await expect.poll(() => page.evaluate(() => { const i = window.deckEditor.deck.currentSlide.querySelector('img[data-credit-url]'); return i && [i.getAttribute('src'), i.getAttribute('data-credit-from'), i.getAttribute('data-credit-url')]; })).toEqual([url, '127.0.0.1', url]);
});
