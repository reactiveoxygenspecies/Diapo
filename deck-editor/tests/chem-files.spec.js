// Chemical structures from files: Molfile (V2000, V3000), SDF and ChemDraw CDXML, drawn from the
// file's own coordinates (core/chemfile.js, core/molsvg.js), kept in the figure, edited in the panel.
const { test, expect, fs, path, freshDeckEachTest, DECK, openDeck, readDeck, save, stagePoint } = require('./helpers');

freshDeckEachTest();

const FIX = path.join(__dirname, 'fixtures', 'chem');
const fixture = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');

/* The structure figure on the current slide (the last one), as the tests look at it. */
const info = (page) => page.evaluate(() => {
    const ed = window.deckEditor, figs = ed.deck.currentSlide.querySelectorAll('figure[data-chem]'), f = figs[figs.length - 1];
    if (!f) return null;
    const svg = f.querySelector(':scope > svg'), src = f.querySelector(':scope > script[data-chem-source]');
    const live = [...(svg ? svg.querySelectorAll('line, polygon, circle, path') : [])];
    return {
        count: figs.length, chem: f.getAttribute('data-chem'), format: f.getAttribute('data-chem-format'),
        type: src && src.getAttribute('type'), source: src && src.textContent, label: svg && svg.getAttribute('aria-label'), key: svg && svg.getAttribute('data-key'),
        texts: svg ? [...svg.querySelectorAll('text')].map(t => t.textContent) : [], polygons: svg ? svg.querySelectorAll('polygon').length : 0,
        lines: svg ? svg.querySelectorAll('line').length : 0, circles: svg ? [...svg.querySelectorAll('circle')].length : 0,
        red: f.innerHTML.includes('#e0402a'), gradients: svg ? svg.querySelectorAll('radialGradient').length : 0, shapes: live.length,
        selected: ed.selection.single === f, html: f.innerHTML, w: parseFloat(f.style.width), h: parseFloat(f.style.height),
    };
});

const firefox = () => test.info().project.name === 'firefox';

/* Text on the clipboard pasted where the focus is (`target`: a selector, or null for the canvas with
   nothing selected). Chrome takes a made-up paste event with its own clipboardData; Firefox empties
   that, so there the text is copied and pasted for real (Ctrl+C from a scratch box, then Ctrl+V). */
async function pasteText(page, text, target = null) {
    const focus = () => target ? page.focus(target)
        : page.evaluate(() => { const ed = window.deckEditor; ed.selection.set([]); if (document.activeElement) document.activeElement.blur(); });
    if (firefox()) {
        await page.evaluate((t) => { const a = document.createElement('textarea'); a.id = 'pasteSrc'; a.value = t; document.body.appendChild(a); a.select(); }, text);
        await page.keyboard.press('Control+c');
        await page.evaluate(() => document.getElementById('pasteSrc').remove());
        await focus();
        await page.keyboard.press('Control+v');
        return;
    }
    await focus();
    await page.evaluate(([text, target]) => {
        const dt = new DataTransfer(); dt.setData('text/plain', text);
        const at = target ? document.querySelector(target) : window.deckEditor.deck.doc.body;
        at.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, [text, target]);
}
/* A file on the clipboard (copied in the file manager) pasted on the canvas. Firefox gives a made-up
   paste event no files and the system clipboard cannot be given one, so there its text is pasted. */
async function pasteFile(page, name, text) {
    if (firefox()) return pasteText(page, text);
    await page.evaluate(([name, text]) => {
        const ed = window.deckEditor;
        ed.selection.set([]);
        const dt = new DataTransfer();
        dt.items.add(new File([text], name, { type: '' }));
        ed.deck.doc.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, [name, text]);
}

test('chem 1 Molfile V2000 pasted into the SMILES field: drawn from its coordinates, the file kept in the figure, one undo step; edited in its box', async ({ page }) => {
    test.setTimeout(60000);
    await openDeck(page);
    await page.click('#btnInsert');
    await page.click('[data-insert="structure"]');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-chem] > svg'));
    const aspirin = await info(page);
    expect(aspirin).toMatchObject({ chem: 'CC(=O)Oc1ccccc1C(=O)O', format: null, type: null });
    // The SMILES field takes a pasted Molfile whole (a one-line field would run its lines together).
    const mol = fixture('caffeine.mol');
    await pasteText(page, mol, '#chemSmiles');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-chem]').getAttribute('data-chem-format') === 'molfile');
    let c = await info(page);
    expect(c).toMatchObject({ chem: '', format: 'molfile', type: 'chemical/x-mdl-molfile', red: true });
    expect(c.source).toBe('\n' + mol + '\n');
    expect(c.label).toContain('caffeine, C8H10N4O2');
    expect(c.label).toContain('SMILES CN1C=NC2=C1C(=O)N(C)C(=O)N2C');
    expect(c.texts.sort()).toEqual(['N', 'N', 'N', 'N', 'O', 'O']);              // methyls are line ends, as SmilesDrawer draws them
    expect(c.gradients).toBe(6);                                                // bonds fade into the colour of N and O
    expect(c.html).not.toContain('<style');
    await expect(page.locator('#chemFormula')).toHaveText('Formula: C8H10N4O2');
    await expect(page.locator('#chemFrom')).toContainText('SMILES (without stereo): CN1C=NC2=C1C(=O)N(C)C(=O)N2C');
    await expect(page.locator('#chemSource')).toBeVisible();
    await expect(page.locator('#chemSmiles')).toBeHidden();
    expect(await page.inputValue('#chemSource')).toBe(mol);
    // One undo step back to the SMILES, and forward again.
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await info(page)).toMatchObject({ chem: 'CC(=O)Oc1ccccc1C(=O)O', format: null, type: null, html: aspirin.html });
    await page.evaluate(() => window.deckEditor.history.redo());
    expect(await info(page)).toMatchObject({ chem: '', format: 'molfile', key: c.key });
    // Edited in the box: an atom made sulfur is drawn as it is typed; leaving the box is one undo step.
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.doc.querySelector('figure[data-chem]')); });
    await expect(page.locator('#chemSource')).toBeVisible();
    const edited = mol.replace('    8.3488    0.5864    0.0000 O ', '    8.3488    0.5864    0.0000 S ');
    expect(edited).not.toBe(mol);
    await page.fill('#chemSource', edited);
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-chem] > svg').getAttribute('aria-label').includes('C8H10N4OS'));
    const steps = await page.evaluate(() => window.deckEditor.history.undoStack.length);
    await page.locator('#chemSource').blur();
    await page.waitForFunction((n) => window.deckEditor.history.undoStack.length === n + 1, steps);
    expect((await info(page)).source).toBe('\n' + edited + '\n');
    // A mistake says what is wrong; the slide keeps the last drawing that worked.
    await page.fill('#chemSource', edited.replace(/ 14 15  0/, ' 14 x5  0'));
    await expect(page.locator('#chemError')).toContainText('Not drawn');
    expect((await info(page)).label).toContain('C8H10N4OS');
    await page.fill('#chemSource', edited);
    await expect(page.locator('#chemError')).toBeHidden();
    // A SMILES typed into the box makes it a SMILES structure again.
    await page.fill('#chemSource', 'CCO');
    await page.locator('#chemSource').blur();
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-chem]').getAttribute('data-chem') === 'CCO');
    expect(await info(page)).toMatchObject({ format: null, type: null });
    await expect(page.locator('#chemSmiles')).toBeVisible();
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await info(page)).toMatchObject({ format: 'molfile', chem: '' });
});

test('chem 2 V3000 and SDF pasted on the canvas, an SDF read from Insert > Chemical structure from file: stereo hashes, the first record only, aromatic circles', async ({ page }) => {
    test.setTimeout(60000);
    await openDeck(page);
    // L-alanine in V3000, pasted as text on the slide: a structure of its own, its methyl hashed.
    await pasteText(page, fixture('alanine-v3000.mol'));
    await page.waitForFunction(() => window.deckEditor.deck.currentSlide.querySelector('figure[data-chem-format="molfile"] > svg'));
    let c = await info(page);
    expect(c.label).toContain('L-alanine, C3H7NO2');
    expect(c.selected).toBe(true);
    expect(c.texts.sort()).toEqual(['H₂N', 'O', 'OH']);                  // the N on the left: its H before it
    expect(c.lines).toBeGreaterThanOrEqual(5 + 2 + 4);                            // bonds, the C=O pair, the hash's lines
    await expect(page.locator('#chemFormula')).toHaveText('Formula: C3H7NO2');
    // Benzene from an SDF of two records: the first one only (no ammonium), alternating double bonds.
    await pasteText(page, fixture('benzene.sdf'));
    await page.waitForFunction(() => window.deckEditor.deck.currentSlide.querySelectorAll('figure[data-chem-format="molfile"] > svg').length === 2);
    c = await info(page);
    expect(c.label).toContain('benzene, C6H6');
    expect(c.texts).toEqual([]);
    expect(c.lines).toBe(9);                                                      // six bonds, three inner lines
    expect(c.circles).toBe(0);
    // "Aromatic rings as circles" draws the ring's circle: one undo step.
    await page.click('#chemCircles');
    await page.waitForFunction(() => { const f = [...window.deckEditor.deck.currentSlide.querySelectorAll('figure[data-chem]')].pop(); return f.getAttribute('data-chem-aromatic') === 'circles'; });
    c = await info(page);
    expect(c.circles).toBe(1);
    expect(c.lines).toBe(6);
    await page.evaluate(() => window.deckEditor.history.undo());
    expect((await info(page)).circles).toBe(0);
    // Insert > Chemical structure from file... reads a .mol into the figure.
    await page.click('#btnInsert');
    await page.setInputFiles('#insertChem', path.join(FIX, 'caffeine.mol'));
    await page.waitForFunction(() => window.deckEditor.deck.currentSlide.querySelectorAll('figure[data-chem-format="molfile"]').length === 3);
    c = await info(page);
    expect(c.label).toContain('C8H10N4O2');
    expect(c.w / c.h).toBeGreaterThan(1);                                         // the box takes the drawing's proportions
    // Atom colours off: one colour.
    await page.click('#chemColours');
    await page.waitForFunction(() => [...window.deckEditor.deck.currentSlide.querySelectorAll('figure[data-chem]')].pop().getAttribute('data-chem-colours') === 'off');
    c = await info(page);
    expect(c.red).toBe(false);
    expect(c.gradients).toBe(0);
    // A Molfile with no 2D coordinates (every atom at 0, 0) is laid out by SmilesDrawer from its SMILES, and says so.
    const flat = fixture('caffeine.mol').replace(/^( *-?\d+\.\d{4}){3}(?= [A-Z])/gm, '    0.0000    0.0000    0.0000');
    expect(flat).not.toContain('11.1159');
    await pasteText(page, flat);
    await page.waitForFunction(() => window.deckEditor.deck.currentSlide.querySelectorAll('figure[data-chem-format="molfile"]').length === 4);
    c = await info(page);
    expect(c.label).toContain('C8H10N4O2');
    expect(c.texts.length).toBeGreaterThan(4);
    await expect(page.locator('#chemFrom')).toContainText('no 2D coordinates');
});

test('chem 3 ChemDraw CDXML dropped on the slide: wedge and hash bonds, an abbreviation as its label, the reaction arrow and caption; a .mol dropped where it lands', async ({ page }) => {
    test.setTimeout(60000);
    await openDeck(page);
    const drop = (name, text, sx, sy) => page.evaluate(async ([name, text, sx, sy]) => {
        const ed = window.deckEditor, dt = new DataTransfer();
        dt.items.add(new File([text], name, { type: '' }));
        const s = ed.deck.stage.getBoundingClientRect(), k = ed.deck.scale;
        const x = s.left + sx * k, y = s.top + sy * k;
        const target = ed.deck.doc.elementFromPoint(x, y) || ed.deck.doc.body;
        const opts = { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true };
        target.dispatchEvent(new DragEvent('dragover', opts));
        target.dispatchEvent(new DragEvent('drop', opts));
    }, [name, text, sx, sy]);
    await drop('methoxyphenylethanol.cdxml', fixture('methoxyphenylethanol.cdxml'), 600, 500);
    await page.waitForFunction(() => window.deckEditor.deck.currentSlide.querySelector('figure[data-chem-format="cdxml"] > svg'));
    let c = await info(page);
    expect(c).toMatchObject({ chem: '', format: 'cdxml', type: 'chemical/x-cdxml' });
    expect(c.label).toContain('C9H12O2');                                         // OMe expanded from the fragment ChemDraw keeps in the node
    expect(c.texts).toContain('OMe');
    expect(c.texts).toContain('HO');
    expect(c.texts).toContain('H₂, Pd/C');                                        // the caption, its subscript kept
    expect(c.polygons).toBe(2);                                                   // the wedge and the arrow's head
    await expect(page.locator('#chemFormula')).toHaveText('Formula: C9H12O2');
    await expect(page.locator('#chemSource')).toBeVisible();
    expect(await page.inputValue('#chemSource')).toContain('<CDXML');
    const box = await page.evaluate(() => { const ed = window.deckEditor; return ed.deck.stageRect([...ed.deck.currentSlide.querySelectorAll('figure[data-chem]')].pop()); });
    expect(Math.abs(box.x + box.w / 2 - 600)).toBeLessThan(2);                    // centred where it was dropped
    expect(Math.abs(box.y + box.h / 2 - 500)).toBeLessThan(2);
    // A .mol dropped on the slide; a binary .cdx is refused with a word on CDXML.
    await drop('caffeine.mol', fixture('caffeine.mol'), 1400, 600);
    await page.waitForFunction(() => window.deckEditor.deck.currentSlide.querySelectorAll('figure[data-chem]').length === 2);
    expect((await info(page)).label).toContain('C8H10N4O2');
    await drop('scheme.cdx', 'VjCD0100', 1400, 300);
    await expect(page.locator('.toast').last()).toContainText('CDXML');
    expect((await info(page)).count).toBe(2);
    // A double-click goes to the source.
    const r = await page.evaluate(() => { const ed = window.deckEditor; const f = ed.deck.currentSlide.querySelector('figure[data-chem-format="cdxml"]'); ed.selection.select(f); return ed.deck.stageRect(f); });
    const p = await stagePoint(page, r.x + r.w / 2, r.y + r.h / 2);
    await page.mouse.dblclick(p.x, p.y);
    await expect(page.locator('#chemSource')).toBeFocused();
});

test('chem 4 saved and opened again: the file stays in the figure, nothing redrawn; single-file export, PowerPoint export; a source that does not read is a problem', async ({ page }) => {
    test.setTimeout(90000);
    await openDeck(page);
    // With Windows line ends, as a clipboard on Windows gives them: kept as LF, so the file opens again as saved.
    await pasteText(page, fixture('methoxyphenylethanol.cdxml').replace(/\n/g, '\r\n'));
    await page.waitForFunction(() => window.deckEditor.deck.currentSlide.querySelector('figure[data-chem-format="cdxml"] > svg'));
    await pasteFile(page, 'alanine-v3000.mol', fixture('alanine-v3000.mol'));
    await page.waitForFunction(() => window.deckEditor.deck.currentSlide.querySelector('figure[data-chem-format="molfile"] > svg'));
    // An existing SMILES structure beside them is saved as before: no format, no data block.
    await page.evaluate(() => window.deckEditor.insert.structure('Oc1ccccc1'));
    const htmls = await page.evaluate(() => [...window.deckEditor.deck.currentSlide.querySelectorAll('figure[data-chem]')].map(f => f.innerHTML));
    await save(page);
    const saved = readDeck();
    expect(saved).toContain('data-chem="" data-chem-format="cdxml"');
    expect(saved).toMatch(/<script type="chemical\/x-cdxml" data-chem-source(="")?>\n<\?xml/);
    expect(saved).toMatch(/<script type="chemical\/x-mdl-molfile" data-chem-source(="")?>\nL-alanine\n/);
    expect(saved).toMatch(/<figure data-chem="Oc1ccccc1"[^>]*><svg/);
    expect(saved).not.toMatch(/data-chem="Oc1ccccc1"[^>]*>(?:(?!<\/figure>)[\s\S])*<script/);
    await openDeck(page);
    expect(await page.evaluate(() => [...window.deckEditor.deck.currentSlide.querySelectorAll('figure[data-chem]')].map(f => f.innerHTML))).toEqual(htmls);
    expect(await page.evaluate(() => window.deckEditor.dirty)).toBe(false);
    await expect(page.locator('#problemsBadge')).toBeHidden();
    // Selected again, the panel has the file in its box.
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.querySelector('figure[data-chem-format="molfile"]')); });
    expect(await page.inputValue('#chemSource')).toBe(fixture('alanine-v3000.mol'));

    // The single-file export keeps the figures and their data blocks.
    const r = await page.evaluate(() => window.deckEditor.exporter.standalone({ to: 'chem-standalone.html', fonts: false }));
    expect(r.ok !== false).toBe(true);
    const single = fs.readFileSync(path.join(path.dirname(DECK), 'chem-standalone.html'), 'utf8');
    expect(single).toMatch(/<script type="chemical\/x-cdxml" data-chem-source(="")?>/);
    expect(single).toContain('data-chem-format="molfile"');
    fs.rmSync(path.join(path.dirname(DECK), 'chem-standalone.html'), { force: true });

    // PowerPoint: each structure is a picture (SVG with a PNG), named Structure, its alt text the formula.
    const spec = await page.evaluate(async () => {
        const m = await import('/core/pptx.js');
        const s = await new m.PptxCollector(window.deckEditor).collect();
        return s.slides[window.deckEditor.deck.current].items.filter(it => it.name === 'Structure').map(it => ({ kind: it.kind, svg: it.svg && it.svg.length, png: !!it.png, alt: it.alt, polygon: /<polygon/.test(it.svg || ''), script: /<script/.test(it.svg || '') }));
    });
    expect(spec.length).toBe(3);
    for (const s of spec) expect(s).toMatchObject({ kind: 'svg', png: true, script: false });
    expect(spec.map(s => s.alt).join(' | ')).toContain('C9H12O2');
    expect(spec.map(s => s.alt).join(' | ')).toContain('C3H7NO2');
    expect(spec.some(s => s.polygon)).toBe(true);

    // Written by hand with the file alone: drawn on open; one that does not read is listed under Problems.
    const start = '<section class="slide title-slide active" data-name="title">';
    const mol = fixture('caffeine.mol');
    fs.writeFileSync(DECK, readDeck().replace(start, start
        + `<figure data-chem="" data-chem-format="molfile" style="position:absolute; left:100px; top:300px; width:300px; height:200px; margin:0"><script type="chemical/x-mdl-molfile" data-chem-source>\n${mol}\n</script></figure>`
        + '<figure data-chem="" data-chem-format="molfile" style="position:absolute; left:500px; top:300px; width:300px; height:200px; margin:0"><script type="chemical/x-mdl-molfile" data-chem-source>\nbroken\n\n\n  2  1  0  0  0  0  0  0  0  0999 V2000\nM  END\n</script></figure>'));
    await openDeck(page);
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-chem-format="molfile"] > svg'));
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('figure[data-chem-format="molfile"] > svg').getAttribute('aria-label'))).toContain('C8H10N4O2');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('figure[data-chem-format="molfile"] > script[data-chem-source]').textContent)).toBe('\n' + mol + '\n');
    await expect(page.locator('#problemsBadge')).toHaveText('1 problem');
    await page.click('#problemsBadge');
    await expect(page.locator('.problems')).toContainText('Structure not drawn on slide 1');
    await expect(page.locator('.problems')).toContainText('Molfile broken');
});
