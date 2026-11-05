/* ============================================================
   animate.js - entrance animations for elements.

   Two kinds exist on a slide:
   - the deck's own reveal (classes such as .reveal, driven by the
     deck's CSS when the slide becomes .visible, staggered with --i);
   - editor presets: data-anim="name" on the element plus
     --anim-duration / --anim-delay / --anim-ease inline. The CSS for
     every preset in use is written into the deck's override block
     (document.js), so the saved file animates on its own.

   Preset keyframes touch transform, opacity, filter and, for the
   directional presets, `translate` (added to the editor's own
   position, see mv()), so they keep to the screen's directions
   whatever the element's rotation. Moves and rotation made in the
   editor live in the `translate` / `rotate` properties (or --dx/--dy
   for deck reveals), so they compose with the animation instead of
   being overwritten by it.
   ============================================================ */
import { getOffset, setOffset, forgetVars } from './transform.js';
import { ANIM_MARK_START, ANIM_MARK_END, animStateSelectors } from './document.js';

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/* A move along the SCREEN's axes. It animates the individual `translate` property, which CSS
   applies before `rotate` and `scale`, so a rotated or flipped element still comes in from the
   side the viewer calls up / down / left / right (a `transform: translateY()` would run in the
   element's own turned frame). `animation-composition: add` puts the move on top of the position
   the editor wrote in `translate`, instead of replacing it. It is set inside the keyframe that
   moves, so opacity in the same animation still replaces. */
const px = v => typeof v === 'number' ? v + 'px' : v;
function mv(x, y) { return `translate:${px(x)} ${px(y)};animation-composition:add`; }

/* name -> { label, loop, from/to or keyframes, dur } */
export const PRESETS = {
    'fade':        { label: 'Fade',        kf: 'from{opacity:0}to{opacity:1}' },
    'fade-up':     { label: 'Fade up',     kf: `from{opacity:0}from{${mv(0, 40)}}to{opacity:1}to{${mv(0, 0)}}` },
    'fade-down':   { label: 'Fade down',   kf: `from{opacity:0}from{${mv(0, -40)}}to{opacity:1}to{${mv(0, 0)}}` },
    'fade-left':   { label: 'Fade left',   kf: `from{opacity:0}from{${mv(60, 0)}}to{opacity:1}to{${mv(0, 0)}}` },
    'fade-right':  { label: 'Fade right',  kf: `from{opacity:0}from{${mv(-60, 0)}}to{opacity:1}to{${mv(0, 0)}}` },
    'zoom':        { label: 'Zoom',        kf: 'from{opacity:0;transform:scale(0.6)}to{opacity:1;transform:none}' },
    'zoom-out':    { label: 'Zoom out',    kf: 'from{opacity:0;transform:scale(1.4)}to{opacity:1;transform:none}' },
    'pop':         { label: 'Pop',         kf: '0%{opacity:0;transform:scale(0.5)}70%{opacity:1;transform:scale(1.08)}100%{transform:none}', ease: 'ease-out' },
    'bounce':      { label: 'Bounce',      kf: `0%{opacity:0}55%{opacity:1}0%{${mv(0, -120)}}55%{${mv(0, 0)}}72%{${mv(0, -28)}}86%{${mv(0, 0)}}94%{${mv(0, -10)}}100%{${mv(0, 0)}}`, ease: 'ease-out', dur: 0.9 },
    'drop':        { label: 'Drop',        kf: `from{opacity:0}from{${mv(0, -200)};transform:scale(1.1)}to{opacity:1}to{${mv(0, 0)};transform:none}`, ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    'slide-x':     { label: 'Slide in X',  kf: `from{${mv('-100vw', 0)}}to{${mv(0, 0)}}` },
    'slide-y':     { label: 'Slide in Y',  kf: `from{${mv(0, '100vh')}}to{${mv(0, 0)}}` },
    'scale-x':     { label: 'Scale in X',  kf: 'from{opacity:0;transform:scaleX(0)}to{opacity:1;transform:none}' },
    'scale-y':     { label: 'Scale in Y',  kf: 'from{opacity:0;transform:scaleY(0)}to{opacity:1;transform:none}' },
    'blur':        { label: 'Blur',        kf: 'from{opacity:0;filter:blur(18px)}to{opacity:1;filter:blur(0)}' },
    'twirl':       { label: 'Twirl',       kf: 'from{opacity:0;transform:rotate(-180deg) scale(0.3)}to{opacity:1;transform:none}', dur: 0.8 },
    'flip':        { label: 'Flip',        kf: 'from{opacity:0;transform:perspective(1200px) rotateX(-90deg)}to{opacity:1;transform:none}', dur: 0.7 },
    'stomp':       { label: 'Stomp',       kf: '0%{opacity:0;transform:scale(3)}60%{opacity:1;transform:scale(0.95)}100%{transform:none}', ease: 'cubic-bezier(0.7, 0, 0.3, 1)', dur: 0.5 },
    'pulse':       { label: 'Pulse',       loop: true, kf: '0%,100%{transform:none}50%{transform:scale(1.06)}', ease: 'ease-in-out', dur: 1.6 },
    'drift-x':     { label: 'Drift X',     loop: true, kf: `0%,100%{${mv(-14, 0)}}50%{${mv(14, 0)}}`, ease: 'ease-in-out', dur: 3 },
    'drift-y':     { label: 'Drift Y',     loop: true, kf: `0%,100%{${mv(0, -12)}}50%{${mv(0, 12)}}`, ease: 'ease-in-out', dur: 3 },
    'spin':        { label: 'Spin',        loop: true, kf: 'from{transform:rotate(0)}to{transform:rotate(360deg)}', ease: 'linear', dur: 6 },
    'rotate':      { label: 'Rotate',      loop: true, kf: '0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg)}', ease: 'ease-in-out', dur: 2.4 },
};
export const EASES = { [EASE]: 'Smooth (expo)', 'ease-out': 'Ease out', 'ease-in-out': 'Ease in-out', 'linear': 'Linear', 'cubic-bezier(0.34, 1.56, 0.64, 1)': 'Overshoot' };

/* CSS for the presets a deck uses. Runs when the slide becomes .visible; elements
   waiting for a delayed entrance are hidden by the "backwards" fill. */
export function animationCss(names) {
    const used = Array.from(new Set(names)).filter(n => PRESETS[n]);
    if (!used.length) return '';
    const lines = [ANIM_MARK_START];
    for (const n of used) {
        const p = PRESETS[n];
        lines.push(`@keyframes de-${n} { ${p.kf} }`);
        // Plain elements animate when the slide shows; fragments when they are revealed (or, while editing, with the slide).
        const sel = animStateSelectors(`[data-anim="${n}"]`).join(', ');
        lines.push(`${sel} { animation: de-${n} var(--anim-duration, ${p.dur || 0.6}s) var(--anim-ease, ${p.ease || EASE}) var(--anim-delay, 0s) ${p.loop ? 'infinite' : '1 backwards'}; }`);
    }
    lines.push(ANIM_MARK_END);
    return lines.join('\n');
}

/* ------------------------------------------------------------
   Reading what an element has
   ------------------------------------------------------------ */
/* Class names the deck itself animates: any class that appears in a rule under .visible. */
export function deckRevealClasses(doc) {
    const out = new Set();
    for (const sheet of Array.from(doc.styleSheets)) {
        if (sheet.ownerNode && /deck-editor/.test(sheet.ownerNode.id || '')) continue;
        let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
        for (const r of Array.from(rules)) {
            if (!r.selectorText || !/\.visible\b/.test(r.selectorText)) continue;
            for (const part of r.selectorText.split(',')) {
                const m = /\.visible\s+\.([\w-]+)\s*$/.exec(part.trim()) || /\.visible\s+\.([\w-]+)$/.exec(part.trim());
                if (m) out.add(m[1]);
            }
        }
    }
    return Array.from(out);
}

export function describeAnimation(el, revealClasses) {
    const preset = el.getAttribute('data-anim');
    if (preset && PRESETS[preset]) {
        return {
            kind: 'preset', preset,
            duration: parseFloat(el.style.getPropertyValue('--anim-duration')) || PRESETS[preset].dur || 0.6,
            delay: parseFloat(el.style.getPropertyValue('--anim-delay')) || 0,
            ease: el.style.getPropertyValue('--anim-ease').trim() || PRESETS[preset].ease || EASE,
            loop: !!PRESETS[preset].loop,
        };
    }
    const cls = revealClasses.find(c => el.classList.contains(c));
    if (cls) return { kind: 'deck', cls, index: parseFloat(el.style.getPropertyValue('--i')) || 0 };
    return { kind: 'none' };
}
export function fragmentOf(el) {
    if (!el.hasAttribute('data-fragment')) return null;
    const i = el.getAttribute('data-fragment-index');
    return { index: i == null || i === '' ? '' : +i };
}

/* ------------------------------------------------------------
   Changing it (all through history, one step per call)
   ------------------------------------------------------------ */
/* A deck reveal makes way for an editor animation: park its class in data-anim-was and
   keep the element's position (the move becomes `translate`). */
function parkReveal(history, el, revealClasses, label) {
    const cls = revealClasses.find(c => el.classList.contains(c));
    if (!cls) return;
    const o = getOffset(el);
    history.attr(el, 'data-anim-was', cls, label);
    const classes = (el.getAttribute('class') || '').split(/\s+/).filter(c => c && c !== cls);
    history.attr(el, 'class', classes.join(' '), label);      // kept (possibly empty) so it stays in place
    forgetVars(el);
    history.style(el, () => {
        el.style.removeProperty('--dx'); el.style.removeProperty('--dy');
        setOffset(el, o.x, o.y);                       // now written as translate
    }, { label });
}
/* Give a parked deck reveal back when nothing of the editor's animates the element any more. */
function restoreReveal(history, el, label) {
    const was = el.getAttribute('data-anim-was');
    if (!was || el.hasAttribute('data-anim') || el.hasAttribute('data-text-effect')) return;
    const o = getOffset(el);
    history.attr(el, 'data-anim-was', null, label);
    const classes = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    if (!classes.includes(was)) classes.push(was);
    history.attr(el, 'class', classes.join(' '), label);
    forgetVars(el);
    history.style(el, () => {
        el.style.translate = '';
        setOffset(el, o.x, o.y);      // back to --dx/--dy now that the reveal rule applies again
    }, { label });
}

export function applyPreset(history, deck, el, name, revealClasses) {
    history.begin(name ? 'Animation ' + PRESETS[name].label : 'Remove animation');
    history.remember(el);
    if (name) {
        parkReveal(history, el, revealClasses, 'Animation');
        history.attr(el, 'data-anim', name, 'Animation');
        history.style(el, () => {
            el.style.removeProperty('--anim-duration'); el.style.removeProperty('--anim-delay'); el.style.removeProperty('--anim-ease');
        }, { label: 'Animation' });
    } else {
        history.attr(el, 'data-anim', null, 'Remove animation');
        history.style(el, () => {
            el.style.removeProperty('--anim-duration'); el.style.removeProperty('--anim-delay'); el.style.removeProperty('--anim-ease');
        }, { label: 'Remove animation' });
        restoreReveal(history, el, 'Remove animation');
    }
    history.end();
    deck.refreshAnimations();
}

/* Text effects (letters, words, typewriter) run in the deck runtime when the slide shows.
   A deck reveal on the element would fade the whole text in on top; it is parked meanwhile. */
export const TEXT_EFFECTS = { '': 'None', letters: 'Letter by letter', words: 'Word by word', typewriter: 'Typewriter' };
export function setTextEffect(history, deck, el, kind, revealClasses) {
    history.begin(kind ? 'Text effect' : 'Remove text effect');
    history.remember(el);
    if (kind) parkReveal(history, el, revealClasses, 'Text effect');
    history.attr(el, 'data-text-effect', kind || null, 'Text effect');
    if (!kind) restoreReveal(history, el, 'Remove text effect');
    history.end();
}

/* Only values that differ from the preset's defaults are written, so the markup stays short. */
/* Reveal on click: data-fragment (+ data-fragment-index). A deck reveal is handed over
   like for presets, and a fragment without a preset gets a plain fade. */
export function setFragment(history, deck, el, on, index, revealClasses) {
    history.begin(on ? 'Reveal on click' : 'Show with slide');
    if (on) {
        if (!el.getAttribute('data-anim')) applyPreset(history, deck, el, 'fade', revealClasses);
        history.attr(el, 'data-fragment', '', 'Reveal on click');
        history.attr(el, 'data-fragment-index', index === '' || index == null ? null : String(index), 'Fragment order');
    } else {
        history.attr(el, 'data-fragment', null, 'Show with slide');
        history.attr(el, 'data-fragment-index', null, 'Show with slide');
        el.classList.remove('visible');
    }
    history.end();
    deck.refreshAnimations();
}

export function setTiming(history, el, { duration, delay, ease }) {
    const p = PRESETS[el.getAttribute('data-anim')] || {};
    const defDur = p.dur || 0.6, defEase = p.ease || EASE;
    history.style(el, () => {
        if (duration != null) { if (duration === '' || +duration === defDur) el.style.removeProperty('--anim-duration'); else el.style.setProperty('--anim-duration', +duration + 's'); }
        if (delay != null) { if (delay === '' || +delay === 0) el.style.removeProperty('--anim-delay'); else el.style.setProperty('--anim-delay', +delay + 's'); }
        if (ease != null) { if (!ease || ease === defEase) el.style.removeProperty('--anim-ease'); else el.style.setProperty('--anim-ease', ease); }
    }, { label: 'Animation timing', key: 'anim-timing' });
}

/* Replay the entrance of one element (or of the whole slide) without changing anything. */
export function replay(deck, el) {
    const targets = el ? [el] : Array.from(deck.currentSlide.querySelectorAll('[data-anim], [data-text-effect]'));
    const rt = deck.win.deckRuntime;
    let missingRuntime = false;
    for (const t of targets) {
        if (t.hasAttribute('data-anim')) {
            t.style.animation = 'none';
            void t.offsetWidth;
            t.style.animation = '';
            if (!t.getAttribute('style')) t.removeAttribute('style');
        }
        if (t.hasAttribute('data-text-effect')) {
            if (rt && rt.playTextEffect) rt.playTextEffect(t); else missingRuntime = true;
        }
    }
    return !missingRuntime;
}
