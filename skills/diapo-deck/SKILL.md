---
name: diapo-deck
license: MIT
description: Create distinctive, animation-rich HTML slide decks that open, edit and save in Diapo, the user's deck editor (the fixed 1920x1080 stage contract, deck-runtime presenter features), from scratch, from a PowerPoint or Markdown file, from a reveal.js or slides.com deck, or by improving an existing deck. Use whenever the user wants a presentation, slides, a deck, a slideshow, a talk or pitch, a PPTX converted to the web, or a reveal.js / slides.com deck brought into the editor. Preferred over reveal.js or generic HTML slide skills for this user: the output is a plain .html the editor can work on.
---

# Diapo deck

Zero-dependency HTML decks: one `index.html` per deck, all CSS and JS inline,
a fixed 1920x1080 stage scaled to the window, and the deck editor's file
contract, so every deck can be opened in the editor, edited by direct
manipulation, presented with its built-in presenter view, and exported to PDF
or a single file from there.

## Core principles

1. **The editor's contract is the format.** Structure, base CSS, controller and
   runtime come from this skill's files verbatim; the design goes on top.
   Read [editor-integration.md](editor-integration.md) before generating.
2. **Show, don't tell.** People discover taste by looking: three real title
   slides, not a list of adjectives.
3. **Distinctive design.** No generic "AI slop": no default fonts, no purple
   gradient on white, no cookie-cutter card grids. Every deck feels authored
   for its subject.
4. **Progressive disclosure.** Read the light style indexes first; a bold
   template's full `design.md` only after the user picks it.
5. **Fixed stage, non-negotiable.** 1920x1080 stage pixels, scaled as a whole;
   letterbox, never reflow. No `clamp()`, `vw`, `vh` or breakpoints inside the
   stage.
6. **Editable by construction.** Discrete blocks, real elements, semantic tags,
   inline stage-px positions for anything the user will drag. The deck should
   be as pleasant to edit as it is to watch.

## Design aesthetics

Each deck should look authored for its subject, not like a default:

- **Typography**: distinctive, well-paired faces from Google Fonts (the editor
  can list, download and embed those). Not Inter, Roboto, Arial, system fonts,
  and not Space Grotesk on every deck either. Vary serif / grotesque / mono /
  display across generations.
- **Colour**: commit. A dominant surface with one sharp accent beats an even
  spread. Draw from IDE themes, print, signage, cultural references. Vary light
  and dark.
- **Motion**: one orchestrated entrance per slide (staggered `--i`), a few
  fragments where the argument builds, one text effect at most. See
  [animation-patterns.md](animation-patterns.md).
- **Atmosphere**: layered gradients, grids, grain, geometric shapes; not flat
  solid backgrounds everywhere, not illustrations.

## Content density

Ask whether the deck is for speaking or reading and design around it:

| Mode | Best for | Behaviour |
|---|---|---|
| **Low density / speaker-led** | Talks, keynotes, pitches | One idea per slide, large type (body 36-44px), 1-3 bullets, generous space, more slides |
| **High density / reading-first** | Reports, handouts, async review | Self-contained slides, grids, tables, annotations, 4-8 bullets or 4-6 cards, body 28-32px |

Hard limits at 1920x1080: no text under 22px (captions) or 28px (body), no
overflow, no overlapping panels. Content that does not fit is split into more
slides, never shrunk until cramped.

---

## Phase 0: Detect the mode

- **A. New deck**: from a topic, notes or full content. Go to Phase 1.
- **B. Convert**: a `.pptx` or `.md` file, or an HTML deck made with reveal.js
  or slides.com. Go to Phase 4.
- **C. Enhance**: an existing deck (any deck with `.deck-stage`, including one
  saved by the editor). Read it fully first, then follow the Mode C rules.

Also decide **where the deck lives**: the folder the user names; otherwise the
current working directory; if that is the editor's own repository, its
`workspace/` folder. The deck is `<folder>/<deck-name>/index.html` with
`assets/` beside it (a short kebab-case name). Say where it went.

### Mode C rules

- Preserve everything the editor wrote: inline `style` edits, `translate:` /
  `--dx/--dy` moves, `<style id="deck-editor-overrides">` and
  `<style id="deck-editor-fonts">` in the head, `<aside class="notes" hidden>`,
  `data-*` attributes. Edit around them; never regenerate the file from scratch.
- If `.deck-editor/<name>.~draft` exists next to the deck, the user has unsaved
  edits in the editor: say so and ask before touching the file.
- Leave what the editor made as it is: `figure[data-chart]` (edit its JSON
  table, then open and save in the editor to redraw), `figure[data-math]` and
  `figure[data-chem]` (change the attribute and drop the `<svg>`; the editor
  draws it again), `div[data-crop]` round
  a cropped picture, `data-fit`, `data-locked`, `data-guides`, `data-id`.
- An older runtime is fine: the editor brings it up to date on the next save.
- Count existing elements before adding; a slide at its density limit gets a
  continuation slide instead of a squeeze. New pictures need a stage-px box.
- A deck from the older `frontend-slides` skill (a `<script src="editor.js">`,
  an edit hotzone, `E` key, comment notes, `.slide.visible .reveal { transform:
  translateY(0) }`) is migrated on request or when enhancing: drop the in-deck
  editor, fix the reveal rule to `translate(var(--dx,0px), var(--dy,0px))`,
  move comment notes into asides, add the runtime. `scripts/check-deck.py`
  lists what is off.
- After any change, run the Phase 3 verification again.

---

## Phase 1: Content discovery (new decks)

Ask everything at once, with the environment's structured-question UI when it
has one, else one numbered message:

1. **Purpose** (header "Purpose"): Pitch deck / Talk or teaching /
   Internal update / Report or handout
2. **Length** (header "Length"): Short 5-10 / Medium 10-20 / Long 20+
3. **Content** (header "Content"): All content ready / Rough notes / Topic only
4. **Density** (header "Density"): Low density, speaker-led / High density,
   reading-first

Do not ask about editing or export up front; the editor handles both after the
draft. If the deck will run unattended (a booth screen, a lobby loop, a
kiosk), say so in the plan: it gets `data-auto-advance` seconds and
`data-loop` (animation-patterns.md, "Runs by itself") and no fragments. If the user has content, ask them to share it (text, files, a folder of
pictures). Remember the density choice: it sets slide count, type scale, words
per slide and the balance of statement slides versus structured slides.

### Pictures, when provided

1. List the files (`.png .jpg .jpeg .webp .svg .gif`).
2. Look at each one (image reading); if unavailable, go by names and ask only
   when needed.
3. Judge each: what it shows, usable or not (and why), the concept it carries,
   dominant colours.
4. Design the outline around text and pictures together (three screenshots make
   three feature slides; a logo goes on the title and closing slides).
5. Confirm the outline: "Does this outline and picture selection look right?"
   Options: Looks good / Adjust pictures / Adjust outline.
6. Copy the ones used into `<deck>/assets/`, resized to at most 2400px on the
   long side (Pillow); originals untouched.

If a usable logo exists, put it on each style preview so the user sees their
brand three ways. When the user has no pictures yet but the deck wants them,
leave image placeholders (`data-placeholder="image"`) the editor fills with a
double-click, and say so.

---

## Phase 2: Style discovery

Generate **three single-slide previews**: real title slides for this deck in
three distinct directions. Never ask whether they want options; always show.

Read [STYLE_PRESETS.md](STYLE_PRESETS.md) and
[bold-template-pack/selection-index.json](bold-template-pack/selection-index.json)
(metadata only; no `design.md` yet).

| Mood | Presets to consider |
|---|---|
| Confident / impressive | Bold Signal, Electric Studio, Dark Botanical |
| Excited / energetic | Creative Voltage, Neon Cyber, Split Pastel |
| Calm / focused | Notebook Tabs, Paper & Ink, Swiss Modern |
| Inspired / moved | Dark Botanical, Vintage Editorial, Pastel Geometry |

**Mix**: one safe preset, at least one bold template (shortlist by `mood`,
`tone`, `best_for`, `avoid_for`, `formality`, `density`, `scheme`; then read only
the shortlisted `preview.md` files), one wildcard (another bold template or a
custom design of your own when the brief offers a sharper idea than the
library). Formal decks: restrained safe option, calm high-formality template,
authoritative wildcard. Expressive decks: readable safe option, one strong
template, an adventurous context-specific wildcard. If the user names a style,
honour it as one slot.

**Custom wildcard**: a deliberate thesis (typography, committed palette,
recognisable layout system, one atmospheric device) that can expand into
section, content, quote, comparison and closing slides.

**Authenticity (non-negotiable)**: a preview is a first slide, not a diagnostic
card. No "preview", "option A", template names, file names, requirement notes
("safe option", "audience: ...") on the slide. Real chrome only: deck title,
author, date, company, page number. Check the visible text before opening.

**Files**: each preview is a complete deck with one slide, built exactly like
the final deck (contract, base CSS, controller; the runtime may be left out),
saved as `<folder>/.diapo-deck/previews/style-a.html`, `-b`, `-c` (a dot
folder: the editor's file list ignores it, but its server still serves it).
Open all three: `py -3 scripts/open-in-editor.py <folder>/.diapo-deck/previews/style-a.html --no-browser`
prints a `/deck/...` URL for each; show them in the browser pane when there is
one (screenshots at 1280x720), else open the URLs in the system browser.

Then ask (header "Style"): Which direction? Style A: name / Style B: name /
Style C: name / Mix elements. "Mix" gets a follow-up about what to combine.

---

## Phase 3: Generate the deck

Read, in this order, before writing:

1. [editor-integration.md](editor-integration.md): the rules and the markup
   the editor and runtime understand.
2. [deck-template.md](deck-template.md): the skeleton and where each piece goes.
3. [deck-base.css](deck-base.css): pasted in full.
4. [deck-controller.js](deck-controller.js): pasted in full.
5. The runtime: `py -3 scripts/deckeditor.py runtime` prints the path of the file to paste
   as `<script id="deck-runtime">` (the editor's current copy when the editor
   is installed, else the bundled one).
6. [animation-patterns.md](animation-patterns.md) for the chosen feeling.
7. The chosen bold template's `design.md` (only that one) or the chosen
   preview's CSS as the design recipe: keep its fonts, palette, decorative
   vocabulary, spacing rhythm and component grammar; translate any `vw`/`vh`/
   `clamp()` proportions into stage pixels; do not copy its demo content.

Then write the deck:

- `<title>` is the deck's name: the editor's Decks drawer lists decks by it.
- Expand the chosen system into a small set of slide kinds (title, section,
  bullets, two columns, picture + text, quote, big number, comparison, closing)
  and use them consistently. Give every slide `data-name`; start sections with
  `data-section`.
- Apply the density mode throughout. Speaker-led: more slides, bigger type,
  statement slides. Reading-first: structured grids, tables, captions, still
  designed, not a document pasted on a slide.
- Theme variables on `:root` with literal colours and the names the editor's
  layouts look for (`--accent`, `--ink`, `--ink-2`, `--ink-3`, `--rule`,
  `--paper`, `--paper-2`, `--font`, `--font-display`); tag-level type styles.
- Charts as the editor's own charts (`figure[data-chart]` holding its table
  as JSON, deck-template.md "Charts"): no script, no library, editable in the
  editor's Chart section. A chart library (`[data-fig]`) only when the kind is
  one the editor cannot draw, and say that Diapo will ask to trust the deck.
- Equations as `figure[data-math]` (LaTeX, mhchem's `\ce{}` for reactions) and
  molecules as `figure[data-chem]` (SMILES), deck-template.md "Equations and
  chemical structures": never a picture of a formula or a hand-drawn SVG
  molecule, which the user cannot edit.
- Entrances with `.reveal*` + `--i`; fragments where the argument builds;
  transitions and text effects sparingly; a footer master layer with the page
  counter unless the design rejects chrome.
- Full-slide backgrounds and texture layers the user should not drag by
  accident get `data-locked`; margin guides on the stage (`data-guides`) so
  the user's drags snap to the deck's rhythm.
- Speaker notes as `<aside class="notes" hidden>` on slides that need them
  (speaker-led decks: most of them, two or three sentences each).
- One Google Fonts `<link>` with every family and weight used.
- Comments: `/* === SECTION === */` in CSS, `<!-- SLIDE n - name -->` before
  slides, nothing else in comments before a slide.
- No em dashes anywhere in the file.

### Verify (always, before delivery)

1. `py -3 scripts/check-deck.py <deck>/index.html`: zero errors; explain any
   warning you leave.
2. `py -3 scripts/open-in-editor.py <deck>/index.html --no-browser` (uses the
   running editor or starts one; prints the editor URL and the deck URL).
   A deck with charts: open the editor URL (it draws every chart from its
   table), press Ctrl+S there, and run check-deck again: the drawings are now
   in the file, so the deck shows them anywhere.
3. Screenshot every slide from the deck URL with `#n` at 1280x720: no overflow,
   no covered panels, fonts loaded, pictures present. Fix and re-check. A
   `scrollHeight` check alone is not enough; look at the rendering.
4. One screenshot at phone width (375px): the stage letterboxes, nothing
   reflows.
5. Open the editor URL: no Problems badge, no bar at the top (a bar asking
   to trust the deck means it runs scripts of its own; one offering to update
   the presentation features means the runtime pasted was not the current
   one), thumbnails present, click a heading and it selects as one element. If the browser pane is not available, run
   the checks you can and say which were skipped.
6. Delete `<folder>/.diapo-deck/` (the previews) once the deck is verified.

---

## Phase 4: Convert a PowerPoint, Markdown, reveal.js or slides.com deck

A `.pptx` or `.md` file goes through the editor's importer:

1. `py -3 scripts/import-deck.py <file> <folder>/<deck-name>` writes a faithful
   plain deck on the editor's template (theme, masters and layouts, positions,
   text with bullets and emphasis, shapes, pictures into `assets/`, tables,
   charts as editable `figure[data-chart]`, SmartArt from its drawing, notes)
   and lists what it could not carry (effects, animations, embedded objects).
2. Summarise to the user: slide titles, content per slide, picture count,
   the importer's notes. Ask whether they want **a restyle** (Phase 2, then
   Phase 3 with the imported content, keeping `assets/`) or **a faithful
   conversion** (keep the imported deck, tidy type and spacing, run the
   verification; it already follows the contract).
3. Imported charts keep PowerPoint's drawing and their table: in a restyle,
   copy the table into a new `figure[data-chart]` in the deck's design
   (deck-template.md "Charts"). A chart the importer could not draw is in its
   notes: rebuild it the same way, or leave an image placeholder and say so.

### A reveal.js or slides.com deck

No script converts these: read the deck and rebuild it on the editor's
template, with Phase 3's files and checks. A reveal.js deck has
`.reveal > .slides > section`. A slides.com export is a zip (`index.html`,
`lib/`, the pictures) of the same structure whose elements are `.sl-block`
boxes placed in pixels; unzip it into `<folder>/.diapo-deck/import/` and
delete that folder at the end, like the previews. Read the canvas size from
`Reveal.initialize({ width, height })` (reveal.js defaults to 960x700) and
the fonts and colours from the theme stylesheet.

| reveal.js / slides.com | Deck |
|---|---|
| `section`; a vertical stack (nested sections) | `section.slide` each, in reading order, `data-name` from its heading |
| `.sl-block` with left / top / width / height | an absolutely positioned element, the box scaled by stage width / canvas width |
| `aside.notes` | `<aside class="notes" hidden>` |
| `.fragment`, `data-fragment-index` | `data-fragment`, same index; fragment styles (grow, highlight, ...) become the default fade |
| `data-auto-animate`, `data-id` | the same attributes |
| `data-transition` | `data-transition` when it is fade, slide or zoom; otherwise fade |
| `data-background-color` / `-gradient` / `-image` | the slide's background; an image as a full-bleed `data-locked` layer |
| the theme's fonts and colours | the theme variables on `:root` and one Google Fonts link |
| pictures | `<deck>/assets/`, resized as in Phase 1 |

Some content only exists once the page's plugins run: `data-markdown`
sections (convert the Markdown yourself), highlighted code (keep `pre > code`
with the deck's own code styling), maths from KaTeX or MathJax (render it to
SVG, or keep the expression as text and say which). The deck's own scripts
and plugins are not carried over.

Ask the same question as step 2: **a restyle** (Phase 2, then Phase 3 at
1920x1080) or **a faithful conversion**, which keeps the canvas proportions
with the stage 1920 wide (960x700 becomes 1920x1400, deck-template.md "Other
slide sizes"). Tell the user what did not carry over, then run the Phase 3
verification.

---

## Phase 5: Delivery

1. Open the deck in the editor: `py -3 scripts/open-in-editor.py <deck>/index.html`
   (opens the system browser; in a session with a browser pane, use
   `--no-browser` and open the printed URL there so the user sees it beside
   the chat).
2. Tell the user, briefly:
   - Where the file is, the style name, the slide count, which folder the
     editor now lists.
   - How to present: open `index.html` in any browser; arrows / Space, `#n` in
     the URL; P presenter view, O overview, L laser, D draw, A runs it by
     itself, H hides the on-screen controls. Presenter > Rehearse the timings
     in the editor records a time per slide.
   - How to edit: everything on the slide is direct manipulation in the
     editor; Ctrl+S saves in place with a backup; Ctrl+T (Theme) changes the
     colours and fonts deck-wide; Ctrl+M adds a slide in the deck's style;
     the Animation section handles entrances and click-reveals; Ctrl+K finds
     any action.
   - What to ask for next: revisions, more slides, a PDF or single-file export.
3. Offer the natural next steps without pushing: revise, export, share.

---

## Phase 6: Export and share (optional)

Everything the deck needs to travel is in the editor's Export menu; mention
these instead of running scripts:

- **PDF (Ctrl+P)**: one page per slide, animations in their final state,
  fragments revealed, charts rendered, printed by the local Chrome or Edge.
  **PDF with notes** prints a handout with the speaker notes.
- **Single HTML file**: scripts, styles, pictures, fonts inlined; opens
  anywhere offline.
- **Save as (Ctrl+Shift+S)**: an independent copy with its assets.
- **Previous versions**: every save keeps the one before; this brings one back.

For a live URL, `scripts/deploy.sh <deck folder>` deploys the folder to Vercel
(Node and a free Vercel account; the script guides the login). Deploy the
folder, not the file, so `assets/` travels; verify the pictures on the
deployed page; redeploying updates the same URL.

---

## Supporting files

| File | Purpose | When |
|---|---|---|
| [editor-integration.md](editor-integration.md) | The editor's contract, the markup it understands, the checklist | Before Phase 3, Mode C |
| [deck-template.md](deck-template.md) | Skeleton, theme variables, charts and generated content, images | Phase 3 |
| [deck-base.css](deck-base.css) | Mandatory base CSS (stage, slides, print, reveal family) | Phase 3, pasted in full |
| [deck-controller.js](deck-controller.js) | The navigation and scaling controller | Phase 3, pasted in full |
| [deck-runtime.js](deck-runtime.js) | Presenter, overview, laser, drawing, fragments, transitions (bundled copy; `scripts/deckeditor.py runtime` prefers the editor's) | Phase 3, pasted in full |
| [animation-patterns.md](animation-patterns.md) | Feeling-to-motion guide, reveal variants, runtime markup | Phase 3 |
| [STYLE_PRESETS.md](STYLE_PRESETS.md) | 12 safe presets | Phase 2 |
| [bold-template-pack/](bold-template-pack/README.md) | 34 bold design systems: `selection-index.json`, then `preview.md`, then one `design.md` | Phase 2 and 3 |
| `scripts/check-deck.py` | Static contract check (also: scripts Diapo would pause, charts not yet drawn, an outdated runtime) | Phase 3 verify, Mode C |
| `scripts/open-in-editor.py` | Open a deck in the editor (starts the server if needed) | Phase 3 verify, Phase 5 |
| `scripts/import-deck.py` | PPTX / Markdown to deck through the editor's importer | Phase 4 |
| `scripts/deckeditor.py` | Finds the editor; `where`, `runtime`, `workspace` | Everywhere |
| `scripts/deploy.sh` | Vercel deployment | Phase 6 |
| `config.json` | `deck_editor`: path of the editor folder (or set `DECK_EDITOR_HOME`) | Setup |
