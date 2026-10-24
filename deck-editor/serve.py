#!/usr/bin/env python3
"""Diapo server: serves the editor app plus one workspace folder of decks,
and exposes a small JSON API so the browser can save files back to disk.

    py -3 serve.py [workspace folder] [port] [--tab | --no-open] [--default <folder>] [--settings <file>] [--backups N]

Without a workspace argument the last used folder is reopened (or --default on a
first run, or the current folder). Port defaults to 8800. Binds to 127.0.0.1 only.
Python 3 standard library only, no third-party packages.

Routes
    GET  /                       the editor app (app/index.html)
    GET  /<app file>             editor.css, editor.js, core/*.js, templates/*
    GET  /deck/<path>            any file inside the workspace (the iframe loads decks here); a deck
                                 comes with X-Diapo-Version, a hash of the file (see /api/save)
    GET  /api/status             {ok, workspace}
    GET  /api/list?dir=<path>    *.html files under the workspace, recursive, each with its title and
                                 whether it is a deck (has a .deck-stage)
    POST /api/save?file=<path>[&base=<version>][&overwrite=1]
                                 body = HTML; keeps the previous versions in <deck folder>/.deck-editor/
                                 (<name>.bak, <name>.~1.bak ... <name>.~N.bak; N = 10 unless set).
                                 base = the X-Diapo-Version the deck was opened at: 409 with reason
                                 "changed" when the file is different now (overwrite=1 writes anyway);
                                 returns the new version
    POST /api/upload?dir=<path>  multipart file(s) -> <dir>/assets/, returns relative paths
    POST /api/new?path=<path>[&template=<slug>]  create a deck from app/templates/<slug>.html
                                 (blank.html by default; template=welcome copies the tour deck,
                                 app/templates/welcome.html, built like the other templates)
    POST /api/rename?file=&to=   rename a deck (its sibling files stay where they are)
    POST /api/duplicate?file=&to= copy a deck to a new name in the same folder
    GET  /api/draft?file=<path>  {exists, mtime} of the unsaved-draft sidecar .deck-editor/<name>.~draft
    POST /api/draft?file=<path>  body = HTML; writes the sidecar (autosave of unsaved edits)
    DELETE /api/draft?file=<path> removes the sidecar (after a save, or on Discard)
    GET  /deck/<path>?draft=1    serves <path>.~draft in place of the file, same URL so
                                 relative assets and the deck's own scripts behave identically
    POST /api/workspace?path=    switch the workspace to another folder (remembered)
    POST /api/workspace/pick     native folder dialog on this machine, then switch to it
    POST /api/workspace/pick-file native file dialog; switches to the file's folder and returns it
    POST /api/recent?file=<path> record a deck as recently opened
    GET  /api/themes             saved themes {name: {vars, rules, css}}
    POST /api/themes?name=       body = JSON theme; saves or replaces it
    DELETE /api/themes?name=     removes a saved theme
    GET  /api/fonts/google?family= weights and italic weights Google Fonts offers for a family
    POST /api/fonts/host?file=&embed=0|1  body = JSON {urls}: downloads the fonts behind
                                 Google Fonts stylesheet URLs into <deck folder>/fonts/ (or
                                 inlines them as data URIs) and returns the @font-face CSS
    POST /api/fonts/upload?file= multipart font files -> <deck folder>/fonts/; returns each
                                 file's family, weight and style read from the font itself
    POST /api/fonts/embed-own?file= body = JSON {css}: rewrites url(fonts/...) in the given
                                 @font-face CSS to data URIs read from the deck folder
    POST /api/export?file=&to=   body = HTML; writes a self-contained copy (scripts, styles,
                                 images, fonts inlined) as <deck folder>/<to>, or asks where
                                 with a save dialog when `to` is missing (dialog=0: next to
                                 the deck under a default name)
    POST /api/export/pptx?file=&to=   body = the deck measured by the editor (JSON); writes an
                                 editable PowerPoint file (pptx_export.py) to <to> / a save dialog
    POST /api/pdf?file=&to=      body = printable HTML; prints it with the Chrome or Edge on
                                 this machine (headless) to <to> / a save dialog; 501 when
                                 no such browser exists (the editor then prints itself)
    POST /api/import?name=&path= multipart .md or .pptx (or path= a file on this machine) -> a new
                                 deck <name>/index.html in the workspace, pictures copied into its
                                 assets/; returns {file, notes}
    POST /api/import/pick        native file dialog for a .md / .pptx on this machine -> {path} (or
                                 {cancelled}); the editor then imports it with /api/import?path=
    POST /api/saveas?file=&to=   body = HTML; writes the deck under a new name or place (`to` = a bare
                                 name in the deck folder, or an absolute path; without it a save dialog),
                                 copies the local files it references (assets, scripts, styles, fonts)
                                 into the new folder, and makes that folder the workspace when it is
                                 outside; returns {file, workspace, copied, notes}

The last workspace and the recent decks are kept in ~/.deck-editor.json.

The editor opens in its own window: the Chrome or Edge of this machine (the
one that prints the PDFs) in app mode, with no tabs or address bar and a
profile of its own (~/.deck-editor-window-<port>) that never mixes with the
user's browsing and remembers the window size. When the window closes the
server stops, so Diapo starts and quits like a program (on macOS, Chrome
keeps running after its last window closes: Cmd+Q quits it and stops the
server). --tab opens a normal browser tab instead and serves until Ctrl+C,
which is also the fallback without Chrome or Edge; the windowed Windows build
then opens a console window titled Diapo, and closing it stops the server. If the port is taken by
another Diapo, a window on that one is opened instead of a second server;
if it is taken by something else, the next free port is used.

Without a console (the windowed executable) everything printed goes to
~/.deck-editor.log, and a fatal error is shown in a message box.

Who may call this: every request must carry a Host header naming this server
(127.0.0.1, localhost or [::1] with the port), and every POST or DELETE must come
from the editor's own origin (browsers say so in Origin / Sec-Fetch-Site). A web
page on another site therefore cannot make the server write, switch folders or
open dialogs, and a DNS-rebinding page cannot read files. Every file is served with
frame-ancestors 'self' (and X-Frame-Options), so no other site can show the editor
in a frame and steer clicks into it, and a request that a page on another site or
origin makes (a <script src> to a deck's file, say) is refused on reads too. Uploads are limited to image, video and audio
files under a plain file name.
"""
import email
import email.policy
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import base64
import contextlib
import hashlib
import html as html_text
import re
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import struct
import tempfile
import import_deck
import mimetypes
import zlib

# Inside a PyInstaller build (build-exe.py) the app files are unpacked next to sys._MEIPASS.
HERE = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(HERE, "app")
TEMPLATE = os.path.join(APP_DIR, "templates", "blank.html")
IGNORED_DIRS = {"node_modules", ".git", ".frontend-slides", "__pycache__", "deck-editor", ".deck-editor"}   # the last: this tool's own templates and fixtures
BACKUP_HISTORY = 10          # default; the settings file ("backups") or --backups N override it
SIDECAR_DIR = ".deck-editor"  # backups and drafts live here, next to the deck, not beside it
MAX_UPLOAD = 50 * 1024 * 1024
# What /api/upload accepts: things a slide can show. Never scripts, HTML or executables,
# so a request from elsewhere can not plant a file that runs.
UPLOAD_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg",
              ".mp4", ".webm", ".mov", ".mp3", ".m4a", ".wav", ".ogg"}


# ------------------------------------------------------------------
# Settings: the last workspace and the recently opened decks, kept in
# the user's home folder so they survive moving this tool around.
# ------------------------------------------------------------------
def settings_path(argv):
    """~/.deck-editor.json, or the file named by --settings (the tests use a throw-away one)."""
    if "--settings" in argv:
        i = argv.index("--settings")
        if i + 1 < len(argv):
            return os.path.abspath(argv[i + 1])
    return os.path.join(os.path.expanduser("~"), ".deck-editor.json")


SETTINGS_FILE = settings_path(sys.argv[1:])
MAX_RECENT = 12

# The sample deck lives here, not in the user's folder: a hidden folder beside the settings
# file (~/.deck-editor-samples/welcome/index.html), reached through the virtual folder
# "@diapo/" in every path the API takes, so it opens from any workspace and never shows up
# in a folder listing.
SAMPLES_DIR = os.path.realpath(os.path.join(os.path.dirname(SETTINGS_FILE), ".deck-editor-samples"))
SAMPLES_PREFIX = "@diapo"


def is_virtual(rel):
    return rel == SAMPLES_PREFIX or rel.startswith(SAMPLES_PREFIX + "/")


# The settings hold the trusted decks and the saved themes, so they are
# never half-written: one writer at a time (the server answers on several threads), each
# write going to a temporary file that then takes the settings' place.
SETTINGS_LOCK = threading.RLock()
SETTINGS_WRITABLE = True
SETTINGS_NOTES = []          # what went wrong reading them, printed once the log is set up (main)


def load_settings():
    """The settings, or {} on a first run. A file that cannot be opened is tried again for a
    moment (on Windows a virus scanner or a sync client can hold it); if it stays shut, this
    session leaves it alone rather than write an empty one over it. A file that is not valid
    JSON is moved aside as <name>.broken-<time> (it may hold settings worth recovering)."""
    global SETTINGS_WRITABLE
    if not os.path.exists(SETTINGS_FILE):
        return {}
    text = None
    for attempt in range(10):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                text = f.read()
            break
        except OSError as e:
            err = e
            time.sleep(0.2)
    if text is None:
        SETTINGS_WRITABLE = False
        SETTINGS_NOTES.append(f"Could not read the settings ({SETTINGS_FILE}: {err}); this session does not change them.")
        return {}
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except ValueError:
        pass
    aside = f"{SETTINGS_FILE}.broken-{time.strftime('%Y%m%d-%H%M%S')}"
    try:
        os.replace(SETTINGS_FILE, aside)
        SETTINGS_NOTES.append(f"The settings were damaged; they were kept as {aside} and Diapo starts afresh.")
    except OSError as e:
        SETTINGS_WRITABLE = False
        SETTINGS_NOTES.append(f"The settings are damaged and could not be moved aside ({e}); this session does not change them.")
    return {}


def save_settings(data):
    """Write the settings whole or not at all: to <name>.<pid>.tmp, flushed to the disk,
    then swapped in with os.replace. A crash, a full disk or a second thread mid-write
    leaves the previous file as it was."""
    with SETTINGS_LOCK:
        if not SETTINGS_WRITABLE:
            return
        text = json.dumps(data, indent=2)
        tmp = f"{SETTINGS_FILE}.{os.getpid()}.tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(text)
                f.flush()
                os.fsync(f.fileno())
            for attempt in range(10):                  # Windows: a reader (scanner, sync) may hold the file
                try:
                    os.replace(tmp, SETTINGS_FILE)
                    break
                except PermissionError:
                    if attempt == 9:
                        raise
                    time.sleep(0.1)
        except OSError as e:
            print(f"Could not write the settings ({SETTINGS_FILE}): {e}")
            try:
                os.remove(tmp)
            except OSError:
                pass


@contextlib.contextmanager
def settings_change():
    """with settings_change() as s: s["key"] = value - changes the settings and writes them,
    one thread at a time, so no change is lost to another made at the same moment."""
    with SETTINGS_LOCK:
        yield SETTINGS
        save_settings(SETTINGS)


SETTINGS = load_settings()

# The build: bump APP_VERSION and APP_RELEASED with every release (tools/release.py does).
APP_VERSION = "1.0.0"
APP_RELEASED = "2026-10-24"


def recent_decks():
    """Recently opened decks that still exist, newest first, each with its title."""
    out = []
    for r in SETTINGS.get("recent", []):
        file = r.get("file", "")
        if is_virtual(file):
            full = os.path.join(SAMPLES_DIR, file[len(SAMPLES_PREFIX):].lstrip("/").replace("/", os.sep))
        else:
            full = os.path.join(r.get("workspace", ""), file.replace("/", os.sep))
        if os.path.isfile(full):
            out.append({**r, "title": deck_title(full)})
    return out


TITLE_RE = re.compile(rb"<title[^>]*>(.*?)</title\s*>", re.I | re.S)
_titles = {}


def deck_title(full):
    """The <title> of an HTML file (read from its first 256 KB, where the head is), or ""."""
    try:
        st = os.stat(full)
    except OSError:
        return ""
    key = (full, st.st_mtime_ns, st.st_size)
    if key not in _titles:
        with open(full, "rb") as f:
            m = TITLE_RE.search(f.read(262144))
        title = html_text.unescape(m.group(1).decode("utf-8", "replace")) if m else ""
        _titles[key] = " ".join(title.split())[:120]
    return _titles[key]


DECK_STAGE_RE = re.compile(rb"""class\s*=\s*["'][^"'>]*\bdeck-stage\b""", re.I)
_decks = {}


def is_deck(full):
    """Whether an HTML file has an element of class deck-stage, so the editor can open it. Read
    in chunks to the end if need be: a single-file export carries its fonts in the head, before
    the stage."""
    try:
        st = os.stat(full)
    except OSError:
        return False
    key = (full, st.st_mtime_ns, st.st_size)
    if key not in _decks:
        found, tail = False, b""
        try:
            with open(full, "rb") as f:
                while not found:
                    chunk = f.read(1 << 20)
                    if not chunk:
                        break
                    found = DECK_STAGE_RE.search(tail + chunk) is not None
                    tail = chunk[-512:]
        except OSError:
            pass
        _decks[key] = found
    return _decks[key]


def remember_deck(workspace, file):
    with settings_change() as s:
        recent = [r for r in s.get("recent", []) if not (r.get("workspace") == workspace and r.get("file") == file)]
        recent.insert(0, {"workspace": workspace, "file": file, "when": int(time.time())})
        s["recent"] = recent[:MAX_RECENT]


# ------------------------------------------------------------------
# Command line: positional args are [workspace] [port] in any order
# (a number is the port, anything else is the workspace folder).
# Without a workspace argument the last used one is reopened; the
# --default <folder> option names the folder for a first run.
# ------------------------------------------------------------------
def parse_args(argv):
    workspace, port, default = None, 8800, None
    it = iter(argv)
    for a in it:
        if a == "--default":
            default = next(it, None)
        elif a == "--settings":
            next(it, None)
        elif a == "--backups":
            v = next(it, None)
            if v and v.isdigit():
                SETTINGS["backups"] = int(v)
        elif a.startswith("--"):
            continue
        elif a.isdigit():
            port = int(a)
        else:
            workspace = a
    if workspace is None:
        last = SETTINGS.get("workspace")
        if last and os.path.isdir(last):
            workspace = last
        elif default and os.path.isdir(default):
            workspace = default
        else:
            workspace = os.getcwd()
    return os.path.realpath(workspace), port, "--no-open" not in argv


WORKSPACE, PORT, OPEN_BROWSER = parse_args(sys.argv[1:])
LOG_FILE = (SETTINGS_FILE[:-5] if SETTINGS_FILE.endswith(".json") else SETTINGS_FILE) + ".log"


def set_workspace(path):
    """Switch the served workspace; remembered for the next start."""
    global WORKSPACE
    full = os.path.realpath(path)
    if not os.path.isdir(full):
        raise FileNotFoundError("no such folder: " + path)
    WORKSPACE = full
    with settings_change() as s:
        s["workspace"] = full
    print(f"Workspace: {full}")
    return full


# ------------------------------------------------------------------
# Native pickers. They run in a separate Python process (tkinter is not
# thread-safe and the server is threaded); the dialog belongs to this
# machine, which is where the files are.
# ------------------------------------------------------------------
PICKER = r"""
import sys, tkinter, tkinter.filedialog as fd
root = tkinter.Tk(); root.withdraw(); root.attributes('-topmost', True)
kind, start, name = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ''
if kind == 'folder':
    p = fd.askdirectory(initialdir=start, title='Choose the folder that holds your decks')
elif kind == 'import':
    p = fd.askopenfilename(initialdir=start, title='Import a Markdown or PowerPoint file', filetypes=[('Markdown or PowerPoint', '*.md *.markdown *.txt *.pptx'), ('Markdown', '*.md *.markdown *.txt'), ('PowerPoint', '*.pptx'), ('All files', '*.*')])
elif kind == 'save':
    ext = name[name.rfind('.'):] if '.' in name else ''
    kinds = [('PDF', '*.pdf')] if ext == '.pdf' else [('HTML', '*.html')]
    p = fd.asksaveasfilename(initialdir=start, initialfile=name, defaultextension=ext, title='Export as', filetypes=kinds + [('All files', '*.*')])
else:
    p = fd.askopenfilename(initialdir=start, title='Open a deck', filetypes=[('HTML decks', '*.html *.htm'), ('All files', '*.*')])
sys.stdout.write(p or '')
"""


NO_DIALOG = "no file dialog is available on this computer"


def native_pick(kind, start, name=""):
    """A native dialog: tkinter first (works everywhere it is installed), then the system's own
    dialog on macOS (osascript) and Linux (zenity or kdialog). Raises RuntimeError(NO_DIALOG)
    when none can be shown; the editor then asks for a path in its own UI."""
    if os.environ.get("DECK_EDITOR_NO_DIALOG"):        # headless machines and the tests: never show one
        raise RuntimeError(NO_DIALOG)
    # A frozen build re-runs itself with --picker (there is no separate python to call).
    cmd = [sys.executable, "--picker", kind, start, name] if getattr(sys, "frozen", False) else [sys.executable, "-c", PICKER, kind, start, name]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if r.returncode == 0:
            return r.stdout.strip()
        err = (r.stderr.strip().splitlines() or ["unknown error"])[-1]
    except (OSError, subprocess.SubprocessError) as e:
        err = str(e)
    fallback = system_pick(kind, start, name)
    if fallback is not None:
        return fallback
    raise RuntimeError(NO_DIALOG + " (tkinter: " + err + ")")


def system_pick(kind, start, name):
    """The operating system's dialog without tkinter. Returns the path, '' when cancelled, None
    when no such dialog exists here."""
    try:
        if sys.platform == "darwin":
            if kind == "folder":
                script = 'POSIX path of (choose folder with prompt "Choose the folder that holds your decks")'
            elif kind == "save":
                script = 'POSIX path of (choose file name with prompt "Export as" default name "%s")' % name.replace('"', '')
            else:
                script = 'POSIX path of (choose file with prompt "%s")' % ("Import a Markdown or PowerPoint file" if kind == "import" else "Open a deck")
            r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=600)
            if r.returncode != 0:
                return "" if "User canceled" in (r.stderr or "") else None
            return r.stdout.strip().rstrip("/") if kind == "folder" else r.stdout.strip()
        if sys.platform.startswith("linux"):
            if shutil.which("zenity"):
                args = ["zenity", "--file-selection"]
                if kind == "folder":
                    args += ["--directory", "--title=Choose the folder that holds your decks"]
                elif kind == "save":
                    args += ["--save", "--confirm-overwrite", "--filename=" + os.path.join(start, name), "--title=Export as"]
                else:
                    args += ["--title=" + ("Import a Markdown or PowerPoint file" if kind == "import" else "Open a deck")]
                r = subprocess.run(args, capture_output=True, text=True, timeout=600)
                return r.stdout.strip() if r.returncode == 0 else ""
            if shutil.which("kdialog"):
                args = ["kdialog", "--getexistingdirectory" if kind == "folder" else "--getsavefilename" if kind == "save" else "--getopenfilename", os.path.join(start, name) if kind == "save" else start]
                r = subprocess.run(args, capture_output=True, text=True, timeout=600)
                return r.stdout.strip() if r.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return None
    return None


# ------------------------------------------------------------------
# Path safety: every path coming from the browser is resolved against
# the workspace and rejected if it escapes it (".." or absolute paths).
# ------------------------------------------------------------------
def safe_path(rel):
    rel = urllib.parse.unquote(rel or "").replace("\\", "/").lstrip("/")
    root = WORKSPACE
    if is_virtual(rel):
        root, rel = SAMPLES_DIR, rel[len(SAMPLES_PREFIX):].lstrip("/")
    full = os.path.realpath(os.path.join(root, rel))
    if full != root and not full.startswith(root + os.sep):
        raise PermissionError("path is outside the workspace")
    return full


def rel_path(full):
    if full == SAMPLES_DIR or full.startswith(SAMPLES_DIR + os.sep):
        sub = os.path.relpath(full, SAMPLES_DIR).replace(os.sep, "/")
        return SAMPLES_PREFIX if sub == "." else SAMPLES_PREFIX + "/" + sub
    return os.path.relpath(full, WORKSPACE).replace(os.sep, "/")


# ------------------------------------------------------------------
# Request origin: the server listens on 127.0.0.1 only, but any web page
# the user has open can still send requests to it. Three checks keep those
# out:
#   - the Host header must name this server (a page reached through DNS
#     rebinding carries its own host name and is refused on every request);
#   - no request may come from another site or origin (Sec-Fetch-Site), so
#     a page elsewhere cannot load a workspace file as its own script;
#   - a request that changes something (POST, DELETE) must come from the
#     editor's own origin. Browsers send Origin on such requests, and
#     Sec-Fetch-Site on every request; a request with neither is not from
#     a browser (curl, the tests) and is a local process with disk access
#     of its own anyway.
# ------------------------------------------------------------------
LOCAL_HOSTS = ("127.0.0.1", "localhost", "[::1]")


def allowed_hosts(port):
    return {f"{h}:{port}" for h in LOCAL_HOSTS} | (set(LOCAL_HOSTS) if port == 80 else set())


def host_ok(host, port):
    return (host or "").strip().lower() in allowed_hosts(port)


def fetch_site_ok(fetch_site):
    """Any request, reads too: a page elsewhere may not load the editor's or the workspace's
    files (a <script src> to a deck's data.js would run it in that page, which could then read
    what it defines). Browsers say where a request comes from in Sec-Fetch-Site: the editor's
    own pages send same-origin, a window opened on the editor (the app window, a bookmark,
    a typed address) none. No header: not a browser, or one too old to send it."""
    return fetch_site is None or fetch_site.strip().lower() in ("same-origin", "none")


def origin_ok(origin, fetch_site, port):
    if origin is not None:
        return origin.strip().lower() in {f"http://{h}" for h in allowed_hosts(port)}
    if fetch_site is not None:
        return fetch_site.strip().lower() in ("same-origin", "none")
    return True


# ------------------------------------------------------------------
# Scripts in decks. The editor loads a deck from its own origin (it reaches
# into the deck's DOM), so a script in a deck would pass the origin check
# above and could call every route as if it were the editor: switch the
# workspace to any folder, read any file, write anywhere. So every file
# under /deck/ is served with a Content-Security-Policy that lets only
# Diapo's own scripts run: the controller and the presentation features of
# the templates and the print helpers, recognised by the SHA-256 of their
# text, current editions and past ones (app/known-scripts.json, built by
# tools/build-known-scripts.py from the git history). A deck's other
# scripts, inline event handlers, javascript: links and form posts stay
# off. A deck with scripts of its own (a chart library, a generator) gets a
# bar in the editor; once the user trusts it, it is served without the
# policy for as long as those scripts stay the same: the inline ones and the
# script files on this computer by the hash of their text (a changed library
# next to the deck pauses it again), files from the internet by address only
# (the bar says their contents can change unseen). A file such a script
# loads by itself (an import, a fetched script) is not part of the check.
# The editor's own pages get a policy too (their script files and Diapo's
# known scripts only), so deck text that reaches the editor as HTML can
# never run there either.
# ------------------------------------------------------------------
SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script(?=[\s/>])[^>]*>", re.I | re.S)
SRC_RE = re.compile(r"""(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", re.I)
TYPE_RE = re.compile(r"""(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", re.I)
DECK_DOC_EXT = (".html", ".htm", ".~draft")
# Text the editor writes into decks as inline scripts (the presentation features, the
# print helpers): hashed as written ("\n" + text + "\n"), with its own line ends and with LF.
EDITOR_SCRIPTS = ("deck-runtime.js", "print/prep.js", "print/keeper.js")
_known = None
_scan_cache = {}


def script_hash(text):
    return base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode("ascii")


def _attr_value(regex, attrs):
    m = regex.search(attrs)
    return next((g for g in m.groups() if g is not None), "") if m else None


def page_scripts(text):
    """(src or None, body) of every <script> a browser would run in this page. The body is
    what the browser hashes: the text as written, line ends turned into LF by the parser."""
    for m in SCRIPT_RE.finditer(text):
        attrs = m.group(1)
        kind = (_attr_value(TYPE_RE, attrs) or "").strip().lower()
        if kind not in ("", "module") and not any(k in kind for k in ("javascript", "ecmascript", "jscript", "livescript")):
            continue                                   # a data block (application/json): never run
        src = _attr_value(SRC_RE, attrs)
        yield (src.strip() if src is not None else None), m.group(2).replace("\r\n", "\n").replace("\r", "\n")


def _known_sets():
    """(exact, trimmed): hashes of every script Diapo itself puts into decks, current and
    past editions, as written and without the whitespace round them."""
    global _known
    if _known is None:
        exact, trimmed = set(), set()
        tdir = os.path.join(APP_DIR, "templates")
        for name in sorted(os.listdir(tdir)):
            if name.endswith(".html"):
                with open(os.path.join(tdir, name), encoding="utf-8") as f:
                    for src, body in page_scripts(f.read()):
                        if src is None:
                            exact.add(script_hash(body))
                            trimmed.add(script_hash(body.strip()))
        for rel in EDITOR_SCRIPTS:
            try:
                with open(os.path.join(APP_DIR, rel), encoding="utf-8", newline="") as f:
                    raw = f.read()
            except OSError:
                continue
            for text in (raw, raw.replace("\r\n", "\n")):
                exact.add(script_hash("\n" + text.strip() + "\n"))
            trimmed.add(script_hash(raw.replace("\r\n", "\n").strip()))
        try:
            with open(os.path.join(APP_DIR, "known-scripts.json"), encoding="utf-8") as f:
                data = json.load(f)
            exact.update(data.get("sha256", []))
            trimmed.update(data.get("trimmed", []))
        except (OSError, ValueError):
            pass
        _known = (exact, trimmed)
    return _known


def known_script_hashes():
    return _known_sets()[0]


REMOTE_SRC = re.compile(r"^([a-z][a-z0-9+.-]*:|//)", re.I)
_file_digests = {}


def file_digest(path):
    """SHA-256 of a file (16 hex digits), kept while its size and time stay the same."""
    st = os.stat(path)
    key = (path, st.st_mtime_ns, st.st_size)
    if key not in _file_digests:
        if len(_file_digests) > 256:
            _file_digests.clear()
        with open(path, "rb") as f:
            _file_digests[key] = hashlib.sha256(f.read()).hexdigest()[:16]
    return _file_digests[key]


def local_script(full, src):
    """The file on this computer a deck's <script src> loads (relative to the deck, or
    /deck/... and the editor's own files from the server's root), or None outside them."""
    path = urllib.parse.unquote(src.split("?")[0].split("#")[0])
    if path.startswith("/"):
        if path.startswith("/deck/"):
            try:
                return safe_path(path[len("/deck/"):])
            except PermissionError:
                return None
        return os.path.realpath(os.path.join(APP_DIR, path.lstrip("/")))
    return os.path.realpath(os.path.join(os.path.dirname(full), path.replace("/", os.sep)))


def scan_deck(full, data):
    """What a deck page runs, as {"own": [...], "allow": [...], "remote": n}.
    own: its scripts that are not Diapo's: inline ones by hash, files on this computer by
    src and the hash of their contents (so trust lapses when the file changes), files from
    the internet by src (their contents can change unseen: "remote" counts them). A local
    file that does not exist is left out: it cannot run; so is the earlier in-deck editor
    prototype, editor.js, which is served as a no-op.
    allow: exact hashes of scripts that are a Diapo edition with other whitespace round it
    (a deck that pasted the controller in); the policy lets those run in this deck."""
    key = (hashlib.sha256(data).digest(), os.path.dirname(full), WORKSPACE)
    if key not in _scan_cache:
        exact, trimmed = _known_sets()
        own, allow, files, remote = set(), set(), [], 0
        for src, body in page_scripts(data.decode("utf-8", "replace")):
            if src is None:
                h = script_hash(body)
                if h in exact:
                    continue
                if script_hash(body.strip()) in trimmed:
                    allow.add(h)
                else:
                    own.add(h)
            elif src:
                if REMOTE_SRC.match(src):
                    own.add("src:" + src)
                    remote += 1
                else:
                    local = local_script(full, src)
                    if local and not (os.path.basename(local).lower() == "editor.js" and is_legacy_editor(local)):
                        files.append((src, local))
        if len(_scan_cache) > 64:
            _scan_cache.clear()
        _scan_cache[key] = (own, allow, files, remote)
    own, allow, files, remote = _scan_cache[key]
    # The files are hashed on every call (kept per file while it is unchanged), not with the
    # page: a library next to the deck can change while the deck's own text does not.
    own = set(own) | {f"src:{src}#{file_digest(local)}" for src, local in files if os.path.isfile(local)}
    return {"own": sorted(own), "allow": sorted(allow), "remote": remote}


def scripts_fingerprint(own):
    return hashlib.sha256("\n".join(own).encode("utf-8")).hexdigest()


def deck_trusted(full, own):
    """True when the user trusted this deck with exactly these scripts of its own."""
    return bool(own) and SETTINGS.get("trusted_decks", {}).get(full) == scripts_fingerprint(own)


def hash_sources(hashes):
    return " ".join(f"'sha256-{h}'" for h in sorted(hashes))


# Only the editor may show its pages and the decks in a frame: a page on another site that
# framed them could lay its own picture over the editor and steer a click ("Trust this deck").
FRAME_POLICY = "frame-ancestors 'self'"


def deck_csp(allow=()):
    return f"script-src {hash_sources(known_script_hashes() | set(allow))}; form-action 'none'; {FRAME_POLICY}"


def editor_csp(host):
    base = "http://" + host
    files = " ".join(f"{base}/{p}" for p in ("editor.js", "look.js", "presenter.js", "core/", "vendor/"))   # vendor/: MathJax, SmilesDrawer
    return f"script-src {files} {hash_sources(known_script_hashes())}; form-action 'none'; object-src 'none'; {FRAME_POLICY}"


def safe_upload_name(name):
    """A file name the upload may use: base name only, printable, with an allowed extension."""
    name = os.path.basename((name or "").replace("\\", "/"))
    name = re.sub(r"[^\w.\- ()]", "_", name).strip(" .")
    stem, ext = os.path.splitext(name)
    if not stem or ext.lower() not in UPLOAD_EXT:
        return None
    return stem + ext.lower()


def content_version(data):
    """What a deck's text is, as a short hash: the editor sends back the version it opened
    with every save, and a save over a file that has changed since is refused (409)."""
    return hashlib.sha256(data).hexdigest()[:24]


def file_version(path):
    with open(path, "rb") as f:
        return content_version(f.read())


def served_version(full, served):
    """The X-Diapo-Version of a deck as the editor opens it: the file's version, also when
    its draft is served (the draft's edits are on top of that file). A draft older than the
    file was made on top of an earlier text, so it gets a version no file has: the first
    save then asks before writing over what changed."""
    if served != full and os.path.isfile(full) and os.path.getmtime(full) > os.path.getmtime(served):
        return "draft-older-than-file"
    return file_version(full) if os.path.isfile(full) else ""


def is_deck_html(data):
    """A saved body must look like a deck, so a broken client cannot wipe a file."""
    return len(data) >= 200 and b"deck-stage" in data


# ------------------------------------------------------------------
# Backups: <file>.bak is always the previous version. Before it is
# overwritten it is pushed into <file>.~1.bak ... <file>.~10.bak.
# ------------------------------------------------------------------
def backup_count():
    n = SETTINGS.get("backups", BACKUP_HISTORY)
    return max(0, int(n)) if isinstance(n, int) or str(n).isdigit() else BACKUP_HISTORY


def sidecar_dir(path, create=False):
    """<deck folder>/.deck-editor/, hidden on Windows too, created on demand."""
    d = os.path.join(os.path.dirname(path), SIDECAR_DIR)
    if create and not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
        if sys.platform == "win32":
            try:
                import ctypes
                ctypes.windll.kernel32.SetFileAttributesW(d, 0x02)      # FILE_ATTRIBUTE_HIDDEN
            except Exception:  # noqa: BLE001 - cosmetic
                pass
    return d


def sidecar(path, suffix, create=False):
    return os.path.join(sidecar_dir(path, create), os.path.basename(path) + suffix)


def migrate_sidecars(path):
    """Versions up to 0.1.2 wrote <file>.bak, <file>.~N.bak and <file>.~draft next to the deck.
    Move whatever is still there into .deck-editor/ so the deck folder holds the deck alone."""
    folder, name = os.path.split(path)
    moved = 0
    try:
        entries = os.listdir(folder)
    except OSError:
        return 0
    for f in entries:
        if f.startswith(name + ".") and re.fullmatch(re.escape(name) + r"\.(bak|~\d+\.bak|~draft)", f):
            try:
                os.replace(os.path.join(folder, f), os.path.join(sidecar_dir(path, True), f))
                moved += 1
            except OSError:
                pass
    return moved


def rotate_backups(path):
    """Keep the file about to be overwritten: .deck-editor/<name>.bak, older ones rotate
    through <name>.~1.bak ... <name>.~N.bak. Returns the backup's path relative to the deck folder."""
    if not os.path.exists(path):
        return None
    migrate_sidecars(path)
    n_keep = backup_count()
    if n_keep == 0:
        return None
    bak = sidecar(path, ".bak", True)
    if os.path.exists(bak):
        oldest = sidecar(path, f".~{n_keep}.bak")
        if os.path.exists(oldest):
            os.remove(oldest)
        for n in range(n_keep - 1, 0, -1):
            src = sidecar(path, f".~{n}.bak")
            if os.path.exists(src):
                os.replace(src, sidecar(path, f".~{n + 1}.bak"))
        if n_keep > 1:
            os.replace(bak, sidecar(path, ".~1.bak"))
    shutil.copyfile(path, bak)
    return SIDECAR_DIR + "/" + os.path.basename(bak)


def move_sidecars(src, dst):
    """A renamed deck keeps its previous versions and its draft: .deck-editor/<old>.bak,
    .~N.bak and .~draft become .deck-editor/<new>.... (sidecars are named after the file)."""
    migrate_sidecars(src)                      # an older Diapo's sidecars beside the file, if any
    folder = sidecar_dir(src)
    old, new = os.path.basename(src), os.path.basename(dst)
    try:
        entries = os.listdir(folder)
    except OSError:
        return
    for f in entries:
        if re.fullmatch(re.escape(old) + r"\.(bak|~\d+\.bak|~draft)", f):
            try:
                os.replace(os.path.join(folder, f), os.path.join(folder, new + f[len(old):]))
            except OSError:
                pass


def versions_of(path):
    """The previous versions of a deck, newest first: .bak (the one before the current file),
    then .~1.bak, .~2.bak ... Each with its time, size, title and slide count."""
    migrate_sidecars(path)
    name = os.path.basename(path)
    out = []
    for n in range(0, backup_count() + 1):
        f = sidecar(path, ".bak" if n == 0 else f".~{n}.bak")
        if not os.path.isfile(f):
            continue
        try:
            with open(f, "r", encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue
        title = re.search(r"<title>([^<]*)</title>", text[:6000])
        out.append({
            "version": os.path.basename(f)[len(name):],           # ".bak", ".~1.bak" ...
            "mtime": int(os.stat(f).st_mtime), "bytes": os.path.getsize(f),
            "title": (title.group(1).strip() if title else ""), "slides": len(re.findall(r'<section class="slide', text)),
        })
    return out


def version_path(path, version):
    if not re.fullmatch(r"\.bak|\.~\d+\.bak", version or ""):
        raise PermissionError("not a version name")
    f = sidecar(path, version)
    if not os.path.isfile(f):
        raise FileNotFoundError("no such version")
    return f


TOUR_EDITION = re.compile(r'<meta name="diapo-tour" content="(\d+)"')


def stale_tour(full):
    """True when the file is an earlier edition of the tour deck: titled like it, but without the
    current template's edition mark. A user's own deck, or the current tour with edits, is left alone."""
    try:
        with open(full, "r", encoding="utf-8", errors="replace") as f:
            head = f.read(4000)
        with open(os.path.join(APP_DIR, "templates", "welcome.html"), "r", encoding="utf-8") as f:
            current = TOUR_EDITION.search(f.read(4000))
    except OSError:
        return False
    if not current:
        return False
    title = re.search(r"<title>([^<]*)</title>", head)
    if not title or not title.group(1).strip().lower().startswith("welcome to "):
        return False
    mine = TOUR_EDITION.search(head)
    return not mine or mine.group(1) != current.group(1)


def is_legacy_editor(full):
    """The earlier prototype (editor.js next to a deck) announces itself in its header."""
    try:
        with open(full, "rb") as f:
            head = f.read(4096)
        return b"DESIGN EDITOR" in head or b"ed-panel" in head
    except OSError:
        return False


def draft_path(full, create=False):
    """.deck-editor/<name>.~draft; an old draft next to the deck is moved there first."""
    legacy = full + ".~draft"
    if os.path.isfile(legacy):
        try:
            os.replace(legacy, sidecar(full, ".~draft", True))
        except OSError:
            pass
    return sidecar(full, ".~draft", create)


# -- Google Fonts -------------------------------------------------------
# Google serves woff2 (with unicode-range subsets) only to browsers that
# announce support, so every request goes out with a browser user agent.
FONT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
FONT_HOSTS = ("fonts.googleapis.com", "fonts.gstatic.com")
FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900]
# Embedding writes the files into the HTML itself, so only the subsets a Latin or Greek
# deck can use go in; a fonts/ folder keeps every subset Google offers.
EMBED_SUBSETS = {"", "latin", "latin-ext", "greek", "greek-ext"}
_font_cache = {}


def fetch_url(url, timeout=30):
    host = urllib.parse.urlparse(url).netloc
    if host not in FONT_HOSTS:
        raise ValueError("only Google Fonts URLs are fetched")
    if url in _font_cache:
        return _font_cache[url]
    req = urllib.request.Request(url, headers={"User-Agent": FONT_UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    _font_cache[url] = data
    return data


def probe_google_family(family):
    """Which weights and italic weights exist for a family. The css (v1) API
    ignores variants a family does not have, so one request answers it."""
    spec = ",".join([str(w) for w in FONT_WEIGHTS] + [f"{w}i" for w in FONT_WEIGHTS])
    url = "https://fonts.googleapis.com/css?family=" + urllib.parse.quote(family) + ":" + spec + "&display=swap"
    try:
        css = fetch_url(url).decode("utf-8")
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):
            return None
        raise
    weights, italics = set(), set()
    for block in re.findall(r"@font-face\s*{([^}]*)}", css):
        style = re.search(r"font-style:\s*(\w+)", block)
        weight = re.search(r"font-weight:\s*(\d+)", block)
        if not weight:
            continue
        (italics if style and style.group(1) == "italic" else weights).add(int(weight.group(1)))
    if not weights:
        return None
    return {"family": family, "weights": sorted(weights), "italics": sorted(italics)}


def font_slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-") or "font"


FONT_EXT = {".woff2": "woff2", ".woff": "woff", ".ttf": "truetype", ".otf": "opentype"}
STYLE_WEIGHTS = [("thin", 100), ("hairline", 100), ("extralight", 200), ("ultralight", 200), ("light", 300),
                 ("regular", 400), ("normal", 400), ("book", 400), ("medium", 500), ("semibold", 600), ("demibold", 600),
                 ("extrabold", 800), ("ultrabold", 800), ("bold", 700), ("black", 900), ("heavy", 900)]


def style_from_words(text):
    """'Bold Italic' / 'SemiBoldItalic' / 'ExtraLight' -> (weight, italic)."""
    t = re.sub(r"[\s_-]+", "", text or "").lower()
    italic = "italic" in t or "oblique" in t
    t = t.replace("italic", "").replace("oblique", "")
    for name, w in STYLE_WEIGHTS:
        if name in t:
            return w, italic
    return 400, italic


def sfnt_tables(data):
    """{tag: bytes} for a TrueType/OpenType/WOFF file (WOFF2 is Brotli-packed: not read)."""
    tag = data[:4]
    tables = {}
    if tag == b"wOFF":
        n = struct.unpack(">H", data[12:14])[0]
        for i in range(n):
            t, off, comp, orig = struct.unpack(">4sIII", data[44 + i * 20:44 + i * 20 + 16])
            raw = data[off:off + comp]
            tables[t.decode("latin-1")] = zlib.decompress(raw) if comp < orig else raw
    elif tag in (b"\x00\x01\x00\x00", b"OTTO", b"true"):
        n = struct.unpack(">H", data[4:6])[0]
        for i in range(n):
            t, _, off, length = struct.unpack(">4sIII", data[12 + i * 16:12 + i * 16 + 16])
            tables[t.decode("latin-1")] = data[off:off + length]
    return tables


def font_meta(data, filename):
    """Family, weight and italic from the font's name and OS/2 tables, else from the file name."""
    stem = os.path.splitext(os.path.basename(filename))[0]
    parts = re.split(r"[-_]", stem, 1)
    family = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", parts[0]).strip() or stem
    weight, italic = style_from_words(parts[1] if len(parts) > 1 else "")
    try:
        tables = sfnt_tables(data)
        name = tables.get("name")
        if name:
            count, str_off = struct.unpack(">HH", name[2:6])
            found = {}
            for i in range(count):
                pid, eid, lid, nid, length, off = struct.unpack(">HHHHHH", name[6 + i * 12:18 + i * 12])
                if nid not in (1, 2, 16, 17):
                    continue
                raw = name[str_off + off:str_off + off + length]
                text = raw.decode("utf-16-be", "ignore") if pid in (0, 3) else raw.decode("latin-1", "ignore")
                if (pid == 3 and lid == 0x409) or (nid, pid) not in found:
                    found[(nid, pid)] = text
            get = lambda nid: found.get((nid, 3)) or found.get((nid, 1)) or found.get((nid, 0))
            family = get(16) or get(1) or family
            weight, italic = style_from_words(get(17) or get(2) or "")
        os2 = tables.get("OS/2")
        if os2 and len(os2) >= 64:
            weight = struct.unpack(">H", os2[4:6])[0] or weight
            italic = bool(struct.unpack(">H", os2[62:64])[0] & 1) or italic
            weight = max(100, min(900, int(round(weight / 100.0)) * 100))
    except Exception:  # noqa: BLE001 - a font we cannot read still gets the file-name guess
        pass
    return family.strip(), weight, italic


def host_google_fonts(urls, deck_full, embed):
    """Download every face behind the given stylesheet URLs. Returns (css, files, bytes)
    where css is a set of @font-face rules pointing at fonts/<name>.woff2 next to the
    deck (or at data: URIs when embed is set)."""
    fonts_dir = os.path.join(os.path.dirname(deck_full), "fonts")
    out, files, total, seen = [], 0, 0, set()
    for url in urls:
        css = fetch_url(url).decode("utf-8")
        subset = ""
        # Blocks come as "/* latin */" comments followed by the @font-face for that subset.
        for m in re.finditer(r"/\*\s*([\w-]+)\s*\*/|(@font-face\s*{[^}]*})", css):
            if m.group(1):
                subset = m.group(1)
                continue
            text = m.group(2)
            fam = re.search(r"font-family:\s*['\"]?([^'\";]+)", text)
            style = re.search(r"font-style:\s*(\w+)", text)
            weight = re.search(r"font-weight:\s*([\d ]+)", text)
            src = re.search(r"url\(([^)]+)\)\s*format\(['\"]?(\w+)", text)
            urange = re.search(r"unicode-range:\s*([^;]+)", text)
            if not (fam and src):
                continue
            fam, style, weight = fam.group(1).strip(), (style.group(1) if style else "normal"), (weight.group(1).strip() if weight else "400")
            key = (fam, style, weight, subset or "all")
            if key in seen or (embed and subset not in EMBED_SUBSETS):
                continue
            seen.add(key)
            data = fetch_url(src.group(1).strip("'\""))
            total += len(data)
            files += 1
            if embed:
                ref = "data:font/woff2;base64," + base64.b64encode(data).decode("ascii")
            else:
                name = f"{font_slug(fam)}-{weight.replace(' ', '-')}{'i' if style == 'italic' else ''}-{subset or 'all'}.woff2"
                os.makedirs(fonts_dir, exist_ok=True)
                with open(os.path.join(fonts_dir, name), "wb") as f:
                    f.write(data)
                ref = "fonts/" + name
            rule = f"@font-face {{ font-family: '{fam}'; font-style: {style}; font-weight: {weight}; font-display: swap; src: url({ref}) format('{src.group(2)}');"
            if urange:
                rule += f" unicode-range: {urange.group(1).strip()};"
            rule += " }"
            out.append((f"/* {subset} */\n" if subset else "") + rule)
    return "\n".join(out), files, total


def list_tree(root):
    """The .html files under root, sorted, ignoring tool folders and backups; `deck` says
    whether the editor can open one (the drawer hides the others unless asked)."""
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in IGNORED_DIRS and not d.startswith("."))
        for name in sorted(filenames):
            if name.lower().endswith(".html"):
                full = os.path.join(dirpath, name)
                st = os.stat(full)
                out.append({"path": rel_path(full), "name": name, "size": st.st_size, "mtime": int(st.st_mtime), "title": deck_title(full), "deck": is_deck(full)})
    return out


# ------------------------------------------------------------------
# Export: a self-contained copy of a deck, and a PDF.
#
# The single-file export inlines what the deck loads from its own folder
# (scripts, stylesheets, images, videos, fonts, data-svg sources, url()
# references) as data URIs or inline blocks, and fetches the deck's Google
# Fonts as data URIs so the file presents without a network connection.
# Anything it cannot inline (a missing file, an external URL, srcset) is
# reported back in `notes` instead of failing.
#
# The PDF is printed by the Chrome or Edge installed on this machine, in
# headless mode, from a temporary copy of the printable HTML written next
# to the deck (so relative assets resolve). Without Chrome the client
# falls back to the browser's print dialog.
# ------------------------------------------------------------------
SKIP_URL = re.compile(r"^(data:|blob:|javascript:|mailto:|tel:|#|https?://|//)", re.I)
MIME_EXTRA = {".svg": "image/svg+xml", ".webp": "image/webp", ".avif": "image/avif", ".woff2": "font/woff2",
              ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".mjs": "text/javascript", ".js": "text/javascript"}
INLINE_MAX = 40 * 1024 * 1024        # one file; a deck that embeds more than this is not going to open anywhere


def data_uri(path):
    ext = os.path.splitext(path)[1].lower()
    mime = MIME_EXTRA.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        data = f.read()
    return "data:" + mime + ";base64," + base64.b64encode(data).decode("ascii"), len(data)


class Inliner:
    def __init__(self, deck_full):
        self.deck_dir = os.path.dirname(deck_full)
        # What may be inlined: files under the deck's root, the workspace or, for the tour, its own folder.
        self.root = SAMPLES_DIR if deck_full.startswith(SAMPLES_DIR + os.sep) else WORKSPACE
        self.notes = []
        self.files = 0
        self.bytes = 0
        self.seen = {}

    def resolve(self, ref, base_dir=None):
        """Local file behind a URL reference, or None (external, missing, or outside the workspace)."""
        ref = (ref or "").strip()
        if not ref or SKIP_URL.match(ref):
            return None
        clean = ref.split("#", 1)[0].split("?", 1)[0]
        clean = urllib.parse.unquote(clean.replace("&amp;", "&"))
        full = os.path.realpath(os.path.join(base_dir or self.deck_dir, clean.replace("/", os.sep)))
        if not (full == self.root or full.startswith(self.root + os.sep)):
            self.note("outside the workspace, kept as a link: " + ref)
            return None
        if not os.path.isfile(full):
            self.note("missing file, kept as is: " + ref)
            return None
        return full

    def note(self, text):
        if text not in self.notes:
            self.notes.append(text)

    def uri(self, full):
        if full in self.seen:
            return self.seen[full]
        if os.path.getsize(full) > INLINE_MAX:
            self.note("too large to embed, kept as a link: " + os.path.relpath(full, self.deck_dir))
            return None
        u, n = data_uri(full)
        self.files += 1
        self.bytes += n
        self.seen[full] = u
        return u

    def css_urls(self, css, base_dir):
        def sub(m):
            q, ref = m.group(1), m.group(2)
            full = self.resolve(ref, base_dir)
            u = self.uri(full) if full else None
            return f"url({q}{u}{q})" if u else m.group(0)
        return re.sub(r"url\(\s*(['\"]?)([^'\")]+)\1\s*\)", sub, css)

    def tag_attr(self, tag, attr):
        """Replace one URL attribute of a start tag with a data URI (unchanged when not local)."""
        def sub(m):
            full = self.resolve(m.group(3))
            u = self.uri(full) if full else None
            return m.group(1) + m.group(2) + u + m.group(2) if u else m.group(0)
        return re.sub(r"(\s" + attr + r"\s*=\s*)([\"'])([^\"']*)\2", sub, tag, count=1, flags=re.I)

    def run(self, html, embed_google):
        # 1. Scripts loaded from files next to the deck.
        def script(m):
            attrs, src, attrs2 = m.group(1), m.group(2), m.group(3)
            full = self.resolve(src)
            if not full:
                return m.group(0)
            with open(full, "r", encoding="utf-8", errors="replace") as f:
                js = f.read()
            self.files += 1
            self.bytes += len(js)
            return "<script" + attrs + attrs2 + ">\n" + js.replace("</script", "<\\/script") + "\n</script>"
        html = re.sub(r"<script\b([^>]*?)\ssrc\s*=\s*[\"']([^\"']+)[\"']([^>]*)>\s*</script\s*>", script, html, flags=re.I)

        # 2. Stylesheets: local ones become <style>, Google Fonts become embedded @font-face rules.
        def link(m):
            tag = m.group(0)
            if not re.search(r"rel\s*=\s*[\"']?stylesheet", tag, re.I):
                return tag
            href = re.search(r"\shref\s*=\s*[\"']([^\"']+)[\"']", tag, re.I)
            if not href:
                return tag
            href = href.group(1).replace("&amp;", "&")
            if "fonts.googleapis.com" in href:
                if not embed_google:
                    return tag
                try:
                    css, n, size = host_google_fonts([href], os.path.join(self.deck_dir, "x.html"), True)
                except Exception as e:  # noqa: BLE001 - offline: the link stays and the export says so
                    self.note("Google Fonts could not be fetched, the link is kept: " + str(e).splitlines()[0])
                    return tag
                self.files += n
                self.bytes += size
                return "<style data-embedded-fonts=\"" + href.replace("&", "&amp;").replace('"', "&quot;") + "\">\n" + css + "\n</style>"
            full = self.resolve(href)
            if not full:
                return tag
            with open(full, "r", encoding="utf-8", errors="replace") as f:
                css = f.read()
            self.files += 1
            self.bytes += len(css)
            return "<style>\n" + self.css_urls(css, os.path.dirname(full)) + "\n</style>"
        html = re.sub(r"<link\b[^>]*>", link, html, flags=re.I)

        # 3. url() inside <style> blocks and style attributes.
        html = re.sub(r"(<style\b[^>]*>)([\s\S]*?)(</style\s*>)", lambda m: m.group(1) + self.css_urls(m.group(2), self.deck_dir) + m.group(3), html, flags=re.I)
        html = re.sub(r"(\sstyle\s*=\s*)([\"'])([^\"']*url\([^\"']*)\2", lambda m: m.group(1) + m.group(2) + self.css_urls(m.group(3), self.deck_dir) + m.group(2), html, flags=re.I)

        # 4. Media tags and the deck contract's data-svg hosts.
        def media(m):
            tag = m.group(0)
            name = m.group(1).lower()
            for attr in ("src", "poster", "href", "data"):
                if attr == "href" and name not in ("image", "use"):
                    continue
                if attr == "data" and name != "object":
                    continue
                tag = self.tag_attr(tag, attr)
            if re.search(r"\ssrcset\s*=", tag, re.I):
                self.note("srcset is not embedded (only src): <" + name + ">")
            return tag
        html = re.sub(r"<(img|video|audio|source|track|image|embed|object)\b[^>]*>", media, html, flags=re.I)
        html = re.sub(r"<[a-zA-Z][^>]*\sdata-svg\s*=[^>]*>", lambda m: self.tag_attr(m.group(0), "data-svg"), html)
        if re.search(r"<iframe\b[^>]*\ssrc\s*=\s*[\"'](?!https?:|//|data:)", html, re.I):
            self.note("iframes that load a local file are not embedded")
        return html


def local_refs(html, deck_dir):
    """Relative paths of the files a deck loads from its own folder tree: src / href / poster /
    data-svg attributes and url() in styles. Only paths below the deck folder count (no ".." and
    nothing absolute); missing files are reported, not copied."""
    found, missing = [], []
    def consider(ref):
        ref = (ref or "").strip().replace("&amp;", "&")
        if not ref or SKIP_URL.match(ref):
            return
        clean = urllib.parse.unquote(ref.split("#", 1)[0].split("?", 1)[0]).replace("\\", "/")
        if clean.startswith("/") or ".." in clean.split("/") or re.match(r"^[A-Za-z]:", clean):
            return
        if not os.path.isfile(os.path.join(deck_dir, clean.replace("/", os.sep))):
            if clean not in missing:
                missing.append(clean)
            return
        if clean not in found:
            found.append(clean)
    for m in re.finditer(r"<(?:img|video|audio|source|track|script|link|image|use|embed|object)\b[^>]*>", html, re.I):
        tag = m.group(0)
        if tag.lower().startswith("<link") and not re.search(r"rel\s*=\s*[\"']?(stylesheet|icon|preload|modulepreload)", tag, re.I):
            continue
        for a in re.finditer(r"\s(?:src|href|poster|data)\s*=\s*[\"']([^\"']+)[\"']", tag, re.I):
            consider(a.group(1))
    for a in re.finditer(r"\sdata-svg\s*=\s*[\"']([^\"']+)[\"']", html, re.I):
        consider(a.group(1))
    for a in re.finditer(r"url\(\s*[\"']?([^\"')]+)[\"']?\s*\)", html, re.I):
        consider(a.group(1))
    return found, missing


# -- PDF through headless Chrome / Edge --------------------------------
def find_chrome():
    """Path of a Chromium-based browser on this machine, or None."""
    env = os.environ.get("DECK_EDITOR_CHROME")
    if env and os.path.isfile(env):
        return env
    for name in ("chrome", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "msedge", "microsoft-edge"):
        p = shutil.which(name)
        if p:
            return p
    candidates = []
    if sys.platform == "win32":
        for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), os.environ.get("LocalAppData")):
            if not base:
                continue
            candidates += [os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"),
                           os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
                           os.path.join(base, "Chromium", "Application", "chrome.exe")]
    elif sys.platform == "darwin":
        candidates += ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                       "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                       "/Applications/Chromium.app/Contents/MacOS/Chromium"]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


def print_pdf(html, deck_full, out_path, size=(1920, 1080)):
    """Write `html` next to the deck, print it to out_path with headless Chrome, clean up.
    `size` is the deck's stage in px: the browser window is that size so anything the
    deck lays out against the viewport matches the page."""
    chrome = find_chrome()
    if not chrome:
        raise LookupError("no Chrome or Edge found on this computer (set DECK_EDITOR_CHROME to the browser's path)")
    deck_dir = os.path.dirname(deck_full)
    tmp_html = os.path.join(deck_dir, f".deck-editor-print-{os.getpid()}.html")
    tmp_pdf = out_path + ".tmp"
    profile = os.path.join(tempfile.gettempdir(), f"deck-editor-chrome-{os.getpid()}")
    with open(tmp_html, "wb") as f:
        f.write(html)
    args = [chrome, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
            "--hide-scrollbars", f"--window-size={size[0]},{size[1]}", "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=10000", "--no-pdf-header-footer", "--user-data-dir=" + profile,
            "--print-to-pdf=" + tmp_pdf, "--allow-file-access-from-files", "file:///" + tmp_html.replace(os.sep, "/")]
    # Time scales with the deck: about a second per slide for a picture-heavy one, plus a floor.
    slides = len(re.findall(rb"<section\s[^>]*class=\"[^\"]*\bslide\b", html))
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=90 + 3 * slides)
        if not os.path.isfile(tmp_pdf) or os.path.getsize(tmp_pdf) < 100:
            tail = (r.stderr or r.stdout or "").strip().splitlines()[-3:]
            raise RuntimeError("the browser did not produce a PDF" + (": " + " | ".join(tail) if tail else ""))
        # On Windows a helper process of the browser can still hold the file for a moment.
        for attempt in range(20):
            try:
                os.replace(tmp_pdf, out_path)
                break
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.25)
    finally:
        for p in (tmp_html, tmp_pdf):
            for attempt in range(8):
                try:
                    if os.path.exists(p):
                        os.remove(p)
                    break
                except OSError:
                    time.sleep(0.25)
        shutil.rmtree(profile, ignore_errors=True)
    return os.path.getsize(out_path), os.path.basename(chrome)


WINDOWS_DEVICES = re.compile(r"^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$", re.I)


def bare_name(to, ext):
    """`to` as the name of a file in a deck's folder, with `ext` added when it is missing.
    Refused (ValueError): anything that could land elsewhere - a path, a drive ("C:notes"
    is a file in drive C's current folder on Windows, not in the deck's), a colon (an NTFS
    stream), control characters, an empty name, and the names Windows keeps for devices."""
    name = (to or "").strip()
    if not name.strip(".") or re.search(r"[\\/:\x00-\x1f]", name):
        raise ValueError("give a file name, not a path")
    if not name.lower().endswith(ext):
        name += ext
    if WINDOWS_DEVICES.match(name):
        raise ValueError(f'"{name}" is a name Windows keeps for itself')
    return name


def export_target(q, deck_full, default_name, ext):
    """Where an export goes: `to` (a bare name in the deck folder), or a native save dialog.
    Returns (path, cancelled). Without a working dialog the default name next to the deck is used."""
    deck_dir = os.path.dirname(deck_full)
    to = q.get("to", "").strip()
    if to:
        return os.path.join(deck_dir, bare_name(to, ext)), False
    if q.get("dialog") == "0":
        return os.path.join(deck_dir, default_name), False
    try:
        p = native_pick("save", deck_dir, default_name)
    except RuntimeError:
        return os.path.join(deck_dir, default_name), False
    if not p:
        return None, True
    if not p.lower().endswith(ext):
        p += ext
    return p, False


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # Keep the console quiet except for writes and errors.
        msg = fmt % args
        if "POST" in msg or " 4" in msg or " 5" in msg:
            super().log_message(fmt, *args)

    # -- helpers ---------------------------------------------------
    def _json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if self.close_connection:
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def _fail(self, message, status=400):
        # A rejected request may leave an unread body on a keep-alive connection;
        # closing it keeps the next request from parsing that body as headers.
        self.close_connection = True
        return self._json({"ok": False, "error": message}, status)

    def _query(self):
        return {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).items()}

    def _guard(self, mutating):
        """Refuse requests that do not come from this editor (see origin_ok above).
        Returns True when the request may proceed; otherwise the reply is sent."""
        if not host_ok(self.headers.get("Host"), PORT):
            self._fail("refused: the request was not addressed to this server", 403)
            return False
        if mutating and not origin_ok(self.headers.get("Origin"), self.headers.get("Sec-Fetch-Site"), PORT):
            self._fail("refused: only the editor page may change files", 403)
            return False
        if not fetch_site_ok(self.headers.get("Sec-Fetch-Site")):
            self._fail("refused: the request came from another site", 403)
            return False
        return True

    def _read_body(self):
        """Read this request's body once. Handler instances live for a whole keep-alive
        connection, so the body is stored per request (do_POST), never lazily cached."""
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_UPLOAD:
            raise ValueError("body too large")
        return self.rfile.read(n)

    def _body(self):
        return self._request_body

    def _deck_policy(self, full, served):
        """The CSP header for a file under /deck/ (see "Scripts in decks"): Diapo's own
        scripts only for a page, unless the user trusts that deck; no scripts at all for
        any other file a frame might show as a document (an SVG, say)."""
        if not served.lower().endswith(DECK_DOC_EXT):
            return f"script-src 'none'; form-action 'none'; {FRAME_POLICY}"
        try:
            with open(served, "rb") as f:
                data = f.read()
        except OSError:
            return deck_csp()
        scan = scan_deck(full, data)
        return FRAME_POLICY if deck_trusted(full, scan["own"]) else deck_csp(scan["allow"])

    def _trust_reply(self, full, draft):
        """{trusted, scripts, remote, known} for a deck: how many scripts of its own it has (and
        how many of them come from the internet), whether they run, and the hashes of the Diapo scripts that may run in it (the editor puts them
        in the printable copy's policy)."""
        served = draft_path(full) if draft and os.path.isfile(draft_path(full)) else full
        with open(served, "rb") as f:
            scan = scan_deck(full, f.read())
        return {"ok": True, "trusted": deck_trusted(full, scan["own"]), "scripts": len(scan["own"]),
                "remote": scan["remote"], "known": sorted(known_script_hashes() | set(scan["allow"]))}

    def _send_file(self, full, csp=None, headers=None):
        """Static file with no-store caching; SimpleHTTPRequestHandler does the MIME work."""
        if not os.path.isfile(full):
            return self._fail("not found", 404)
        if os.path.basename(full).lower() == "editor.js" and is_legacy_editor(full):
            # Decks made with the earlier in-deck editor prototype still load it; inside
            # this editor it would fight over the keyboard, so it is served as a no-op.
            # The file on disk is not touched and the deck keeps it when opened on its own.
            body = b"/* deck-editor: the in-deck editor prototype is disabled while editing here */\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        ctype = self.guess_type(full)
        if full.lower().endswith((".js", ".mjs")):
            ctype = "text/javascript"
        elif full.lower().endswith(".~draft"):
            ctype = "text/html"
        elif full.lower().endswith(".webmanifest"):
            ctype = "application/manifest+json"
        st = os.stat(full)
        self.send_response(200)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text/") else ""))
        self.send_header("Content-Length", str(st.st_size))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", csp or FRAME_POLICY)
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        # Read the file and close it before sending: on Windows an open file cannot be renamed
        # or deleted, and a slow reader (a preview, a long video) would hold it. Large media
        # streams as before.
        if st.st_size <= 16 * 1024 * 1024:
            with open(full, "rb") as f:
                data = f.read()
            self.wfile.write(data)
            return
        with open(full, "rb") as f:
            shutil.copyfileobj(f, self.wfile)

    # -- GET ---------------------------------------------------------
    def do_GET(self):
        if not self._guard(mutating=False):
            return
        route = urllib.parse.urlparse(self.path).path
        try:
            if route == "/api/themes":
                with SETTINGS_LOCK:
                    themes = dict(SETTINGS.get("themes", {}))
                return self._json({"ok": True, "themes": themes})
            if route == "/api/status":
                return self._json({"ok": True, "workspace": WORKSPACE, "recent": recent_decks(), "version": 1, "app": APP_VERSION})
            if route == "/api/list":
                d = safe_path(self._query().get("dir", ""))
                if not os.path.isdir(d):
                    return self._fail("no such folder", 404)
                return self._json({"ok": True, "dir": rel_path(d) if d != WORKSPACE else "", "files": list_tree(d)})
            if route == "/api/fonts/google":
                fam = self._query().get("family", "").strip()
                if not fam:
                    return self._fail("family?")
                info = probe_google_family(fam)
                if not info:
                    return self._fail(f'Google Fonts has no family called "{fam}"', 404)
                return self._json({"ok": True, **info})
            if route == "/api/draft":
                d = draft_path(safe_path(self._query().get("file", "")))
                if not os.path.isfile(d):
                    return self._json({"ok": True, "exists": False})
                return self._json({"ok": True, "exists": True, "mtime": int(os.stat(d).st_mtime)})
            if route == "/api/versions":
                full = safe_path(self._query().get("file", ""))
                if not os.path.isfile(full):
                    return self._fail("no such file", 404)
                return self._json({"ok": True, "versions": versions_of(full)})
            if route == "/api/trust":
                full = safe_path(self._query().get("file", ""))
                if not os.path.isfile(full):
                    return self._fail("no such deck", 404)
                return self._json(self._trust_reply(full, self._query().get("draft") == "1"))
            if route.startswith("/deck/"):
                full = safe_path(route[len("/deck/"):])
                served = full
                if self._query().get("draft") == "1" and os.path.isfile(draft_path(full)):
                    served = draft_path(full)
                if not os.path.isfile(served):
                    return self._fail("not found", 404)
                extra = {"X-Diapo-Version": served_version(full, served)} if served.lower().endswith(DECK_DOC_EXT) else None
                return self._send_file(served, csp=self._deck_policy(full, served), headers=extra)
            if route == "/":
                route = "/index.html"
            # Everything else is the editor app itself (no path escapes here either).
            full = os.path.realpath(os.path.join(APP_DIR, urllib.parse.unquote(route).lstrip("/")))
            if not full.startswith(APP_DIR + os.sep):
                return self._fail("forbidden", 403)
            page = full.lower().endswith((".html", ".htm"))
            return self._send_file(full, csp=editor_csp(self.headers.get("Host").strip().lower()) if page else None)
        except PermissionError as e:
            return self._fail(str(e), 403)
        except FileNotFoundError as e:
            return self._fail(str(e), 404)
        except Exception as e:  # noqa: BLE001 - report anything to the client
            return self._fail(f"{type(e).__name__}: {e}", 500)

    # -- POST --------------------------------------------------------
    def do_POST(self):
        route = urllib.parse.urlparse(self.path).path
        q = self._query()
        self._request_body = b""
        if not self._guard(mutating=True):
            return                                     # _fail closed the connection, so the unread body is dropped with it
        try:
            self._request_body = self._read_body()    # always drain the body, even when the request is refused
            if route == "/api/trust":
                # on=1: the user trusts this deck's own scripts as they are now; on=0 pauses them again.
                full = safe_path(q.get("file", ""))
                if not os.path.isfile(full):
                    return self._fail("no such deck", 404)
                served = draft_path(full) if q.get("draft") == "1" and os.path.isfile(draft_path(full)) else full
                with open(served, "rb") as f:
                    own = scan_deck(full, f.read())["own"]
                with settings_change() as s:
                    trusted = s.setdefault("trusted_decks", {})
                    if q.get("on", "1") == "1" and own:
                        trusted[full] = scripts_fingerprint(own)
                    else:
                        trusted.pop(full, None)
                return self._json(self._trust_reply(full, q.get("draft") == "1"))
            if route == "/api/save":
                return self.api_save(q)
            if route == "/api/upload":
                return self.api_upload(q)
            if route == "/api/new":
                return self.api_new(q)
            if route == "/api/rename":
                return self.api_copy_or_move(q, move=True)
            if route == "/api/duplicate":
                return self.api_copy_or_move(q, move=False)
            if route == "/api/versions/restore":
                return self.api_version(q, restore=True)
            if route == "/api/versions/copy":
                return self.api_version(q, restore=False)
            if route == "/api/draft":
                return self.api_draft_write(q)
            if route == "/api/workspace":
                ws = set_workspace(q.get("path", ""))
                return self._json({"ok": True, "workspace": ws})
            if route == "/api/workspace/pick":
                p = native_pick("folder", WORKSPACE)
                if not p:
                    return self._json({"ok": True, "cancelled": True, "workspace": WORKSPACE})
                return self._json({"ok": True, "workspace": set_workspace(p)})
            if route == "/api/workspace/pick-file":
                p = native_pick("file", WORKSPACE)
                if not p:
                    return self._json({"ok": True, "cancelled": True, "workspace": WORKSPACE})
                ws = set_workspace(os.path.dirname(p))
                return self._json({"ok": True, "workspace": ws, "file": rel_path(os.path.realpath(p))})
            if route == "/api/themes":
                name = q.get("name", "").strip()
                if not name:
                    return self._fail("a theme needs a name")
                theme = json.loads(self._body().decode("utf-8") or "{}")
                if not isinstance(theme, dict):
                    return self._fail("a theme is a JSON object")
                with settings_change() as s:
                    s.setdefault("themes", {})[name] = {"vars": theme.get("vars", {}), "rules": theme.get("rules", {}), "css": theme.get("css", "")}
                    themes = dict(s["themes"])
                return self._json({"ok": True, "themes": themes})
            if route == "/api/fonts/host":
                full = safe_path(q.get("file", ""))
                if not os.path.isfile(full):
                    return self._fail("no such deck", 404)
                body = json.loads(self._body().decode("utf-8") or "{}")
                urls = [u for u in body.get("urls", []) if isinstance(u, str)]
                if not urls:
                    return self._fail("no font stylesheet URLs")
                css, files, size = host_google_fonts(urls, full, q.get("embed") == "1")
                return self._json({"ok": True, "css": css, "files": files, "bytes": size})
            if route == "/api/fonts/upload":
                return self.api_font_upload(q)
            if route == "/api/fonts/embed-own":
                full = safe_path(q.get("file", ""))
                deck_dir = os.path.dirname(full)
                css = json.loads(self._body().decode("utf-8") or "{}").get("css", "")

                def inline(m):
                    rel = m.group(1)
                    p = os.path.realpath(os.path.join(deck_dir, rel))
                    if not p.startswith(os.path.join(deck_dir, "fonts") + os.sep) or not os.path.isfile(p):
                        return m.group(0)
                    mime = {"woff2": "font/woff2", "woff": "font/woff", "ttf": "font/ttf", "otf": "font/otf"}.get(p.rsplit(".", 1)[-1].lower(), "application/octet-stream")
                    with open(p, "rb") as f:
                        return "url(data:" + mime + ";base64," + base64.b64encode(f.read()).decode("ascii") + ")"
                return self._json({"ok": True, "css": re.sub(r"url\((fonts/[^)]+)\)", inline, css)})
            if route == "/api/recent":
                full = safe_path(q.get("file", ""))
                if os.path.isfile(full):
                    remember_deck(WORKSPACE, rel_path(full))
                return self._json({"ok": True, "recent": recent_decks()})
            if route == "/api/export":
                return self.api_export(q)
            if route == "/api/import":
                return self.api_import(q)
            if route == "/api/saveas":
                return self.api_saveas(q)
            if route == "/api/import/pick":
                # Only the dialog: the editor converts with /api/import?path=, so it can show
                # that it is busy while converting rather than while the dialog is open.
                p = native_pick("import", WORKSPACE)
                if not p:
                    return self._json({"ok": True, "cancelled": True})
                return self._json({"ok": True, "path": p})
            if route == "/api/pdf":
                return self.api_pdf(q)
            if route == "/api/export/pptx":
                return self.api_pptx(q)
            return self._fail("unknown endpoint", 404)
        except PermissionError as e:
            return self._fail(str(e), 403)
        except FileNotFoundError as e:
            return self._fail(str(e), 404)
        except ValueError as e:                        # a name that is not a file name, a body that is not JSON
            return self._fail(str(e), 400)
        except Exception as e:  # noqa: BLE001
            return self._fail(f"{type(e).__name__}: {e}", 500)

    def do_DELETE(self):
        if not self._guard(mutating=True):
            return
        route = urllib.parse.urlparse(self.path).path
        try:
            if route == "/api/draft":
                d = draft_path(safe_path(self._query().get("file", "")))
                if os.path.isfile(d):
                    os.remove(d)
                return self._json({"ok": True})
            if route == "/api/themes":
                with settings_change() as s:
                    s.get("themes", {}).pop(self._query().get("name", ""), None)
                    themes = dict(s.get("themes", {}))
                return self._json({"ok": True, "themes": themes})
            return self._fail("unknown endpoint", 404)
        except PermissionError as e:
            return self._fail(str(e), 403)
        except FileNotFoundError as e:
            return self._fail(str(e), 404)
        except Exception as e:  # noqa: BLE001
            return self._fail(f"{type(e).__name__}: {e}", 500)

    def api_draft_write(self, q):
        full = safe_path(q.get("file", ""))
        if not full.lower().endswith(".html"):
            return self._fail("only .html files have drafts")
        body = self._body()
        if not is_deck_html(body):
            return self._fail("refusing to write: the content does not look like a deck (no deck-stage)")
        d = draft_path(full, create=True)
        with open(d + ".tmp", "wb") as f:
            f.write(body)
        os.replace(d + ".tmp", d)
        return self._json({"ok": True, "bytes": len(body)})

    def api_save(self, q):
        full = safe_path(q.get("file", ""))
        if not full.lower().endswith(".html"):
            return self._fail("only .html files can be saved")
        body = self._body()
        if not is_deck_html(body):
            return self._fail("refusing to write: the content does not look like a deck (no deck-stage)")
        # base: the version the editor opened (X-Diapo-Version). Another program or window
        # that saved the file since would lose its changes without a word; the editor asks.
        base = q.get("base", "")
        if base and q.get("overwrite") != "1" and os.path.isfile(full) and file_version(full) != base:
            self.close_connection = True
            return self._json({"ok": False, "reason": "changed",
                               "error": "the file has changed on disk since it was opened"}, 409)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        backup = rotate_backups(full)
        tmp = full + ".tmp"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, full)
        print(f"saved {rel_path(full)} ({len(body)} bytes)" + (f", previous -> {backup}" if backup else ""))
        return self._json({"ok": True, "bytes": len(body), "backup": backup, "file": rel_path(full), "version": content_version(body)})

    def import_into_workspace(self, src_path, name=""):
        """Convert a .md / .pptx at src_path into <workspace>/<name>/index.html (a free folder name)."""
        stem = re.sub(r"[^\w\s.-]+", "", name or os.path.splitext(os.path.basename(src_path))[0]).strip().strip(".") or "imported"
        folder, n = os.path.join(WORKSPACE, stem), 1
        while os.path.exists(folder):
            n += 1
            folder = os.path.join(WORKSPACE, f"{stem}-{n}")
        os.makedirs(folder)
        try:
            html_text, notes = import_deck.import_file(src_path, folder)
        except Exception:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        out = os.path.join(folder, "index.html")
        with open(out, "w", encoding="utf-8", newline="") as f:
            f.write(html_text)
        print(f"imported {src_path} -> {rel_path(out)}")
        return {"ok": True, "file": rel_path(out), "notes": notes, "source": os.path.basename(src_path)}

    def api_import(self, q):
        """multipart: one .md or .pptx file -> a new deck in the workspace. With path=<file on
        this machine> the file is read from disk instead (pictures next to it come along)."""
        src = q.get("path", "").strip()
        if src:
            if not os.path.isfile(src):
                return self._fail("no such file: " + src, 404)
            return self._json(self.import_into_workspace(os.path.abspath(src), q.get("name", "")))
        ctype = self.headers.get("Content-Type", "")
        if not ctype.startswith("multipart/form-data"):
            return self._fail("expected multipart/form-data")
        msg = email.message_from_bytes(b"Content-Type: " + ctype.encode() + b"\r\n\r\n" + self._body(), policy=email.policy.HTTP)
        for part in msg.iter_parts():
            name = os.path.basename(part.get_filename() or "")
            ext = os.path.splitext(name)[1].lower()
            if not name or ext not in (".md", ".markdown", ".txt", ".pptx"):
                continue
            data = part.get_payload(decode=True)
            with tempfile.TemporaryDirectory(prefix="deck-import-") as tmp:
                src = os.path.join(tmp, re.sub(r"[^\w.-]+", "_", name))
                with open(src, "wb") as f:
                    f.write(data)
                return self._json(self.import_into_workspace(src, q.get("name", "")))
        return self._fail("no Markdown (.md) or PowerPoint (.pptx) file in the upload")

    def api_saveas(self, q):
        """The live deck under a new name or place, with the files it references copied along."""
        full = safe_path(q.get("file", ""))
        if not os.path.isfile(full):
            return self._fail("no such deck", 404)
        body = self._body()
        if not is_deck_html(body):
            return self._fail("refusing to write: the content does not look like a deck (no deck-stage)")
        src_dir = os.path.dirname(full)
        to = q.get("to", "").strip()
        if to:
            if re.match(r"^[A-Za-z]:(?![\\/])", to):
                return self._fail("give a full path (C:\\...) or a file name")     # C:name: drive C's current folder
            target = to if (os.path.isabs(to) or re.match(r"^[A-Za-z]:", to)) else os.path.join(src_dir, to)
            target = os.path.realpath(target)
            if not target.lower().endswith(".html"):
                target += ".html"
            chosen = False
        else:
            stem = os.path.splitext(os.path.basename(full))[0]
            if stem.lower() == "index":
                stem = os.path.basename(src_dir) or stem
            try:
                p = native_pick("save", src_dir, stem + "-copy.html")
            except RuntimeError:
                return self._fail(NO_DIALOG + ": give the new name in the field instead", 501)
            if not p:
                return self._json({"ok": True, "cancelled": True})
            target = os.path.realpath(p if p.lower().endswith(".html") else p + ".html")
            chosen = True                                 # the dialog already asked about overwriting
        if target == os.path.realpath(full):
            return self._fail("that is the deck itself; use Save")
        if os.path.exists(target) and not chosen and q.get("overwrite") != "1":
            return self._fail("a file with that name already exists", 409)
        tgt_dir = os.path.dirname(target)
        os.makedirs(tgt_dir, exist_ok=True)
        html_text = body.decode("utf-8", "replace")
        refs, missing = local_refs(html_text, src_dir)
        copied = 0
        if os.path.realpath(tgt_dir) != os.path.realpath(src_dir):
            for rel in refs:
                s = os.path.join(src_dir, rel.replace("/", os.sep))
                d = os.path.join(tgt_dir, rel.replace("/", os.sep))
                os.makedirs(os.path.dirname(d), exist_ok=True)
                if not os.path.exists(d) or os.path.getsize(d) != os.path.getsize(s):
                    shutil.copyfile(s, d)
                    copied += 1
        with open(target + ".tmp", "wb") as f:
            f.write(body)
        os.replace(target + ".tmp", target)
        notes = [f"not found next to the deck, not copied: {m}" for m in missing]
        # A target outside the current workspace becomes the workspace, as Open deck... does.
        if not (target == WORKSPACE or target.startswith(WORKSPACE + os.sep)):
            set_workspace(tgt_dir)
        print(f"saved as {target} ({len(body)} bytes, {copied} files copied)")
        return self._json({"ok": True, "file": rel_path(target), "path": target, "workspace": WORKSPACE, "copied": copied, "notes": notes})

    def api_export(self, q):
        """body = the deck as the editor would save it -> one self-contained .html file."""
        full = safe_path(q.get("file", ""))
        if not os.path.isfile(full):
            return self._fail("no such deck", 404)
        body = self._body()
        if not is_deck_html(body):
            return self._fail("refusing to export: the content does not look like a deck (no deck-stage)")
        stem = os.path.splitext(os.path.basename(full))[0]
        if stem.lower() == "index":
            stem = os.path.basename(os.path.dirname(full)) or stem
        out, cancelled = export_target(q, full, stem + "-standalone.html", ".html")
        if cancelled:
            return self._json({"ok": True, "cancelled": True})
        if os.path.realpath(out) == os.path.realpath(full):
            return self._fail("the export cannot overwrite the deck itself")
        inl = Inliner(full)
        html = inl.run(body.decode("utf-8", "replace"), embed_google=q.get("fonts", "1") != "0")
        data = html.encode("utf-8")
        with open(out + ".tmp", "wb") as f:
            f.write(data)
        os.replace(out + ".tmp", out)
        print(f"exported {out} ({len(data)} bytes, {inl.files} files inlined)")
        return self._json({"ok": True, "path": out, "name": os.path.basename(out), "bytes": len(data), "files": inl.files, "notes": inl.notes})

    def api_pdf(self, q):
        """body = printable HTML (every slide shown, print CSS) -> a PDF via headless Chrome / Edge."""
        full = safe_path(q.get("file", ""))
        if not os.path.isfile(full):
            return self._fail("no such deck", 404)
        body = self._body()
        if not is_deck_html(body):
            return self._fail("refusing to print: the content does not look like a deck (no deck-stage)")
        if not find_chrome():
            self.close_connection = True
            return self._json({"ok": False, "error": "no Chrome or Edge on this computer", "reason": "no-chrome"}, 501)
        stem = os.path.splitext(os.path.basename(full))[0]
        if stem.lower() == "index":
            stem = os.path.basename(os.path.dirname(full)) or stem
        out, cancelled = export_target(q, full, stem + ".pdf", ".pdf")
        if cancelled:
            return self._json({"ok": True, "cancelled": True})
        try:
            stage = (max(100, min(20000, int(q.get("w", 1920)))), max(100, min(20000, int(q.get("h", 1080)))))
        except ValueError:
            stage = (1920, 1080)
        size, browser = print_pdf(body, full, out, stage)
        print(f"printed {out} ({size} bytes) with {browser}")
        return self._json({"ok": True, "path": out, "name": os.path.basename(out), "bytes": size, "browser": browser})

    def api_pptx(self, q):
        """body = the deck measured by the editor (core/pptx.js) as JSON -> an editable .pptx (pptx_export.py)."""
        full = safe_path(q.get("file", ""))
        if not os.path.isfile(full):
            return self._fail("no such deck", 404)
        try:
            spec = json.loads(self._body().decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            return self._fail(f"not a deck description ({e})")
        if not isinstance(spec, dict) or not isinstance(spec.get("slides"), list):
            return self._fail("not a deck description (no slides)")
        root = SAMPLES_DIR if full.startswith(SAMPLES_DIR + os.sep) else WORKSPACE
        kinds = {".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".gif": "gif", ".bmp": "bmp", ".svg": "svg"}

        def resolve(pic):
            # A workspace path (the editor turns /deck/<path> URLs into these); nothing outside it.
            rel = str(pic.get("path") or "").split("#", 1)[0].split("?", 1)[0]
            target = os.path.realpath(os.path.join(root, urllib.parse.unquote(rel).replace("/", os.sep)))
            ext = kinds.get(os.path.splitext(target)[1].lower())
            if not ext or not target.startswith(root + os.sep) or not os.path.isfile(target) or os.path.getsize(target) > 200 * 1024 * 1024:
                return None
            with open(target, "rb") as f:
                return f.read(), ext

        import pptx_export
        data, notes = pptx_export.build_pptx(spec, resolve)
        stem = os.path.splitext(os.path.basename(full))[0]
        if stem.lower() == "index":
            stem = os.path.basename(os.path.dirname(full)) or stem
        out, cancelled = export_target(q, full, stem + ".pptx", ".pptx")
        if cancelled:
            return self._json({"ok": True, "cancelled": True})
        tmp = out + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, out)
        print(f"exported {out} ({len(data)} bytes, {len(spec['slides'])} slides)")
        return self._json({"ok": True, "path": out, "name": os.path.basename(out), "bytes": len(data), "notes": notes})

    def api_font_upload(self, q):
        """multipart font files -> <deck folder>/fonts/, with what each file says about itself."""
        full = safe_path(q.get("file", ""))
        fonts_dir = os.path.join(os.path.dirname(full), "fonts")
        ctype = self.headers.get("Content-Type", "")
        if not ctype.startswith("multipart/form-data"):
            return self._fail("expected multipart/form-data")
        msg = email.message_from_bytes(b"Content-Type: " + ctype.encode() + b"\r\n\r\n" + self._body(), policy=email.policy.HTTP)
        out = []
        for part in msg.iter_parts():
            name = os.path.basename(part.get_filename() or "")
            ext = os.path.splitext(name)[1].lower()
            if not name or ext not in FONT_EXT:
                continue
            data = part.get_payload(decode=True)
            family, weight, italic = font_meta(data, name)
            os.makedirs(fonts_dir, exist_ok=True)
            stem = font_slug(os.path.splitext(name)[0])
            dest, n = os.path.join(fonts_dir, stem + ext), 1
            while os.path.exists(dest):
                with open(dest, "rb") as f:
                    if f.read() == data:
                        break                     # the same file again: reuse it
                n += 1
                dest = os.path.join(fonts_dir, f"{stem}-{n}{ext}")
            with open(dest, "wb") as f:
                f.write(data)
            out.append({"file": "fonts/" + os.path.basename(dest), "format": FONT_EXT[ext], "family": family, "weight": weight, "italic": italic, "bytes": len(data)})
        if not out:
            return self._fail("no font file (.woff2, .woff, .ttf, .otf) in the upload")
        return self._json({"ok": True, "fonts": out})

    def api_upload(self, q):
        """multipart/form-data with one or more file parts -> <dir>/assets/<name>."""
        target_dir = safe_path(q.get("dir", ""))
        assets = os.path.join(target_dir, "assets")
        ctype = self.headers.get("Content-Type", "")
        if not ctype.startswith("multipart/form-data"):
            return self._fail("expected multipart/form-data")
        raw = b"Content-Type: " + ctype.encode() + b"\r\n\r\n" + self._body()
        msg = email.message_from_bytes(raw, policy=email.policy.HTTP)
        saved, refused = [], []
        for part in msg.iter_parts():
            raw_name = part.get_filename() or ""
            name = safe_upload_name(raw_name)
            if not name:
                if raw_name:
                    refused.append(os.path.basename(raw_name))
                continue
            data = part.get_payload(decode=True)
            os.makedirs(assets, exist_ok=True)
            stem, ext = os.path.splitext(name)
            dest, n = os.path.join(assets, name), 1
            while os.path.exists(dest):  # never overwrite an existing asset
                n += 1
                dest = os.path.join(assets, f"{stem}-{n}{ext}")
            with open(dest, "wb") as f:
                f.write(data)
            saved.append("assets/" + os.path.basename(dest))
        if not saved:
            kinds = ", ".join(sorted(e.lstrip(".") for e in UPLOAD_EXT))
            return self._fail(("not an image, video or audio file: " + ", ".join(refused) if refused else "no file in the upload") + f" (accepted: {kinds})")
        return self._json({"ok": True, "files": saved, "refused": refused})

    def api_new(self, q):
        full = safe_path(q.get("path", ""))
        if full in (WORKSPACE, SAMPLES_DIR):
            return self._fail("give the new deck a name")      # else "<workspace>.html", beside the workspace
        if not full.lower().endswith(".html"):
            full += ".html"
        refreshed = None
        if os.path.exists(full):
            # The tour deck is the one file New may replace: an older edition of it (the Markdown
            # tour, or a previous design) gives way to the current one, kept as a backup.
            if q.get("template") != "welcome" or not stale_tour(full):
                return self._fail("a file with that name already exists", 409)
            refreshed = rotate_backups(full)
        if not os.path.isfile(TEMPLATE):
            return self._fail("template missing: app/templates/blank.html", 500)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        # A named template (app/templates/<slug>.html; "welcome" is the tour deck), else the blank one.
        slug = q.get("template", "").strip()
        src = TEMPLATE
        if slug and slug != "blank":
            if not re.fullmatch(r"[a-z0-9-]+", slug):
                return self._fail("unknown template")
            src = os.path.join(APP_DIR, "templates", slug + ".html")
            if not os.path.isfile(src):
                return self._fail("unknown template: " + slug, 404)
        with open(src, "rb") as f:
            data = f.read()
        if slug != "welcome":
            # The deck is called what the user named it (the folder, or the file when it is not
            # index.html), not "New deck": the title is what the Decks list and the title bar show.
            stem = os.path.splitext(os.path.basename(full))[0]
            name = os.path.basename(os.path.dirname(full)) if stem.lower() == "index" else stem
            name = re.sub(r"[-_]+", " ", name).strip()
            if name:
                title = html_text.escape(name[:1].upper() + name[1:], quote=False).encode("utf-8")
                data = TITLE_RE.sub(lambda m: m.group(0)[:m.group(0).index(b">") + 1] + title + b"</title>", data, count=1)
        with open(full, "wb") as f:
            f.write(data)
        return self._json({"ok": True, "file": rel_path(full), "refreshed": refreshed})

    def api_version(self, q, restore):
        """A previous version of a deck: restored over the current file (which becomes the newest
        backup), or copied beside it as "<name> (<date time>).html" to open on its own."""
        full = safe_path(q.get("file", ""))
        if not os.path.isfile(full) or not full.lower().endswith(".html"):
            return self._fail("no such deck", 404)
        src = version_path(full, q.get("version", ""))
        if restore:
            with open(src, "rb") as f:
                data = f.read()                 # read first: the rotation below renames the backups
            rotate_backups(full)
            with open(full + ".tmp", "wb") as f:
                f.write(data)
            os.replace(full + ".tmp", full)
            print(f"restored {rel_path(full)} from {os.path.basename(src)}")
            return self._json({"ok": True, "file": rel_path(full)})
        stamp = time.strftime("%Y-%m-%d %H.%M", time.localtime(os.stat(src).st_mtime))
        stem = os.path.splitext(os.path.basename(full))[0]
        dst, n = os.path.join(os.path.dirname(full), f"{stem} ({stamp}).html"), 2
        while os.path.exists(dst):
            dst = os.path.join(os.path.dirname(full), f"{stem} ({stamp}) {n}.html"); n += 1
        shutil.copyfile(src, dst)
        return self._json({"ok": True, "file": rel_path(dst)})

    def api_copy_or_move(self, q, move):
        src = safe_path(q.get("file", ""))
        if not os.path.isfile(src):
            return self._fail("no such file", 404)
        # "to" is a bare name: the file stays in its own folder.
        dst = os.path.join(os.path.dirname(src), bare_name(q.get("to", ""), ".html"))
        same = move and os.path.normcase(dst) == os.path.normcase(src)      # a change of case only (Windows, macOS)
        if os.path.exists(dst) and not same:
            return self._fail("a file with that name already exists", 409)
        if not move:
            shutil.copyfile(src, dst)
            return self._json({"ok": True, "file": rel_path(dst)})
        old_rel = rel_path(src)
        os.replace(src, dst)
        move_sidecars(src, dst)
        with settings_change() as s:
            trusted = s.get("trusted_decks", {})
            if src in trusted:
                trusted[dst] = trusted.pop(src)
            for r in s.get("recent", []):
                if r.get("workspace") == WORKSPACE and r.get("file") == old_rel:
                    r["file"] = rel_path(dst)
        return self._json({"ok": True, "file": rel_path(dst)})


# ------------------------------------------------------------------
# The window and the process (see the docstring's paragraph on it).
# ------------------------------------------------------------------
def use_log_file():
    """A windowed executable has no console: print to ~/.deck-editor.log instead."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    try:
        f = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
    except OSError:
        f = open(os.devnull, "w")
    sys.stdout = sys.stderr = f
    print(f"\n--- {time.strftime('%Y-%m-%d %H:%M:%S')} ---")


def fail(message):
    """Print the message and quit; without a console, show it in a message box too."""
    print(message)
    if getattr(sys, "frozen", False) and not os.environ.get("DECK_EDITOR_NO_DIALOG"):
        try:
            import tkinter, tkinter.messagebox
            tkinter.Tk().withdraw()
            tkinter.messagebox.showerror("Diapo", message)
        except Exception:
            if sys.platform == "win32":
                import ctypes
                ctypes.windll.user32.MessageBoxW(None, message, "Diapo", 0x10)
    sys.exit(1)


def diapo_at(port):
    """True when another Diapo answers on this port."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/status", timeout=1.5) as r:
            return json.load(r).get("ok") is True
    except Exception:
        return False


def port_in_use(port):
    """Something accepts connections on this port. Checked before binding because
    HTTPServer sets SO_REUSEADDR, which on Windows lets a second server bind a
    port that is already served instead of failing."""
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def bind_server():
    """The server on PORT, or on the next free port when PORT is taken by
    something else. Returns (server, port); when the port belongs to another
    Diapo, returns (None, port) so the caller shows that one instead."""
    global PORT
    for port in range(PORT, PORT + 20):
        if port_in_use(port):
            if diapo_at(port):
                return None, port
            continue
        try:
            server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
        except OSError:
            continue
        if port != PORT:
            print(f"Port {PORT} is in use; using {port}.")
        PORT = port                                    # the Host / Origin guards compare against it
        return server, port
    fail(f"No free port between {PORT} and {PORT + 19}.")


def show_console(url):
    """The windowed Windows build in a browser tab: closing the tab does not stop the
    server, so it opens a console window of its own whose close button does. Only this
    note is written to it; the rest still goes to the log file, because a click in a
    console (QuickEdit) pauses whoever writes to it, and that would freeze the server."""
    if sys.platform != "win32" or sys.__stdout__ is not None:      # a console already, or not Windows
        return
    try:
        import ctypes
        k = ctypes.windll.kernel32
        if not k.AllocConsole():
            return
        k.SetConsoleTitleW("Diapo")
        with open("CONOUT$", "w", encoding="utf-8") as con:
            con.write(f"Diapo is running in your browser at\n\n    {url}\n\n"
                      "Keep this window open while you work.\n"
                      "Close it to stop Diapo (save your deck first).\n")
    except Exception as e:  # noqa: BLE001 - the tab still works without it
        print(f"Could not open the console window ({e}).")


def open_window(url, port, console=True):
    """Open the editor in a Chromium app window and return its process, or
    open a browser tab (--tab, or no Chrome / Edge) and return None. With a tab,
    `console` gives the windowed build a console window that stops Diapo when closed."""
    def tab():
        if console:
            show_console(url)                            # first, so the browser comes up in front of it
        webbrowser.open(url)
    chrome = None if "--tab" in sys.argv else find_chrome()
    if not chrome:
        if "--tab" not in sys.argv:
            print("No Chrome or Edge found: opening a browser tab instead (set DECK_EDITOR_CHROME to the browser's path).")
        tab()
        return None
    profile = f"{LOG_FILE[:-4]}-window-{port}"          # ~/.deck-editor-window-8800: one browser instance per server
    args = [chrome, "--app=" + url, "--user-data-dir=" + profile,
            "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-extensions",
            "--disable-features=Translate,MediaRouter",
            "--start-maximized"]                         # every start; a --window-size would cancel it
    try:
        return subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as e:
        print(f"Could not start {chrome} ({e}): opening a browser tab instead.")
        tab()
        return None


def main():
    if "--picker" in sys.argv:                          # a frozen build showing a dialog for itself
        a = sys.argv[sys.argv.index("--picker") + 1:] + ["", "", ""]
        sys.argv = ["picker"] + a[:3]
        exec(PICKER, {"__name__": "__main__"})          # noqa: S102 - our own code, see PICKER
        return
    use_log_file()
    for note in SETTINGS_NOTES:
        print(note)
    if not os.path.isdir(WORKSPACE):
        fail(f"Workspace folder not found: {WORKSPACE}")
    server, port = bind_server()
    url = f"http://127.0.0.1:{port}/"
    if server is None:                                  # Diapo is already running there: show it, do not start a second one
        print(f"Diapo is already running at {url}; opening a window on it.")
        if OPEN_BROWSER:
            open_window(url, port, console=False)        # this process ends at once; the running one has its console
        return
    hint = "   (Ctrl+C to stop)" if sys.__stdout__ is not None else ""     # no console in the windowed build
    print(f"Diapo\nWorkspace: {WORKSPACE}\nEditor:    {url}{hint}\nChange the workspace from the Decks drawer in the editor.")
    window = None
    if OPEN_BROWSER:
        window = open_window(url, port)
    if window is not None:
        print("Running in its own window; closing the window stops Diapo.")
        threading.Thread(target=lambda: (window.wait(), server.shutdown()), daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        if window is not None and window.poll() is None:
            window.terminate()
    print("Stopped.")


if __name__ == "__main__":
    main()
