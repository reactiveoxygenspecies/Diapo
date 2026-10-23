/* Diapo print helper (prep): written inline into the printable copy of a deck by core/export.js. Its hash is a known Diapo script (serve.py), so it runs where deck scripts are paused. */
window.requestIdleCallback = function (fn) { return setTimeout(function () { fn({ didTimeout: false, timeRemaining: function () { return 50; } }); }, 1); };
window.cancelIdleCallback = function (id) { clearTimeout(id); };
