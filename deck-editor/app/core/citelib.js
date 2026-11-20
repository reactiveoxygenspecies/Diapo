/* ============================================================
   citelib.js - the deck's references in a dialog (Insert >
   Citation library..., the Library button of the citation popover,
   the Sources slide's panel): search them, see where each is cited,
   import a .bib / RIS / CSL-JSON file or a paste, add one by its
   DOI, change a key, remove what is not cited, and choose the style
   the whole deck is written in (any CSL style: the ones Diapo
   carries, or a .csl file). Every change is one undo step.
   ============================================================ */
import { CITE, CUSTOM_STYLE_ID, keysOf, parseCite, formatCite, parseReferences, styleList, styleIdOf, customStyle, styleTitle, authorsShort, yearOf, isKey, escapeHtml } from './cite.js';
import { searchRefs } from './citepop.js';

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;

export function openCiteLibrary(app, { select = null } = {}) {
    if (!app.deck.isOpen) return;
    if (app.textEdit.active) app.textEdit.commit();
    document.querySelectorAll('.help.citelib').forEach(h => h.remove());
    const lib = app.sources.library, deck = app.deck;
    const h = document.createElement('div');
    h.className = 'help citelib';
    h.setAttribute('role', 'dialog'); h.setAttribute('aria-modal', 'true'); h.setAttribute('aria-label', 'References in this deck');
    h.innerHTML = `<div class="help-card citelib-card">
        <div class="citelib-head"><h2>References in this deck</h2><span class="chip" id="clCount"></span><span class="chip ok" id="clCited"></span><span class="spacer"></span>
            <label class="citelib-lab" for="clStyle">Style</label><select id="clStyle" title="How every citation and the Sources slide are written: a CSL style, the format of Zotero, Mendeley and Pandoc"></select>
            <button class="citelib-x" id="clClose" title="Close (Esc)" aria-label="Close">&times;</button></div>
        <div class="citelib-tools"><input type="text" id="clSearch" placeholder="Search author, title, year, key, DOI" spellcheck="false" aria-label="Search the references">
            <div class="insp-seg citelib-seg" id="clFilter"><button data-f="all" class="on">All</button><button data-f="cited">Cited</button><button data-f="unused">Not cited</button></div></div>
        <div class="citelib-body"><div class="citelib-table"><table><thead><tr><th>Key</th><th>First author</th><th>Year</th><th>Title</th><th>Slides</th></tr></thead><tbody id="clRows"></tbody></table><div class="citelib-empty" id="clEmpty" hidden></div></div>
            <div class="citelib-detail" id="clDetail"></div></div>
        <div class="citelib-paste" id="clPaste" hidden><textarea id="clPasteText" rows="6" spellcheck="false" placeholder="@article{szostak2001, author = {Szostak, Jack W. and ...}, title = {Synthesizing life}, ...}&#10;BibTeX, BibLaTeX, RIS or CSL-JSON" aria-label="References to add"></textarea>
            <div class="row"><span class="citelib-msg" id="clPasteMsg"></span><span class="spacer"></span><button class="mini-btn" id="clPasteCancel">Cancel</button><button class="mini-btn primary" id="clPasteAdd">Add these</button></div></div>
        <div class="citelib-foot">
            <button class="mini-btn" id="clImport" title="A .bib (BibTeX, BibLaTeX), .ris or CSL-JSON file: what Zotero, Mendeley, JabRef and Pandoc export">Import a file...</button>
            <button class="mini-btn" id="clPasteBtn">Paste...</button>
            <input type="text" id="clDoi" placeholder="DOI, e.g. 10.1038/35053176" spellcheck="false" aria-label="Add a reference by its DOI"><button class="mini-btn" id="clDoiAdd" title="Looks the reference up at doi.org">Add</button>
            <span class="spacer"></span><span class="citelib-msg" id="clMsg" role="status"></span>
            <button class="mini-btn" id="clUnused" title="Take the references cited nowhere out of the deck">Remove unused</button>
            <button class="tb-btn primary" id="clDone">Done</button>
        </div>
        <input type="file" id="clFile" accept=".bib,.bibtex,.ris,.json,.txt,application/json" multiple hidden>
        <input type="file" id="clCsl" accept=".csl,.xml" hidden>
    </div>`;
    document.body.appendChild(h);
    const $ = (id) => h.querySelector('#' + id);
    let filter = 'all', current = select;
    const say = (text, bad = false) => { $('clMsg').textContent = text; $('clMsg').classList.toggle('bad', bad); };
    const close = () => h.remove();
    $('clClose').addEventListener('click', close);
    $('clDone').addEventListener('click', close);
    h.addEventListener('pointerdown', (e) => { if (e.target === h) close(); });
    h.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }, true);

    /* Where each key is cited: key -> [slide numbers]. */
    const citedOn = () => {
        const out = new Map(), slides = deck.slides;
        for (const s of deck.stage.querySelectorAll(CITE)) {
            if (s.closest('[data-sources-body], [data-slide-refs]')) continue;
            const sl = s.closest('.slide'), n = sl ? slides.indexOf(sl) + 1 : 0;
            for (const k of keysOf(s)) { if (!out.has(k)) out.set(k, []); if (n && !out.get(k).includes(n)) out.get(k).push(n); }
        }
        return out;
    };
    const first = (it) => { const a = (it.author || it.editor || [])[0]; return a ? (a.family || a.literal || '') + (a.given ? ', ' + a.given.split(/\s+/).map(g => g[0] + '.').join(' ') : '') : ''; };

    function rows() {
        const cited = citedOn(), items = lib.items;
        $('clCount').textContent = items.length + (items.length === 1 ? ' reference' : ' references');
        $('clCited').textContent = items.filter(it => cited.has(it.id)).length + ' cited';
        let list = searchRefs(items, $('clSearch').value, 10000);
        if (filter === 'cited') list = list.filter(it => cited.has(it.id));
        if (filter === 'unused') list = list.filter(it => !cited.has(it.id));
        $('clRows').innerHTML = list.map(it => `<tr data-id="${escapeHtml(it.id)}" class="${it.id === current ? 'sel' : ''} ${cited.has(it.id) ? '' : 'unused'}" tabindex="0">
            <td class="mono">${escapeHtml(it.id)}</td><td>${escapeHtml(first(it))}</td><td>${escapeHtml(yearOf(it))}</td><td class="t">${escapeHtml(it.title || '')}</td><td>${(cited.get(it.id) || []).join(', ') || '–'}</td></tr>`).join('');
        const missing = [...cited.keys()].filter(k => !lib.has(k));
        $('clEmpty').hidden = !!(list.length || missing.length) && !!items.length;
        $('clEmpty').innerHTML = !items.length ? 'No references yet. <b>Import a file</b> (.bib from Zotero, Mendeley or JabRef; RIS; CSL-JSON), <b>paste</b> some, or add one by its <b>DOI</b>.' : 'Nothing matches.';
        if (missing.length) $('clEmpty').hidden = false, $('clEmpty').innerHTML = (items.length && !list.length ? 'Nothing matches. ' : '') + `Cited in the deck but not in the library: <b>${missing.map(escapeHtml).join(', ')}</b>. Import them, or change those citations.`;
        $('clUnused').disabled = !items.some(it => !cited.has(it.id));
        detail();
    }
    function detail() {
        const it = current && lib.get(current), box = $('clDetail');
        if (!it) { box.innerHTML = '<div class="citelib-none">Choose a reference to see it, where it is cited, and how the style writes it.</div>'; return; }
        const cited = citedOn().get(it.id) || [];
        const names = (it.author || it.editor || []).map(a => a.literal || [a.given, a.family].filter(Boolean).join(' ')).join(', ');
        const venue = [it['container-title'] || it.publisher, it.volume, it.page].filter(Boolean).join(', ');
        const entry = app.sources.lastBib && app.sources.lastBib.get(it.id);
        box.innerHTML = `<h3>${escapeHtml(it.title || it.id)}</h3><div class="who">${escapeHtml(names)}</div>
            <div class="kv"><span>In</span><span>${escapeHtml(venue) || '–'}</span><span>Year</span><span>${escapeHtml(yearOf(it)) || '–'}</span>
            ${it.DOI ? `<span>DOI</span><span><a href="https://doi.org/${encodeURI(it.DOI)}" target="_blank" rel="noopener">${escapeHtml(it.DOI)}</a></span>` : ''}
            <span>Key</span><span><input type="text" id="clKey" value="${escapeHtml(it.id)}" spellcheck="false" aria-label="Citation key" title="The key the citations use ([@key]); changing it changes them too"></span></div>
            <div class="theme-sub">Cited on</div><div class="citelib-where">${cited.length ? cited.map(n => `<button class="mini-btn" data-go="${n}">Slide ${n}</button>`).join('') : '<span class="citelib-none">Nowhere yet</span>'}</div>
            <div class="theme-sub">As the style writes it</div><div class="citelib-entry">${entry || '<span class="citelib-none">Written once it is cited (or when the Sources slide lists everything).</span>'}</div>
            <div class="row"><span class="spacer"></span><button class="mini-btn" id="clRemove">Remove from the deck</button></div>`;
        box.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { deck.goTo(+b.dataset.go - 1); }));
        $('clKey').addEventListener('change', () => renameKey(it.id, $('clKey').value.trim()));
        $('clKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
        $('clRemove').addEventListener('click', () => removeKeys([it.id]));
    }
    function renameKey(from, to) {
        if (to === from) return;
        if (!isKey(to)) { say('A key is letters, digits and _ : . - /, starting with a letter or a digit.', true); detail(); return; }
        if (lib.has(to)) { say('There is a reference with the key ' + to + ' already.', true); detail(); return; }
        app.history.begin('Change citation key');
        lib.write(app.history, lib.items.map(x => x.id === from ? { ...x, id: to } : x), 'Change citation key');
        for (const s of deck.stage.querySelectorAll(CITE)) {
            const c = parseCite(s.getAttribute('data-cite'));
            if (!c || !c.items.some(i => i.id === from)) continue;
            c.items.forEach(i => { if (i.id === from) i.id = to; });
            app.history.attr(s, 'data-cite', formatCite(c), 'Change citation key');
        }
        app.history.end();
        current = to; say('Key changed; the citations use ' + to + ' now.');
        app.sources.schedule(0); rows();
    }
    function removeKeys(ids) {
        const cited = citedOn(), used = ids.filter(id => cited.has(id));
        if (used.length && !confirm(`${used.join(', ')} ${used.length > 1 ? 'are' : 'is'} cited in the deck (slide ${used.map(id => cited.get(id).join(', ')).join('; ')}). Remove anyway? The citations then show their keys until a reference with that key is added again.`)) return;
        lib.write(app.history, lib.items.filter(x => !ids.includes(x.id)), ids.length > 1 ? 'Remove references' : 'Remove reference');
        if (ids.includes(current)) current = null;
        say(ids.length > 1 ? `Removed ${ids.length} references.` : 'Removed ' + ids[0] + '.');
        app.sources.schedule(0); rows();
    }
    async function add(text, what) {
        say('Reading ' + what + '...');
        try {
            const items = await parseReferences(text);
            if (!items.length) { say('No references found in ' + what + '.', true); return false; }
            const r = lib.merge(app.history, items, 'Import references');
            say(`${what}: ${r.added} added${r.updated ? `, ${r.updated} updated` : ''}.`);
            if (r.ids[0]) current = r.ids[0];
            app.sources.schedule(0); rows();
            return true;
        } catch (err) { say('Could not read ' + what + ': ' + err.message, true); return false; }
    }
    async function addDoi(raw) {
        const m = DOI_RE.exec(raw || '');
        if (!m) { say('That is not a DOI (they start with 10. and a slash follows).', true); return; }
        say('Looking up ' + m[1] + '...');
        try {
            const r = await app.api.citeDoi(m[1]);
            const out = lib.merge(app.history, [r.item], 'Add reference');
            current = out.ids[0]; $('clDoi').value = '';
            say(out.added ? 'Added ' + current + '.' : 'Updated ' + current + '.');
            app.sources.schedule(0); rows();
        } catch (err) { say('Could not add ' + m[1] + ': ' + err.message, true); }
    }

    // Styles: the ones Diapo carries, and the deck's own .csl if it has one.
    async function styles() {
        const list = await styleList(), own = customStyle(deck), cur = styleIdOf(deck);
        const sel = $('clStyle');
        sel.innerHTML = (own ? `<option value="${escapeHtml(own.id)}">${escapeHtml(own.title)} (this deck's .csl)</option><option disabled>──────────</option>` : '')
            + list.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)}${s.numbered ? ' · numbered' : ''}</option>`).join('')
            + '<option disabled>──────────</option><option value="__file">Another style (.csl file)...</option>';
        sel.value = cur;
        if (sel.value !== cur) sel.value = 'apa';
    }
    $('clStyle').addEventListener('change', () => {
        const v = $('clStyle').value;
        if (v === '__file') { styles(); $('clCsl').click(); return; }
        app.history.attr(deck.stage, 'data-csl-style', v === 'apa' ? null : v, 'Citation style');
        app.sources.schedule(0);
        say('Every citation is written in ' + $('clStyle').selectedOptions[0].textContent.replace(/ · numbered$/, '') + ' now.');
        setTimeout(rows, 400);
    });
    $('clCsl').addEventListener('change', async () => {
        const f = $('clCsl').files[0]; $('clCsl').value = '';
        if (!f) return;
        const xml = await f.text();
        if (!/<style[\s>]/.test(xml) || !/xmlns="http:\/\/purl\.org\/net\/xbiblio\/csl"/.test(xml)) { say(f.name + ' is not a CSL style.', true); return; }
        if (/rel="independent-parent"/.test(xml)) { say(f.name + ' is a dependent style: load the style it names as its parent instead.', true); return; }
        const id = 'custom-' + ((/<id>[^<]*\/([^/<]+)<\/id>/.exec(xml) || [])[1] || f.name.replace(/\.\w+$/, '')).replace(/[^\w-]/g, '-');
        app.history.begin('Citation style');
        let s = deck.doc.getElementById(CUSTOM_STYLE_ID);
        if (!s) {
            s = deck.doc.createElement('script');
            s.type = 'application/vnd.citationstyles.csl+xml'; s.id = CUSTOM_STYLE_ID;
            s.setAttribute('data-style-id', id);
            s.textContent = '\n' + xml.replace(/<\/script/gi, '<\\/script') + '\n';
            app.history.insert(s, deck.stage, deck.stage.firstChild, 'Citation style');
        } else {
            const before = s.innerHTML;
            s.textContent = '\n' + xml.replace(/<\/script/gi, '<\\/script') + '\n';
            app.history.html(s, before, s.innerHTML, 'Citation style');
            app.history.attr(s, 'data-style-id', id, 'Citation style');
        }
        app.history.attr(deck.stage, 'data-csl-style', id, 'Citation style');
        app.history.end();
        await styles();
        app.sources.schedule(0);
        say('Every citation is written in ' + styleTitle(xml) + ' now.');
    });

    $('clSearch').addEventListener('input', rows);
    $('clFilter').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; $('clFilter').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); rows(); });
    $('clRows').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (!tr) return; current = tr.dataset.id; rows(); });
    $('clRows').addEventListener('keydown', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && e.key === 'Enter') { current = tr.dataset.id; rows(); } });
    $('clImport').addEventListener('click', () => $('clFile').click());
    $('clFile').addEventListener('change', async () => {
        const files = Array.from($('clFile').files); $('clFile').value = '';
        for (const f of files) await add(await f.text(), f.name);
    });
    $('clPasteBtn').addEventListener('click', () => { $('clPaste').hidden = false; $('clPasteText').focus(); });
    $('clPasteCancel').addEventListener('click', () => { $('clPaste').hidden = true; });
    $('clPasteAdd').addEventListener('click', async () => { if (await add($('clPasteText').value, 'the pasted text')) { $('clPasteText').value = ''; $('clPaste').hidden = true; } });
    $('clDoiAdd').addEventListener('click', () => addDoi($('clDoi').value));
    $('clDoi').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addDoi($('clDoi').value); } });
    $('clUnused').addEventListener('click', () => { const cited = citedOn(); removeKeys(lib.items.filter(it => !cited.has(it.id)).map(it => it.id)); });
    // A .bib dropped on the dialog is imported.
    h.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); e.stopPropagation(); } });
    h.addEventListener('drop', async (e) => { e.preventDefault(); e.stopPropagation(); for (const f of Array.from(e.dataTransfer.files)) await add(await f.text(), f.name); });

    styles();
    rows();
    $('clSearch').focus();
    // The bibliography entries shown in the detail are the last pass's: one now, for this view.
    app.sources.run().then(() => { if (h.isConnected) detail(); });
    return h;
}
