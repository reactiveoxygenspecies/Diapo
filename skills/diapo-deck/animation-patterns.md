# Animation patterns

Match motion to the intended feeling, then express it with the deck's own
`.reveal` family (CSS the editor understands) and the runtime's markup
(fragments, transitions, text effects, auto-animate). One well-orchestrated
entrance per slide beats scattered micro-interactions.

## Effect-to-feeling guide

| Feeling | Motion | Visual cues |
|---|---|---|
| Dramatic / cinematic | Slow fades (1-1.5s), scale 0.94 to 1, `data-transition="fade"` at 0.8s | Dark backgrounds, spotlight gradients, full-bleed pictures |
| Techy / futuristic | Short staggers (0.06s), `data-text-effect="typewriter"` on a mono label, grid reveals | Grid patterns, mono accents, cyan / magenta / electric blue |
| Playful / friendly | Overshoot easing `cubic-bezier(0.34, 1.56, 0.64, 1)`, `.reveal` from below with a slight scale | Rounded corners, bright pastels, sticker-like badges |
| Professional / corporate | Fast subtle moves (0.3-0.4s, 16px), `data-transition="none"` or `fade` at 0.3s | Navy / slate, precise spacing, charts |
| Calm / minimal | Very slow gentle fades, no transforms, long delays | Whitespace, muted palette, serif type |
| Editorial / magazine | Staggered text lines, pictures a beat after the headline (`--i` gaps) | Strong hierarchy, pull quotes, grid-breaking layouts |

## Entrances: the `.reveal` family

deck-base.css defines `.reveal` (up), `.reveal-img` (up + slight scale) and
`.reveal-right` (from the right). Tune their distances, durations and easing
per style, keep the selectors and the visible transform:

```css
/* Cinematic: slower, larger */
:root { --dur: 1.1s; --ease-out: cubic-bezier(0.22, 1, 0.36, 1); }
.reveal { transform: translateY(48px); }
.reveal-img { transform: scale(0.94); }

/* Playful: overshoot */
:root { --dur: 0.7s; --ease-out: cubic-bezier(0.34, 1.56, 0.64, 1); }
.reveal { transform: translateY(40px) scale(0.96); }
```

Stagger with `--i` (`--stagger`, 0.12s by default; set it on `:root` for the
whole deck, next to `--dur`, `--ease-out` and `--reveal-y`, which the editor's
Motion section also edits):

```html
<div class="eyebrow reveal" style="--i:0">Chapter 2</div>
<h2 class="reveal" style="--i:1">The headline</h2>
<p class="reveal" style="--i:2">A line of support.</p>
<img class="reveal-img" style="--i:4; position:absolute; ..." src="assets/x.jpg" alt="">
```

Extra entrance classes follow the same pattern, so a moved element still animates:

```css
.reveal-left { opacity: 0; transform: translateX(-50px); transition: opacity var(--dur) var(--ease-out), transform var(--dur) var(--ease-out); transition-delay: calc(var(--i, 0) * var(--stagger, 0.12s)); }
.reveal-blur { opacity: 0; filter: blur(12px); transition: opacity var(--dur), filter var(--dur) var(--ease-out), transform var(--dur) var(--ease-out); transition-delay: calc(var(--i, 0) * var(--stagger, 0.12s)); }
.slide.visible .reveal-left, .slide.visible .reveal-blur { opacity: 1; filter: none; transform: translate(var(--dx, 0px), var(--dy, 0px)); }
@media print { .slide .reveal-left, .slide .reveal-blur { opacity: 1 !important; filter: none !important; transform: translate(var(--dx, 0px), var(--dy, 0px)) !important; } }
```

The editor detects any class whose `.slide.visible` rule reads `--dx/--dy`, and
shows its `--i` in the Animation panel. Do not use `:nth-child` delays.

## Reveal on click: fragments (runtime)

```html
<li class="reveal" style="--i:2" data-fragment>Shown on the first Space</li>
<li class="reveal" style="--i:3" data-fragment>Shown on the second</li>
<div data-fragment data-fragment-index="1">Together with the first (same index)</div>
```

Fragments fade in by default; a fragment that is also `.reveal` uses its
entrance. The editor shows fragments while editing and has a "Reveal on click"
checkbox for them.

## Slide transitions (runtime)

```html
<main class="deck-stage" id="deckStage" data-transition="fade" data-transition-duration="0.5">   <!-- deck default -->
<section class="slide" data-transition="zoom">                                                  <!-- this slide -->
```

`fade | slide | up | zoom | none`. Keep them short (0.3-0.6s) unless cinematic.

## Auto-animate: morph between two slides (runtime)

```html
<section class="slide" data-auto-animate data-name="before">
    <h2 data-id="title" style="position:absolute; left:96px; top:96px">One idea</h2>
    <div data-id="box" style="position:absolute; left:96px; top:300px; width:400px; height:240px; background:var(--accent)"></div>
</section>
<section class="slide" data-name="after">
    <h2 data-id="title" style="position:absolute; left:96px; top:96px; font-size:48px">One idea, smaller</h2>
    <div data-id="box" style="position:absolute; left:1100px; top:200px; width:700px; height:600px; background:var(--accent)"></div>
    <p class="reveal">Everything else fades in.</p>
</section>
```

Good for "zoom into a detail", "a list becomes a diagram", build-ups of the same
scene. Elements match by `data-id`, else by tag + text or image `src`. Give
linked elements the same `data-id` rather than relying on equal text. Two
linked boxes tween colour, corners, rotation and shadow (a square into a
circle); two `<svg>` shapes of one `<path>` each morph outline to outline;
linked elements that do not look alike cross-fade on the way.

## Runs by itself (runtime)

For decks nobody clicks through: a booth screen, a lobby loop, a looping
teaser. Seconds per slide on the slide, or a default on the stage; when the
first slide has a wait (its own or the stage's), the deck starts running as
soon as it is opened on its own.

```html
<main class="deck-stage" id="deckStage" data-auto-advance="8" data-loop>  <!-- every slide 8 s, forever -->
<section class="slide" data-auto-advance="15">                            <!-- this one longer -->
```

Fragments are stepped through one per wait, so an unattended deck is better
without them. A key or click stops it; A starts it again. In a deck for a
speaker, leave it out: the speaker can rehearse in the editor (Presenter >
Rehearse the timings) and the times are written as `data-auto-advance`
(which then also starts the deck by itself when opened; any key stops it).

## Text effects (runtime)

```html
<h1 data-text-effect="words">Every word lands</h1>
<p class="mono" data-text-effect="typewriter" data-text-effect-speed="1.4">> booting the argument_</p>
```

`letters | words | typewriter`. One per slide at most; the runtime wraps the text
in spans only while it plays, so the file stays clean.

## Loops and ambient motion

Pure CSS keyframes on decorative elements, gated so the editor stays calm:

```css
@keyframes drift { 0%, 100% { translate: 0 0; } 50% { translate: 24px -18px; } }
html:not(.deck-editing) .blob { animation: drift 9s ease-in-out infinite; }
```

Use the `translate` / `rotate` / `scale` properties in keyframes, not
`transform`, so the editor's own `translate:` moves compose with them.

## Backgrounds and atmosphere

```css
/* Layered radial gradients for depth */
.slide.mesh { background:
    radial-gradient(ellipse at 20% 80%, color-mix(in srgb, var(--accent) 35%, transparent) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 20%, color-mix(in srgb, var(--accent-2) 25%, transparent) 0%, transparent 50%),
    var(--slide-bg); }

/* Grid pattern */
.slide.grid { background-image:
    linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
    background-size: 80px 80px; }

/* Grain: an inline SVG noise as a texture layer that never catches clicks */
.grain { position:absolute; inset:0; pointer-events:none; opacity:0.08; mix-blend-mode:multiply;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
```

Backgrounds on the slide itself are edited in the editor's slide section
(colour, picture); backgrounds on an inner layer are edited as that element.

## Script-driven effects (particles, counters, tilt)

Rarely worth it: any script of the deck's own makes Diapo ask the user to
trust the deck, and until they do, the effect does not run. Prefer CSS
(keyframes, `.reveal` variants, gradients) for anything decorative. When a
script earns its place, three rules: render into an empty `[data-generated]`
host (see deck-template.md), start and stop on `deck:slide` so only the
visible slide animates, and skip entirely while
`document.documentElement.classList.contains('deck-editing')`. The deck must
read well with the script paused.

```js
document.addEventListener('deck:slide', (e) => {
    if (document.documentElement.classList.contains('deck-editing')) return;
    const slide = document.querySelectorAll('.slide')[e.detail];
    slide.querySelectorAll('[data-count]').forEach(el => countUp(el, +el.dataset.count));
});
```

Counters: keep the final number in the markup (`<div class="stat" data-count="42">42%</div>`)
so the editor, the thumbnails and the PDF show the finished state.

## Do not

- Animate `display`, `width`/`height` of text boxes, or anything that reflows neighbours.
- Autoplay sound.
- Use `transform` in loops on elements the user will move (use `translate`/`rotate`).
- Depend on `IntersectionObserver` or scroll: slides do not scroll, `.visible` is the trigger.
