#!/usr/bin/env python3
"""Convert a PowerPoint (.pptx) or Markdown (.md) file into a deck with the editor's importer.

Usage:
  py -3 import-deck.py <file.pptx|file.md> <output folder>

Writes <output folder>/index.html (built on the editor's blank template: theme,
masters and layouts are resolved, every shape keeps its position and size, text keeps
bullets, sizes, bold/italic/colours, pictures are copied into <output folder>/assets/,
tables become tables, charts become editable figure[data-chart], SmartArt comes from
its drawing, notes are kept) and prints what could not be carried over.

The result is a faithful, plain deck: read it for the content and the layout, then
restyle it in the chosen design (or keep it as-is when the user wants a conversion
that stays close to the original). Standard library only; no python-pptx needed.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import deckeditor  # noqa: E402


def main(argv):
    if len(argv) < 2 or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    src, out_dir = os.path.abspath(argv[0]), os.path.abspath(argv[1])
    if not os.path.isfile(src):
        print("no such file: " + src, file=sys.stderr)
        return 1
    home = deckeditor.find_editor()
    if not home:
        print("deck-editor not found: set DECK_EDITOR_HOME or config.json (see deckeditor.py)", file=sys.stderr)
        return 1
    sys.path.insert(0, home)
    import import_deck  # the editor's importer (deck-editor/import_deck.py)

    os.makedirs(out_dir, exist_ok=True)
    html_text, notes = import_deck.import_file(src, out_dir)
    out = os.path.join(out_dir, "index.html")
    with open(out, "w", encoding="utf-8", newline="") as f:
        f.write(html_text)
    print("written " + out)
    for n in notes or []:
        print("note: " + str(n))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
