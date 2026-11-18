/* ============================================================
   publish.js - Export > Publish...

   After a talk people want "a link". Diapo hosts nothing and makes no network call for this:
   it writes a folder (the deck as index.html and every file it uses, none of the editor's;
   serve.py write_publish_folder) that goes on a free host the user owns, and the dialog says
   how, step by step. The links to the two hosts open in the user's own browser, only when
   clicked, through the same fixed-address route as the About dialog's.
   ============================================================ */
import { api } from './api.js';

const NO_DIALOG = /no file dialog is available/i;
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sizeLabel = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

export async function showPublish(app) {
    if (!app.deck.isOpen || !app.file) return null;
    document.querySelectorAll('.help.publish').forEach(h => h.remove());
    window.dispatchEvent(new CustomEvent('editor:before-save'));
    let plan;
    try { plan = await api.publishPlan(app.file); } catch (err) { app.toast('Could not prepare the publish: ' + err.message, { error: true }); return null; }
    const html = app.serialize();
    const googleFonts = /fonts\.googleapis\.com\/css/i.test(html);
    const trust = app.deck.trust;
    const paused = !!(trust && trust.scripts && !trust.trusted);
    const h = document.createElement('div');
    h.className = 'help versions publish';
    h.setAttribute('role', 'dialog'); h.setAttribute('aria-modal', 'true'); h.setAttribute('aria-label', 'Publish this deck');
    h.innerHTML = `<div class="help-card publish-card">
        <h2>Publish this deck</h2>
        <p>Diapo does not host anything and sends nothing anywhere. It prepares a folder with your deck and the files it uses; you put that folder on a free host you own, and the host gives you a link.</p>
        <label class="pub-label" for="pubDest">Folder to write</label>
        <div class="row pub-row"><input type="text" id="pubDest" spellcheck="false" value="${esc(plan.dest)}"><button class="tb-btn" id="pubPick">Choose folder...</button></div>
        <label class="about-auto"><input type="checkbox" id="pubZip"> Also make a .zip of it (for hosts that take a zip)</label>
        ${googleFonts ? `<label class="about-auto"><input type="checkbox" id="pubFonts" checked> Download the Google Fonts into the folder <span class="muted">(otherwise the page asks Google for them when it opens)</span></label>` : ''}
        ${paused ? `<p class="about-bad pub-warn">This deck has scripts of its own that you have not trusted, so Diapo is pausing them here. A web host runs them as written. Publish it only if you wrote them or trust where they came from.</p>` : ''}
        <p class="muted pub-hint">Pictures, video, fonts, scripts and styles the deck uses are copied in. Drafts, backups and previous versions stay behind.</p>
        <div id="pubAsk" class="pub-ask" hidden></div>
        <div class="row"><span class="spacer"></span><button class="tb-btn" id="pubClose">Cancel</button><button class="tb-btn primary" id="pubGo">Publish</button></div>
    </div>`;
    const $ = (id) => h.querySelector('#' + id);
    const card = h.querySelector('.help-card');
    let busy = false;

    const run = async (overwrite) => {
        if (busy) return;
        busy = true; $('pubGo').disabled = true;
        $('pubAsk').hidden = true;
        try {
            const r = await api.publish(app.file, html, { to: $('pubDest').value.trim(), overwrite, fonts: !!($('pubFonts') && $('pubFonts').checked), zip: $('pubZip').checked });
            showResult(r);
        } catch (err) {
            if (err.data && err.data.reason === 'not-empty') {
                const ask = $('pubAsk');
                ask.hidden = false;
                ask.innerHTML = `<p><b>${esc(err.message)}.</b> Publishing into it replaces files with the same names and leaves everything else as it is.</p><button class="tb-btn" id="pubOver">Publish into it anyway</button>`;
            } else app.toast('Could not publish: ' + err.message, { error: true, ms: 6000 });
        } finally { busy = false; if (h.isConnected) $('pubGo').disabled = false; }
    };

    const showResult = (r) => {
        const notes = (r.notes || []).length ? `<div class="about-notes">${r.notes.map(esc).join('\n')}</div>` : '';
        card.innerHTML = `<h2>Your site is ready</h2>
            <p>${r.files} file${r.files === 1 ? '' : 's'} (${sizeLabel(r.bytes)}) written to <code class="pub-path">${esc(r.path)}</code>${r.zip ? `, and a zip beside it: <code class="pub-path">${esc(r.zip)}</code>` : ''}.${r.fonts ? ` ${r.fonts} font file${r.fonts === 1 ? '' : 's'} downloaded.` : ''}</p>
            ${notes}
            <div class="row"><button class="tb-btn" id="pubShow">Show the folder</button><button class="tb-btn" id="pubCopy">Copy the folder's path</button></div>
            <h3>Put it online, free</h3>
            <p class="pub-hint muted">Pick one. You keep the account and the files; Diapo is not involved after this.</p>
            <ol class="pub-steps">
                <li><b>Netlify Drop</b> (quickest). Open <button class="mini-btn" data-link="netlify-drop">app.netlify.com/drop</button> and drag the folder onto the page. You get a link at once; make a free account to keep the site beyond a day.</li>
                <li><b>GitHub Pages.</b> Create <button class="mini-btn" data-link="github-new">a new repository</button> (public), choose <i>uploading an existing file</i>, drag in what is <i>inside</i> the folder, and commit. Then open the repository's <i>Settings &gt; Pages</i>, choose the <i>main</i> branch and <i>Save</i>. The link appears there after a minute.</li>
                <li><b>Any web host.</b> Upload the folder's contents (not the folder itself, so that <code>index.html</code> sits at the top) to the site's public folder.</li>
            </ol>
            <div class="row"><span class="spacer"></span><button class="tb-btn primary" id="pubDone">Done</button></div>`;
        card.querySelector('#pubShow').addEventListener('click', () => api.publishReveal(r.path).catch(err => app.toast('Could not show the folder: ' + err.message, { error: true })));
        card.querySelector('#pubCopy').addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(r.path); app.toast('Folder path copied'); }
            catch (e) {
                const range = document.createRange(); range.selectNodeContents(card.querySelector('.pub-path'));
                const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
                app.toast('Select and copy the path shown above', { ms: 3500 });
            }
        });
        card.querySelector('#pubDone').addEventListener('click', () => h.remove());
    };

    h.addEventListener('click', async (e) => {
        if (e.target === h || e.target.id === 'pubClose') { h.remove(); return; }
        const link = e.target.closest('[data-link]');
        if (link) { api.openLink(link.dataset.link).catch(err => app.toast('Could not open the browser: ' + err.message, { error: true })); return; }
        if (e.target.id === 'pubGo') run(false);
        if (e.target.id === 'pubOver') run(true);
        if (e.target.id === 'pubPick') {
            try {
                const r = await api.publishPick(app.file);
                if (!r.cancelled) $('pubDest').value = r.path;
            } catch (err) {
                app.toast(NO_DIALOG.test(err.message) ? 'No folder dialog on this computer: type the folder\'s path in the box.' : 'Could not open the dialog: ' + err.message, { error: !NO_DIALOG.test(err.message), ms: 5000 });
            }
        }
    });
    h.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'pubDest') { e.preventDefault(); run(false); } });
    document.body.appendChild(h);
    $('pubDest').focus();
    return h;
}
