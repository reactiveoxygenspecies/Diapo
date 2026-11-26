/* ============================================================
   heartbeat.js - tells serve.py this page is open.

   When Diapo runs in a normal browser tab, closing the tab is the only way to say "done", so
   the server stops itself once no Diapo page has called for a while (serve.py, QuitWatch).
   Every few seconds this posts /api/heartbeat; pagehide posts it once more with bye=1 so a
   closed tab is noticed within seconds (a reload announces itself again at once). A hidden
   tab's timers may run only once a minute, which the server allows for.

   If the server cannot be reached (it was stopped, or the computer slept long enough for it
   to quit), a bar says so instead of leaving a page that fails one button at a time.
   ============================================================ */
const EVERY = +window.DIAPO_BEAT_MS || 5000;                   // ms between calls while the page is open (the tests shorten it)
const FAILS_BEFORE_BAR = 2;
const id = 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

let timer = 0, fails = 0, stopped = false, bar = null;

async function beat() {
    if (stopped) return;
    try {
        const r = await fetch('/api/heartbeat?id=' + id, { method: 'POST', cache: 'no-store', keepalive: true });
        if (!r.ok) throw new Error(String(r.status));
        fails = 0;
        if (bar) { bar.remove(); bar = null; }
    } catch (e) {
        if (++fails >= FAILS_BEFORE_BAR) showGone();
    }
}

function showGone() {
    if (bar || stopped) return;
    bar = document.createElement('div');
    bar.className = 'bar gone-bar';
    bar.setAttribute('role', 'alert');
    bar.innerHTML = 'Diapo is not running any more, so nothing here can be saved. Your saved decks are safe. Start Diapo again, then <button data-a="reload">reload this page</button>.';
    bar.addEventListener('click', (e) => { if (e.target.dataset.a === 'reload') location.reload(); });
    (document.getElementById('barStack') || document.body).appendChild(bar);
}

/* Says the page is closing; the server then waits only a few seconds for another to appear. */
function bye() {
    if (stopped) return;
    try { navigator.sendBeacon('/api/heartbeat?id=' + id + '&bye=1'); } catch (e) { /* the server's own timeout covers it */ }
}

/* After Quit: no more calls, and no bar when the server goes. */
export function stopHeartbeat() {
    stopped = true;
    clearInterval(timer);
    if (bar) { bar.remove(); bar = null; }
}

export function startHeartbeat() {
    beat();
    timer = setInterval(beat, EVERY);
    window.addEventListener('pagehide', bye);
    // Back from the back/forward cache, or a tab woken after a sleep: say so at once.
    window.addEventListener('pageshow', () => { if (!stopped) beat(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') beat(); });
    // A page holding a Web Lock is not frozen or discarded by browsers that save memory, which
    // would otherwise look to the server like a closed tab.
    try { if (navigator.locks) navigator.locks.request('diapo-open', () => new Promise(() => {})); } catch (e) { /* optional */ }
}

/* The page shown once Diapo has been stopped from File > Quit Diapo. */
export function showStopped() {
    stopHeartbeat();
    document.title = 'Diapo has stopped';
    document.body.className = '';
    document.body.innerHTML = '<main class="stopped" role="status" style="font:16px/1.5 system-ui,sans-serif;max-width:30em;margin:18vh auto 0;padding:0 24px;text-align:center">'
        + '<h1 style="font-size:24px;margin:0 0 8px">Diapo has stopped</h1>'
        + '<p style="margin:0;opacity:.75">You can close this tab. To use Diapo again, start it from where you started it before.</p></main>';
}
