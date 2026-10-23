#!/usr/bin/env python3
"""Where is the deck editor? Shared by the other scripts; also a small CLI.

Lookup order:
  1. the DECK_EDITOR_HOME environment variable (the deck-editor folder)
  2. "deck_editor" in config.json next to this script
  3. ../../deck-editor relative to the skill (the skill lives in the editor's repository)
  4. ~/deck-editor

Usage:
  py -3 deckeditor.py where      prints the deck-editor folder (exit 1 if not found)
  py -3 deckeditor.py runtime    prints the path of the runtime script to paste
                                 (the editor's app/deck-runtime.js when found, else
                                 the bundled deck-runtime.js next to this skill)
  py -3 deckeditor.py workspace  prints the folder the editor used last (~/.deck-editor.json)
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)


def _is_editor(path):
    return bool(path) and os.path.isfile(os.path.join(path, "serve.py")) and os.path.isdir(os.path.join(path, "app"))


def find_editor():
    """The deck-editor folder, or None."""
    candidates = [os.environ.get("DECK_EDITOR_HOME", "")]
    cfg = os.path.join(SKILL, "config.json")
    if os.path.isfile(cfg):
        try:
            with open(cfg, encoding="utf-8") as f:
                candidates.append(json.load(f).get("deck_editor", ""))
        except (OSError, ValueError):
            pass
    candidates.append(os.path.normpath(os.path.join(SKILL, "..", "..", "deck-editor")))
    candidates.append(os.path.join(os.path.expanduser("~"), "deck-editor"))
    for c in candidates:
        c = os.path.expanduser(c) if c else c
        if _is_editor(c):
            return os.path.abspath(c)
    return None


def runtime_path():
    """The runtime script to paste into a deck: the editor's own copy when the editor is
    installed (always the current version), else the copy bundled with the skill."""
    home = find_editor()
    if home:
        p = os.path.join(home, "app", "deck-runtime.js")
        if os.path.isfile(p):
            return p
    return os.path.join(SKILL, "deck-runtime.js")


def last_workspace():
    """The folder the editor opened last, from its settings file, or None."""
    p = os.path.join(os.path.expanduser("~"), ".deck-editor.json")
    try:
        with open(p, encoding="utf-8") as f:
            ws = json.load(f).get("workspace")
        return ws if ws and os.path.isdir(ws) else None
    except (OSError, ValueError):
        return None


def python_cmd():
    """How to start a Python 3 for the server: the interpreter running this script."""
    return sys.executable


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "where"
    if what == "where":
        home = find_editor()
        if not home:
            print("deck-editor not found: set DECK_EDITOR_HOME or config.json", file=sys.stderr)
            sys.exit(1)
        print(home)
    elif what == "runtime":
        print(runtime_path())
    elif what == "workspace":
        ws = last_workspace()
        print(ws or "")
        sys.exit(0 if ws else 1)
    else:
        print(__doc__)
        sys.exit(2)
