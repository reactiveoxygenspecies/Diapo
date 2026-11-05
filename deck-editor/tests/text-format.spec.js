// Text formatting while editing: superscript / subscript toggling and pasting rich text.
const { test, expect, freshDeckEachTest, openDeck } = require('./helpers');

freshDeckEachTest();

/* Start editing the first <p> of the current slide with `html` as its content. */
async function editWith(page, html) {
    await openDeck(page);
    await page.evaluate((html) => {
        const a = window.deckEditor, p = a.deck.currentSlide.querySelector('p');
        p.innerHTML = html;
        window.__p = p;
        a.textEdit.start(p);
    }, html);
}
const html = (page) => page.evaluate(() => window.__p.innerHTML.replace(/\u200b/g, ''));     // zero-width spaces are the caret's footing until the edit ends
const exec = (page, c) => page.evaluate((c) => window.deckEditor.textEdit.exec(c), c);

/* Select the text `str` (found in one text node of the edited element). */
const find = (page, str) => page.evaluate((str) => {
    const d = window.deckEditor.deck, el = window.__p;
    const w = d.doc.createTreeWalker(el, 4); let t;
    while ((t = w.nextNode())) { const k = t.data.indexOf(str); if (k >= 0) {
        d.win.focus(); el.focus({ preventScroll: true });
        const r = d.doc.createRange(); r.setStart(t, k); r.setEnd(t, k + str.length);
        const s = d.win.getSelection(); s.removeAllRanges(); s.addRange(r); return true; } }
    return false;
}, str);
/* Firefox gives a paste event made by a script an empty clipboard (getData answers ''), so the
   pasted data cannot be simulated there; a real paste in Firefox carries it. */
const noSyntheticPaste = () => test.skip(test.info().project.name === 'firefox', 'Firefox empties the clipboard of a synthetic paste event');

/* Dispatch a paste carrying `data` (type -> string) into the edited text. */
const paste = (page, data) => page.evaluate((data) => {
    const d = window.deckEditor.deck;
    const dt = new d.win.DataTransfer();
    for (const [k, v] of Object.entries(data)) dt.setData(k, v);
    d.doc.dispatchEvent(new d.win.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, data);
const caretEnd = (page) => page.evaluate(() => {
    const d = window.deckEditor.deck, el = window.__p; el.focus({ preventScroll: true });
    const r = d.doc.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s = d.win.getSelection(); s.removeAllRanges(); s.addRange(r);
});
/* The caret inside the first <sup> at offset k. */
const caretInSup = (page, k) => page.evaluate((k) => {
    const d = window.deckEditor.deck, el = window.__p; const t = el.querySelector('sup').firstChild; el.focus({ preventScroll: true });
    const r = d.doc.createRange(); r.setStart(t, k); r.collapse(true); const s = d.win.getSelection(); s.removeAllRanges(); s.addRange(r);
}, k);

test('superscript: the same shortcut again takes it off, whole or in part', async ({ page }) => {
    await editWith(page, 'a hello b');
    await find(page, 'hello'); await page.keyboard.press('Control+Shift+=');
    expect(await html(page)).toBe('a <sup>hello</sup> b');
    await page.keyboard.press('Control+Shift+=');
    expect(await html(page)).toBe('a hello b');
    // Part of it: the element splits round the selection.
    await editWith(page, 'a <sup>hello</sup> b');
    await find(page, 'ell'); await exec(page, 'sup');
    expect(await html(page)).toBe('a <sup>h</sup>ell<sup>o</sup> b');
    // A selection reaching past the element is not all superscript: it applies to the lot, then toggles off.
    await editWith(page, 'a <sup>hello</sup> b');
    await page.evaluate(() => { const d = window.deckEditor.deck, el = window.__p; const r = d.doc.createRange(); r.setStart(el.firstChild, 0); r.setEnd(el.lastChild, 1); const s = d.win.getSelection(); el.focus(); s.removeAllRanges(); s.addRange(r); });
    await exec(page, 'sup');
    expect(await html(page)).toBe('<sup>a hello </sup>b');
    await exec(page, 'sup');
    expect(await html(page)).toBe('a hello b');
});

test('superscript on subscript swaps, and a reset stylesheet does not defeat the toggle', async ({ page }) => {
    await editWith(page, 'x <sub>2</sub> y');
    await page.evaluate(() => { const st = document.createElement('style'); st.textContent = 'sup,sub{vertical-align:baseline;position:relative}'; window.deckEditor.deck.doc.head.appendChild(st); });
    await find(page, '2'); await exec(page, 'sup');
    expect(await html(page)).toBe('x <sup>2</sup> y');
    await exec(page, 'sup');
    expect(await html(page)).toBe('x 2 y');
    await exec(page, 'sub');
    expect(await html(page)).toBe('x <sub>2</sub> y');
});

test('superscript: the caret inside it steps out for what is typed next; the bar shows the state', async ({ page }) => {
    await editWith(page, 'a <sup>hello</sup> b');
    await caretInSup(page, 2);
    await page.waitForTimeout(100);
    await expect(page.locator('.textbar [data-cmd=sup]')).toHaveClass(/on/);
    await expect(page.locator('.textbar [data-cmd=sub]')).not.toHaveClass(/on/);
    await page.keyboard.press('Control+Shift+=');
    await page.keyboard.type('X');
    expect(await html(page)).toBe('a <sup>he</sup>X<sup>llo</sup> b');
    await editWith(page, 'a <sup>hello</sup> b');
    await caretInSup(page, 5);
    await page.keyboard.press('Control+Shift+=');
    await page.keyboard.type('X');
    expect(await html(page)).toBe('a <sup>hello</sup>X b');
});

test('superscript: undo and redo take the whole edit back and forward', async ({ page }) => {
    await editWith(page, 'a hello b');
    await find(page, 'hello'); await exec(page, 'sup');
    await exec(page, 'sup');
    await exec(page, 'sub');
    await page.evaluate(() => window.deckEditor.textEdit.commit());
    expect(await page.evaluate(() => window.__p.innerHTML)).toBe('a <sub>hello</sub> b');
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await page.evaluate(() => window.__p.innerHTML)).toBe('a hello b');
    await page.evaluate(() => window.deckEditor.history.redo());
    expect(await page.evaluate(() => window.__p.innerHTML)).toBe('a <sub>hello</sub> b');
});

test('paste: rich text keeps colour, bold, links and breaks; scripts, handlers and layout are dropped', async ({ page }) => {
    noSyntheticPaste();
    await editWith(page, 'start:');
    await caretEnd(page);
    await paste(page, {
        'text/plain': 'plain version',
        'text/html': '<html><body><!--StartFragment--><p class="MsoNormal" style="margin:0cm;font-size:11pt;font-family:Calibri;position:absolute"><span style="color:#ff0000;mso-ignore:x;font-size:14pt">red</span> <b>bold</b> <span style="background:yellow">hi</span><o:p></o:p></p>'
            + '<p onclick="alert(1)"><a href="javascript:alert(1)" onmouseover="x()">bad</a> <a href="https://example.com/a" target="_blank">good</a><br>next<sup>2</sup><script>alert(1)</script><img src="http://x/y.png"></p><!--EndFragment--></body></html>',
    });
    const h = await html(page);
    expect(h).toMatch(/<span style="color: ?(#ff0000|rgb\(255, 0, 0\));?">red<\/span>/);
    expect(h).toContain('<b>bold</b>');
    expect(h).toMatch(/background-color: ?(yellow|rgb\(255, 255, 0\))/);
    expect(h).toContain('<a href="https://example.com/a">good</a>');
    expect(h).toContain('<sup>2</sup>');
    expect(h).toContain('<br>');
    for (const bad of ['script', 'onclick', 'onmouseover', 'javascript', '<img', 'font-size', 'font-family', 'position', 'class=', 'Mso', 'alert']) expect(h).not.toContain(bad);
    expect(h).toContain('bad');
});

test('paste: Ctrl+Shift+V pastes the plain text only', async ({ page }) => {
    noSyntheticPaste();
    await editWith(page, 'start:');
    await caretEnd(page);
    // The keystroke arms a plain paste (a real one needs the system clipboard, so its paste event is sent by hand).
    await page.evaluate(() => { const d = window.deckEditor.deck; d.doc.dispatchEvent(new d.win.KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); });
    await paste(page, { 'text/plain': 'just text', 'text/html': '<b style="color:red">just text</b>' });
    expect(await html(page)).toBe('start:just text');
    await paste(page, { 'text/plain': 'again', 'text/html': '<b style="color:red">again</b>' });
    expect(await html(page)).toContain('<b>again</b>');
});

test('paste: text copied from an element on the canvas keeps the colour set in the editor', async ({ page }) => {
    noSyntheticPaste();
    await openDeck(page);
    const clip = await page.evaluate(() => {
        const a = window.deckEditor, el = a.deck.currentSlide.querySelector('p');
        el.style.color = 'rgb(200, 30, 40)';
        el.setAttribute('data-id', 'cp1');
        el.setAttribute('data-css', 'background-color: #123456;');
        return a.editops._markup([el]);
    });
    await page.evaluate(() => { const a = window.deckEditor, p = a.deck.currentSlide.querySelector('h1, h2'); window.__p = p; p.innerHTML = 'target '; a.textEdit.start(p); });
    await caretEnd(page);
    await paste(page, { 'text/plain': 'x', 'text/html': clip });
    const h = await html(page);
    expect(h).toMatch(/color: ?rgb\(200, 30, 40\)/);
    expect(h).toMatch(/background-color: ?#123456/);
    expect(h).not.toContain('data-');
    expect(h).not.toContain('position');
});

test('paste: an element copied on the canvas pastes with its colour as another element', async ({ page }) => {
    await openDeck(page);
    const r = await page.evaluate(() => {
        const a = window.deckEditor, d = a.deck, el = d.currentSlide.querySelector('p');
        el.style.color = 'rgb(200, 30, 40)';
        const dt = new d.win.DataTransfer(); dt.setData('text/html', a.editops._markup([el])); dt.setData('text/plain', el.textContent);
        const n = d.currentSlide.querySelectorAll('p').length;
        a.editops.paste(dt);
        return { grew: d.currentSlide.querySelectorAll('p').length - n, colour: d.win.getComputedStyle(a.selection.primary).color };
    });
    expect(r.grew).toBe(1);
    expect(r.colour).toBe('rgb(200, 30, 40)');
});
