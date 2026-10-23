/* ============================================================
   api.js - the only place that talks to serve.py.
   Every call returns the parsed JSON body and throws an Error
   with the server's message when {ok:false} comes back.
   ============================================================ */

async function call(method, path, body, headers = {}) {
    const res = await fetch(path, { method, body, headers, cache: 'no-store' });
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON reply, handled below */ }
    if (!data) throw new Error(`${method} ${path}: ${res.status} ${res.statusText}`);
    if (!data.ok) {
        const err = new Error(data.error || 'request failed'); err.data = data; err.status = res.status; throw err;
    }
    return data;
}

const q = (params) => Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

export const api = {
    status: () => call('GET', '/api/status'),
    list: (dir = '') => call('GET', '/api/list?' + q({ dir })),
    /* base: the version the deck was opened at; the server answers 409 (reason "changed") when
       the file is different now, unless overwrite is set. */
    save: (file, html, { base = '', overwrite = false } = {}) =>
        call('POST', '/api/save?' + q({ file, ...(base ? { base } : {}), ...(overwrite ? { overwrite: 1 } : {}) }), html, { 'Content-Type': 'text/html; charset=utf-8' }),
    upload: (dir, files) => {
        const fd = new FormData();
        for (const f of files) fd.append('file', f, f.name);
        return call('POST', '/api/upload?' + q({ dir }), fd);
    },
    newDeck: (path, template = '') => call('POST', '/api/new?' + q({ path, ...(template ? { template } : {}) })),
    rename: (file, to) => call('POST', '/api/rename?' + q({ file, to })),
    duplicate: (file, to) => call('POST', '/api/duplicate?' + q({ file, to })),
    draftStatus: (file) => call('GET', '/api/draft?' + q({ file })),
    draftWrite: (file, html) => call('POST', '/api/draft?' + q({ file }), html, { 'Content-Type': 'text/html; charset=utf-8' }),
    draftDelete: (file) => call('DELETE', '/api/draft?' + q({ file })),
    /* Whether a deck's own scripts run (serve.py, "Scripts in decks"): {trusted, scripts, known}. */
    trust: (file, draft = false) => call('GET', '/api/trust?' + q({ file, draft: draft ? 1 : 0 })),
    setTrust: (file, on, draft = false) => call('POST', '/api/trust?' + q({ file, on: on ? 1 : 0, draft: draft ? 1 : 0 })),
    versions: (file) => call('GET', '/api/versions?' + q({ file })),
    restoreVersion: (file, version) => call('POST', '/api/versions/restore?' + q({ file, version })),
    copyVersion: (file, version) => call('POST', '/api/versions/copy?' + q({ file, version })),
    setWorkspace: (path) => call('POST', '/api/workspace?' + q({ path })),
    pickWorkspace: () => call('POST', '/api/workspace/pick'),
    pickFile: () => call('POST', '/api/workspace/pick-file'),
    recent: (file) => call('POST', '/api/recent?' + q({ file })),
    runtimeScript: () => fetch('/deck-runtime.js', { cache: 'no-store' }).then(r => r.text()),
    themes: () => call('GET', '/api/themes'),
    saveTheme: (name, theme) => call('POST', '/api/themes?' + q({ name }), JSON.stringify(theme), { 'Content-Type': 'application/json' }),
    deleteTheme: (name) => call('DELETE', '/api/themes?' + q({ name })),
    googleFamily: (family) => call('GET', '/api/fonts/google?' + q({ family })),
    uploadFonts: (file, files) => {
        const fd = new FormData();
        for (const f of files) fd.append('file', f, f.name);
        return call('POST', '/api/fonts/upload?' + q({ file }), fd);
    },
    embedOwnFonts: (file, css) => call('POST', '/api/fonts/embed-own?' + q({ file }), JSON.stringify({ css }), { 'Content-Type': 'application/json' }),
    hostFonts: (file, urls, embed) => call('POST', '/api/fonts/host?' + q({ file, embed: embed ? 1 : 0 }), JSON.stringify({ urls }), { 'Content-Type': 'application/json' }),
    importPick: () => call('POST', '/api/import/pick'),
    importPath: (p, name = '') => call('POST', '/api/import?' + q({ path: p, name })),
    importFile: (file, name = '') => { const fd = new FormData(); fd.append('file', file, file.name); return call('POST', '/api/import?' + q({ name }), fd); },
    saveAs: (file, html, { to = null, overwrite = false } = {}) =>
        call('POST', '/api/saveas?' + q({ file, ...(to ? { to } : {}), ...(overwrite ? { overwrite: 1 } : {}) }), html, { 'Content-Type': 'text/html; charset=utf-8' }),
    /* Exports: `to` names the file (in the deck folder); without it the server shows a save
       dialog, unless dialog is false (then a default name next to the deck). */
    exportStandalone: (file, html, { to = null, dialog = true, fonts = true } = {}) =>
        call('POST', '/api/export?' + q({ file, ...(to ? { to } : {}), dialog: dialog ? 1 : 0, fonts: fonts ? 1 : 0 }), html, { 'Content-Type': 'text/html; charset=utf-8' }),
    pptx: (file, spec, { to = null, dialog = true } = {}) =>
        call('POST', '/api/export/pptx?' + q({ file, ...(to ? { to } : {}), dialog: dialog ? 1 : 0 }), JSON.stringify(spec), { 'Content-Type': 'application/json' }),
    pdf: (file, html, { to = null, dialog = true, w = 0, h = 0 } = {}) =>
        call('POST', '/api/pdf?' + q({ file, ...(to ? { to } : {}), dialog: dialog ? 1 : 0, ...(w && h ? { w, h } : {}) }), html, { 'Content-Type': 'text/html; charset=utf-8' }),

    /* URL the iframe uses for a workspace file. */
    deckUrl: (file, { draft = false } = {}) => '/deck/' + file.split('/').map(encodeURIComponent).join('/') + (draft ? '?draft=1' : ''),
};
