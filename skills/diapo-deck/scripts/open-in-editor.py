#!/usr/bin/env python3
"""Open a deck in the deck editor.

Usage:
  py -3 open-in-editor.py <deck.html> [--port 8800] [--no-browser]

What it does:
  1. Finds the editor (see deckeditor.py).
  2. Uses the editor server already running on the port when there is one
     (its folder is switched to the deck's parent folder if the deck lies
     elsewhere), else starts one detached: serve.py <folder> <port> --no-open.
  3. Prints two URLs and opens the first in the default browser:
       editor:  http://127.0.0.1:<port>/?file=<name>/index.html
       deck:    http://127.0.0.1:<port>/deck/<name>/index.html   (the deck alone; add #n for slide n)
  --no-browser only prints (use it from an agent that has its own browser pane).
  The server is left running afterwards (the user may have decks open in it).

The "folder" the editor lists is the folder that contains the deck folder:
  <folder>/<name>/index.html  ->  folder = <folder>,  file = <name>/index.html
  <folder>/talk.html          ->  folder = <folder>,  file = talk.html
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import deckeditor  # noqa: E402


def status(port):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/status" % port, timeout=1.5) as r:
            return json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return None


def set_workspace(port, folder):
    req = urllib.request.Request(
        "http://127.0.0.1:%d/api/workspace?path=%s" % (port, urllib.parse.quote(folder)),
        data=b"", method="POST")
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read().decode("utf-8")).get("workspace")


def split_deck(path):
    """(folder the editor should list, file path relative to it, slash-separated)."""
    path = os.path.abspath(path)
    deck_dir = os.path.dirname(path)
    parts = deck_dir.replace("\\", "/").split("/")
    if ".diapo-deck" in parts:
        # A style preview: the folder is the one that holds .diapo-deck.
        folder = "/".join(parts[:parts.index(".diapo-deck")])
        folder = os.path.normpath(folder if folder else "/")
    elif os.path.basename(path).lower() == "index.html":
        folder = os.path.dirname(deck_dir)
    else:
        folder = deck_dir
    rel = os.path.relpath(path, folder).replace(os.sep, "/")
    return folder, rel


def start_server(home, folder, port):
    log = os.path.join(folder, ".deck-editor", "server.log")
    os.makedirs(os.path.dirname(log), exist_ok=True)
    out = open(log, "ab")
    args = [deckeditor.python_cmd(), os.path.join(home, "serve.py"), folder, str(port), "--no-open"]
    kw = {"stdout": out, "stderr": out, "stdin": subprocess.DEVNULL, "cwd": home}
    if os.name == "nt":
        kw["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    subprocess.Popen(args, **kw)
    for _ in range(40):
        time.sleep(0.25)
        if status(port):
            return True
    return False


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    deck = argv[0]
    port = 8800
    browser = True
    i = 1
    while i < len(argv):
        if argv[i] == "--port" and i + 1 < len(argv):
            port = int(argv[i + 1]); i += 1
        elif argv[i] == "--no-browser":
            browser = False
        i += 1
    if not os.path.isfile(deck):
        print("no such file: " + deck, file=sys.stderr)
        return 1
    home = deckeditor.find_editor()
    if not home:
        print("deck-editor not found: set DECK_EDITOR_HOME or config.json (see deckeditor.py)", file=sys.stderr)
        return 1
    folder, rel = split_deck(deck)

    st = status(port)
    if st:
        current = os.path.normcase(os.path.abspath(st.get("workspace") or ""))
        wanted = os.path.normcase(os.path.abspath(folder))
        deck_abs = os.path.normcase(os.path.abspath(deck))
        if current and deck_abs.startswith(current.rstrip("\\/") + os.sep):
            # Already inside the running editor's folder: keep it, address the deck from there.
            rel = os.path.relpath(os.path.abspath(deck), st["workspace"]).replace(os.sep, "/")
        elif current != wanted:
            set_workspace(port, folder)
            print("editor folder switched to " + folder)
    else:
        if not start_server(home, folder, port):
            print("could not start the editor server on port %d (see %s)" % (port, os.path.join(folder, ".deck-editor", "server.log")), file=sys.stderr)
            return 1
        print("editor started on port %d for %s" % (port, folder))

    editor_url = "http://127.0.0.1:%d/?file=%s" % (port, urllib.parse.quote(rel))
    deck_url = "http://127.0.0.1:%d/deck/%s" % (port, urllib.parse.quote(rel))
    print("editor: " + editor_url)
    print("deck:   " + deck_url)
    if browser:
        webbrowser.open(editor_url)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
