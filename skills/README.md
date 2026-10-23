# Skills

Claude Code skills that belong to this repository.

- `diapo-deck/`: generates HTML slide decks that follow the deck editor's file
  contract (fixed 1920x1080 stage, `deck-base.css`, the template's controller,
  the runtime), from a topic, from a PowerPoint or Markdown file, or by
  enhancing an existing deck. Adapted from
  [zarazhangrui/frontend-slides](https://github.com/zarazhangrui/frontend-slides)
  (MIT; the licence is in `diapo-deck/LICENSE-frontend-slides.txt`): the
  style presets and the bold template pack are theirs; the Diapo Format, the
  scripts and the workflow are the editor's. The whole skill is MIT
  (`diapo-deck/LICENSE`), like the editor: copy it, ship it with
  your own tools, change it.

## Installing

Claude Code reads skills from `~/.claude/skills/<name>/SKILL.md` (every
project) or `<project>/.claude/skills/<name>/` (one project). To use
`diapo-deck` everywhere without a copy that drifts, link it:

```
mklink /J "%USERPROFILE%\.claude\skills\diapo-deck" "C:\path\to\Diapo\skills\diapo-deck"
```

(`ln -s` on macOS and Linux.) `diapo-deck/config.json` holds the path of the
`deck-editor` folder; the scripts also accept `DECK_EDITOR_HOME` and find the
folder on their own when the skill sits inside this repository.

## Keeping the skill in step with the editor

- `deck-base.css`, `deck-controller.js` and `deck-runtime.js` are the Deck
  Format (MIT, see `../diapo-format/`). `py -3 deck-editor/tools/build-format.py`
  (also run by `build-templates.py`) refreshes the runtime copy from
  `deck-editor/app/deck-runtime.js`, and warns when the controller or the
  annotated base CSS no longer match `blank.html`; update those by hand.
  The scripts prefer the editor's own runtime when they find it, and the
  editor offers "Update presentation features" to decks with an older copy,
  so the bundled copy only matters on a machine without the editor.
