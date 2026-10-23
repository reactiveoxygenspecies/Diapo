/* Diapo print helper (keeper): written inline into the printable copy of a deck by core/export.js. Its hash is a known Diapo script (serve.py), so it runs where deck scripts are paused. */
(function () {
    var stage = document.querySelector('.deck-stage'); if (!stage) return;
    // No transitions: what the master layer looks like on a slide is read the moment the slide shows.
    var quick = document.createElement('style'); quick.textContent = '.deck-stage, .deck-stage * { transition: none !important; }'; document.head.appendChild(quick);
    var MASTER = ':scope > :not(.slide):not(script):not(style):not(template):not(.deck-overview):not(.deck-laser):not(.deck-draw):not(.deck-controls):not(.print-notes)';
    var n = stage.querySelectorAll(':scope > .slide').length, i = 0;
    var noMaster = {};
    Array.prototype.forEach.call(stage.querySelectorAll(':scope > .slide'), function (s, i) { if (s.hasAttribute('data-no-master')) { noMaster[i] = true; s.removeAttribute('data-no-master'); } });
    function stamp(i) {
        var slide = stage.querySelectorAll(':scope > .slide')[i]; if (!slide || noMaster[i]) return;
        Array.prototype.forEach.call(stage.querySelectorAll(MASTER), function (m) {
            var cs = getComputedStyle(m);
            if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
            var c = m.cloneNode(true); c.setAttribute('data-print-master', '');
            Array.prototype.forEach.call(c.querySelectorAll('#pageNow, [data-page-now]'), function (e) { e.removeAttribute('id'); e.textContent = String(i + 1); });
            Array.prototype.forEach.call(c.querySelectorAll('#pageTotal, [data-page-total]'), function (e) { e.removeAttribute('id'); e.textContent = String(n); });
            slide.appendChild(c);
        });
    }
    function show() {
        var all = stage.querySelectorAll(':scope > .slide');
        for (var i = 0; i < all.length; i++) {
            if (!all[i].classList.contains('active')) all[i].classList.add('active');
            if (!all[i].classList.contains('visible')) all[i].classList.add('visible');
        }
        var frags = stage.querySelectorAll('[data-fragment]');
        for (var j = 0; j < frags.length; j++) if (!frags[j].classList.contains('visible')) frags[j].classList.add('visible');
    }
    show();
    new MutationObserver(show).observe(stage, { attributes: true, subtree: true, attributeFilter: ['class'] });
    window.addEventListener('load', show);
    function walk() {
        if (i > 0) stamp(i - 1);
        if (i >= n) { show(); document.documentElement.setAttribute('data-print-ready', ''); return; }
        i += 1;
        try { location.hash = '#' + i; } catch (e) { /* ignore */ }
        setTimeout(walk, 60);
    }
    setTimeout(walk, 50);
})();
