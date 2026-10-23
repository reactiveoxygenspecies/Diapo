/* look.js - the editor's look (Look menu) before the first paint, so the chrome does not flash.
   A file, not inline: the editor's pages allow no inline scripts (serve.py, editor_csp). */
try { var look = localStorage.getItem('deck-editor-look'); if (look === 'clean') delete document.documentElement.dataset.look; else if (look) document.documentElement.dataset.look = look; } catch (e) { /* ignore */ }
