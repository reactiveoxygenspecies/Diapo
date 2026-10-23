// Editing on the canvas and in the panel: selection, insert, lists and tables, text, pictures, charts, guides, the palette, the panel itself.
// Run with: npx playwright test   (from the deck-editor folder)
const { test, expect, fs, path, freshDeckEachTest, DECK, DECK_DIR, centre, drag, goTo, near, openDeck, own, readDeck, save, scale, slack, stagePoint, stageRect } = require('./helpers');

freshDeckEachTest();

/* ------------------------------------------------------------
   13. Align and distribute
   ------------------------------------------------------------ */
test('13 align: to the selection box, to the slide, and distribute with equal gaps', async ({ page }) => {
    await openDeck(page);
    await goTo(page, 2);
    const rects = () => page.evaluate(() => Array.from(window.deckEditor.deck.doc.querySelectorAll('li')).map(li => { const r = window.deckEditor.deck.stageRect(li); return { x: Math.round(r.x), r: Math.round(r.x + r.w), y: Math.round(r.y), b: Math.round(r.y + r.h), cx: Math.round(r.x + r.w / 2) }; }));
    // Spread the three list items so they differ, then align their right edges to the widest.
    await page.evaluate(() => { const a = window.deckEditor; const lis = a.deck.doc.querySelectorAll('li'); a.selection.select(lis[1]); a.selection.nudge(120, 0); a.selection.select(lis[2]); a.selection.nudge(40, 60); a.selection.set(Array.from(lis)); });
    const before = await rects();
    const rightMost = Math.max(...before.map(r => r.r));
    await page.click('[data-align="right"]');
    expect((await rects()).map(r => r.r)).toEqual([rightMost, rightMost, rightMost]);
    expect(await page.evaluate(() => window.deckEditor.history.top.label)).toBe('Align right');
    // Distribute vertically: equal gaps, first and last unchanged.
    await page.click('[data-distribute="y"]');
    const after = (await rects()).sort((p, q) => p.y - q.y);
    expect(after[0].y).toBe(Math.min(...before.map(r => r.y)));
    expect(Math.abs((after[1].y - after[0].b) - (after[2].y - after[1].b))).toBeLessThanOrEqual(1);
    // To the slide: horizontal centres at 960.
    await page.check('#inspAlignSlide');
    await page.click('[data-align="centre"]');
    expect((await rects()).map(r => r.cx)).toEqual([960, 960, 960]);
    // A single element always aligns to the slide.
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('.slide.active h2')));
    await page.click('[data-align="bottom"]');
    expect(await page.evaluate(() => { const r = window.deckEditor.deck.stageRect(window.deckEditor.deck.doc.querySelector('.slide.active h2')); return Math.round(r.y + r.h); })).toBe(1080);
    // Every step undoes; the file is untouched.
    await page.evaluate(() => { const h = window.deckEditor.history; while (h.canUndo) h.undo(); });
    expect(await page.evaluate(() => window.deckEditor.deck.serialize({ isEdited: () => false }) === window.deckEditor.deck.source)).toBe(true);
});

/* ------------------------------------------------------------
   21. Slide layouts and image placeholders
   ------------------------------------------------------------ */
test('21 layouts: the picker adds a laid-out slide; placeholders show only while editing and take a picture', async ({ page }) => {
    await openDeck(page);
    // The + button opens the picker with one tile per layout; a tile adds the slide after the current one.
    await page.click('#btnAddSlide');
    await expect(page.locator('.layout-picker')).toBeVisible();
    const tiles = await page.locator('.layout-tile').count();
    expect(tiles).toBeGreaterThanOrEqual(10);
    await page.click('.layout-tile[data-layout="title-bullets"]');
    await expect(page.locator('.layout-picker')).toHaveCount(0);
    await page.waitForTimeout(600);
    const built = await page.evaluate(() => {
        const d = window.deckEditor.deck, s = d.currentSlide;
        return { index: d.current, h2: s.querySelector('h2') && s.querySelector('h2').textContent, items: s.querySelectorAll('ul > li').length, group: s.querySelector('ul').hasAttribute('data-group'),
                 h2px: parseFloat(d.win.getComputedStyle(s.querySelector('h2')).fontSize), lipx: parseFloat(d.win.getComputedStyle(s.querySelector('li')).fontSize) };
    });
    expect(built.index).toBe(1);
    expect(built.h2).toBe('Slide title');
    expect(built.items).toBe(3);
    expect(built.group).toBe(true);
    expect(built.h2px).toBeGreaterThanOrEqual(40);            // stage-sized type, from the deck's CSS or the fallback
    expect(built.lipx).toBeGreaterThanOrEqual(30);
    // Esc closes the picker without adding; Ctrl+Shift+M adds a blank slide directly.
    await page.keyboard.press('Control+m');
    await expect(page.locator('.layout-picker')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.layout-picker')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+m');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.deckEditor.deck.slides.length)).toBe(5);
    expect(await page.evaluate(() => window.deckEditor.deck.currentSlide.children.length)).toBe(0);

    // An image placeholder: visible while editing, display:none in the file, replaced by an <img> in the same box.
    await page.evaluate(() => window.deckEditor.strip.addSlide(2, 'title-image'));
    await page.waitForTimeout(400);
    const ph = await page.evaluate(() => {
        const d = window.deckEditor.deck, p = d.currentSlide.querySelector('[data-placeholder]');
        return { display: d.win.getComputedStyle(p).display, inline: p.style.display, left: p.style.left, width: p.style.width };
    });
    expect(ph.display).toBe('flex');
    expect(ph.inline).toBe('none');
    await page.evaluate(() => { const s = window.deckEditor.deck.currentSlide; window.deckEditor.insert.fillPlaceholder(s.querySelector('[data-placeholder]'), 'assets/shape.svg', 'shape'); });
    const img = await page.evaluate(() => { const s = window.deckEditor.deck.currentSlide; const i = s.querySelector('img'); return { n: s.querySelectorAll('[data-placeholder]').length, left: i.style.left, width: i.style.width, fit: i.style.objectFit, src: i.getAttribute('src') }; });
    expect(img.n).toBe(0);
    expect(img.left).toBe(ph.left);
    expect(img.width).toBe(ph.width);
    expect(img.fit).toBe('cover');
    expect(img.src).toBe('assets/shape.svg');
    // Undo puts the placeholder back in one step; the slides survive a save and reload.
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.deckEditor.deck.currentSlide.querySelectorAll('[data-placeholder]').length)).toBe(1);
    await save(page);
    const saved = readDeck();
    expect(saved).toContain('data-placeholder="image"');
    expect(saved).toMatch(/<ul (data-group style="[^"]*"|style="[^"]*" data-group)><li data-edit>First point<\/li>/);   // Firefox writes style first
    await openDeck(page);
    expect(await page.evaluate(() => window.deckEditor.deck.slides.length)).toBe(6);
});

/* ------------------------------------------------------------
   22. Insert library: lists, tables, code, shapes, embeds
   ------------------------------------------------------------ */
test('22 insert: lists edit as a whole, tables cell by cell with Tab, code keeps its colours, shapes and embeds are inline', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => window.deckEditor.strip.addSlide(0, 'blank'));
    await page.waitForTimeout(400);

    // List: a double-click on an item edits the whole list, Enter makes a new item.
    await page.evaluate(() => { const ul = window.deckEditor.insert.list(); ul.style.left = '100px'; ul.style.top = '100px'; window.deckEditor.selection.clear(); });
    await page.waitForTimeout(300);
    let c = await centre(page, 'ul li:nth-child(2)');
    await page.mouse.dblclick(c.x, c.y);
    await page.waitForFunction(() => window.deckEditor.textEdit.active);
    expect(await page.evaluate(() => window.deckEditor.textEdit.el.tagName)).toBe('UL');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Fourth point');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => Array.from(window.deckEditor.deck.currentSlide.querySelectorAll('ul li')).map(l => l.textContent))).toEqual(['First point', 'Second point', 'Fourth point', 'Third point']);

    // Table: the cell under the double-click is edited; Tab moves on; Tab past the last cell adds a row.
    await page.evaluate(() => { const t = window.deckEditor.insert.table(); t.style.left = '100px'; t.style.top = '400px'; window.deckEditor.selection.clear(); });
    await page.waitForTimeout(300);
    c = await centre(page, 'table tr:nth-child(2) td:nth-child(2)');
    await page.mouse.dblclick(c.x, c.y);
    await page.waitForFunction(() => window.deckEditor.textEdit.active);
    expect(await page.evaluate(() => { const e = window.deckEditor.textEdit.el; return e.tagName + ':' + Array.from(e.parentNode.children).indexOf(e); })).toBe('TD:1');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('B2');
    await page.keyboard.press('Tab');
    await page.keyboard.type('B3');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');      // through the last row and past its end
    await page.waitForTimeout(200);
    const table = await page.evaluate(() => { const t = window.deckEditor.deck.doc.querySelector('table'); return { rows: t.querySelectorAll('tr').length, b2: t.querySelector('tr:nth-child(2) td:nth-child(2)').textContent, b3: t.querySelector('tr:nth-child(2) td:nth-child(3)').textContent, editing: window.deckEditor.textEdit.el && window.deckEditor.textEdit.el.parentNode.rowIndex }; });
    expect(table.rows).toBe(4);
    expect(table.b2).toBe('B2');
    expect(table.b3).toBe('B3');
    expect(table.editing).toBe(3);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const t = window.deckEditor.deck.doc.querySelector('table'); window.deckEditor.insert.tableAddColumn(t); window.deckEditor.insert.tableRemoveRow(t); });
    expect(await page.evaluate(() => { const t = window.deckEditor.deck.doc.querySelector('table'); return [t.querySelectorAll('tr').length, t.querySelector('tr').children.length]; })).toEqual([3, 4]);

    // Code: coloured spans, re-coloured after an edit, newlines kept as text.
    await page.evaluate(() => { const p = window.deckEditor.insert.code('let x = 1; // one'); p.style.left = '1000px'; p.style.top = '100px'; window.deckEditor.selection.clear(); });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('code').innerHTML)).toMatch(/<span style="color:#82aaff">let<\/span> x = <span style="color:#f78c6c">1<\/span>; <span style="color:#8a8f9c;font-style:italic">\/\/ one<\/span>/);
    c = await centre(page, 'pre');
    await page.mouse.dblclick(c.x, c.y);
    await page.waitForFunction(() => window.deckEditor.textEdit.active);
    expect(await page.evaluate(() => window.deckEditor.textEdit.el.tagName)).toBe('CODE');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('return "two"');
    await page.keyboard.press('Escape');
    const code = await page.evaluate(() => { const c = window.deckEditor.deck.doc.querySelector('code'); return { text: c.textContent, html: c.innerHTML }; });
    expect(code.text).toBe('let x = 1; // one\nreturn "two"');
    expect(code.html).toContain('<span style="color:#c3e88d">"two"</span>');

    // Shapes and embeds.
    const rest = await page.evaluate(() => {
        const ed = window.deckEditor;
        const star = ed.insert.shape('star'), em = ed.insert.embed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1'), vid = ed.insert.video('assets/clip.mp4');
        return { star: star.outerHTML, embed: em.getAttribute('src'), video: vid.outerHTML };
    });
    expect(rest.star.replace(/ (style="[^"]*") (data-id="[^"]*")/, ' $2 $1'))   // Firefox writes style first
        .toMatch(/<svg viewBox="0 0 100 100" preserveAspectRatio="none" data-id="el-\d+" style="[^"]*color: var\(--accent\)[^"]*"><path d="[^"]+" fill="currentColor"><\/path><\/svg>/);   // every insert has a data-id (auto-animate)
    expect(rest.embed).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(rest.video).toMatch(/<video src="assets\/clip.mp4" controls="" playsinline="" preload="metadata"/);

    // Everything survives a save with no editor residue.
    await save(page);
    const saved = readDeck().replace(/ (style="[^"]*")((?: [\w-]+(?:="[^"]*")?)+)>/g, '$2 $1>');   // Firefox writes style first
    expect(saved).not.toContain('contenteditable=');
    expect(saved).toMatch(/<table data-group data-id="el-\d+" style="[^"]*"><tr><th data-edit style="[^"]*">Column 1<\/th>/);
    expect(saved).toMatch(/<pre data-group data-id="el-\d+" style="[^"]*"><code data-edit data-code>/);
    expect(saved).toContain('<video src="assets/clip.mp4" controls playsinline preload="metadata"');
    expect(saved).toContain('src="https://www.youtube.com/embed/dQw4w9WgXcQ"');
});

/* ------------------------------------------------------------
   23. Clipboard, delete, layer order, group / ungroup, element menu
   ------------------------------------------------------------ */
test('23 edit ops: copy and paste across slides, delete for real, layer steps, group and ungroup keep positions', async ({ page, context }) => {
    if (test.info().project.name === 'chrome') await context.grantPermissions(['clipboard-read', 'clipboard-write']);   // Firefox has no such permissions
    await openDeck(page);
    // Copy the heading with Ctrl+C, paste it onto slide 3 with Ctrl+V: same markup, no id, top of the slide's order.
    const c = await centre(page, 'h1');
    await page.mouse.click(c.x, c.y);
    await page.waitForFunction(() => window.deckEditor.selection.items.length === 1);
    await page.keyboard.press('Control+c');
    await expect(page.locator('.toast')).toContainText('Copied');
    await goTo(page, 2);
    const before = await page.evaluate(() => window.deckEditor.deck.currentSlide.children.length);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(400);
    const pasted = await page.evaluate(() => { const s = window.deckEditor.deck.currentSlide; const last = s.lastElementChild; return { n: s.children.length, tag: last.tagName, text: last.textContent, selected: window.deckEditor.selection.primary === last, id: last.id }; });
    expect(pasted.n).toBe(before + 1);
    expect(pasted.tag).toBe('H1');
    expect(pasted.text).toBe('Sample deck title');
    expect(pasted.selected).toBe(true);
    expect(pasted.id).toBe('');
    // Pasting again on the same slide as the copy steps the copy aside.
    await goTo(page, 0);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(400);
    const stepped = await page.evaluate(() => { const s = window.deckEditor.deck.currentSlide; const h = s.querySelectorAll('h1'); return { n: h.length, style: h[1].getAttribute('style') }; });
    expect(stepped.n).toBe(2);
    expect(stepped.style).toMatch(/--dx: 24px; --dy: 24px/);
    // Text from elsewhere becomes a text box.
    await page.evaluate(() => window.deckEditor.editops.paste({ files: [], getData: (t) => t === 'text/plain' ? 'Pasted words' : '' }));
    expect(await page.evaluate(() => window.deckEditor.selection.primary.textContent)).toBe('Pasted words');
    // Delete removes for real (Hide is the old behaviour, still in the panel); undo brings it back.
    const count = await page.evaluate(() => window.deckEditor.deck.currentSlide.children.length);
    await page.keyboard.press('Delete');
    expect(await page.evaluate(() => window.deckEditor.deck.currentSlide.children.length)).toBe(count - 1);
    expect(await page.evaluate(() => window.deckEditor.deck.currentSlide.querySelectorAll('[data-hidden]').length)).toBe(0);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.deckEditor.deck.currentSlide.children.length)).toBe(count);
    // Cut then paste moves an element to another slide.
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.currentSlide.querySelectorAll('h1')[1]));
    await page.keyboard.press('Control+x');
    expect(await page.evaluate(() => window.deckEditor.deck.currentSlide.querySelectorAll('h1').length)).toBe(1);
    await goTo(page, 1);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.deckEditor.deck.currentSlide.querySelectorAll('h1').length)).toBe(1);

    // Layer order among free elements is document order: forward / backward step by one, front / back go past all;
    // z-index is only written when a sibling already has one.
    await page.evaluate(() => { const ed = window.deckEditor; ed.strip.addSlide(1, 'blank'); });
    await page.waitForTimeout(400);
    const order = () => page.evaluate(() => Array.from(window.deckEditor.deck.currentSlide.children).map(e => (e.tagName === 'DIV' ? (e.style.borderRadius ? 'ellipse' : 'rect') : 'star') + (e.style.zIndex ? ':' + e.style.zIndex : '')));
    await page.evaluate(() => { const ed = window.deckEditor; ed.insert.rect(); ed.insert.rect(true); ed.insert.shape('star'); ed.selection.select(ed.deck.currentSlide.children[0]); });
    await page.keyboard.press('Control+BracketRight');                 // past the ellipse only
    expect(await order()).toEqual(['ellipse', 'rect', 'star']);
    await page.keyboard.press('Control+BracketRight');                 // past the star
    expect(await order()).toEqual(['ellipse', 'star', 'rect']);
    await page.keyboard.press('Control+BracketLeft');
    expect(await order()).toEqual(['ellipse', 'rect', 'star']);
    await page.keyboard.press('Control+Shift+BracketLeft');            // to the back
    expect(await order()).toEqual(['rect', 'ellipse', 'star']);
    await page.evaluate(() => { const ed = window.deckEditor; const star = ed.deck.currentSlide.children[2]; star.style.zIndex = '5'; ed.selection.select(ed.deck.currentSlide.children[0]); });
    await page.keyboard.press('Control+Shift+BracketRight');           // a sibling has a z-index: go above it with one
    expect(await order()).toEqual(['rect:6', 'ellipse', 'star:5']);
    // Under a sibling at z 0 is never a negative z-index (that would paint behind the parent's
    // background): the element takes z 0 and an earlier place in the document instead.
    await page.keyboard.press('Control+Shift+BracketLeft');            // rect:6 to the back, under ellipse (z 0)
    expect(await order()).toEqual(['rect:0', 'ellipse', 'star:5']);
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.children[2]); });
    await page.keyboard.press('Control+BracketLeft');                  // star:5 one step down: under ellipse (z 0), above rect:0
    expect(await order()).toEqual(['rect:0', 'star:0', 'ellipse']);
    expect(await page.evaluate(() => Array.from(window.deckEditor.deck.currentSlide.children).some(e => parseInt(e.style.zIndex, 10) < 0))).toBe(false);
    await page.keyboard.press('Control+z');                            // each was one undo step
    await page.keyboard.press('Control+z');
    expect(await order()).toEqual(['rect:6', 'ellipse', 'star:5']);
    await page.evaluate(() => { const ed = window.deckEditor; ed.deck.currentSlide.children[2].style.zIndex = ''; ed.deck.currentSlide.children[0].style.zIndex = ''; });

    // Group two shapes: one wrapper sized to their box, children keep their place on the stage; ungroup restores.
    const rectsBefore = await page.evaluate(() => Array.from(window.deckEditor.deck.currentSlide.children).slice(0, 2).map(e => window.deckEditor.deck.stageRect(e)));
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.set(Array.from(ed.deck.currentSlide.children).slice(0, 2)); });
    await page.keyboard.press('Control+g');
    const grouped = await page.evaluate(() => { const ed = window.deckEditor; const g = ed.selection.primary; return { tag: g.tagName, group: g.hasAttribute('data-group'), kids: g.children.length, rect: ed.deck.stageRect(g), kidRects: Array.from(g.children).map(e => ed.deck.stageRect(e)), slideKids: ed.deck.currentSlide.children.length }; });
    expect(grouped.tag).toBe('DIV');
    expect(grouped.group).toBe(true);
    expect(grouped.kids).toBe(2);
    expect(grouped.slideKids).toBe(2);
    for (let i = 0; i < 2; i++) for (const k of ['x', 'y', 'w', 'h']) expect(Math.abs(grouped.kidRects[i][k] - rectsBefore[i][k])).toBeLessThan(1);
    expect(Math.abs(grouped.rect.x - Math.min(rectsBefore[0].x, rectsBefore[1].x))).toBeLessThan(1);
    // The group moves as one.
    await page.evaluate(() => window.deckEditor.selection.nudge(10, 0));
    const moved = await page.evaluate(() => Array.from(window.deckEditor.selection.primary.children).map(e => window.deckEditor.deck.stageRect(e)));
    expect(Math.abs(moved[0].x - rectsBefore[0].x - 10)).toBeLessThan(1);
    // Ctrl+click picks a member out of the group; a plain drag on it then moves that member alone
    // (a plain click would pick the group, but a selection inside the pick stays the target).
    const er = await stageRect(page, '[data-group] > div:nth-child(2)');
    const ec = await stagePoint(page, er.x + er.w * 0.12, er.y + er.h * 0.5);      // on the ellipse, clear of the star over its middle
    await page.keyboard.down('Control');
    await page.mouse.click(ec.x, ec.y);
    await page.keyboard.up('Control');
    expect(await page.evaluate(() => { const ed = window.deckEditor; return ed.selection.single === ed.deck.currentSlide.querySelector('[data-group] > div:nth-child(2)'); })).toBe(true);
    const kk = await page.evaluate(() => window.deckEditor.deck.scale);
    await drag(page, ec, { x: ec.x + 60 * kk, y: ec.y }, { ctrl: true });     // Ctrl: no snapping (a line lies about 14 px past)
    const solo = await page.evaluate(() => { const ed = window.deckEditor; const g = ed.deck.currentSlide.querySelector('[data-group]'); return { sel: ed.selection.single === g.children[1], rects: Array.from(g.children).map(e => ed.deck.stageRect(e)), groups: ed.deck.currentSlide.querySelectorAll('[data-group]').length }; });
    expect(solo.sel).toBe(true);
    expect(solo.groups).toBe(1);
    expect(Math.abs(solo.rects[0].x - moved[0].x)).toBeLessThan(1);
    expect(Math.abs(solo.rects[1].x - moved[1].x - 60)).toBeLessThan(2);
    await page.keyboard.press('Control+z');
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.querySelector('[data-group]')); });
    // A look the deck's CSS gives the members through the group (`.stack .card { ... }`) stays
    // with them when they leave it: what changed is written inline, nothing else is.
    await page.evaluate(() => { const d = window.deckEditor.deck.doc; const st = d.createElement('style'); st.id = 'tst-look'; st.textContent = '[data-group] > div { letter-spacing: 3px; }'; d.head.appendChild(st); });
    await page.keyboard.press('Control+Shift+g');
    const un = await page.evaluate(() => { const ed = window.deckEditor; const w = ed.deck.win; return { n: ed.selection.items.length, groups: ed.deck.currentSlide.querySelectorAll('[data-group]').length, rects: ed.selection.items.map(e => ed.deck.stageRect(e)), slideKids: ed.deck.currentSlide.children.length, look: ed.selection.items.map(e => [w.getComputedStyle(e).letterSpacing, e.style.letterSpacing, e.style.color]) }; });
    expect(un.n).toBe(2);
    expect(un.groups).toBe(0);
    expect(un.slideKids).toBe(3);
    expect(Math.abs(un.rects[0].x - rectsBefore[0].x - 10)).toBeLessThan(1);
    expect(Math.abs(un.rects[1].y - rectsBefore[1].y)).toBeLessThan(1);
    expect(un.look).toEqual([['3px', '3px', ''], ['3px', '3px', '']]);
    // One undo step each way (the inline look goes with it).
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.deckEditor.deck.currentSlide.querySelectorAll('[data-group]').length)).toBe(1);
    expect(await page.evaluate(() => Array.from(window.deckEditor.deck.currentSlide.querySelector('[data-group]').children).map(e => e.style.letterSpacing))).toEqual(['', '']);
    await page.evaluate(() => window.deckEditor.deck.doc.getElementById('tst-look').remove());

    // The element menu: right-click selects and lists the actions; Delete from it works.
    const star = await centre(page, '.slide.active > svg');
    await page.mouse.click(star.x, star.y, { button: 'right' });
    await expect(page.locator('.el-menu')).toBeVisible();
    expect(await page.evaluate(() => window.deckEditor.selection.primary.tagName)).toBe('svg');
    expect(await page.locator('.el-menu button[data-a="ungroup"]').isDisabled()).toBe(true);
    await page.click('.el-menu button[data-a="delete"]');
    await expect(page.locator('.el-menu')).toHaveCount(0);
    expect(await page.evaluate(() => window.deckEditor.deck.currentSlide.querySelectorAll('svg').length)).toBe(0);
    // Right-click on empty canvas: the slide menu.
    const empty = await stagePoint(page, 1800, 1000);
    await page.mouse.click(empty.x, empty.y, { button: 'right' });
    await expect(page.locator('.el-menu button[data-a="newslide"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.el-menu')).toHaveCount(0);
});

/* ------------------------------------------------------------
   26. Panels, Theme panel and Esc, drafts that go away on undo
   ------------------------------------------------------------ */
test('26 panels: side panels hide, show and resize; Esc leaves the Theme panel; a draft is dropped when undo returns to the saved state', async ({ page }) => {
    await openDeck(page);
    // The browser's own context menu is kept off the editor's chrome and the canvas (the deck document too); fields keep it.
    const menuAllowed = (sel, inDeck = false) => page.evaluate(([sel, inDeck]) => { const d = inDeck ? window.deckEditor.deck.doc : document; const el = d.querySelector(sel); const e = new (inDeck ? window.deckEditor.deck.win : window).MouseEvent('contextmenu', { bubbles: true, cancelable: true }); el.dispatchEvent(e); return !e.defaultPrevented; }, [sel, inDeck]);
    expect(await menuAllowed('#btnSave')).toBe(false);
    expect(await menuAllowed('.deck-stage', true)).toBe(false);
    expect(await menuAllowed('#inspNotes')).toBe(true);
    const cols = () => page.evaluate(() => getComputedStyle(document.getElementById('workspace')).gridTemplateColumns.split(' ').map(v => Math.round(parseFloat(v))));
    const before = await cols();
    expect(before[0]).toBe(220);
    expect(before[2]).toBe(300);
    // Toggle buttons in the status bar, and Ctrl+\ for both.
    await page.click('#btnTogglePanel');
    expect((await cols())[2]).toBe(0);
    await expect(page.locator('#inspector')).toBeHidden();
    await page.click('#btnTogglePanel');
    expect((await cols())[2]).toBe(300);
    await page.keyboard.press('Control+Backslash');
    expect(await cols()).toEqual([0, 1400, 0]);
    await page.keyboard.press('Control+Backslash');
    expect((await cols())[0]).toBe(220);
    // Drag the strip's edge 80px to the right; the thumbnails follow; double-click resets.
    const sp = await page.locator('#strip .splitter').boundingBox();
    await page.mouse.move(sp.x + sp.width / 2, sp.y + 200);
    await page.mouse.down();
    await page.mouse.move(sp.x + sp.width / 2 + 80, sp.y + 200, { steps: 6 });
    await page.mouse.up();
    expect((await cols())[0]).toBe(300);
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('deck-editor-panels'))).stripW).toBe(300);
    await page.dblclick('#strip .splitter');
    expect((await cols())[0]).toBe(220);
    // The Theme panel widens the right column and closes on Esc; a focused field takes the first Esc.
    await page.keyboard.press('Control+t');
    await expect(page.locator('body')).toHaveClass(/theme-mode/);
    expect((await cols())[2]).toBe(400);
    await page.click('#themeBody input[type=text]');
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).toHaveClass(/theme-mode/);
    expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('INPUT');
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/theme-mode/);
    // Theme mode opens a hidden panel.
    await page.click('#btnTogglePanel');
    await page.keyboard.press('Control+t');
    await expect(page.locator('#inspector')).toBeVisible();
    await page.keyboard.press('Escape');
    // Drafts: an edit writes one after a moment; undoing back to the saved state removes it.
    const draft = path.join(DECK_DIR, '.deck-editor', 'index.html.~draft');
    await page.evaluate(() => window.deckEditor.strip.addSlide(0, 'blank'));
    await expect.poll(() => fs.existsSync(draft), { timeout: 5000 }).toBe(true);
    await page.keyboard.press('Control+z');
    await expect.poll(() => fs.existsSync(draft), { timeout: 5000 }).toBe(false);
    expect(await page.evaluate(() => window.deckEditor.dirty)).toBe(false);
});

/* ------------------------------------------------------------
   30. Labels inside inline SVG
   ------------------------------------------------------------ */
test('30 svg text: a label in an inlined SVG is edited in a box over it, lines map to tspans, and the edit is undoable and saved', async ({ page }) => {
    await openDeck(page);
    await goTo(page, 1);
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('[data-svg] svg text'));
    // Double-click on the label opens the box with the two lines; typing changes the SVG live.
    const c = await centre(page, '[data-svg] svg text');
    await page.mouse.dblclick(c.x, c.y);
    await page.waitForFunction(() => window.deckEditor.textEdit.active);
    await expect(page.locator('.svgtext-edit')).toBeVisible();
    expect(await page.locator('.svgtext-edit').inputValue()).toBe('Box\nlabel');
    const box = await page.locator('.svgtext-edit').evaluate(ta => ({ font: ta.style.font, color: ta.style.color }));
    expect(box.font).toContain('Arial');
    expect(box.color).toBe('rgb(28, 28, 31)');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('New');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('[data-svg] svg text').textContent)).toBe('New');
    await page.keyboard.press('Enter');
    await page.keyboard.type('name');
    await page.keyboard.press('Enter');
    await page.keyboard.type('three');
    await page.keyboard.press('Escape');
    await expect(page.locator('.svgtext-edit')).toHaveCount(0);
    const spans = () => page.evaluate(() => Array.from(window.deckEditor.deck.doc.querySelectorAll('[data-svg] svg text tspan')).map(t => t.textContent + '@' + t.getAttribute('x') + '/' + t.getAttribute('dy')));
    expect(await spans()).toEqual(['New@150/0', 'name@150/1.2em', 'three@150/1.2em']);
    // One undo step brings the old label back; redo the new one.
    await page.keyboard.press('Control+z');
    expect(await spans()).toEqual(['Box@150/0', 'label@150/1.2em']);
    await page.keyboard.press('Control+y');
    expect(await spans()).toEqual(['New@150/0', 'name@150/1.2em', 'three@150/1.2em']);
    // The exact element (Ctrl+click / Enter) works too, and the edit keeps the SVG inline in the file.
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('[data-svg] svg text tspan')));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.deckEditor.textEdit.active);
    await page.keyboard.press('Escape');
    await save(page);
    const saved = readDeck();
    expect(saved).toMatch(/data-svg="assets\/shape.svg">\s*<svg/);
    expect(saved).toContain('<tspan x="150" dy="1.2em">three</tspan>');
});

/* ------------------------------------------------------------
   33. Copies of elements the deck lays out in flow do not reflow anything
   ------------------------------------------------------------ */
test('33 copies in flow: Alt+drag, Ctrl+D and paste of a flex-column heading leave the original and its neighbours in place', async ({ page }) => {
    await openDeck(page);
    const R = (sel) => page.evaluate((s) => { const d = window.deckEditor.deck; const r = d.stageRect(d.doc.querySelector(s)); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w) }; }, sel);
    const h1 = await R('h1'), sub = await R('p.sub');
    expect(await page.evaluate(() => window.deckEditor.deck.win.getComputedStyle(window.deckEditor.deck.doc.querySelector('h1')).position)).toBe('static');
    // Alt+drag by (300, 120): the copy is where the original was plus the drag; nothing else moved.
    const k = await scale(page);
    const c = await centre(page, 'h1');
    await drag(page, c, { x: c.x + 300 * k, y: c.y + 120 * k }, { alt: true });
    await page.waitForTimeout(900);
    const copies = () => page.evaluate(() => { const d = window.deckEditor.deck; return Array.from(d.doc.querySelectorAll('h1')).map(h => { const r = d.stageRect(h); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), pos: d.win.getComputedStyle(h).position }; }); });
    let hs = await copies();
    expect(hs.length).toBe(2);
    expect(hs[0]).toEqual({ ...h1, pos: 'static' });
    expect(Math.abs(hs[1].x - (h1.x + 300))).toBeLessThanOrEqual(2);
    expect(Math.abs(hs[1].y - (h1.y + 120))).toBeLessThanOrEqual(2);
    expect(hs[1].w).toBe(h1.w);
    expect(hs[1].pos).toBe('absolute');
    expect(await R('p.sub')).toEqual(sub);
    await page.keyboard.press('Control+z');
    expect((await copies()).length).toBe(1);
    expect(await R('h1')).toEqual(h1);
    // Ctrl+D: the copy sits 24px down and right of the original, the original and the subtitle stay.
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('h1')));
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(900);
    hs = await copies();
    expect(hs[0]).toEqual({ ...h1, pos: 'static' });
    expect(hs[1]).toEqual({ x: h1.x + 24, y: h1.y + 24, w: h1.w, pos: 'absolute' });
    expect(await R('p.sub')).toEqual(sub);
    await page.keyboard.press('Control+z');
    // Paste on another slide lands at the same stage position.
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('h1')));
    await page.keyboard.press('Control+c');
    await goTo(page, 2);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(900);
    const pasted = await page.evaluate(() => { const d = window.deckEditor.deck; const p = d.selection ? null : window.deckEditor.selection.primary; const r = d.stageRect(p); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), parent: p.parentElement.classList.contains('slide') }; });
    expect(pasted).toEqual({ x: h1.x, y: h1.y, w: h1.w, parent: true });
});

test('40 icons: the Font Awesome picker inserts an inline svg that recolours through the panel and saves with its attribution', async ({ page }) => {
    await openDeck(page);
    await page.click('#btnInsert');
    await page.click('[data-insert="fa"]');
    await expect(page.locator('.iconpick')).toBeVisible();
    await expect(page.locator('.iconpick-grid button').first()).toBeVisible({ timeout: 15000 });   // the catalog loaded
    await page.fill('.iconpick-search', 'rocket');
    await expect(page.locator('.iconpick-grid button').first()).toHaveAttribute('title', 'Rocket (rocket)');
    await page.click('.iconpick-tabs [data-style="b"]');
    await page.fill('.iconpick-search', 'github');
    await expect(page.locator('.iconpick-grid button').first()).toHaveAttribute('title', /Github/i);
    await page.click('.iconpick-tabs [data-style="s"]');
    await page.fill('.iconpick-search', 'rocket');
    await page.locator('.iconpick-grid button').first().click();
    await expect(page.locator('.iconpick')).toBeHidden();
    const info = await page.evaluate(() => { const d = window.deckEditor.deck, el = window.deckEditor.selection.primary; return { tag: el.tagName, fa: el.getAttribute('data-fa'), fill: d.win.getComputedStyle(el.querySelector('path')).fill, role: document.getElementById('inspRole').textContent }; });
    expect(info.tag).toBe('svg');
    expect(info.fa).toBe('solid/rocket');
    expect(info.role).toBe('');                                   // nothing to flag: not locked, not on every slide
    await page.fill('#inspHex', '#ff00aa');
    await page.locator('#inspHex').dispatchEvent('change');
    expect(await page.evaluate(() => { const d = window.deckEditor.deck, el = window.deckEditor.selection.primary; return d.win.getComputedStyle(el.querySelector('path')).fill; })).toBe('rgb(255, 0, 170)');
    await save(page);
    const saved = readDeck();
    expect(saved).toMatch(/<svg viewBox="0 0 512 512" data-fa="solid\/rocket"[^>]*><!--!Font Awesome Free [\d.]+ by @fontawesome[^>]*--><path fill="currentColor" d="M/);
    expect(saved).not.toContain('fontawesome.json');
    // Reopen: still one icon, still recoloured; undo of the insert removes it.
    await openDeck(page);
    expect(await page.evaluate(() => Array.from(window.deckEditor.deck.doc.querySelectorAll('[data-fa]')).map(e => e.style.color))).toEqual(['rgb(255, 0, 170)']);
});

test('41 panels and canvas: paste lands in a focused field, the wheel steps a number field, the middle button grabs the view, Ctrl+wheel zooms at the pointer', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => { const d = window.deckEditor.deck; window.deckEditor.selection.select(d.doc.querySelector('.slide.active h1')); });
    // Paste: a colour code pasted into the hex field changes the field, not the slide.
    const before = await page.evaluate(() => window.deckEditor.deck.currentSlide.children.length);
    await page.focus('#inspHex');
    await page.evaluate(() => {
        const dt = new DataTransfer(); dt.setData('text/plain', '#12abef');
        const f = document.getElementById('inspHex'); f.value = '';
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        const handled = !f.dispatchEvent(ev);
        if (!handled) { f.value = '#12abef'; f.dispatchEvent(new Event('change', { bubbles: true })); }   // what the browser does when nobody intercepts
        window.__pasteIntercepted = handled;
    });
    expect(await page.evaluate(() => window.__pasteIntercepted)).toBe(false);
    expect(await page.evaluate(() => window.deckEditor.deck.currentSlide.children.length)).toBe(before);
    expect(await page.evaluate(() => window.deckEditor.deck.win.getComputedStyle(window.deckEditor.selection.primary).color)).toBe('rgb(18, 171, 239)');
    // Wheel over the focused Size field: one step per notch, ten with Shift, applied to the element.
    const size0 = +(await page.inputValue('#inspSize'));
    const box = await page.locator('#inspSize').boundingBox();
    await page.focus('#inspSize');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -100);
    expect(+(await page.inputValue('#inspSize'))).toBe(size0 + 1);
    await page.keyboard.down('Shift'); await page.mouse.wheel(0, 100); await page.keyboard.up('Shift');
    expect(+(await page.inputValue('#inspSize'))).toBe(size0 - 9);
    expect(await page.evaluate(() => window.deckEditor.selection.primary.style.fontSize)).toBe((size0 - 9) + 'px');
    // Wheel elsewhere in the panel with the field still focused scrolls as usual (the field keeps its value).
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.wheel(0, -100);
    expect(+(await page.inputValue('#inspSize'))).toBe(size0 - 9);
    // Middle button: the view moves with the mouse while it is held.
    await page.evaluate(() => window.deckEditor.setZoom(1.5));
    const c = () => page.evaluate(() => { const c = document.getElementById('canvas'); return [c.scrollLeft, c.scrollTop]; });
    const cb = await page.locator('#canvas').boundingBox();
    const [sx, sy] = await c();
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cb.x + cb.width / 2 - 120, cb.y + cb.height / 2 - 60, { steps: 4 });
    const [mx, my] = await c();
    near(mx - sx, 120, slack(), 'scrollLeft'); near(my - sy, 60, slack(), 'scrollTop');
    expect(await page.evaluate(() => document.getElementById('canvas').classList.contains('grabbing'))).toBe(true);
    await page.mouse.up({ button: 'middle' });
    expect(await page.evaluate(() => document.getElementById('canvas').classList.contains('grabbing'))).toBe(false);
    // Ctrl+wheel: the stage point under the pointer stays under the pointer.
    const at = { x: cb.x + cb.width * 0.3, y: cb.y + cb.height * 0.6 };
    const stagePt = () => page.evaluate(({ x, y }) => { const r = document.getElementById('stageWrap').getBoundingClientRect(); const z = window.deckEditor.zoom; return [Math.round((x - r.left) / z), Math.round((y - r.top) / z)]; }, at);
    const p0 = await stagePt();
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.deckEditor.zoom)).toBeGreaterThan(1.5);
    const p1 = await stagePt();
    expect(Math.abs(p1[0] - p0[0])).toBeLessThanOrEqual(2);
    expect(Math.abs(p1[1] - p0[1])).toBeLessThanOrEqual(2);
});

test('42 text formatting: superscript, subscript, strikethrough and code from the bar and the keyboard, cleared again, saved as tags', async ({ page }) => {
    await openDeck(page);
    const c = await centre(page, 'h1');
    await page.mouse.dblclick(c.x, c.y);
    await page.waitForFunction(() => window.deckEditor.textEdit.active);
    await expect(page.locator('.textbar [data-cmd="sup"]')).toBeVisible();
    // Type a formula: E = mc2 with the 2 superscript, H2O with the 2 subscript.
    await page.keyboard.press('End');
    await page.keyboard.type(' E = mc');
    await page.click('.textbar [data-cmd="sup"]');
    await expect(page.locator('.textbar [data-cmd="sup"]')).toHaveClass(/on/);
    await page.keyboard.type('2');
    await page.click('.textbar [data-cmd="sup"]');
    await expect(page.locator('.textbar [data-cmd="sup"]')).not.toHaveClass(/on/);
    await page.keyboard.type(' H');
    await page.keyboard.press('Control+=');                       // subscript from the keyboard
    await page.keyboard.type('2');
    await page.keyboard.press('Control+=');
    await page.keyboard.type('O ');
    // Strikethrough and code on selections.
    await page.keyboard.type('old');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Shift+End');                        // whole line selected; re-select just "old"
    await page.keyboard.press('End');
    await page.keyboard.down('Shift'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Shift');
    await page.keyboard.press('Control+Shift+X');
    await page.keyboard.press('End');
    await page.keyboard.press('Control+Shift+X');                 // off again before typing on
    await page.keyboard.type(' run()');
    await page.keyboard.down('Shift'); for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Shift');
    await page.click('.textbar [data-cmd="code"]');
    await expect(page.locator('.textbar [data-cmd="code"]')).toHaveClass(/on/);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.deckEditor.textEdit.active)).toBe(false);
    const html = await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').innerHTML);
    expect(html).toMatch(/mc<sup>2<\/sup>/);
    expect(html).toMatch(/H<sub>2<\/sub>O/);
    expect(html).toMatch(/<strike>old<\/strike>|<s>old<\/s>/);
    expect(html).toMatch(/<code>run\(\)<\/code>/);
    // Scripts are set at 65% of the text, the size word processors use (the browser's default is about 83%);
    // this fixture has no rule of its own, so the editor writes one into the override block.
    const sizes = await page.evaluate(() => { const d = window.deckEditor.deck, h = d.doc.querySelector('h1'); const f = (el) => parseFloat(d.win.getComputedStyle(el).fontSize); return { base: f(h), sup: f(h.querySelector('sup')), sub: f(h.querySelector('sub')), supAlign: d.win.getComputedStyle(h.querySelector('sup')).verticalAlign }; });
    expect(sizes.sup / sizes.base).toBeCloseTo(0.65, 2);
    expect(sizes.sub / sizes.base).toBeCloseTo(0.65, 2);
    expect(sizes.supAlign).toBe('super');
    await save(page);
    expect(readDeck()).toContain('mc<sup>2</sup>');
    expect(readDeck()).toContain('/* superscript and subscript (managed by the deck editor) */');
    // Clear formatting takes it all off again.
    await page.mouse.dblclick(c.x, c.y);
    await page.waitForFunction(() => window.deckEditor.textEdit.active);
    await page.keyboard.press('Control+a');
    await page.click('.textbar [data-cmd="clear"]');
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.deckEditor.textEdit.active)).toBe(false);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').innerHTML)).not.toMatch(/<(sup|sub|strike|s|code)>/);
    await save(page);
    expect(readDeck()).not.toContain('superscript and subscript (managed');   // no scripts left, no rule
    // A deck from the blank template has the rule in its own CSS: same sizes, nothing added to the override block.
    const r = await page.evaluate(() => window.deckEditor.api.newDeck('scripts-test/index.html'));
    await page.goto('/?file=' + r.file);
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('.slide.active.visible'));
    await page.evaluate(() => { const h = window.deckEditor.deck.doc.querySelector('h1'); h.innerHTML = 'E = mc<sup>2</sup>'; });
    const s2 = await page.evaluate(() => { const d = window.deckEditor.deck, h = d.doc.querySelector('h1'); const f = (el) => parseFloat(d.win.getComputedStyle(el).fontSize); return { ratio: f(h.querySelector('sup')) / f(h), managed: d.overridesText().includes('superscript and subscript') }; });
    expect(s2.ratio).toBeCloseTo(0.65, 2);
    expect(s2.managed).toBe(false);
    fs.rmSync(path.join(__dirname, '.tmp-workspace', 'scripts-test'), { recursive: true, force: true });
});

/* ------------------------------------------------------------
   45. Colour on part of a text, from the panel, while editing
   ------------------------------------------------------------ */
test('45 text colour: with part of the text selected, the panel colours that part only; the edit stays open; none takes it off; the whole element otherwise', async ({ page }) => {
    await openDeck(page);
    const c = await centre(page, 'h1');
    await page.mouse.dblclick(c.x, c.y);
    await page.waitForFunction(() => window.deckEditor.textEdit.active);
    // Select the last word ("title") with the keyboard, then click a theme swatch in the panel.
    await page.keyboard.press('End');
    await page.keyboard.down('Shift'); for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Shift');
    expect(await page.evaluate(() => window.deckEditor.deck.win.getSelection().toString())).toBe('title');
    await page.click('#inspColourTarget button[data-t="text"]');
    await page.click('#inspSwatches .insp-swatch:nth-child(2)');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => { const ed = window.deckEditor; const h = ed.deck.doc.querySelector('h1'); return { active: ed.textEdit.active, html: h.innerHTML, own: h.style.color, sel: ed.deck.win.getSelection().toString() }; });
    expect(after.active).toBe(true);                                           // the edit is still open
    expect(after.html).toMatch(/^Sample deck <span style="color: var\(--[a-z0-9-]+\);">title<\/span>$/);
    expect(after.own).toBe('');                                                // the element itself is untouched
    expect(after.sel).toBe('title');                                           // and the part is still selected
    // A second colour replaces the first in the same span; the hex field works too; none takes the colour off.
    await page.click('#inspSwatches .insp-swatch:nth-child(3)');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('h1 span').length)).toBe(1);
    await page.fill('#inspHex', '#ff0000');
    await page.locator('#inspHex').dispatchEvent('change');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').innerHTML)).toBe('Sample deck <span style="color: rgb(255, 0, 0);">title</span>');
    await page.click('#inspColour [data-act="nocolour"]');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').innerHTML)).toBe('Sample deck title');
    expect(await page.evaluate(() => window.deckEditor.textEdit.active)).toBe(true);
    // The part stays selected after none; coloured again and committed, it is saved with the span.
    expect(await page.evaluate(() => window.deckEditor.deck.win.getSelection().toString())).toBe('title');
    await page.click('#inspSwatches .insp-swatch:nth-child(2)');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.deckEditor.textEdit.active)).toBe(false);
    await save(page);
    expect(readDeck()).toMatch(/Sample deck <span style="color: var\(--[a-z0-9-]+\);">title<\/span><\/h1>/);
    // With just a caret (nothing selected), the panel colours the whole element as before, and the edit ends.
    await page.mouse.dblclick(c.x, c.y);
    await page.waitForFunction(() => window.deckEditor.textEdit.active);
    await page.keyboard.press('End');
    await page.click('#inspSwatches .insp-swatch:nth-child(4)');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.deckEditor.textEdit.active)).toBe(false);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').style.color)).toMatch(/^var\(--/);
});

/* ------------------------------------------------------------
   47. Lock, and alt text
   ------------------------------------------------------------ */
test('47 lock and alt: a locked element is passed by, cannot be moved, Ctrl+click reaches it; alt text goes on pictures and icons', async ({ page }) => {
    await openDeck(page);
    // A rectangle over the heading, locked: a click where both are lands on the heading; a marquee round it leaves it out.
    await page.evaluate(() => { const ed = window.deckEditor; const r = ed.insert.rect(); r.style.left = '0px'; r.style.top = '0px'; r.style.width = '1920px'; r.style.height = '1080px'; r.style.opacity = '0.3'; });
    await page.waitForTimeout(200);
    await page.click('#inspLock');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.deckEditor.selection.single.hasAttribute('data-locked'))).toBe(true);
    expect(await page.evaluate(() => document.getElementById('inspLock').textContent)).toBe('Unlock');
    expect(await page.evaluate(() => document.getElementById('inspRole').textContent)).toContain('locked');
    expect(await page.evaluate(() => document.querySelector('.ov-main').dataset.mode)).toBe('locked');
    const c = await centre(page, 'h1');
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.deckEditor.selection.single.tagName)).toBe('H1');
    const rr = await stageRect(page, '.slide.active > div[data-id]');
    const a = await stagePoint(page, 5, 5), b = await stagePoint(page, 1915, 1075);
    await drag(page, a, b);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.deckEditor.selection.items.some(e => e.hasAttribute('data-locked')))).toBe(false);
    expect(await page.evaluate(() => window.deckEditor.selection.items.length)).toBeGreaterThan(0);
    // Ctrl+click reaches it; a Ctrl+drag on it moves nothing (a plain press passes through to what is under it); arrows move nothing.
    const p = await stagePoint(page, 1800, 1000);
    await page.keyboard.down('Control'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.deckEditor.selection.single.hasAttribute('data-locked'))).toBe(true);
    const k = await scale(page);
    await drag(page, p, { x: p.x + 100 * k, y: p.y + 50 * k }, { ctrl: true });
    await page.keyboard.press('ArrowRight');
    const rr2 = await stageRect(page, '.slide.active > div[data-id]');
    expect(Math.abs(rr2.x - rr.x)).toBeLessThan(1); expect(Math.abs(rr2.y - rr.y)).toBeLessThan(1);
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('.ov-h')).every(h => getComputedStyle(h).display === 'none'))).toBe(true);
    await page.click('#inspLock');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.deckEditor.selection.single.hasAttribute('data-locked'))).toBe(false);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('.slide.active > div[data-id]').hasAttribute('data-locked'))).toBe(true);
    await page.evaluate(() => window.deckEditor.editops.remove());
    expect(await page.evaluate(() => !!window.deckEditor.deck.doc.querySelector('.slide.active > div[data-id]'))).toBe(false);
    // Alt text: the Picture section shows for an icon (aria-label + role) and for a picture (alt); not for text.
    await page.evaluate(() => { const ed = window.deckEditor; ed.insert.icon('star'); });
    await page.waitForTimeout(200);
    await expect(page.locator('#inspPicture')).toBeVisible();
    await page.fill('#inspAlt', 'A star');
    await page.locator('#inspAlt').dispatchEvent('change');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => { const s = window.deckEditor.selection.single; return [s.getAttribute('aria-label'), s.getAttribute('role')]; })).toEqual(['A star', 'img']);
    await page.evaluate(() => { const ed = window.deckEditor; const img = ed.deck.doc.createElement('img'); img.src = 'assets/x.png'; img.style.cssText = 'position:absolute;left:100px;top:100px;width:200px;height:120px'; ed.insert.add(img, 'Insert image'); });
    await page.waitForTimeout(200);
    await page.fill('#inspAlt', 'A picture');
    await page.locator('#inspAlt').dispatchEvent('change');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.deckEditor.selection.single.getAttribute('alt'))).toBe('A picture');
    await page.evaluate(() => window.deckEditor.inspector.setAlt(''));                 // the field's x
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.deckEditor.selection.single.hasAttribute('alt'))).toBe(false);
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('h1')));
    await expect(page.locator('#inspPicture')).toBeHidden();
    await save(page);
    expect(readDeck()).toContain('aria-label="A star" role="img"');
});

/* ------------------------------------------------------------
   48. Picture: fit, focus, flip, grayscale, replace
   ------------------------------------------------------------ */
test('48 picture: fit and focus crop to the box, flip and grayscale are undoable, another file replaces the picture in its box', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => { const ed = window.deckEditor; const img = ed.deck.doc.createElement('img'); img.src = 'assets/x.png'; img.style.cssText = 'position:absolute;left:100px;top:100px;width:400px;height:200px'; ed.insert.add(img, 'Insert image'); });
    await page.waitForTimeout(200);
    await expect(page.locator('#inspMediaRows')).toBeVisible();
    await expect(page.locator('#inspFocusRow')).toBeHidden();                  // stretched: no focus to choose
    await page.selectOption('#inspFit', 'cover');
    await page.locator('#inspFit').dispatchEvent('change');
    await page.waitForTimeout(100);
    await expect(page.locator('#inspFocusRow')).toBeVisible();
    await page.click('#inspFocus [data-focus="right top"]');
    await page.click('#inspFlip [data-flip="x"]');
    await page.fill('#inspGray', '60');
    await page.locator('#inspGray').dispatchEvent('change');
    await page.waitForTimeout(100);
    const st = await page.evaluate(() => { const s = window.deckEditor.selection.single.style; return { fit: s.objectFit, pos: s.objectPosition, scale: s.scale, filter: s.filter }; });
    expect(st).toEqual({ fit: 'cover', pos: 'right top', scale: '-1 1', filter: 'grayscale(60%)' });
    expect(await page.evaluate(() => document.querySelector('#inspFlip [data-flip="x"]').classList.contains('on'))).toBe(true);
    await page.click('#inspFlip [data-flip="y"]');
    await page.click('#inspFlip [data-flip="x"]');
    expect(await page.evaluate(() => window.deckEditor.selection.single.style.scale)).toBe('1 -1');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.deckEditor.selection.single.style.scale)).toBe('-1 1');
    await page.evaluate(() => window.deckEditor.inspector._clear('_grayscale'));
    expect(await page.evaluate(() => window.deckEditor.selection.single.style.filter)).toBe('');
    // Replace: the upload lands in the same element, box and look kept (the upload is stubbed: the server has the file).
    const before = await page.evaluate(() => { const s = window.deckEditor.selection.single; return { id: s.getAttribute('data-id'), css: s.style.cssText }; });
    await page.evaluate(async () => { const ed = window.deckEditor; const f = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'new.png', { type: 'image/png' }); await ed.insert.upload([f], { placeholder: ed.selection.single }); });
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => { const s = window.deckEditor.selection.single; return { id: s.getAttribute('data-id'), css: s.style.cssText, src: s.getAttribute('src'), imgs: window.deckEditor.deck.doc.querySelectorAll('img').length }; });
    expect(after.id).toBe(before.id);
    expect(after.css).toBe(before.css);
    expect(after.src).toMatch(/^assets\/new(-\d+)?\.png$/);
    expect(after.imgs).toBe(1);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.deckEditor.selection.single.getAttribute('src'))).toBe('assets/x.png');
});

/* ------------------------------------------------------------
   49. Shrink to fit
   ------------------------------------------------------------ */
test('49 shrink to fit: text that overflows its box steps its size down, grows back when there is room, follows edits and resizes, and is undone cleanly', async ({ page }) => {
    await openDeck(page);
    // A text box 400 x 120 with a lot of text at 32px: it overflows.
    await page.evaluate(() => { const ed = window.deckEditor; const t = ed.insert.text('The quick brown fox jumps over the lazy dog, again and again and again, until the box is too small for it.'); ed.textEdit.commit(); t.style.width = '400px'; t.style.height = '120px'; ed.selection.select(t); });
    await page.waitForTimeout(200);
    const over = () => page.evaluate(() => { const t = window.deckEditor.selection.single; return { over: t.scrollHeight > t.clientHeight + 1, size: t.style.fontSize, fit: t.getAttribute('data-fit'), base: t.getAttribute('data-fit-size') }; });
    expect((await over()).over).toBe(true);
    await expect(page.locator('#inspFitRow')).toBeVisible();
    await page.check('#inspFitText');
    await page.waitForTimeout(200);
    let st = await over();
    expect(st.over).toBe(false);
    expect(st.fit).toBe('shrink');
    expect(st.base).toBe('32px');
    expect(parseFloat(st.size)).toBeLessThan(32);
    const shrunk = parseFloat(st.size);
    // A bigger box: the text grows back towards its size; the same box again: shrinks again.
    await page.evaluate(() => { const ed = window.deckEditor; ed.history.style(ed.selection.single, () => { ed.selection.single.style.height = '400px'; }, { label: 'Resize' }); });
    await page.waitForTimeout(200);
    st = await over();
    expect(parseFloat(st.size)).toBe(32);
    await page.evaluate(() => { const ed = window.deckEditor; ed.history.style(ed.selection.single, () => { ed.selection.single.style.height = '120px'; }, { label: 'Resize' }); });
    await page.waitForTimeout(200);
    expect(parseFloat((await over()).size)).toBe(shrunk);
    // Less text: it grows back after the edit.
    await page.evaluate(() => { const ed = window.deckEditor; const t = ed.selection.single; ed.textEdit.start(t); t.textContent = 'Short.'; ed.textEdit.commit(); });
    await page.waitForTimeout(200);
    expect(parseFloat((await over()).size)).toBe(32);
    // Undo the edit: the long text and its shrunk size come back together, no extra fitting on the way.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    st = await over();
    expect(parseFloat(st.size)).toBe(shrunk);
    expect(await page.evaluate(() => window.deckEditor.selection.single.textContent)).toMatch(/^The quick/);
    // Off: the given size is back and the attributes are gone; saved decks carry data-fit and the inline size.
    await page.uncheck('#inspFitText');
    await page.waitForTimeout(100);
    st = await over();
    expect(st).toEqual({ over: true, size: '32px', fit: null, base: null });
    await page.check('#inspFitText');
    await save(page);
    expect(readDeck()).toMatch(/data-fit="shrink"/);
});

/* ------------------------------------------------------------
   50. Copy style / paste style
   ------------------------------------------------------------ */
test('50 copy style: Ctrl+Alt+C takes the look of an element, Ctrl+Alt+V puts what differs on the selection, inline, in one undo step', async ({ page }) => {
    await openDeck(page);
    // A styled rectangle and two plain ones; the look of the first goes on the others.
    await page.evaluate(() => { const ed = window.deckEditor; const a = ed.insert.rect(); a.style.background = 'rgb(10, 20, 30)'; a.style.borderRadius = '18px'; a.style.boxShadow = 'rgba(0, 0, 0, 0.5) 0px 4px 12px'; a.style.border = '3px solid rgb(200, 0, 0)'; ed.insert.rect(); ed.insert.rect(); ed.selection.select(a); });
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+Alt+c');
    expect(await page.evaluate(() => !!window.deckEditor.editops.styleClip)).toBe(true);
    await page.evaluate(() => { const ed = window.deckEditor; const r = ed.deck.currentSlide.querySelectorAll('.slide.active > div[data-id]'); ed.selection.set([r[1], r[2]]); });
    await page.keyboard.press('Control+Alt+v');
    await page.waitForTimeout(100);
    const looks = await page.evaluate(() => { const ed = window.deckEditor; return Array.from(ed.deck.currentSlide.querySelectorAll('.slide.active > div[data-id]')).map(e => { const cs = ed.deck.win.getComputedStyle(e); return [cs.backgroundColor, cs.borderTopLeftRadius, cs.borderTopColor, cs.boxShadow, e.style.left]; }); });
    expect(looks[1].slice(0, 4)).toEqual(looks[0].slice(0, 4));
    expect(looks[2].slice(0, 4)).toEqual(looks[0].slice(0, 4));
    expect(looks[1][4]).not.toBe(looks[0][4]);                                  // where it is was not copied
    // One undo step for both; a paste onto an element that already looks the same writes nothing.
    await page.keyboard.press('Control+z');
    const undone = await page.evaluate(() => { const ed = window.deckEditor; return Array.from(ed.deck.currentSlide.querySelectorAll('.slide.active > div[data-id]')).map(e => ed.deck.win.getComputedStyle(e).borderTopLeftRadius); });
    expect(undone[1]).toBe('0px'); expect(undone[2]).toBe('0px');
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.querySelector('.slide.active > div[data-id]')); });
    const before = await page.evaluate(() => window.deckEditor.selection.single.getAttribute('style'));
    await page.keyboard.press('Control+Alt+v');
    expect(await page.evaluate(() => window.deckEditor.selection.single.getAttribute('style'))).toBe(before);
    // The element menu has both.
    const c = await centre(page, '.slide.active > div[data-id]');
    await page.mouse.click(c.x, c.y, { button: 'right' });
    await expect(page.locator('.el-menu [data-a="copystyle"]')).toBeVisible();
    await expect(page.locator('.el-menu [data-a="pastestyle"]')).toBeEnabled();
    await page.keyboard.press('Escape');
});

/* ------------------------------------------------------------
   52. The command palette
   ------------------------------------------------------------ */
test('52 palette: Ctrl+K opens a search over actions, slides and icons; Enter runs the chosen one; Esc closes', async ({ page }) => {
    await openDeck(page);
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette-input')).toBeFocused();
    // A slide by its name.
    await page.keyboard.type('bullets');
    await expect(page.locator('.palette-item.on')).toContainText('Go to slide 3');
    await page.keyboard.press('Enter');
    await expect(page.locator('.palette')).toHaveCount(0);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.deckEditor.deck.current)).toBe(2);
    // An insert action: a rectangle lands on the slide.
    await page.keyboard.press('Control+k');
    await page.keyboard.type('rectan');
    await expect(page.locator('.palette-item.on')).toContainText('Rectangle');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => { const s = window.deckEditor.selection.single; return s && s.tagName === 'DIV' && !!s.style.background; })).toBe(true);
    // Element actions appear with a selection: "lock" locks it; a built-in icon inserts.
    await page.keyboard.press('Control+k');
    await page.keyboard.type('lock');
    await expect(page.locator('.palette-item.on')).toHaveText(/Lock$/);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('[data-locked]').length)).toBe(1);
    await page.keyboard.press('Control+k');
    await page.keyboard.type('icon star');
    const items = await page.evaluate(() => Array.from(document.querySelectorAll('.palette-item')).map(i => i.textContent));
    expect(items.some(t => /^Iconstar$/.test(t))).toBe(true);
    await page.evaluate(() => Array.from(document.querySelectorAll('.palette-item')).find(i => i.textContent === 'Iconstar').click());
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.deckEditor.selection.single.tagName.toLowerCase())).toBe('svg');
    // Arrow keys move the choice; Esc closes without running.
    await page.keyboard.press('Control+k');
    await page.keyboard.type('zoom');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.palette-item.on')).toContainText('Zoom in');
    await page.keyboard.press('Escape');
    await expect(page.locator('.palette')).toHaveCount(0);
});

/* ------------------------------------------------------------
   53. Hints: off by default, on from the Look menu, remembered
   ------------------------------------------------------------ */
test('53 hints: the notes under the fields are off until asked for; what a field does is on its tooltip; state notes stay', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => window.deckEditor.selection.clear());
    await page.waitForTimeout(200);
    // Off by default: no explaining notes in the panel, but the tooltips are there.
    expect(await page.evaluate(() => document.documentElement.dataset.hints)).toBe('off');
    const shownHints = () => page.evaluate(() => Array.from(document.querySelectorAll('#inspector .insp-hint')).filter(h => h.offsetParent !== null && h.textContent.trim()).map(h => h.textContent.trim()));
    expect(await shownHints()).toEqual(['Needs the presentation features script (Presenter menu).']);   // a state note, not an explanation
    expect(await page.evaluate(() => document.getElementById('inspSection').title)).toContain('A section starts at this slide');
    expect(await page.evaluate(() => document.querySelector('label[title] #inspAutoAnimate') !== null)).toBe(true);
    // On from the Look menu: the notes appear, and each is one short line.
    await page.click('#btnLook');
    await page.click('[data-opt="hints"]');
    expect(await page.evaluate(() => document.documentElement.dataset.hints)).toBe('on');
    const hints = await shownHints();
    expect(hints.length).toBeGreaterThan(0);
    for (const h of hints) expect(h.length).toBeLessThan(90);
    expect(await page.evaluate(() => document.getElementById('btnHintsState').textContent)).toBe('shown');
    // Remembered across a reload, and off again.
    await page.reload();
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen);
    expect(await page.evaluate(() => document.documentElement.dataset.hints)).toBe('on');
    await page.click('#btnLook');
    await page.click('[data-opt="hints"]');
    expect(await page.evaluate(() => document.documentElement.dataset.hints)).toBe('off');
    // A note that reports state (how many fragments) shows either way.
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.doc.querySelector('h1')); });
    await page.check('#animFragment');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => { const h = document.getElementById('animFragHint'); return { text: h.textContent, shown: h.offsetParent !== null }; })).toEqual({ text: 'Revealed on Space, in order; 1 on this slide.', shown: true });
});

/* ------------------------------------------------------------
   54. Rulers and the deck's guides
   ------------------------------------------------------------ */
test('54 guides: rulers drop guides the deck keeps, they snap a move, and they are saved, undone and cleared', async ({ page }) => {
    await openDeck(page);
    // Off by default; on from the Look menu, and the rulers appear over the canvas.
    expect(await page.evaluate(() => document.documentElement.dataset.rulers)).toBe('off');
    await page.click('#btnLook');
    await page.click('[data-opt="rulers"]');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.dataset.rulers)).toBe('on');
    await expect(page.locator('.ruler-x')).toBeVisible();
    await expect(page.locator('.ruler-y')).toBeVisible();
    // Drag a guide out of the left ruler to x = 400 (stage px): it is kept on the stage.
    const k = await scale(page);
    const wrap = await page.locator('#stageWrap').boundingBox();
    const ry = await page.locator('.ruler-y').boundingBox();
    await drag(page, { x: ry.x + ry.width / 2, y: wrap.y + 200 }, { x: wrap.x + 400 * k, y: wrap.y + 200 });
    await page.waitForTimeout(200);
    const g1 = await page.evaluate(() => window.deckEditor.deck.stage.getAttribute('data-guides'));
    expect(g1).toMatch(/^x:\d+(\.\d)?$/);
    near(+g1.slice(2), 400, Math.max(2, slack(k)), 'guide x');
    // And one out of the top ruler at y = 300.
    const rx = await page.locator('.ruler-x').boundingBox();
    await drag(page, { x: wrap.x + 300, y: rx.y + rx.height / 2 }, { x: wrap.x + 300, y: wrap.y + 300 * k });
    await page.waitForTimeout(200);
    const g = await page.evaluate(() => window.deckEditor.deck.stage.getAttribute('data-guides'));
    expect(g).toMatch(/x:\d+(\.\d)?/); expect(g).toMatch(/y:\d+(\.\d)?/);
    near(+g.match(/y:(\d+(?:\.\d)?)/)[1], 300, Math.max(2, slack(k)), 'guide y');
    expect(await page.evaluate(() => document.querySelectorAll('.guide').length)).toBe(2);
    // A move snaps to the guide: the heading's left edge lands exactly on x = 400.
    await page.evaluate(() => { const ed = window.deckEditor; const x = +ed.deck.stage.getAttribute('data-guides').match(/x:(\d+(?:\.\d)?)/)[1]; ed.deck.stage.setAttribute('data-guides', 'x:400,y:300'); return x; });
    const h1 = await stageRect(page, 'h1');
    const from = await stagePoint(page, h1.x + h1.w / 2, h1.y + h1.h / 2);
    await page.mouse.click(from.x, from.y);
    await drag(page, from, { x: from.x + (400 - h1.x + 3) * k, y: from.y });
    await page.waitForTimeout(200);
    const moved = await stageRect(page, 'h1');
    expect(Math.abs(moved.x - 400)).toBeLessThan(0.6);
    // Saved with the deck, and read back when it is opened again.
    await save(page);
    expect(readDeck()).toContain('data-guides="x:400,y:300"');
    await openDeck(page);
    expect(await page.evaluate(() => window.deckEditor.deck.stage.getAttribute('data-guides'))).toBe('x:400,y:300');
    expect(await page.evaluate(() => document.querySelectorAll('.guide').length)).toBe(2);
    // Dragging a guide off the slide removes it; undo brings it back; the palette clears them all.
    const gx = await page.locator('.guide.v').boundingBox();
    await drag(page, { x: gx.x + gx.width / 2, y: wrap.y + 100 }, { x: wrap.x - 60, y: wrap.y + 100 });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.deckEditor.deck.stage.getAttribute('data-guides'))).toBe('y:300');
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.deckEditor.deck.stage.getAttribute('data-guides'))).toBe('x:400,y:300');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('clear the guides');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.deckEditor.deck.stage.hasAttribute('data-guides'))).toBe(false);
    await page.click('#btnLook');
    await page.click('[data-opt="rulers"]');
    expect(await page.evaluate(() => document.documentElement.dataset.rulers)).toBe('off');
});

/* ------------------------------------------------------------
   57. Numbered lists
   ------------------------------------------------------------ */
test('57 numbered lists: a bulleted list becomes numbered from the panel with its marker and first number, the bar makes one while editing, Tab nests an item', async ({ page }) => {
    await openDeck(page);
    await goTo(page, 2);
    const list = () => page.evaluate(() => {
        const l = window.deckEditor.deck.doc.querySelector('.slide.active ul, .slide.active ol');
        return { tag: l.tagName, items: Array.from(l.children).map(li => li.textContent), marker: l.style.listStyleType, start: l.getAttribute('start') };
    });
    await page.evaluate(() => {
        const d = window.deckEditor.deck.doc;
        window.deckEditor.selection.set([d.querySelector('.slide.active ul')]);
    });
    await expect(page.locator('#inspList')).toBeVisible();
    await expect(page.locator('#inspListKind button[data-v="ul"]')).toHaveClass(/on/);
    await expect(page.locator('#inspListStartRow')).toBeHidden();

    // Numbered: the same items in an <ol>, one undo step, and the marker choices follow the kind.
    await page.click('#inspListKind button[data-v="ol"]');
    expect(await list()).toEqual({ tag: 'OL', items: ['First point', 'Second point', 'Third point'], marker: '', start: null });
    expect(await page.locator('#inspListMarker option').evaluateAll(os => os.map(o => o.value))).toContain('lower-roman');
    await expect(page.locator('#inspListStartRow')).toBeVisible();
    await page.locator('#inspListMarker').selectOption('lower-roman');
    await page.fill('#inspListStart', '4');
    await page.locator('#inspListStart').dispatchEvent('change');
    expect(await list()).toMatchObject({ tag: 'OL', marker: 'lower-roman', start: '4' });

    await save(page);
    expect(readDeck()).toMatch(/<ol[^>]*start="4"|<ol[^>]*list-style-type: lower-roman/);
    expect(readDeck()).toContain('First point');

    // Each step undoes on its own; the list is a <ul> again with its items in place.
    await page.evaluate(() => { const h = window.deckEditor.history; h.undo(); h.undo(); h.undo(); });
    expect(await list()).toEqual({ tag: 'UL', items: ['First point', 'Second point', 'Third point'], marker: '', start: null });

    // The bar over the text knows which kind it is in, and Tab makes a sub-item.
    await page.evaluate(() => {
        const d = window.deckEditor.deck.doc, l = d.querySelector('.slide.active ul');
        window.deckEditor.textEdit.start(l);
        const r = d.createRange(), n = l.children[1].firstChild;
        r.setStart(n, 2); r.collapse(true);
        const s = window.deckEditor.deck.win.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await expect(page.locator('.textbar button[data-cmd="list"]')).toHaveClass(/on/);
    await expect(page.locator('.textbar button[data-cmd="olist"]')).not.toHaveClass(/on/);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!window.deckEditor.deck.doc.querySelector('.slide.active ul ul, .slide.active ul ol'))).toBe(true);
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!window.deckEditor.deck.doc.querySelector('.slide.active ul ul, .slide.active ul ol'))).toBe(false);
    // The same bar turns the list into a numbered one.
    await page.click('.textbar button[data-cmd="olist"]');
    expect(await page.evaluate(() => !!window.deckEditor.deck.doc.querySelector('.slide.active ol'))).toBe(true);

    // Enter makes the next item: the browser cannot split the list it is editing inside.
    const items = () => page.evaluate(() => Array.from(window.deckEditor.textEdit.el.children).map(li => li.textContent));
    const caret = (i, at) => page.evaluate(([i, at]) => {
        const d = window.deckEditor.deck, li = window.deckEditor.textEdit.el.children[i];
        const r = d.doc.createRange();
        if (at === 'end') { r.selectNodeContents(li); r.collapse(false); } else { r.setStart(li.firstChild, at); r.collapse(true); }
        const s = d.win.getSelection(); s.removeAllRanges(); s.addRange(r);
    }, [i, at]);

    await caret(0, 'end');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Extra point');
    expect(await items()).toEqual(['First point', 'Extra point', 'Second point', 'Third point']);
    // The new item looks like the one it came from - its classes, its style, data-edit - but
    // does not take over its identity.
    expect(await page.evaluate(() => {
        const li = window.deckEditor.textEdit.el.children[1];
        return { cls: li.className, style: li.getAttribute('style'), edit: li.hasAttribute('data-edit'), id: li.getAttribute('data-id') };
    })).toEqual({ cls: 'reveal', style: '--i:2', edit: true, id: null });

    // Backspace at the start of an item joins it to the one before.
    await caret(1, 0);
    await page.keyboard.press('Backspace');
    expect(await items()).toEqual(['First pointExtra point', 'Second point', 'Third point']);

    // Splitting inside an item takes the rest of the line with it, trimmed where they part.
    await caret(0, 11);
    await page.keyboard.press('Enter');
    expect(await items()).toEqual(['First point', 'Extra point', 'Second point', 'Third point']);

    // Enter at the end leaves an empty item to type into; finishing the edit drops it again.
    await caret(3, 'end');
    await page.keyboard.press('Enter');
    expect((await items()).length).toBe(5);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => Array.from(window.deckEditor.deck.doc.querySelector('.slide.active ol').children).map(li => li.textContent)))
        .toEqual(['First point', 'Extra point', 'Second point', 'Third point']);

    // A list made inside a text box: the box is still the element being edited, with the list
    // inside it. Enter has to make the next item there too, not a line break in the item.
    await page.evaluate(() => window.deckEditor.insert.text('A line'));
    await page.waitForFunction(() => window.deckEditor.textEdit.active);
    await page.click('.textbar button[data-cmd="olist"]');
    expect(await page.evaluate(() => window.deckEditor.textEdit.el.tagName)).toBe('DIV');
    expect(await page.evaluate(() => !!window.deckEditor.textEdit.el.querySelector('ol > li'))).toBe(true);
    await page.evaluate(() => {
        const d = window.deckEditor.deck, li = window.deckEditor.textEdit.el.querySelector('li');
        const r = d.doc.createRange(); r.selectNodeContents(li); r.collapse(false);
        const s = d.win.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press('Enter');
    await page.keyboard.type('Another line');
    expect(await page.evaluate(() => Array.from(window.deckEditor.textEdit.el.querySelectorAll('li')).map(li => li.textContent)))
        .toEqual(['A line', 'Another line']);
    expect(await page.evaluate(() => window.deckEditor.textEdit.el.querySelector('br'))).toBe(null);
    await page.keyboard.press('Escape');
    // The panel finds that list too, so its marker and kind are still to hand.
    await expect(page.locator('#inspList')).toBeVisible();
    await expect(page.locator('#inspListKind button[data-v="ol"]')).toHaveClass(/on/);
    await page.evaluate(() => window.deckEditor.history.undo());
});

/* ------------------------------------------------------------
   58. The type fields on part of the text
   ------------------------------------------------------------ */
test('58 type on a selection: font, size, weight and italic change the selected words only, and the edit stays open', async ({ page }) => {
    await openDeck(page);
    const h1 = () => page.evaluate(() => window.deckEditor.deck.doc.querySelector('.slide.active h1').innerHTML);
    const before = await h1();
    // Edit the heading in place and select its first word.
    await page.evaluate(() => {
        const d = window.deckEditor.deck, el = d.doc.querySelector('.slide.active h1');
        window.deckEditor.textEdit.start(el);
        const n = el.firstChild, r = d.doc.createRange();
        r.setStart(n, 0); r.setEnd(n, 6);
        const s = d.win.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await expect(page.locator('#inspType')).toHaveClass(/on-part/);

    // The font picker: pressing it does not end the edit, and the pick lands on the word.
    await page.click('#inspFont');
    await expect(page.locator('.fontpick')).toBeVisible();
    expect(await page.evaluate(() => window.deckEditor.textEdit.active)).toBe(true);
    await page.fill('.fontpick-search', 'inter');
    await page.click('.fontpick-item[data-name="Inter"]');
    expect(await h1()).toBe('<span style="font-family: Inter, sans-serif;">Sample</span> deck title');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('.slide.active h1').style.fontFamily)).toBe('');

    // A number field takes the focus out of the deck, which drops the browser's selection:
    // the remembered range keeps the size on the same word.
    await page.click('#inspSize');
    await page.fill('#inspSize', '120');
    await page.locator('#inspWeight').selectOption('900');
    await page.click('#inspStyle button[data-v="italic"]');
    const span = () => page.evaluate(() => window.deckEditor.deck.doc.querySelector('.slide.active h1 span').getAttribute('style'));
    expect(await span()).toContain('font-size: 120px');
    expect(await span()).toContain('font-weight: 900');
    expect(await span()).toContain('font-style: italic');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('.slide.active h1').getAttribute('style'))).toBe('--i:1');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('.slide.active h1').textContent)).toBe('Sample deck title');

    // Esc finishes the edit: one step for the whole thing, and the saved file carries the span.
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.deckEditor.textEdit.active)).toBe(false);
    await expect(page.locator('#inspType')).not.toHaveClass(/on-part/);
    await save(page);
    expect(readDeck()).toContain('font-size: 120px');
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await h1()).toBe(before);
});

/* ------------------------------------------------------------
   59. Charts
   ------------------------------------------------------------ */
test('59 charts: Insert > Chart draws a themed SVG from a table; a pasted table, the kind, the options, a resize and undo redraw it; it saves as SVG + JSON and comes back', async ({ page }) => {
    await openDeck(page);
    await page.click('#btnInsert');
    await page.click('[data-insert="chart"]');
    const fig = () => page.evaluate(() => {
        const f = window.deckEditor.deck.doc.querySelector('figure[data-chart]');
        if (!f) return null;
        const svg = f.querySelector(':scope > svg');
        return { kind: f.dataset.chart, key: svg && svg.getAttribute('data-key'), rects: f.querySelectorAll('svg rect').length, paths: f.querySelectorAll('svg path').length,
            spec: JSON.parse(f.querySelector(':scope > script[data-chart-data]').textContent), selected: window.deckEditor.selection.single === f, text: f.querySelector('svg').textContent };
    });
    let c = await fig();
    expect(c.selected).toBe(true);
    expect(c.kind).toBe('column');
    expect(c.spec.labels).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(c.spec.palette[0]).toMatch(/^var\(--/);                      // the deck's colours
    expect(c.rects).toBe(2 + 8);                                        // two legend keys, eight columns
    await expect(page.locator('#inspChart')).toBeVisible();
    // A table pasted into the top-left cell replaces the chart's table, headings and all.
    const table = 'Region\tRevenue\tCost\nNorth\t1,200\t800\nSouth\t950\t700\nEast\t1480\t900\n';
    if (test.info().project.name === 'firefox') {
        // Firefox empties the clipboardData of a made-up paste event: copy and paste for real.
        await page.evaluate((t) => { const a = document.createElement('textarea'); a.id = 'pasteSrc'; a.value = t; document.body.appendChild(a); a.select(); }, table);
        await page.keyboard.press('Control+c');
        await page.evaluate(() => document.getElementById('pasteSrc').remove());
        await page.focus('#chartGrid input[data-r="0"][data-c="0"]');
        await page.keyboard.press('Control+v');
    } else {
        await page.focus('#chartGrid input[data-r="0"][data-c="0"]');
        await page.evaluate((t) => {
            const dt = new DataTransfer(); dt.setData('text/plain', t);
            document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        }, table);
    }
    c = await fig();
    expect(c.spec.labels).toEqual(['North', 'South', 'East']);
    expect(c.spec.series.map(s => [s.name, s.values])).toEqual([['Revenue', [1200, 950, 1480]], ['Cost', [800, 700, 900]]]);
    expect(c.rects).toBe(2 + 6);
    expect(c.text).toContain('North');
    expect(await page.evaluate(() => window.deckEditor.history.top.label)).toBe('Paste into chart');
    // A typed cell redraws; the change is one undo step.
    await page.fill('#chartGrid input[data-r="1"][data-c="1"]', '2000');
    await page.press('#chartGrid input[data-r="1"][data-c="1"]', 'Enter');
    c = await fig();
    expect(c.spec.series[0].values[0]).toBe(2000);
    expect(c.text).toContain('2,000');                                   // the axis now reaches 2,000
    // A series' own colour: its chip, then a swatch; the chart's text colour is left alone.
    const colour0 = await page.evaluate(() => window.deckEditor.deck.doc.querySelector('figure[data-chart]').style.color);
    await page.click('#chartGrid .chart-chip[data-s="1"]');
    await page.click('#chartSwatches .insp-swatch:not(.chart-auto) >> nth=2');
    c = await fig();
    expect(c.spec.series[1].colour).toMatch(/^var\(--/);
    expect(c.spec.series[0].colour).toBeUndefined();
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('figure[data-chart]').style.color)).toBe(colour0);
    // Kind and options.
    await page.click('#chartKind [data-kind="pie"]');
    c = await fig();
    expect(c.kind).toBe('pie');
    expect(c.paths).toBe(3);
    await page.click('#chartKind [data-kind="bar"]');
    await page.check('#inspChart [data-opt="stacked"]');
    await page.check('#inspChart [data-opt="values"]');
    c = await fig();
    expect(c.kind).toBe('bar');
    expect(c.spec.stacked && c.spec.values).toBe(true);
    expect(c.text).toContain('2,800');                                   // a stack's total
    // A resize draws it again for the new box; undo takes box and drawing back together.
    const key0 = c.key;
    await page.fill('#inspW', '800');
    await page.press('#inspW', 'Enter');
    c = await fig();
    expect(c.key).toMatch(/^800 /);
    await page.evaluate(() => window.deckEditor.history.undo());
    c = await fig();
    expect(c.key).toBe(key0);
    // A double-click goes to the table, not into text editing.
    const p = await centre(page, 'figure[data-chart]');
    await page.mouse.dblclick(p.x, p.y);
    expect(await page.evaluate(() => document.activeElement.matches('#chartGrid input') && !window.deckEditor.textEdit.active)).toBe(true);
    // Saved: the figure with its drawing and its table; reopened, it is the same chart and saves byte-identical.
    await save(page);
    const saved = readDeck();
    expect(saved).toMatch(/<figure data-chart="bar"[^>]*>\s*<svg [^>]*viewBox="0 0 1100 620"/);
    expect(saved).toMatch(/<script type="application\/json" data-chart-data(="")?>\{"labels":\["North","South","East"\]/);
    await openDeck(page);
    const text = await page.evaluate(() => window.deckEditor.deck.doc.querySelector('figure[data-chart] svg').textContent);
    expect(text).toContain('North');
    await page.evaluate(() => window.deckEditor.history.forceDirty());
    await save(page);
    expect(readDeck()).toBe(saved);
});

test('64 charts written by hand: a figure with its table and no drawing is drawn on open, leaves the deck clean, and a save keeps the drawing', async ({ page }) => {
    const table = '{"labels":["A","B"],"series":[{"name":"Sales","values":[3,5]}],"palette":["var(--accent)"],"legend":true,"values":true,"grid":true,"stacked":false}';
    const html = readDeck();
    const at = html.indexOf('</section>');
    fs.writeFileSync(path.join(DECK_DIR, 'index.html'), html.slice(0, at)
        + `<figure data-chart="column" style="position:absolute; left:100px; top:100px; width:800px; height:400px; margin:0; font-size:24px"><script type="application/json" data-chart-data>${table}</script></figure>\n`
        + html.slice(at));
    await openDeck(page);
    await page.waitForFunction(() => !!window.deckEditor.deck.doc.querySelector('figure[data-chart] > svg[data-key]'));
    const drawn = await page.evaluate(() => ({ text: window.deckEditor.deck.doc.querySelector('figure[data-chart] svg').textContent, dirty: window.deckEditor.dirty }));
    expect(drawn.text).toContain('Sales');
    expect(drawn.dirty).toBeFalsy();
    await save(page);
    expect(readDeck()).toMatch(/<figure data-chart="column"[^>]*>\s*<svg [^>]*viewBox="0 0 800 400"[^>]*data-key=/);
});

/* ------------------------------------------------------------
   60. Crop
   ------------------------------------------------------------ */
test('60 crop: a double-click crops a picture by hand (handles crop, a drag moves it, the wheel zooms), one undo step; nothing changed leaves it alone; Remove crop gives the whole picture back', async ({ page }) => {
    await openDeck(page);
    // An 800 x 400 picture shown at 400 x 200.
    await page.evaluate(() => {
        const ed = window.deckEditor, c = document.createElement('canvas'); c.width = 800; c.height = 400;
        const g = c.getContext('2d'); g.fillStyle = '#e33'; g.fillRect(0, 0, 400, 400); g.fillStyle = '#33e'; g.fillRect(400, 0, 400, 400);
        const img = ed.deck.doc.createElement('img'); img.src = c.toDataURL(); img.alt = 'Two halves';
        img.className = 'photo'; img.style.cssText = 'position:absolute;left:100px;top:100px;width:400px;height:200px';
        ed.insert.add(img, 'Insert image');
    });
    await page.waitForFunction(() => window.deckEditor.selection.single.complete);
    const undoDepth = () => page.evaluate(() => window.deckEditor.history.undoStack.length);
    const depth0 = await undoDepth();
    const state = () => page.evaluate(() => {
        const ed = window.deckEditor, box = ed.deck.doc.querySelector('[data-crop]');
        const img = box ? box.querySelector('img') : ed.deck.doc.querySelector('img.photo, img[alt="Two halves"]');
        const r = (el) => { const x = ed.deck.stageRect(el); return [Math.round(x.x), Math.round(x.y), Math.round(x.w), Math.round(x.h)]; };
        return { box: box ? r(box) : null, img: r(img), crop: ed.cropper.active, cls: box ? box.className : img.className, imgCls: img.className, alt: img.alt, top: ed.history.top && ed.history.top.label };
    });
    // Into crop mode and out again without a change: the picture is as it was, no undo step.
    const c0 = await centre(page, 'img');
    await page.mouse.dblclick(c0.x, c0.y);
    let s = await state();
    expect(s.crop).toBe(true);
    expect(s.box).toEqual([100, 100, 400, 200]);
    expect(s.cls).toBe('photo');                                    // the box takes the picture's identity
    expect(s.imgCls).toBe('');
    await page.keyboard.press('Enter');
    s = await state();
    expect(s.crop).toBe(false);
    expect(s.box).toBe(null);
    expect(await undoDepth()).toBe(depth0);
    // Crop: the east handle 100 stage px in, then the picture moved 50 px left, then a zoom.
    await page.mouse.dblclick(c0.x, c0.y);
    const handle = async (sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
    const k = await scale(page);
    let h = await handle('.crop-h[data-h="e"]');
    await drag(page, h, { x: h.x - 100 * k, y: h.y });
    s = await state();
    expect(s.box).toEqual([100, 100, 300, 200]);
    expect(s.img).toEqual([100, 100, 400, 200]);                    // the picture stays where it is
    const mid = await stagePoint(page, 250, 200);
    await drag(page, mid, { x: mid.x - 50 * k, y: mid.y + 80 * k });  // up and down is held: the picture already fills the height
    s = await state();
    near(s.img[0], 50, slack(k), 'picture x');
    expect(s.img.slice(1)).toEqual([100, 400, 200]);
    await drag(page, mid, { x: mid.x + 400 * k, y: mid.y });         // not past its edge
    s = await state();
    expect(s.img[0]).toBe(100);
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.wheel(0, -200);
    s = await state();
    expect(s.img[2]).toBeGreaterThan(400);
    expect(s.img[0]).toBeLessThanOrEqual(100);                       // still covers the box
    expect(s.img[0] + s.img[2]).toBeGreaterThanOrEqual(400);
    await page.keyboard.press('Enter');
    s = await state();
    expect(s.crop).toBe(false);
    expect(await undoDepth()).toBe(depth0 + 1);
    expect(s.top).toBe('Crop');
    // The Picture section works on the picture in the box.
    await expect(page.locator('#inspUncrop')).toBeVisible();
    expect(await page.inputValue('#inspAlt')).toBe('Two halves');
    // Saved: the box with the picture inside it, in percentages.
    await save(page);
    const saved = readDeck();
    expect(saved).toMatch(/<div data-crop="" class="photo"[^>]*style="[^"]*width: 300px; height: 200px;[^"]*overflow: hidden;[^"]*"><img src="data:image\/png[^"]*" alt="Two halves" style="position: absolute; left: -?[\d.]+%; top: -?[\d.]+%; width: [\d.]+%; height: [\d.]+%;/);
    // Undo: the plain picture again, as inserted.
    await page.evaluate(() => window.deckEditor.history.undo());
    s = await state();
    expect(s.box).toBe(null);
    expect(s.img).toEqual([100, 100, 400, 200]);
    expect(s.cls).toBe('photo');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('img[alt="Two halves"]').getAttribute('style'))).toBe('position: absolute; left: 100px; top: 100px; width: 400px; height: 200px;');
    await page.evaluate(() => window.deckEditor.history.redo());
    // Remove crop: the whole picture, same place and width, its own proportions.
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('[data-crop]')));
    await page.click('#inspUncrop');
    s = await state();
    expect(s.box).toBe(null);
    expect(s.img).toEqual([100, 100, 300, 150]);
    expect(s.cls).toBe('photo');
    // A crop box written by hand (as in a template): in and out of crop mode unchanged leaves no undo step
    // and the style attribute as it was written.
    const hand = await page.evaluate(async () => {
        const ed = window.deckEditor, doc = ed.deck.doc, box = doc.createElement('div');
        box.setAttribute('data-crop', '');
        box.setAttribute('style', 'position:absolute;left:900px;top:300px;width:300px;height:200px;overflow:hidden;border-radius:8px;');
        box.innerHTML = '<img src="' + doc.querySelector('img[alt="Two halves"]').src + '" alt="" style="position:absolute;left:-10%;top:0%;width:150%;height:150%;max-width:none;max-height:none;">';
        ed.deck.currentSlide.appendChild(box);
        await new Promise(r => setTimeout(r, 100));
        const depth = ed.history.undoStack.length;
        ed.cropper.start(box); ed.cropper.finish();
        return { depth, now: ed.history.undoStack.length, style: box.getAttribute('style') };
    });
    expect(hand.now).toBe(hand.depth);
    expect(hand.style).toBe('position:absolute;left:900px;top:300px;width:300px;height:200px;overflow:hidden;border-radius:8px;');
});

/* ------------------------------------------------------------
   61. Palette: layouts and templates
   ------------------------------------------------------------ */
test('61 palette layouts and templates: a layout is added by name, a template opens New with it chosen', async ({ page }) => {
    await openDeck(page);
    const n0 = await page.evaluate(() => window.deckEditor.deck.slides.length);
    await page.keyboard.press('Control+k');
    await page.fill('.palette-input', 'new slide quote');
    await expect(page.locator('.palette-item.on')).toContainText('New slide: Quote');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.deckEditor.deck.slides.length)).toBe(n0 + 1);
    expect(await page.evaluate(() => !!window.deckEditor.deck.currentSlide.querySelector('blockquote'))).toBe(true);
    await page.keyboard.press('Control+k');
    await page.fill('.palette-input', 'swiss template');
    await expect(page.locator('.palette-item.on')).toContainText('New deck from the Swiss template');
    await page.keyboard.press('Enter');
    await expect(page.locator('#drawerNew')).toBeVisible();
    await expect(page.locator('#newDeckTemplates input[value="swiss"]')).toBeChecked();
    expect(await page.evaluate(() => document.activeElement.id)).toBe('newDeckName');
});

/* ------------------------------------------------------------
   63. Audit fixes: the panel folds, decks go by their names,
   new text reads on any slide, words not markup
   ------------------------------------------------------------ */
test('63 panel and names: secondary sections fold with a summary, only fitting sections show, decks are named, new text reads on a dark slide', async ({ page }) => {
    // A first-time panel: this test sees the folding a new user sees.
    await page.addInitScript(() => { sessionStorage.setItem('fold-test', '1'); localStorage.removeItem('diapo-panel-folded'); });
    await openDeck(page);
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.querySelector('h1, h2')); });
    const box = page.locator('.insp-section[data-fold="box"]');
    await expect(box).toHaveClass(/folded/);
    await expect(page.locator('#inspW')).toBeHidden();
    await expect(box.locator('.insp-sum')).toHaveText(/^\d+ × \d+$/);
    await box.locator('h4').click();
    await expect(page.locator('#inspW')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('diapo-panel-folded')))).not.toContain('box');
    // Words, not markup: the name field offers what the element is, the font its name.
    expect(await page.locator('#inspName').getAttribute('placeholder')).toBe('Heading');
    expect(await page.locator('#inspFont').textContent()).not.toMatch(/var\(/);
    expect(await page.evaluate(() => [...document.querySelectorAll('#inspector [title]')].some(n => /data-[a-z]/.test(n.title)))).toBe(false);

    // A picture has no Text section.
    await page.evaluate(() => { const ed = window.deckEditor; ed.insert.image('assets/shape.svg'); });
    await expect(page.locator('#inspType')).toBeHidden();

    // New text on a dark slide is not dark.
    const colour = await page.evaluate(() => {
        const ed = window.deckEditor, s = ed.deck.currentSlide;
        s.style.background = '#101014';
        const el = ed.insert.text('Readable?');
        const c = ed.deck.win.getComputedStyle(el).color.match(/\d+/g).map(Number);
        return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    });
    expect(colour).toBeGreaterThan(0.5);

    // Descriptions read across line breaks; a divider comment is not a note.
    const words = await page.evaluate(async () => {
        const { readableText } = await import('/core/dom.js');
        const { Inspector } = await import('/core/inspector.js');
        const doc = window.deckEditor.deck.doc;
        const h = doc.createElement('h2'); h.innerHTML = 'Welcome<br>to Diapo';
        const stage = doc.createElement('main');
        stage.innerHTML = '<!-- ==== SLIDES 5–8 - Droplet sorting gates ==== --><section class="slide"></section><!-- Say hello first --><section class="slide"></section>';
        const [a, b] = stage.querySelectorAll('section');
        return { text: readableText(h), divider: Inspector.notesOf(a), note: Inspector.notesOf(b) };
    });
    expect(words).toEqual({ text: 'Welcome to Diapo', divider: '', note: 'Say hello first' });

    // The Decks drawer and the title bar name a deck by its title; New writes the name in.
    const r = await page.request.post('/api/new?path=' + encodeURIComponent('quarterly-review/index.html'));
    expect((await r.json()).ok).toBe(true);
    const made = fs.readFileSync(path.join(__dirname, '.tmp-workspace', 'quarterly-review', 'index.html'), 'utf8');
    expect(made).toContain('<title>Quarterly review</title>');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+o');
    await expect(page.locator('#drawerList .drawer-file .name', { hasText: 'Quarterly review' })).toBeVisible();
    await expect(page.locator('#drawerList .deck-thumb.filled iframe').first()).toHaveAttribute('sandbox', 'allow-same-origin');
    await expect(page.locator('#fileName')).not.toHaveText(/index\.html/);
    fs.rmSync(path.join(__dirname, '.tmp-workspace', 'quarterly-review'), { recursive: true, force: true });
});
test('67 keyboard: decks open from the list, swatches and the panel\'s marks are buttons, a focused control keeps Enter, arrows and Delete', async ({ page }) => {
    await page.request.post('/api/trust?file=' + encodeURIComponent('sample/index.html') + '&on=1');
    await page.goto('/');
    await page.waitForFunction(() => window.deckEditor && document.body.classList.contains('no-deck'));
    // With no deck open, what needs one is off.
    for (const id of ['btnInsert', 'btnTheme', 'btnZoomFit', 'btnPreview', 'btnPresenter', 'btnExport']) await expect(page.locator('#' + id)).toBeDisabled();

    // The Decks drawer: Tab reaches a deck, Enter opens it.
    await page.keyboard.press('Control+o');
    await expect(page.locator('#drawerList .drawer-deck').first()).toBeVisible();
    await page.focus('#drawerFilter');
    await page.keyboard.type('sample/index');
    await expect(page.locator('#drawerList .drawer-file')).toHaveCount(1);
    for (let i = 0; i < 12 && !(await page.evaluate(() => document.activeElement.matches('#drawerList .drawer-deck'))); i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.closest('.drawer-file').dataset.path)).toBe('sample/index.html');
    await expect(page.locator('#drawerList .drawer-file .acts')).toBeVisible();          // Rename and Duplicate show on focus too
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && window.deckEditor.file === 'sample/index.html');
    await expect(page.locator('#btnInsert')).toBeEnabled();
    await page.waitForTimeout(900);

    // Swatches: buttons named for people, not CSS variables.
    const h1 = await centre(page, 'h1');
    await page.mouse.click(h1.x, h1.y);
    const swatch = page.locator('#inspSwatches .insp-swatch').first();
    await expect(swatch).toBeVisible();
    expect(await swatch.evaluate(el => el.tagName)).toBe('BUTTON');
    const label = await swatch.getAttribute('aria-label');
    expect(label).toMatch(/^[A-Z][^-]* #[0-9a-f]{6}$/);
    // Tab to it, Enter applies it: the heading is not put into text editing.
    const before = await page.evaluate(() => { const el = window.deckEditor.selection.primary; return { color: el.style.color, box: JSON.stringify(window.deckEditor.deck.stageRect(el)) }; });
    await page.focus('#inspColourTarget button[data-t="border"]');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.matches('#inspSwatches .insp-swatch'))).toBe(true);
    await page.keyboard.press('Enter');
    let st = await page.evaluate(() => { const a = window.deckEditor, el = a.selection.primary; return { color: el.style.color, editing: a.textEdit.active, box: JSON.stringify(a.deck.stageRect(el)), alive: el.isConnected }; });
    expect(st.color).toMatch(/^var\(--/);
    expect(st.color).not.toBe(before.color);
    expect(st.editing).toBe(false);
    // Arrows and Delete on a focused swatch are the swatch's, not the canvas's.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Delete');
    st = await page.evaluate(() => { const a = window.deckEditor, el = a.selection.primary; return { box: JSON.stringify(a.deck.stageRect(el)), alive: el.isConnected, slide: a.deck.current }; });
    expect(st).toEqual({ box: before.box, alive: true, slide: 0 });
    // After a click (no keyboard focus ring) the canvas keys work as before.
    await page.mouse.click(h1.x, h1.y);
    await page.locator('#inspSwatches .insp-swatch').nth(1).click();
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => JSON.stringify(window.deckEditor.deck.stageRect(window.deckEditor.selection.primary)))).not.toBe(before.box);

    // A field's "back to the deck's value" mark: Tab reaches it once the field is set, Enter presses it.
    await page.fill('#inspSize', '50');
    await page.keyboard.press('Enter');
    await expect(page.locator('.insp-field[data-prop="fontSize"]')).toHaveClass(/\bset\b/);
    await page.focus('#inspSize');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.matches('.insp-field[data-prop="fontSize"] .insp-clear[role="button"]'))).toBe(true);
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.deckEditor.selection.primary.style.fontSize)).toBe('');
});

/* ------------------------------------------------------------
   70. Equations and chemical structures
   ------------------------------------------------------------ */
test('70 equations and structures: LaTeX and SMILES drawn as SVG in the deck, edited live in the panel, one undo step each, saved and drawn again from source', async ({ page }) => {
    test.setTimeout(60000);
    await openDeck(page);
    const info = (sel) => page.evaluate((sel) => {
        const f = window.deckEditor.deck.doc.querySelector(sel);
        if (!f) return null;
        const svg = f.querySelector(':scope > svg');
        return { src: f.getAttribute(sel === 'figure[data-math]' ? 'data-math' : 'data-chem'), key: svg && svg.getAttribute('data-key'), label: svg && svg.getAttribute('aria-label'),
            w: svg && svg.getAttribute('width'), paths: f.querySelectorAll('svg path').length, style: !!f.querySelector('style, script'), html: f.innerHTML,
            colours: f.getAttribute('data-chem-colours'), red: f.innerHTML.includes('#e0402a'), font: f.style.fontSize, selected: window.deckEditor.selection.single === f };
    }, sel);

    // Insert > Equation: E = mc^2 drawn by MathJax, every glyph a path, sized in em.
    await page.click('#btnInsert');
    await page.click('[data-insert="equation"]');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-math] > svg'));
    let m = await info('figure[data-math]');
    expect(m).toMatchObject({ src: 'E = mc^2', label: 'E = mc^2', style: false, selected: true });
    expect(m.paths).toBeGreaterThan(3);
    expect(m.w).toMatch(/^[\d.]+em$/);
    await expect(page.locator('#inspMath')).toBeVisible();
    // Typed in the panel, it is drawn as it goes; Ctrl+Enter makes it one undo step.
    const eq = '\\frac{a}{b} + \\ce{H2O}';
    await page.fill('#mathTex', eq);
    await page.waitForFunction((eq) => window.deckEditor.deck.doc.querySelector('figure[data-math] > svg').getAttribute('aria-label') === eq, eq);
    await page.focus('#mathTex');
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction((eq) => window.deckEditor.deck.doc.querySelector('figure[data-math]').getAttribute('data-math') === eq, eq);
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await info('figure[data-math]')).toMatchObject({ src: 'E = mc^2', label: 'E = mc^2' });
    await page.evaluate(() => window.deckEditor.history.redo());
    expect(await info('figure[data-math]')).toMatchObject({ src: eq, label: eq });
    // A mistake says what is wrong and the slide keeps the last drawing that worked.
    await page.fill('#mathTex', '\\frac{a}{');
    await expect(page.locator('#mathError')).toContainText('Missing close brace');
    expect((await info('figure[data-math]')).label).toBe(eq);
    // The buttons under the box: a selection is wrapped (the cursor goes to the next slot); nothing selected, the cursor goes in.
    await page.fill('#mathTex', 'a + b');
    await page.evaluate(() => document.getElementById('mathTex').setSelectionRange(0, 1));
    await page.click('#mathKeys button[title^="Fraction"]');
    expect(await page.evaluate(() => { const t = document.getElementById('mathTex'); return [t.value, t.selectionStart, document.activeElement === t]; })).toEqual(['\\frac{a}{} + b', 9, true]);
    await page.keyboard.type('2');
    await page.click('#mathKeys button[title^="Square root"]');
    await page.keyboard.type('x');
    await page.click('#mathKeys button[title^="Times"]');
    expect(await page.inputValue('#mathTex')).toBe('\\frac{a}{2\\sqrt{x\\times }} + b');          // the cursor stays in the root's slot
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-math] > svg').getAttribute('aria-label') === '\\frac{a}{2\\sqrt{x\\times }} + b');
    await page.fill('#mathTex', eq);
    await expect(page.locator('#mathError')).toBeHidden();
    await page.locator('#mathTex').blur();
    // The look: STIX Two (MathJax 4 in a frame of its own) draws other glyphs; one undo step; new equations take it.
    const keyOf = () => page.evaluate(() => { const f = window.deckEditor.deck.doc.querySelector('figure[data-math]'); return [f.getAttribute('data-math-font'), f.querySelector('svg').getAttribute('data-key'), f.querySelector('svg').innerHTML.length]; });
    // Leaving the box redrew what it says (the typing above came back to `eq`).
    await page.waitForFunction((eq) => window.deckEditor.deck.doc.querySelector('figure[data-math] > svg').getAttribute('aria-label') === eq, eq);
    const classic = await keyOf();
    await page.click('#mathFont [data-font="stix2"]');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-math]').getAttribute('data-math-font') === 'stix2', null, { timeout: 20000 });
    const stix = await keyOf();
    expect(stix[1]).not.toBe(classic[1]);
    expect(stix[2]).not.toBe(classic[2]);
    await expect(page.locator('#mathFont [data-font="stix2"]')).toHaveClass(/\bon\b/);
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await keyOf()).toEqual(classic);
    await page.evaluate(() => window.deckEditor.history.redo());
    expect((await keyOf())[0]).toBe('stix2');
    expect(await page.evaluate(async () => { const m = await import('/core/math.js'); return m.lastMathFont(); })).toBe('stix2');
    await page.evaluate(() => window.deckEditor.history.undo());
    await page.evaluate(() => localStorage.removeItem('diapo-math-font'));
    // A double-click on it goes to its LaTeX; a corner handle sizes it through its font size.
    const box = await page.evaluate(() => { const ed = window.deckEditor, f = ed.deck.doc.querySelector('figure[data-math]'); ed.selection.select(f); return ed.deck.stageRect(f); });
    const p = await stagePoint(page, box.x + box.w / 2, box.y + box.h / 2);
    await page.mouse.dblclick(p.x, p.y);
    await expect(page.locator('#mathTex')).toBeFocused();
    await page.keyboard.press('Escape');
    const k = await scale(page);
    const se = await page.locator('.ov-h[data-h="se"]').boundingBox();
    await drag(page, { x: se.x + se.width / 2, y: se.y + se.height / 2 }, { x: se.x + se.width / 2 + box.w * 0.5 * k, y: se.y + se.height / 2 + box.h * 0.5 * k });
    m = await info('figure[data-math]');
    expect(parseFloat(m.font)).toBeGreaterThan(80);
    expect(m.w).toMatch(/em$/);

    // Insert > Chemical structure: aspirin from its SMILES, its formula in the panel, no <style> leaking into the deck.
    await page.click('#btnInsert');
    await page.click('[data-insert="structure"]');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-chem] > svg'));
    let c = await info('figure[data-chem]');
    expect(c).toMatchObject({ src: 'CC(=O)Oc1ccccc1C(=O)O', style: false, selected: true, red: true });
    expect(c.label).toContain('C9H8O4');
    await expect(page.locator('#chemFormula')).toHaveText('Formula: C9H8O4');
    await page.fill('#chemSmiles', 'Oc1ccccc1');
    await page.press('#chemSmiles', 'Enter');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-chem]').getAttribute('data-chem') === 'Oc1ccccc1');
    await expect(page.locator('#chemFormula')).toHaveText('Formula: C6H6O');
    // Atom colours off: one colour (the figure's), an undo step of its own.
    await page.click('#chemColours');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-chem]').getAttribute('data-chem-colours') === 'off');
    expect((await info('figure[data-chem]')).red).toBe(false);
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await info('figure[data-chem]')).toMatchObject({ colours: null, red: true, src: 'Oc1ccccc1' });
    // The ring has alternating double bonds (kekule.js); "Aromatic rings as circles" draws the circle instead.
    const ringCircles = () => page.evaluate(() => [...window.deckEditor.deck.doc.querySelectorAll('figure[data-chem] svg circle')].filter(c => !c.closest('mask')).length);
    expect(await ringCircles()).toBe(0);
    await page.click('#chemCircles');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-chem]').getAttribute('data-chem-aromatic') === 'circles');
    expect(await ringCircles()).toBe(1);
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await ringCircles()).toBe(0);
    // The atom labels take the figure's font (the Text section's Font field), the deck's by default.
    const labelFont = () => page.evaluate(() => { const f = window.deckEditor.deck.doc.querySelector('figure[data-chem]'), t = f.querySelector('svg text'), w = window.deckEditor.deck.win; return [w.getComputedStyle(t).fontFamily, w.getComputedStyle(f).fontFamily]; });
    let lf = await labelFont();
    expect(lf[0]).toBe(lf[1]);
    await page.evaluate(() => { const ed = window.deckEditor, f = ed.deck.doc.querySelector('figure[data-chem]'); ed.history.style(f, (el) => { el.style.fontFamily = 'Georgia, serif'; }, { label: 'Font' }); });
    lf = await labelFont();
    expect(lf[0]).toBe('Georgia, serif');
    await page.evaluate(() => window.deckEditor.history.undo());
    // Rotated, the bonds turn and the atom labels stay level; undone, the labels go back.
    const labels = () => page.evaluate(() => { const svg = window.deckEditor.deck.doc.querySelector('figure[data-chem] > svg'); return { key: svg.getAttribute('data-upright'), turns: [...svg.querySelectorAll('text')].map(t => t.getAttribute('transform')) }; });
    await page.evaluate(() => { const ed = window.deckEditor, f = ed.deck.doc.querySelector('figure[data-chem]'); ed.history.style(f, (el) => { el.style.rotate = '90deg'; }, { label: 'Rotate' }); });
    let l = await labels();
    expect(l.key).toBe('90');
    expect(l.turns.length).toBeGreaterThan(0);
    for (const t of l.turns) expect(t).toMatch(/^rotate\(-90 [\d.-]+ [\d.-]+\)$/);
    await page.evaluate(() => window.deckEditor.history.undo());
    l = await labels();
    expect(l.key).toBe(null);
    for (const t of l.turns) expect(t).toBe(null);
    await page.fill('#chemSmiles', 'C1CC(');
    await expect(page.locator('#chemError')).toBeVisible();
    await page.fill('#chemSmiles', 'Oc1ccccc1');
    await expect(page.locator('#chemError')).toBeHidden();
    await page.locator('#chemSmiles').blur();

    // Saved: source and drawing in the file; opened again, nothing is redrawn and nothing is dirty.
    const mHtml = (await info('figure[data-math]')).html, cHtml = (await info('figure[data-chem]')).html;
    await save(page);
    const saved = readDeck();
    expect(saved).toContain('data-math="\\frac{a}{b} + \\ce{H2O}"');
    expect(saved).toContain('data-chem="Oc1ccccc1"');
    expect(saved).not.toMatch(/<figure data-chem[^>]*>[\s\S]*?<style/);
    await openDeck(page);
    expect((await info('figure[data-math]')).html).toBe(mHtml);
    expect((await info('figure[data-chem]')).html).toBe(cHtml);
    expect(await page.evaluate(() => window.deckEditor.dirty)).toBe(false);

    // Written by hand (or by a deck generator) with the source alone: drawn on open; what does not parse is a problem.
    const start = '<section class="slide title-slide active" data-name="title">';
    fs.writeFileSync(DECK, readDeck().replace(start, start
        + '<figure data-math="x^2 + y^2 = r^2" style="position:absolute; left:100px; top:100px; margin:0; font-size:48px"></figure>'
        + '<figure data-chem="CCO" style="position:absolute; left:100px; top:300px; width:300px; height:200px; margin:0"></figure>'
        + '<figure data-math="\\sqrt{" style="position:absolute; left:100px; top:600px; margin:0"></figure>'));
    await openDeck(page);
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-math="x^2 + y^2 = r^2"] > svg') && window.deckEditor.deck.doc.querySelector('figure[data-chem="CCO"] > svg'));
    await expect(page.locator('#problemsBadge')).toHaveText('1 problem');
    await page.click('#problemsBadge');
    await expect(page.locator('.problems')).toContainText('Equation not drawn on slide 1');
});
