#!/usr/bin/env python3
"""Collect the scripts Diapo has put into decks over its history, as SHA-256 hashes,
into app/known-scripts.json:

    py -3 tools/build-known-scripts.py          (from deck-editor/, inside the git checkout)

serve.py runs Diapo's own scripts in any deck and pauses every other script until
the user trusts the deck (see "Scripts in decks" in serve.py). The current
editions are hashed by serve.py itself at start (app/templates/*.html,
app/deck-runtime.js, app/print/*.js); this file adds the editions of every
earlier commit, so a deck made or saved by an older Diapo still counts as
Diapo's:

- the inline scripts of every template, in every commit;
- the script files Diapo writes into decks (the runtime, the published
  controller and runtime of diapo-format/ and the diapo-deck skill);
- any script in the repository's HTML (decks, fixtures) that carries the
  banner of Diapo's controller, runtime or presenter (older editions that
  predate the templates' history).

Each is stored twice: `sha256` as the text stands and `trimmed` as the text
without its leading and trailing whitespace, so a deck that pasted an edition
with other blank lines round it is still recognised. Run it before a release;
it only ever adds hashes.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
EDITOR = os.path.normpath(os.path.join(HERE, ".."))
sys.path.insert(0, EDITOR)
import serve  # noqa: E402  (page_scripts, script_hash: the same parsing the server does)

OUT = os.path.join(EDITOR, "app", "known-scripts.json")
TEMPLATES = "deck-editor/app/templates/"
FILES = ("deck-editor/app/deck-runtime.js", "deck-editor/app/deck-presenter.js",
         "diapo-format/deck-runtime.js", "diapo-format/deck-controller.js",
         "skills/diapo-deck/deck-runtime.js", "skills/diapo-deck/deck-controller.js")
BANNERS = ("SLIDE PRESENTATION CONTROLLER", "DECK RUNTIME - presentation features", "DECK PRESENTER")


def git(root, *args):
    return subprocess.run(["git", "-C", root, *args], capture_output=True, check=True).stdout


def main():
    root = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=EDITOR, capture_output=True, check=True).stdout.decode().strip()
    exact, trimmed = set(), set()
    try:
        with open(OUT, encoding="utf-8") as f:
            data = json.load(f)
        exact.update(data.get("sha256", []))
        trimmed.update(data.get("trimmed", []))
    except (OSError, ValueError):
        pass
    before = len(exact) + len(trimmed)

    def add_page(text, banner_only):
        for src, body in serve.page_scripts(text):
            if src is None and (not banner_only or any(b in body[:400] for b in BANNERS)):
                exact.add(serve.script_hash(body))
                trimmed.add(serve.script_hash(body.strip()))

    def add_file(raw):
        for text in (raw, raw.replace("\r\n", "\n")):
            exact.add(serve.script_hash("\n" + text.strip() + "\n"))
        trimmed.add(serve.script_hash(raw.replace("\r\n", "\n").strip()))

    commits = git(root, "log", "--format=%H", "--", "*.html", *FILES).decode().split()
    for sha in commits:
        changed = git(root, "show", "--name-only", "--format=", sha).decode().split("\n")
        for name in filter(None, changed):
            if not (name.endswith(".html") or name in FILES):
                continue
            try:
                raw = git(root, "show", f"{sha}:{name}").decode("utf-8", "replace")
            except subprocess.CalledProcessError:
                continue                                   # deleted in this commit
            if name in FILES:
                add_file(raw)
            else:
                add_page(raw, banner_only=not name.startswith(TEMPLATES))
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"about": "SHA-256 of scripts earlier Diapo editions put into decks, as written and trimmed; made by tools/build-known-scripts.py",
                   "sha256": sorted(exact), "trimmed": sorted(trimmed)}, f, indent=1)
        f.write("\n")
    print(f"{len(commits)} commits, {len(exact)} + {len(trimmed)} trimmed hashes ({len(exact) + len(trimmed) - before} new) -> {os.path.relpath(OUT, EDITOR)}")


if __name__ == "__main__":
    main()
