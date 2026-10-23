# Bold Template Pack

This pack brings the `beautiful-html-templates` design systems into the
`frontend-slides` skill without making them the default for every deck.

## What To Read

1. Read `bold-template-pack/selection-index.json` first.
2. Shortlist candidates from metadata only:
   - `mood`
   - `tone`
   - `best_for`
   - `avoid_for`
   - `formality`
   - `density`
   - `scheme`
3. For title-slide previews, read only the relevant candidate `preview.md`
   files.
4. After the user chooses a bold template, read exactly that one template's
   full `design.md`.
5. Do not read every `design.md` in the pack.
6. Never read or copy the source library's `template.html` or `deck-stage.js`:
   the stage comes from this skill (`deck-base.css`, `deck-controller.js`).

The full source metadata index is not bundled in the user-facing skill. Normal
generation should use `selection-index.json` only.

## How To Use In Frontend Slides

Preview mix:

- 1 safe option from `STYLE_PRESETS.md`
- at least 1 bold option from this pack
- 1 wildcard option, which may be another bold template from this pack or a
  self-generated custom design

Adjust the tone inside that default mix:

- For board, legal, regulatory, healthcare, investor-update, or highly formal
  internal decks, make the safe option very restrained and choose calmer,
  higher-formality bold templates. The wildcard should feel authoritative and
  specific, not merely decorative.
- For bold, editorial, expressive, experimental, or highly designed decks, keep
  the safe option as a readable fallback, choose one strong bold template, and
  use the wildcard for either a second adventurous template or a custom design
  that better matches the user's occasion and vibe.

If the wildcard is custom, it must follow Frontend Slides' no-slop aesthetics:
distinctive typography, a committed palette, a recognizable layout system, a
context-specific visual idea, fixed 16:9 stage behavior, and no visible process
labels such as "custom", "wildcard", "template", or "preview".

## Implementation Contract

`design.md` is the design-system reference. Treat it as a style recipe, not as
content to copy. `preview.md` is only a lightweight style card for generating
the three title-slide options.

Preview slides must be real title slides for the user's deck. Do not render
template names, option labels, file names, paths, `preview.md`, "generated
from", or user requirement notes on the slide itself.

When generating final slides:

- The output is a deck in the deck editor's contract (see
  `../editor-integration.md` and `../deck-template.md`): `deck-base.css`,
  `deck-controller.js` and the runtime pasted in full, one self-contained
  `index.html` plus `assets/`.
- Never use the source templates' `<deck-stage>` web component or
  `deck-stage.js` (shadow DOM is invisible to the editor); never copy
  `template.html`. The stage, navigation and scaling come from this skill.
- Treat `vw`, `vh`, and `clamp()` values in a `design.md` as design proportions
  to translate into fixed 1920x1080 stage pixels (1vw = 19.2px, 1vh = 10.8px).
- Preserve the selected template's fonts, palette, decorative vocabulary,
  spacing rhythm, and component grammar. Fonts the template takes from
  Fontshare or other CDNs work in the deck but the editor can only manage
  Google Fonts; prefer the Google family when the design doc offers one.
- Put the template's colours on `:root` as literal values with the editor's
  names alongside the template's (`--accent`, `--ink`, `--paper`, `--rule`,
  `--paper-2`, `--font`, `--font-display`), so the Theme panel and the editor's
  new-slide layouts pick them up.
- Keep the user's actual slide content primary. The template style should shape
  presentation, not override message or structure.
- Verify rendered output for both text overflow and panel overlap. A card can
  pass `scrollHeight` checks while still being covered by another grid panel.
