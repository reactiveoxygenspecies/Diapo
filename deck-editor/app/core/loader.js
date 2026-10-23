/* ============================================================
   loader.js - the loading mark (brand/loader.svg, "Orient").

   The mount turns three quick quarters and rests upright with the
   notch bottom-left, like a projectionist finding which way the
   slide goes in. The motion and the colours are in editor.css
   (.loader); it fades in only after 300 ms, so a quick wait never
   flashes it. presenter.html carries its own copy of the small one.
   ============================================================ */

// DIAPO in Anton, outlined (the same path as brand/logo.svg).
const WORD = 'M24.39 59.85V40.94H29.59Q31.63 40.94 32.67 42.08Q33.70 43.21 33.70 45.39V54.24Q33.70 56.93 32.76 58.39Q31.82 59.85 29.46 59.85ZM28.20 56.51H28.85Q29.89 56.51 29.89 55.50V45.74Q29.89 44.80 29.64 44.52Q29.39 44.25 28.62 44.25H28.20ZM36.39 59.85V40.94H40.04V59.85ZM42.35 59.85 44.18 40.94H50.59L52.39 59.85H48.81L48.54 56.80H46.26L46.03 59.85ZM46.53 53.78H48.25L47.42 44.16H47.25ZM54.87 59.85V40.94H59.86Q61.43 40.94 62.35 41.64Q63.27 42.34 63.66 43.63Q64.06 44.92 64.06 46.70Q64.06 48.42 63.73 49.69Q63.39 50.96 62.54 51.66Q61.69 52.36 60.12 52.36H58.58V59.85ZM58.58 48.97H58.80Q59.85 48.97 60.09 48.38Q60.32 47.78 60.32 46.64Q60.32 45.56 60.09 44.98Q59.86 44.39 59.00 44.39H58.58ZM71.08 60.02Q68.82 60.02 67.62 58.65Q66.42 57.28 66.42 54.69V45.71Q66.42 43.28 67.61 42.03Q68.80 40.77 71.08 40.77Q73.37 40.77 74.56 42.03Q75.75 43.28 75.75 45.71V54.69Q75.75 57.28 74.55 58.65Q73.35 60.02 71.08 60.02ZM71.12 56.54Q71.98 56.54 71.98 54.87V45.65Q71.98 44.25 71.14 44.25Q70.19 44.25 70.19 45.68V54.90Q70.19 55.78 70.41 56.16Q70.62 56.54 71.12 56.54Z';

/* The markup: the bare mount for buttons and the status bar, the mount with the word for the
   canvas (48 px and up, like the logo). Decorative: the text beside it says what is happening. */
export function loader({ word = false } = {}) {
    return `<svg class="loader${word ? ' loader-word' : ''}" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g class="l-turn">`
        + '<rect class="l-card" x="2" y="2" width="96" height="96" rx="7"/>'
        + '<rect class="l-win" x="14" y="26" width="72" height="48" rx="1.5"/>'
        + (word ? `<rect class="l-rim" x="14.6" y="26.6" width="70.8" height="46.8" rx="1"/><path class="l-type" d="${WORD}"/>` : '')
        + '<rect class="l-breathe" x="14" y="26" width="72" height="48" rx="1.5"/>'
        + '<circle class="l-notch" cx="8" cy="92" r="2.6"/>'
        + '</g></svg>';
}
