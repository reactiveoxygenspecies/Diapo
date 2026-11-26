#!/usr/bin/env python3
"""Diapo for AI agents: a Model Context Protocol (MCP) server over stdio.

    py -3 mcp_server.py [--folder <decks folder>] [--settings <file>] [--online]

An agent (Claude Desktop, Cursor, Claude Code, a local model...) starts this program and
talks to it on stdin / stdout: JSON-RPC 2.0, one message per line (MCP's stdio transport).
Nothing but protocol messages goes to stdout; anything the program has to say goes to
stderr, which MCP clients keep as the server's log.

The folder: --folder, else the last folder Diapo opened (the "workspace" of its settings
file, ~/.deck-editor.json or --settings). The settings are only read, never written.
Python 3 standard library only.

Tools (see TOOLS below for their schemas)
    list_decks      the decks in the folder: title, path, slide count, modified time
    read_deck       one deck as an outline (slides, names, sections, text, notes, pictures,
                    charts...), its content version, optionally one slide's HTML and the CSS
    write_slide     replace a slide's HTML, or insert a new slide after one
    set_notes       a slide's speaker notes
    delete_slide    remove a slide
    move_slide      put a slide at another position
    create_deck     a new deck from one of Diapo's templates (app/templates)
    check_deck      the deck's problems (skills/diapo-deck/scripts/check-deck.py, and TeX)
    render_slide    a PNG of one slide, drawn by the Chrome or Edge of this machine
    import_file     a .pptx or .md in the folder -> a new deck (import_deck.py)
    export_pdf      a PDF of the deck, printed like the editor's File > Export > PDF

Every write keeps the editor's conventions (serve.py's own functions): the previous file
goes to <deck folder>/.deck-editor/<name>.bak and the older versions rotate, the file is
written whole through a temporary file, and a write names the content version the agent
read (read_deck): when the file has changed since, the write is refused, as the editor's
save is (409). Only the slide being changed is touched; the head, the styles and the
deck's scripts stay byte for byte. A deck open in the editor notices the change on disk
and offers Reload.

Safety
  - Only files inside the folder are read or written: ".." and absolute paths elsewhere
    are refused, and so is a path that a link (symlink, junction) takes outside.
  - Scripts an agent writes into a deck are the deck's own scripts: Diapo pauses them
    until the user trusts the deck (trust is kept per script fingerprint, so a deck the
    user trusted before is paused again when its scripts change).
  - The program sends nothing over the network. Renders and PDFs are made by headless
    Chrome / Edge from a server on 127.0.0.1 that lives for one call (or from a file on
    disk), with the editor's script policy, and with every other host unreachable: web
    fonts and pictures a deck links from the internet are left out of the picture.
    --online lets the browser fetch them.

Level 2 (the open deck, live in the editor) would add tools next to these that talk to
the running editor; the protocol (McpServer), the tool table (TOOLS) and the deck model
(parse / Deck) do not depend on files being the target.
"""
import base64
import html as html_text
import http.server
import importlib.util
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_NAME = "diapo"
# MCP revisions this server speaks, newest first. The client's version is used when it is
# one of these; otherwise the newest is offered and the client decides.
PROTOCOL_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")

# stdout belongs to the protocol. Keep the real stream for it and send every print (serve.py
# and the importers print progress) to stderr.
PROTOCOL_OUT = sys.stdout.buffer if hasattr(sys.stdout, "buffer") else sys.stdout
sys.stdout = sys.stderr


def log(*args):
    print("[diapo-mcp]", *args, file=sys.stderr, flush=True)


# ------------------------------------------------------------------
# Command line and settings (read only)
# ------------------------------------------------------------------
def option(argv, name):
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1]
    return None


def read_settings(path):
    """Diapo's settings, read only ({} when missing or unreadable)."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def load_serve(folder, settings):
    """Import serve.py for its functions. It reads its command line and the settings file when
    imported, so it gets a throw-away settings path (nothing it might write reaches the user's
    file) and is then given, in memory only, what it needs of the real settings: the trusted
    decks (the script policy) and the number of backups to keep."""
    tmp = tempfile.mkdtemp(prefix="diapo-mcp-")
    argv = sys.argv
    sys.argv = ["serve.py", folder, "--settings", os.path.join(tmp, "settings.json"), "--no-open"]
    sys.path.insert(0, HERE)
    try:
        import serve  # noqa: E402
    finally:
        sys.argv = argv
    serve.SETTINGS_WRITABLE = False                      # never write any settings file
    for key in ("trusted_decks", "backups"):
        if key in settings:
            serve.SETTINGS[key] = settings[key]
    serve.WORKSPACE = os.path.realpath(folder)
    shutil.rmtree(tmp, ignore_errors=True)
    return serve


serve = None          # set by main() (or by a test) through load_serve


# ------------------------------------------------------------------
# Errors a tool reports to the agent (as a result with isError, not a protocol error)
# ------------------------------------------------------------------
class ToolError(Exception):
    pass


class StaleError(ToolError):
    pass


# ------------------------------------------------------------------
# The deck model: an HTML parse that keeps where every element starts and ends in the
# text, so a change replaces exactly one slide (or one notes block) and leaves the rest
# of the file as it was.
# ------------------------------------------------------------------
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
CLOSES_P = {"address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figcaption", "figure",
            "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre",
            "section", "table", "ul"}
INLINE = {"a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "font", "i", "kbd", "label",
          "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "del", "ins"}
SKIP = {"script", "style", "template", "noscript", "svg", "math", "head", "title", "canvas", "button", "select", "textarea"}
HEADINGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}


class Node:
    __slots__ = ("tag", "attrs", "start", "open_end", "close_start", "end", "children", "parent")

    def __init__(self, tag, attrs, start, open_end, parent):
        self.tag, self.attrs, self.start, self.open_end, self.parent = tag, attrs, start, open_end, parent
        self.close_start = self.end = None
        self.children = []

    def classes(self):
        return (self.attrs.get("class") or "").split()

    def elements(self):
        return [c for c in self.children if isinstance(c, Node)]

    def walk(self):
        for c in self.children:
            if isinstance(c, Node):
                yield c
                yield from c.walk()


class Comment:
    __slots__ = ("text", "start", "end")

    def __init__(self, text, start, end):
        self.text, self.start, self.end = text, start, end


class TreeParser(HTMLParser):
    """A forgiving tree builder: tags close their open descendants, a few implicit closings
    (a new <p> or block closes an open <p>, <li> closes <li>...), offsets into the text."""

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.text = text
        self.lines = [0]
        for i, c in enumerate(text):
            if c == "\n":
                self.lines.append(i + 1)
        self.root = Node("#root", {}, 0, 0, None)
        self.stack = [self.root]

    def pos(self):
        line, col = self.getpos()
        return self.lines[line - 1] + col

    def _close(self, node, at):
        node.close_start = node.end = at if node.end is None else node.end

    def handle_starttag(self, tag, attrs):
        start = self.pos()
        raw = self.get_starttag_text() or ""
        top = self.stack[-1]
        if top.tag == "p" and tag in CLOSES_P:
            self._close(self.stack.pop(), start)
        elif tag == top.tag and tag in ("li", "dt", "dd", "tr", "option"):
            self._close(self.stack.pop(), start)
        elif tag in ("td", "th") and top.tag in ("td", "th"):
            self._close(self.stack.pop(), start)
        elif tag in ("dt", "dd") and top.tag in ("dt", "dd"):
            self._close(self.stack.pop(), start)
        parent = self.stack[-1]
        node = Node(tag, {k: (v if v is not None else "") for k, v in attrs}, start, start + len(raw), parent)
        parent.children.append(node)
        if tag in VOID:
            node.close_start = node.end = node.open_end
        else:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        start = self.pos()
        raw = self.get_starttag_text() or ""
        parent = self.stack[-1]
        node = Node(tag, {k: (v if v is not None else "") for k, v in attrs}, start, start + len(raw), parent)
        node.close_start = node.end = node.open_end
        parent.children.append(node)

    def handle_endtag(self, tag):
        start = self.pos()
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                gt = self.text.find(">", start)
                end = len(self.text) if gt < 0 else gt + 1
                for inner in self.stack[i + 1:]:
                    if inner.end is None:
                        inner.close_start = inner.end = start
                node = self.stack[i]
                node.close_start, node.end = start, end
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)

    def handle_comment(self, data):
        start = self.pos()
        end = self.text.find("-->", start)
        self.stack[-1].children.append(Comment(data, start, len(self.text) if end < 0 else end + 3))


def parse(text):
    p = TreeParser(text)
    p.feed(text)
    p.close()
    for node in p.stack[1:]:
        if node.end is None:
            node.close_start = node.end = len(text)
    return p.root


def find_stage(root):
    return next((n for n in root.walk() if "deck-stage" in n.classes()), None)


def stage_slides(stage):
    return [n for n in stage.elements() if "slide" in n.classes()] if stage else []


def first(it):
    return next(iter(it), None)


def notes_node(slide):
    """A slide's notes: <aside class="notes"> among its children (else any child of class notes)."""
    asides = [c for c in slide.elements() if c.tag == "aside" and "notes" in c.classes()]
    if asides:
        return asides[0]
    return first(c for c in slide.elements() if "notes" in c.classes())


SLIDE_LABEL = re.compile(r"^slides?\s*\d+(\s*[-\u2013\u2014]\s*\d+)?\b", re.I)


def notes_from_html(inner):
    """Plain text of a notes block, as the editor reads it: <br> and block ends are line breaks."""
    t = re.sub(r"<br\s*/?>", "\n", inner, flags=re.I)
    t = re.sub(r"</(p|div|li)>", "\n", t, flags=re.I)
    t = html_text.unescape(re.sub(r"<[^>]+>", "", t))
    lines = [l.strip() for l in t.replace("\r", "").split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def comment_before(stage, slide):
    """The comment directly before a slide (only blank text between), or None."""
    kids = stage.children
    i = kids.index(slide) - 1
    while i >= 0 and isinstance(kids[i], str) and not kids[i].strip():
        i -= 1
    return kids[i] if i >= 0 and isinstance(kids[i], Comment) else None


def comment_notes(comment):
    if not comment:
        return ""
    lines = [re.sub(r"^[\s=\-*#]+|[\s=\-*#]+$", "", l) for l in comment.text.split("\n")]
    text = "\n".join(l for l in lines if l).strip()
    return "" if not text or SLIDE_LABEL.match(text) else text


def squash(s):
    return re.sub(r"[ \t\r\f\v]*\n[ \t\r\f\v]*", "\n", re.sub(r"[ \t\r\f\v]+", " ", s)).strip()


def inline_text(node):
    """The text of a node that is its own: its text and that of its inline descendants,
    not of nested blocks (those are outlined on their own). Inline equations as \\( TeX \\)."""
    out = []

    def go(n):
        for c in n.children:
            if isinstance(c, str):
                out.append(re.sub(r"\s+", " ", c))
            elif isinstance(c, Node):
                if c.tag == "br":
                    out.append("\n")
                elif "data-math" in c.attrs and c.tag == "span":
                    out.append("\\(" + c.attrs["data-math"] + "\\)")
                elif c.tag in INLINE and c.tag not in SKIP:
                    go(c)
    go(node)
    return squash("".join(out))


def all_text(node):
    """Every piece of text under a node (svg and scripts left out), for list items and cells."""
    out = []

    def go(n):
        for c in n.children:
            if isinstance(c, str):
                out.append(c)
            elif isinstance(c, Node):
                if c.tag == "br":
                    out.append("\n")
                elif "data-math" in c.attrs and c.tag == "span":
                    out.append("\\(" + c.attrs["data-math"] + "\\)")
                elif c.tag not in SKIP:
                    if c.tag not in INLINE:
                        out.append(" ")
                    go(c)
                    if c.tag not in INLINE:
                        out.append(" ")
    go(node)
    return squash(re.sub(r"[ \t]+", " ", "".join(out)))


def json_in(node, attr):
    """The JSON of a <script type="application/json" attr> child, or None."""
    holder = first(c for c in node.elements() if c.tag == "script" and attr in c.attrs)
    if not holder:
        return None
    try:
        return json.loads("".join(c for c in holder.children if isinstance(c, str)))
    except ValueError:
        return None


def outline_blocks(node, deck_dir, out):
    for c in node.children:
        if not isinstance(c, Node):
            continue
        t, a = c.tag, c.attrs
        if "notes" in c.classes() and (t == "aside" or "slide" in node.classes()):
            continue                                   # speaker notes: outlined apart
        if "data-chart" in a:
            item = {"type": "chart", "kind": a.get("data-chart") or ""}
            spec = json_in(c, "data-chart-data")
            if isinstance(spec, dict):
                if isinstance(spec.get("labels"), list):
                    item["labels"] = [str(x) for x in spec["labels"][:20]]
                if isinstance(spec.get("series"), list):
                    item["series"] = [str(s.get("name", "")) for s in spec["series"] if isinstance(s, dict)][:12]
                if spec.get("title"):
                    item["title"] = str(spec["title"])
            out.append(item)
            continue
        if "data-math" in a and t != "span":
            out.append({"type": "equation", "tex": a["data-math"]})
            continue
        if "data-chem" in a:
            item = {"type": "structure", "source": a["data-chem"]}
            if a.get("data-chem-format"):
                # A Molfile or CDXML kept in the figure (chem.js): its kind, and its text in a data block.
                item["format"] = a["data-chem-format"]
                holder = first(k for k in c.elements() if k.tag == "script" and "data-chem-source" in k.attrs)
                if holder:
                    item["source"] = "".join(k for k in holder.children if isinstance(k, str)).strip("\n")
            out.append(item)
            continue
        if "data-plot" in a:
            item = {"type": "plotly-figure" if a.get("data-plot") == "plotly" else "plot", "library": a.get("data-plot") or ""}
            fig = json_in(c, "data-plot-figure")
            if isinstance(fig, dict):
                title = (fig.get("layout") or {}).get("title") if isinstance(fig.get("layout"), dict) else None
                title = title.get("text") if isinstance(title, dict) else title
                if title:
                    item["title"] = str(title)
                traces = fig.get("data")
                if isinstance(traces, list):
                    item["traces"] = [str(tr.get("type", "scatter")) + (f" {tr['name']}" if tr.get("name") else "") for tr in traces if isinstance(tr, dict)][:12]
            out.append(item)
            continue
        if "data-svg" in a:
            img = first(n for n in c.walk() if n.tag == "img")
            out.append(picture(a["data-svg"], (img.attrs.get("alt") if img else "") or a.get("aria-label", ""), deck_dir, "drawing"))
            continue
        if t == "img":
            out.append(picture(a.get("src", ""), a.get("alt", ""), deck_dir))
            continue
        if t in ("video", "audio"):
            src = a.get("src") or next((s.attrs.get("src", "") for s in c.elements() if s.tag == "source"), "")
            out.append({"type": t, "src": src})
            continue
        if t in ("iframe", "embed", "object"):
            out.append({"type": "embed", "src": a.get("src") or a.get("data") or ""})
            continue
        if t in SKIP:
            continue
        if t in ("ul", "ol"):
            items = [all_text(li) for li in c.elements() if li.tag == "li"]
            out.append({"type": "list", "ordered": t == "ol", "items": [i for i in items if i]})
            for li in c.elements():             # pictures and figures inside items
                outline_media(li, deck_dir, out)
            continue
        if t == "table":
            rows = [[all_text(cell) for cell in tr.elements() if cell.tag in ("td", "th")] for tr in c.walk() if tr.tag == "tr"]
            out.append({"type": "table", "rows": [r for r in rows if r]})
            continue
        if t not in INLINE:
            own = inline_text(c)
            if own:
                kind = ("heading" if t in HEADINGS else "paragraph" if t == "p" else "quote" if t == "blockquote"
                        else "caption" if t == "figcaption" else "code" if t == "pre" else "text")
                item = {"type": kind, "text": own[:4000]}
                if t in HEADINGS:
                    item["level"] = HEADINGS[t]
                if a.get("id"):
                    item["id"] = a["id"]
                out.append(item)
        outline_blocks(c, deck_dir, out)


def outline_media(node, deck_dir, out):
    """Pictures and figures below a node whose text is already in the outline (a list item)."""
    tmp = []
    outline_blocks(node, deck_dir, tmp)
    out.extend(x for x in tmp if x["type"] not in ("text", "paragraph", "heading", "quote", "caption", "code", "list", "table"))


def picture(src, alt, deck_dir, kind="picture"):
    item = {"type": kind, "src": src, "alt": alt}
    s = (src or "").strip()
    if s and not re.match(r"^([a-z][a-z0-9+.-]*:|//|#)", s, re.I):
        local = os.path.normpath(os.path.join(deck_dir, urllib.parse.unquote(s.split("?")[0].split("#")[0])))
        if not os.path.exists(local):
            item["missing"] = True
    return item


class Deck:
    """A deck file read into memory: its text, its version and its parsed slides."""

    def __init__(self, full, data):
        self.full = full
        self.data = data
        self.version = serve.content_version(data)
        try:
            self.text = data.decode("utf-8")
        except UnicodeDecodeError:
            raise ToolError("the deck is not UTF-8 text; open it in Diapo and save it once")
        self.crlf = "\r\n" in self.text[:4096]
        self.root = parse(self.text)
        self.stage = find_stage(self.root)
        if not self.stage:
            raise ToolError("not a Diapo deck: it has no .deck-stage element")
        self.slides = stage_slides(self.stage)

    def slide_index(self, ref, what="slide"):
        """A slide by number (1 = first), by its id or by its name (data-name). 0-based."""
        if isinstance(ref, bool) or ref is None or ref == "":
            raise ToolError(f"say which {what}: a number (1 = first), or a slide's id or name")
        if isinstance(ref, (int, float)) or (isinstance(ref, str) and ref.strip().isdigit()):
            n = int(ref)
            if not 1 <= n <= len(self.slides):
                raise ToolError(f"there is no slide {n}: the deck has {len(self.slides)} slide(s)")
            return n - 1
        ref = str(ref).strip()
        for key in ("id", "data-name"):
            hits = [i for i, s in enumerate(self.slides) if s.attrs.get(key) == ref]
            if len(hits) == 1:
                return hits[0]
            if len(hits) > 1:
                raise ToolError(f'{len(hits)} slides are called "{ref}"; use the slide number')
        raise ToolError(f'no slide has the id or name "{ref}"; read_deck lists them')

    def slide_html(self, i):
        s = self.slides[i]
        return self.text[s.start:s.end]

    def eol(self, s):
        s = s.replace("\r\n", "\n")
        return s.replace("\n", "\r\n") if self.crlf else s

    def indent_of(self, node):
        line = self.text.rfind("\n", 0, node.start) + 1
        lead = self.text[line:node.start]
        return lead if not lead.strip() else ""

    def outline(self):
        deck_dir = os.path.dirname(self.full)
        out, section = [], ""
        for i, s in enumerate(self.slides):
            a = s.attrs
            section = a.get("data-section") or section
            notes = notes_node(s)
            notes_text = notes_from_html(self.text[notes.open_end:notes.close_start]) if notes else comment_notes(comment_before(self.stage, s))
            blocks = []
            outline_blocks(s, deck_dir, blocks)
            ids = []
            for n in s.walk():
                if n.attrs.get("id") and not any(p.tag == "svg" for p in ancestors(n, s)) and n.tag != "svg":
                    ids.append(n.attrs["id"])
            title = next((b["text"] for b in blocks if b["type"] == "heading"), "")
            item = {"slide": i + 1, "name": a.get("data-name", ""), "id": a.get("id", ""),
                    "section": section, "starts_section": bool(a.get("data-section")),
                    "title": title[:200], "classes": " ".join(c for c in s.classes() if c not in ("slide", "active", "visible")),
                    "content": blocks, "notes": notes_text}
            if "data-skip" in a:
                item["skipped"] = True
            if ids:
                item["element_ids"] = ids
            out.append(item)
        return out


def ancestors(node, stop):
    p = node.parent
    while p is not None and p is not stop:
        yield p
        p = p.parent


def stage_size(text):
    """The stage's width and height in px from the deck's CSS (the last rule wins), else 1920x1080."""
    sizes = re.findall(r"\.deck-stage[^{]*\{[^}]*?\bwidth:\s*(\d+)px;?[^}]*?\bheight:\s*(\d+)px", text)
    if sizes:
        w, h = sizes[-1]
        if 100 <= int(w) <= 20000 and 100 <= int(h) <= 20000:
            return int(w), int(h)
    return 1920, 1080


def set_classes(start_tag, add=(), remove=()):
    """A start tag with classes added / removed (its other attributes as they were)."""
    m = re.search(r"""(\sclass\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", start_tag, re.I)
    if not m:
        if not add:
            return start_tag
        cut = len(start_tag) - (2 if start_tag.endswith("/>") else 1)
        return start_tag[:cut] + f' class="{" ".join(add)}"' + start_tag[cut:]
    names = (m.group(2) if m.group(2) is not None else m.group(3) if m.group(3) is not None else m.group(4)).split()
    names = [n for n in names if n not in remove]
    names += [n for n in add if n not in names]
    return start_tag[:m.start()] + m.group(1) + '"' + " ".join(names) + '"' + start_tag[m.end():]


def apply_edits(text, edits):
    """edits: (start, end, replacement, order). Applied from the end of the text backwards; at
    the same place, the lower order is applied first (so it ends up after the others)."""
    for start, end, rep, _ in sorted(edits, key=lambda e: (-e[0], -e[1], e[3])):
        text = text[:start] + rep + text[end:]
    return text


def fix_active(text):
    """Only the first slide carries "active" in the file (the controller adds it at load and the
    editor writes it so); "visible" is never written."""
    root = parse(text)
    slides = stage_slides(find_stage(root))
    edits = []
    for i, s in enumerate(slides):
        tag = text[s.start:s.open_end]
        new = set_classes(tag, add=("active",) if i == 0 else (), remove=("visible",) if i == 0 else ("active", "visible"))
        if new != tag:
            edits.append((s.start, s.open_end, new, 0))
    return apply_edits(text, edits)


def one_slide(fragment):
    """The new slide's HTML, checked: one element with class "slide", closed."""
    frag = fragment.strip()
    root = parse(frag)
    tops = root.elements()
    stray = "".join(c for c in root.children if isinstance(c, str)).strip()
    if len(tops) != 1 or stray or "slide" not in tops[0].classes():
        raise ToolError('the HTML must be exactly one slide element: <section class="slide ..."> ... </section> '
                        "(read_deck with slide_html shows an existing slide to follow)")
    s = tops[0]
    if s.close_start is None or s.close_start == s.end or not frag[s.close_start:].lower().startswith("</" + s.tag):
        raise ToolError(f"the slide's <{s.tag}> is not closed")
    if any("deck-stage" in n.classes() or "slide" in n.classes() for n in s.walk()):
        raise ToolError("a slide cannot hold another slide or a .deck-stage")
    return frag


# ------------------------------------------------------------------
# TeX: what can be checked without a browser (MathJax in the editor has the last word)
# ------------------------------------------------------------------
def tex_problem(tex):
    t = (tex or "").strip()
    if not t:
        return "it is empty"
    depth, i = 0, 0
    while i < len(t):
        c = t[i]
        if c == "\\":
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth < 0:
                return "a } has no matching {"
        i += 1
    if depth > 0:
        return "a { is not closed"
    envs = []
    for kind, name in re.findall(r"\\(begin|end)\s*\{([^}]*)\}", t):
        if kind == "begin":
            envs.append(name)
        elif not envs or envs.pop() != name:
            return f"\\end{{{name}}} does not match its \\begin"
    if envs:
        return f"\\begin{{{envs[-1]}}} has no \\end"
    lefts = len(re.findall(r"\\left(?![A-Za-z])", t))
    rights = len(re.findall(r"\\right(?![A-Za-z])", t))
    if lefts != rights:
        return f"{lefts} \\left against {rights} \\right"
    if re.search(r"(?<!\\)[\^_]\s*$", t):
        return "it ends with ^ or _"
    if re.search(r"(?<!\\)\\$", t):
        return "it ends with a lone backslash"
    return None


# ------------------------------------------------------------------
# check-deck.py (the diapo-deck skill's checker), when it is next to this program
# ------------------------------------------------------------------
_checker = None


def checker():
    global _checker
    if _checker is None:
        _checker = False
        for path in (os.path.join(HERE, "..", "skills", "diapo-deck", "scripts", "check-deck.py"),
                     os.path.join(HERE, "check-deck.py")):
            path = os.path.normpath(path)
            if os.path.isfile(path):
                try:
                    spec = importlib.util.spec_from_file_location("diapo_check_deck", path)
                    mod = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(mod)
                    _checker = mod
                except Exception as e:  # noqa: BLE001
                    log(f"check-deck.py could not be loaded: {e}")
                break
    return _checker or None


# ------------------------------------------------------------------
# Chrome / Edge, headless, kept off the network
# ------------------------------------------------------------------
OFFLINE_ARGS = ["--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1", "--disable-background-networking",
                "--disable-component-update", "--disable-sync", "--no-pings", "--disable-domain-reliability",
                "--disable-client-side-phishing-detection", "--disable-default-apps",
                "--disable-features=OptimizationHints,MediaRouter,Translate,AutofillServerCommunication"]
RENDER_CSS = ("\n<style id=\"deck-editor-mcp-render\">"
              ".deck-controls,.deck-keys,.deck-keyhint,.deck-overview,.deck-laser,.deck-draw{display:none!important}"
              ".deck-stage [data-fragment]{opacity:1!important;visibility:visible!important}"
              "</style>\n")


class RenderHandler(http.server.BaseHTTPRequestHandler):
    """The decks of the folder for one headless browser, read only: GET /deck/<path> with the
    script policy serve.py gives the same file (Diapo's scripts run, the deck's own run only
    when the user trusts the deck). A page asked for with ?render=1 gets a style that shows
    every fragment and hides the deck's controls, and is marked as being edited, so it does
    not move on by itself."""
    protocol_version = "HTTP/1.1"
    folder = None                      # a Folder

    def log_message(self, fmt, *args):
        pass

    def _fail(self, status):
        body = b"no"
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        self._fail(405)

    do_PUT = do_DELETE = do_PATCH = do_POST

    def do_GET(self):
        port = self.server.server_address[1]
        if not serve.host_ok(self.headers.get("Host"), port) or not serve.fetch_site_ok(self.headers.get("Sec-Fetch-Site")):
            return self._fail(403)
        url = urllib.parse.urlsplit(self.path)
        if not url.path.startswith("/deck/"):
            return self._fail(404)
        try:
            full = self.folder.resolve(urllib.parse.unquote(url.path[len("/deck/"):]))
        except ToolError:
            return self._fail(403)
        if not os.path.isfile(full):
            return self._fail(404)
        with open(full, "rb") as f:
            data = f.read()
        lower = full.lower()
        if lower.endswith((".html", ".htm")):
            scan = serve.scan_deck(full, data)
            if serve.deck_trusted(full, scan["own"]):
                csp = serve.FRAME_POLICY
            else:
                csp = serve.deck_csp(scan["allow"], serve.script_urls(self.headers.get("Host").strip().lower(), url.path, scan["files"]))
            if "render=1" in url.query:
                text = data.decode("utf-8", "replace")
                text = re.sub(r"<html\b[^>]*>", lambda m: set_classes(m.group(0), add=("deck-editing",)), text, count=1, flags=re.I)
                m = re.search(r"</head\s*>", text, re.I)
                text = text[:m.start()] + RENDER_CSS + text[m.start():] if m else RENDER_CSS + text
                data = text.encode("utf-8")
            ctype = "text/html; charset=utf-8"
        else:
            csp = f"script-src 'none'; form-action 'none'; {serve.FRAME_POLICY}"
            ctype = "text/javascript; charset=utf-8" if lower.endswith((".js", ".mjs")) else (
                serve.MIME_EXTRA.get(os.path.splitext(lower)[1]) or mimetypes.guess_type(full)[0] or "application/octet-stream")
            if ctype.startswith("text/") and "charset" not in ctype:
                ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", csp)
        self.end_headers()
        self.wfile.write(data)


class Folder:
    """The folder of decks: every path an agent gives is resolved here, and refused outside it."""

    def __init__(self, path, online=False):
        self.root = os.path.realpath(path)
        self.online = online

    def resolve(self, rel, what="path"):
        if not isinstance(rel, str) or not rel.strip():
            raise ToolError(f"give a {what} inside the folder of decks")
        raw = rel.strip().replace("\\", "/")
        if "\x00" in raw or any(ord(c) < 32 for c in raw):
            raise ToolError(f"that {what} has control characters in it")
        if raw.startswith("@"):
            raise ToolError(f"{rel}: only files in the folder of decks can be used")
        if re.match(r"^[A-Za-z]:(?![/])", raw):
            raise ToolError(f"{rel}: a drive without a folder is not a path inside the folder of decks")
        if ".." in raw.split("/"):
            raise ToolError(f"{rel}: '..' is not allowed; give a path inside the folder of decks")
        if os.path.isabs(raw) or re.match(r"^[A-Za-z]:/", raw):
            full = os.path.realpath(raw)
        else:
            full = os.path.realpath(os.path.join(self.root, raw))
        if full != self.root and not full.startswith(self.root + os.sep):
            raise ToolError(f"{rel} is outside the folder of decks ({self.root})")
        return full

    def rel(self, full):
        return os.path.relpath(full, self.root).replace(os.sep, "/")

    def deck_path(self, rel):
        full = self.resolve(rel)
        if not full.lower().endswith((".html", ".htm")):
            raise ToolError(f"{rel} is not an .html file")
        if not os.path.isfile(full):
            raise ToolError(f"no such deck: {rel} (list_decks shows the decks in the folder)")
        return full

    def read(self, rel):
        full = self.deck_path(rel)
        with open(full, "rb") as f:
            return Deck(full, f.read())

    def write(self, deck, text, version):
        """Write a changed deck the way the editor saves: refused when the file is no longer
        the version the agent read; the previous file kept as a backup; written whole."""
        if not isinstance(version, str) or not version.strip():
            raise ToolError("give the deck's version, as read_deck returned it (it guards against writing over other changes)")
        with open(deck.full, "rb") as f:
            now = serve.content_version(f.read())
        if now != version.strip():
            raise StaleError(f"the deck has changed since you read it (you read version {version.strip()}, it is now {now}): "
                             "someone saved it in Diapo or another program did. Read it again with read_deck, then redo the change.")
        data = text.encode("utf-8")
        if not serve.is_deck_html(data):
            raise ToolError("refusing to write: the result would not be a deck")
        backup = serve.rotate_backups(deck.full)
        tmp = deck.full + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, deck.full)
        serve.ensure_deck_files(deck.full, text)
        log(f"wrote {self.rel(deck.full)} ({len(data)} bytes)" + (f", previous -> {backup}" if backup else ""))
        return serve.content_version(data), backup

    # -- rendering ------------------------------------------------
    def chrome_args(self, chrome, profile, w, h):
        args = [chrome, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                "--disable-extensions", "--hide-scrollbars", f"--window-size={w},{h}", "--force-device-scale-factor=1",
                "--run-all-compositor-stages-before-draw", "--user-data-dir=" + profile]
        return args + ([] if self.online else OFFLINE_ARGS)

    def render(self, deck, index, scale):
        chrome = serve.find_chrome()
        if not chrome:
            raise ToolError("no Chrome or Edge found on this computer (set DECK_EDITOR_CHROME to the browser's path)")
        sw, sh = stage_size(deck.text)
        w, h = max(16, round(sw * scale)), max(16, round(sh * scale))
        handler = type("Handler", (RenderHandler,), {"folder": self})
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        httpd.daemon_threads = True
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        work = tempfile.mkdtemp(prefix="diapo-mcp-render-")
        out = os.path.join(work, "slide.png")
        try:
            port = httpd.server_address[1]
            url = f"http://127.0.0.1:{port}/deck/{urllib.parse.quote(self.rel(deck.full))}?render=1#{index + 1}"
            args = self.chrome_args(chrome, os.path.join(work, "profile"), w, h) + [
                "--virtual-time-budget=6000", "--screenshot=" + out, url]
            r = subprocess.run(args, capture_output=True, text=True, timeout=90)
            if not os.path.isfile(out) or os.path.getsize(out) < 100:
                tail = (r.stderr or r.stdout or "").strip().splitlines()[-3:]
                raise ToolError("the browser did not make a picture" + (": " + " | ".join(tail) if tail else ""))
            with open(out, "rb") as f:
                png = f.read()
        except subprocess.TimeoutExpired:
            raise ToolError("the browser took too long to draw the slide")
        finally:
            httpd.shutdown()
            httpd.server_close()
            for attempt in range(8):
                shutil.rmtree(work, ignore_errors=True)
                if not os.path.exists(work):
                    break
                time.sleep(0.25)
        return png, (w, h), os.path.basename(chrome)


# ------------------------------------------------------------------
# The printable copy (what core/export.js makes in the editor, made here from the file)
# ------------------------------------------------------------------
PRINT_ID = "deck-editor-print"


def reveal_classes(text, root):
    """Classes the deck reveals with ".visible .x" rules (deckRevealClasses in core/animate.js)."""
    out = ["reveal", "reveal-img", "reveal-right"]
    for n in root.walk():
        if n.tag != "style" or "deck-editor" in n.attrs.get("id", ""):
            continue
        css = "".join(c for c in n.children if isinstance(c, str))
        for m in re.finditer(r"([^{}]+)\{", css):
            for part in m.group(1).split(","):
                k = re.search(r"\.visible\s+\.([\w-]+)\s*$", part.strip())
                if k and k.group(1) not in out:
                    out.append(k.group(1))
    return out


def print_css(w, h, reveal):
    sel = ", ".join(f".deck-stage .slide .{c}" for c in reveal)
    return f"""@media print {{
@page {{ size: {w}px {h}px; margin: 0; }}
html, body {{ width: {w}px !important; height: auto !important; min-height: 0 !important; margin: 0 !important; overflow: visible !important; background: #fff !important; }}
.deck-viewport {{ position: static !important; inset: auto !important; width: {w}px !important; height: auto !important; overflow: visible !important; }}
.deck-stage {{ position: relative !important; transform: none !important; width: {w}px !important; height: auto !important; overflow: visible !important; }}
.deck-stage > :not(.slide) {{ display: none !important; }}
.deck-stage > .slide {{ position: relative !important; inset: auto !important; left: auto !important; top: auto !important; display: block !important; visibility: visible !important; opacity: 1 !important; pointer-events: auto !important; width: {w}px !important; height: {h}px !important; overflow: hidden !important; margin: 0 !important; break-after: page; page-break-after: always; break-inside: avoid; page-break-inside: avoid; }}
.deck-stage > .slide[data-print-last] {{ break-after: auto; page-break-after: auto; }}
.deck-stage .slide, .deck-stage .slide * {{ transition: none !important; animation: none !important; }}
.deck-stage [data-fragment] {{ opacity: 1 !important; visibility: visible !important; }}
{sel} {{ opacity: 1 !important; visibility: visible !important; filter: none !important; }}
.deck-controls, .deck-overview, .deck-laser, .deck-draw, .deck-keys, .deck-keyhint, .deck-stage [data-hidden] {{ display: none !important; }}
* {{ -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }}
}}"""


def helper_js(name):
    with open(os.path.join(serve.APP_DIR, "print", name + ".js"), encoding="utf-8", newline="") as f:
        return f.read().replace("\r\n", "\n").replace("\r", "\n").strip()


def printable_html(deck):
    """The deck as pages: skipped slides out, the presentation features and the interactive
    charts' library out (charts print as their picture), every slide shown, the print CSS and
    the two print helpers in, and the editor's script policy in the head when the deck's own
    scripts are paused. Returns (html bytes, page count, (w, h))."""
    text = deck.text
    root, slides = deck.root, deck.slides
    cuts = [(s.start, s.end, "", 0) for s in slides if "data-skip" in s.attrs]
    for n in root.walk():
        if n.tag == "script" and (n.attrs.get("id") in ("deck-runtime", "deck-presenter") or "data-deck-plot" in n.attrs):
            cuts.append((n.start, n.end, "", 0))
    text = apply_edits(text, cuts)
    root = parse(text)
    stage = find_stage(root)
    slides = stage_slides(stage)
    if not slides:
        raise ToolError("every slide of this deck is skipped: there is nothing to print")
    edits = []
    for i, s in enumerate(slides):
        tag = set_classes(text[s.start:s.open_end], add=("active", "visible"))
        if i == len(slides) - 1:
            tag = tag[:-1].rstrip("/").rstrip() + " data-print-last>"
        edits.append((s.start, s.open_end, tag, 0))
    for n in stage.walk():
        if "data-href" in n.attrs and "slide" not in n.classes():
            a = f'<a href="{html_text.escape(n.attrs["data-href"])}" target="_blank" style="display: contents;">'
            edits.append((n.start, n.start, a, 0))
            edits.append((n.end, n.end, "</a>", 1))
    w, h = stage_size(text)
    scan = serve.scan_deck(deck.full, deck.data)
    head_first = ""
    if not serve.deck_trusted(deck.full, scan["own"]):
        hashes = " ".join(f"'sha256-{x}'" for x in sorted(serve.known_script_hashes() | set(scan["allow"])))
        head_first += f'<meta http-equiv="Content-Security-Policy" content="script-src {hashes}; form-action \'none\'">'
    head_first += f'<script id="{PRINT_ID}-prep">\n{helper_js("prep")}\n</script>'
    style = f'<style id="{PRINT_ID}">\n{print_css(w, h, reveal_classes(text, root))}\n</style>'
    keeper = f'<script id="{PRINT_ID}-keeper">\n{helper_js("keeper")}\n</script>'
    head = re.search(r"<head\b[^>]*>", text, re.I)
    head_end = re.search(r"</head\s*>", text, re.I)
    body_end = None
    for m in re.finditer(r"</body\s*>", text, re.I):
        body_end = m
    if head and head_end:
        edits.append((head.end(), head.end(), head_first, 0))
        edits.append((head_end.start(), head_end.start(), style, 0))
    else:
        edits.append((0, 0, head_first + style, 0))
    pos = body_end.start() if body_end else len(text)
    edits.append((pos, pos, keeper, 2))
    text = apply_edits(text, edits)
    return text.encode("utf-8"), len(slides), (w, h)


# ------------------------------------------------------------------
# Tools
# ------------------------------------------------------------------
def result_json(obj):
    return [{"type": "text", "text": json.dumps(obj, ensure_ascii=False, indent=1)}]


def templates():
    try:
        with open(os.path.join(serve.APP_DIR if serve else os.path.join(HERE, "app"), "templates", "templates.json"), encoding="utf-8") as f:
            items = json.load(f).get("templates", [])
    except (OSError, ValueError):
        items = []
    out = [t for t in items if isinstance(t, dict) and re.fullmatch(r"[a-z0-9-]+", str(t.get("slug", "")))]
    if not any(t["slug"] == "blank" for t in out):
        out.insert(0, {"slug": "blank", "name": "Blank", "tone": "light", "style": "Formal"})
    return out


class Tools:
    def __init__(self, folder):
        self.folder = folder

    # -- reading --------------------------------------------------
    def list_decks(self, args):
        sub = args.get("folder") or ""
        root = self.folder.resolve(sub, "folder") if sub else self.folder.root
        if not os.path.isdir(root):
            raise ToolError(f"no such folder: {sub}")
        decks = []
        for f in serve.list_tree(root):
            if not f["deck"]:
                continue
            full = os.path.realpath(os.path.join(self.folder.root, f["path"].replace("/", os.sep)))
            if not full.startswith(self.folder.root + os.sep):
                continue                                   # a link that leads out of the folder
            with open(full, "rb") as fh:
                data = fh.read()
            count = len(re.findall(rb"""<section\b[^>]*\bclass\s*=\s*["'](?:[^"']*\s)?slide(?:\s[^"']*)?["']""", data, re.I))
            decks.append({"path": self.folder.rel(full), "title": f["title"], "slides": count, "bytes": f["size"],
                          "modified": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(f["mtime"]))})
        return result_json({"folder": self.folder.root, "decks": decks})

    def read_deck(self, args):
        deck = self.folder.read(args.get("path"))
        scan = serve.scan_deck(deck.full, deck.data)
        w, h = stage_size(deck.text)
        title = re.search(r"<title[^>]*>(.*?)</title\s*>", deck.text, re.I | re.S)
        out = {"path": self.folder.rel(deck.full), "title": html_text.unescape(title.group(1)).strip() if title else "",
               "version": deck.version, "stage": {"width": w, "height": h}, "slide_count": len(deck.slides),
               "own_scripts": {"count": len(scan["own"]), "trusted": serve.deck_trusted(deck.full, scan["own"])},
               "slides": deck.outline()}
        ref = args.get("slide_html")
        if ref not in (None, ""):
            i = deck.slide_index(ref)
            out["slide_html"] = {"slide": i + 1, "html": deck.slide_html(i)}
        if args.get("include_css"):
            css = []
            for n in deck.root.walk():
                if n.tag == "style" and "deck-editor-mcp" not in n.attrs.get("id", ""):
                    css.append("".join(c for c in n.children if isinstance(c, str)).strip())
            out["css"] = "\n\n".join(c for c in css if c)
        return result_json(out)

    # -- writing --------------------------------------------------
    def _done(self, deck, text, version, extra):
        new_version, backup = self.folder.write(deck, text, version)
        after = Deck(deck.full, text.encode("utf-8"))
        return result_json({"ok": True, "path": self.folder.rel(deck.full), "version": new_version,
                            "slide_count": len(after.slides), "backup": backup, **extra})

    def write_slide(self, args):
        deck = self.folder.read(args.get("path"))
        html_in = args.get("html")
        if not isinstance(html_in, str) or not html_in.strip():
            raise ToolError("give the slide's HTML")
        frag = deck.eol(one_slide(html_in))
        has_slide, has_after = args.get("slide") not in (None, ""), args.get("after") is not None
        if has_slide == has_after:
            raise ToolError('give either "slide" (the slide to replace) or "after" (insert a new slide after that one; 0 = first)')
        text = deck.text
        if has_slide:
            i = deck.slide_index(args["slide"])
            s = deck.slides[i]
            text = text[:s.start] + frag + text[s.end:]
            where = i + 1
        else:
            after = args["after"]
            if after in (0, "0"):
                i = -1
            else:
                i = deck.slide_index(after, "slide to insert after")
            nl = deck.eol("\n\n")
            if deck.slides:
                ref = deck.slides[max(i, 0)]
                indent = deck.indent_of(ref)
                if i < 0:
                    pos = ref.start
                    c = comment_before(deck.stage, ref)
                    if c:
                        pos = c.start
                    text = text[:pos] + frag + nl + indent + text[pos:]
                else:
                    text = text[:ref.end] + nl + indent + frag + text[ref.end:]
            else:
                pos = deck.stage.close_start
                text = text[:pos] + frag + deck.eol("\n") + text[pos:]
            where = i + 2
        text = fix_active(text)
        return self._done(deck, text, args.get("version"), {"slide": where, "action": "replaced" if has_slide else "inserted"})

    def set_notes(self, args):
        deck = self.folder.read(args.get("path"))
        i = deck.slide_index(args.get("slide"))
        notes = args.get("notes")
        if not isinstance(notes, str):
            raise ToolError('give the notes as text ("" removes them)')
        notes = "\n".join(l.strip() for l in notes.replace("\r\n", "\n").strip().split("\n"))
        body = html_text.escape(notes, quote=False).replace("\n", "<br>")
        s = deck.slides[i]
        node = notes_node(s)
        text = deck.text
        if node:
            if not notes:
                start = node.start
                while start > s.open_end and text[start - 1] in " \t":
                    start -= 1
                end = node.end
                if text[end:end + 2] == "\r\n":
                    end += 2
                elif text[end:end + 1] == "\n":
                    end += 1
                text = text[:start] + text[end:]
            else:
                tag = text[node.start:node.open_end]
                if not re.search(r"\shidden\b", tag, re.I):
                    tag = tag[:-1].rstrip() + " hidden>"
                text = text[:node.start] + tag + body + text[node.close_start:]
        elif notes:
            aside = f'<aside class="notes" hidden>{body}</aside>'
            line = text.rfind("\n", 0, s.close_start) + 1
            lead = text[line:s.close_start]
            if not lead.strip() and line > s.open_end:
                text = text[:s.close_start] + "    " + aside + deck.eol("\n") + lead + text[s.close_start:]
            else:
                text = text[:s.close_start] + aside + text[s.close_start:]
        else:
            return result_json({"ok": True, "path": self.folder.rel(deck.full), "version": deck.version, "unchanged": True})
        return self._done(deck, text, args.get("version"), {"slide": i + 1})

    def _block(self, deck, i):
        """Where slide i starts with what belongs to it (the comment right before it) and the
        blank text before that."""
        s = deck.slides[i]
        start = s.start
        c = comment_before(deck.stage, s)
        if c:
            start = c.start
        ws = start
        while ws > 0 and deck.text[ws - 1] in " \t\r\n":
            ws -= 1
        return ws, start, s.end

    def delete_slide(self, args):
        deck = self.folder.read(args.get("path"))
        i = deck.slide_index(args.get("slide"))
        if len(deck.slides) == 1:
            raise ToolError("this is the deck's only slide; a deck keeps at least one")
        ws, start, end = self._block(deck, i)
        text = fix_active(deck.text[:ws] + deck.text[end:])
        return self._done(deck, text, args.get("version"), {"deleted": i + 1})

    def move_slide(self, args):
        deck = self.folder.read(args.get("path"))
        i = deck.slide_index(args.get("slide"))
        to = args.get("to")
        if isinstance(to, str) and to.strip().isdigit():
            to = int(to)
        if not isinstance(to, int) or isinstance(to, bool) or not 1 <= to <= len(deck.slides):
            raise ToolError(f'"to" is the slide\'s new position, 1 to {len(deck.slides)}')
        if to == i + 1:
            return result_json({"ok": True, "path": self.folder.rel(deck.full), "version": deck.version, "unchanged": True})
        ws, start, end = self._block(deck, i)
        lead, block = deck.text[ws:start], deck.text[start:end]
        rest = Deck(deck.full, (deck.text[:ws] + deck.text[end:]).encode("utf-8"))
        text = rest.text
        if to == 1:
            first_ws, first_start, _ = self._block(rest, 0)
            text = text[:first_start] + block + (lead or deck.eol("\n\n")) + text[first_start:]
        else:
            ref = rest.slides[to - 2]
            text = text[:ref.end] + (lead or deck.eol("\n\n")) + block + text[ref.end:]
        text = fix_active(text)
        return self._done(deck, text, args.get("version"), {"moved": {"from": i + 1, "to": to}})

    def create_deck(self, args):
        rel = args.get("path")
        full = self.folder.resolve(rel)
        if full == self.folder.root:
            raise ToolError("give the new deck a name, e.g. talk/index.html")
        if not full.lower().endswith(".html"):
            full = os.path.join(full, "index.html") if not os.path.splitext(full)[1] else full + ".html"
            full = self.folder.resolve(full)
        if os.path.exists(full):
            raise ToolError(f"{self.folder.rel(full)} already exists")
        slug = (args.get("template") or "blank").strip()
        known = {t["slug"] for t in templates()}
        if slug not in known:
            raise ToolError(f"unknown template {slug!r}; one of: {', '.join(sorted(known))}")
        src = os.path.join(serve.APP_DIR, "templates", slug + ".html")
        if not os.path.isfile(src):
            raise ToolError(f"the template file is missing: app/templates/{slug}.html")
        with open(src, "rb") as f:
            data = f.read()
        title = (args.get("title") or "").strip()
        if not title:
            stem = os.path.splitext(os.path.basename(full))[0]
            title = re.sub(r"[-_]+", " ", os.path.basename(os.path.dirname(full)) if stem.lower() == "index" else stem).strip()
            title = title[:1].upper() + title[1:]
        if title:
            t = html_text.escape(title[:200], quote=False).encode("utf-8")
            data = serve.TITLE_RE.sub(lambda m: m.group(0)[:m.group(0).index(b">") + 1] + t + b"</title>", data, count=1)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full + ".tmp", "wb") as f:
            f.write(data)
        os.replace(full + ".tmp", full)
        serve.ensure_deck_files(full, data.decode("utf-8", "replace"))
        log(f"created {self.folder.rel(full)} from {slug}")
        deck = Deck(full, data)
        return result_json({"ok": True, "path": self.folder.rel(full), "template": slug, "version": deck.version,
                            "slide_count": len(deck.slides)})

    # -- checking, seeing -----------------------------------------
    def check_deck(self, args):
        deck = self.folder.read(args.get("path"))
        problems = []
        mod = checker()
        if mod:
            try:
                problems = [{"level": l, "message": m} for l, m in mod.check(deck.full)]
            except Exception as e:  # noqa: BLE001
                problems.append({"level": "WARN", "message": f"the deck checker failed: {type(e).__name__}: {e}"})
        else:
            _found, missing = serve.local_refs(deck.text, os.path.dirname(deck.full))
            if missing:
                problems.append({"level": "ERROR", "message": "missing local files: %s" % missing[:12]})
            scan = serve.scan_deck(deck.full, deck.data)
            if scan["own"] and not serve.deck_trusted(deck.full, scan["own"]):
                problems.append({"level": "WARN", "message": f"{len(scan['own'])} script(s) of the deck's own: Diapo pauses them until the user trusts the deck"})
            problems.append({"level": "INFO", "message": "the full checker (skills/diapo-deck/scripts/check-deck.py) is not next to this program; only pictures, scripts and TeX were checked"})
        for i, s in enumerate(deck.slides):
            for n in s.walk():
                if "data-math" in n.attrs:
                    why = tex_problem(n.attrs["data-math"])
                    if why:
                        tex = n.attrs["data-math"].strip()
                        problems.append({"level": "ERROR", "message": f"slide {i + 1}: the equation {tex[:60]!r} will not draw: {why}"})
        order = {"ERROR": 0, "WARN": 1, "INFO": 2}
        problems.sort(key=lambda p: order.get(p["level"], 3))
        counts = {k.lower() + "s": sum(1 for p in problems if p["level"] == k) for k in ("ERROR", "WARN", "INFO")}
        return result_json({"path": self.folder.rel(deck.full), **counts, "problems": problems})

    def render_slide(self, args):
        deck = self.folder.read(args.get("path"))
        i = deck.slide_index(args.get("slide", 1))
        scale = args.get("scale", 0.5)
        if isinstance(scale, bool) or not isinstance(scale, (int, float)) or not 0.1 <= scale <= 1:
            raise ToolError('"scale" is between 0.1 and 1 (1 = the full 1920x1080 stage)')
        png, (w, h), browser = self.folder.render(deck, i, float(scale))
        name = deck.slides[i].attrs.get("data-name", "")
        return [{"type": "image", "data": base64.b64encode(png).decode("ascii"), "mimeType": "image/png"},
                {"type": "text", "text": f"Slide {i + 1} of {len(deck.slides)}" + (f" ({name})" if name else "")
                 + f", {w}x{h} px, drawn by {browser} with every step revealed"
                 + ("" if self.folder.online else "; web fonts and pictures from the internet are not loaded")}]

    # -- import, export -------------------------------------------
    def import_file(self, args):
        src = self.folder.resolve(args.get("source"), "file")
        if not os.path.isfile(src):
            raise ToolError(f"no such file: {args.get('source')}")
        if os.path.splitext(src)[1].lower() not in (".pptx", ".md", ".markdown"):
            raise ToolError("only PowerPoint (.pptx) and Markdown (.md) files can be imported")
        name = args.get("name") or ""
        if name and (not isinstance(name, str) or re.search(r"[/\\:]|\.\.", name)):
            raise ToolError("the name is a plain folder name, without slashes")
        r = serve.Handler.import_into_workspace(None, src, name)     # serve.py's import, into the folder (serve.WORKSPACE)
        full = os.path.join(self.folder.root, r["file"].replace("/", os.sep))
        with open(full, "rb") as f:
            deck = Deck(full, f.read())
        return result_json({"ok": True, "path": r["file"], "version": deck.version, "slide_count": len(deck.slides),
                            "notes": r.get("notes", [])})

    def export_pdf(self, args):
        deck = self.folder.read(args.get("path"))
        if not serve.find_chrome():
            raise ToolError("no Chrome or Edge found on this computer: open the deck in Diapo and use File > Export > PDF (the print dialog)")
        stem = os.path.splitext(os.path.basename(deck.full))[0]
        if stem.lower() == "index":
            stem = os.path.basename(os.path.dirname(deck.full)) or stem
        try:
            name = serve.bare_name(args.get("to") or stem, ".pdf")
        except ValueError as e:
            raise ToolError(f"not a file name for the PDF: {e}")
        if not name.lower().endswith(".pdf"):
            name += ".pdf"
        out = self.folder.resolve(os.path.join(os.path.dirname(deck.full), name))
        html_bytes, pages, size = printable_html(deck)
        nbytes, browser = serve.print_pdf(html_bytes, deck.full, out, size, extra_args=() if self.folder.online else OFFLINE_ARGS)
        return result_json({"ok": True, "pdf": self.folder.rel(out), "pages": pages, "bytes": nbytes, "browser": browser})


PATH = {"type": "string", "description": "The deck's path inside the folder of decks, as list_decks gives it (e.g. talk/index.html)."}
VERSION = {"type": "string", "description": "The deck's version as read_deck (or the last write) returned it. A write is refused when the file has changed since."}
SLIDE = {"type": ["integer", "string"], "description": "A slide: its number (1 = first), or its id or name as read_deck lists them."}
RO = {"readOnlyHint": True, "openWorldHint": False}


def tool_list():
    tpl = templates()
    tpl_text = "; ".join(f"{t['slug']} ({t.get('style', '')}, {t.get('tone', '')})" for t in tpl)
    return [
        {"name": "list_decks", "title": "List decks",
         "description": "The Diapo decks in the folder of decks (an .html file with a .deck-stage), with title, path, slide count, size and last modified time. Start here.",
         "inputSchema": {"type": "object", "properties": {"folder": {"type": "string", "description": "Only this sub-folder (optional)."}}},
         "annotations": RO},
        {"name": "read_deck", "title": "Read a deck",
         "description": "One deck as an outline: every slide in order with its number, name, id, section, layout classes, text (headings, paragraphs, list items, tables as rows, inline equations as \\( TeX \\)), speaker notes, pictures (src, alt, missing), charts, equations, chemical structures and Plotly figures, and the element ids inside. Also the deck's version, which every write needs. Ask for slide_html to get one slide's exact HTML before rewriting it, and include_css to see the classes the deck's styles define.",
         "inputSchema": {"type": "object", "required": ["path"], "properties": {
             "path": PATH,
             "slide_html": {**SLIDE, "description": "Also return this slide's HTML exactly as it is in the file (optional)."},
             "include_css": {"type": "boolean", "description": "Also return the deck's <style> blocks (optional, can be long)."}}},
         "annotations": RO},
        {"name": "write_slide", "title": "Write a slide",
         "description": "Replace one slide's HTML (give slide), or insert a new slide (give after: the slide it follows, 0 to put it first). The HTML is one whole slide element, <section class=\"slide ...\" data-name=\"...\"> ... </section>, laid out in px on the deck's stage (1920x1080 unless read_deck says otherwise) with the deck's own classes; speaker notes go in <aside class=\"notes\" hidden> inside it. Read the deck first and copy the markup of a similar slide. The rest of the file (head, styles, scripts, other slides) is left as it is; the previous file is kept as a backup. Scripts you add stay paused until the user trusts the deck in Diapo.",
         "inputSchema": {"type": "object", "required": ["path", "version", "html"], "properties": {
             "path": PATH, "version": VERSION,
             "html": {"type": "string", "description": "The slide element's HTML."},
             "slide": {**SLIDE, "description": "The slide to replace."},
             "after": {**SLIDE, "description": "Insert a new slide after this one (0 = before the first slide)."}}},
         "annotations": {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": False}},
        {"name": "set_notes", "title": "Set speaker notes",
         "description": "Set a slide's speaker notes (plain text; line breaks are kept). An empty text removes them. The presenter view shows them.",
         "inputSchema": {"type": "object", "required": ["path", "version", "slide", "notes"], "properties": {
             "path": PATH, "version": VERSION, "slide": SLIDE, "notes": {"type": "string"}}},
         "annotations": {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": True, "openWorldHint": False}},
        {"name": "delete_slide", "title": "Delete a slide",
         "description": "Remove a slide from the deck (the previous file is kept as a backup in .deck-editor/).",
         "inputSchema": {"type": "object", "required": ["path", "version", "slide"], "properties": {"path": PATH, "version": VERSION, "slide": SLIDE}},
         "annotations": {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": False}},
        {"name": "move_slide", "title": "Move a slide",
         "description": "Move a slide to another position; \"to\" is its new number (1 = first).",
         "inputSchema": {"type": "object", "required": ["path", "version", "slide", "to"], "properties": {
             "path": PATH, "version": VERSION, "slide": SLIDE, "to": {"type": "integer", "minimum": 1}}},
         "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": False}},
        {"name": "create_deck", "title": "Create a deck",
         "description": "A new deck from one of Diapo's templates, titled after its name unless a title is given. Templates: " + tpl_text + ". Then read_deck it and write its slides.",
         "inputSchema": {"type": "object", "required": ["path"], "properties": {
             "path": {"type": "string", "description": "Where, inside the folder: talk/index.html (the usual form: a folder per deck) or talk.html. A path without .html becomes <path>/index.html."},
             "template": {"type": "string", "enum": [t["slug"] for t in tpl], "description": "The design (default blank)."},
             "title": {"type": "string", "description": "The deck's title (optional)."}}},
         "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": False}},
        {"name": "check_deck", "title": "Check a deck",
         "description": "The problems of a deck, as ERROR (the editor or the deck will get it wrong), WARN and INFO: missing pictures and files, scripts Diapo pauses until the user trusts the deck, structure the editor needs, TeX of equations that will not draw. Run it after writing.",
         "inputSchema": {"type": "object", "required": ["path"], "properties": {"path": PATH}},
         "annotations": RO},
        {"name": "render_slide", "title": "Render a slide",
         "description": "A PNG picture of one slide as it presents, with every step (fragment) revealed, drawn by the Chrome or Edge of this computer. Use it to see what you wrote. The deck's own scripts run only if the user trusts the deck; web fonts and pictures from the internet are not loaded unless Diapo's MCP program was started with --online.",
         "inputSchema": {"type": "object", "required": ["path"], "properties": {
             "path": PATH, "slide": {**SLIDE, "description": "The slide (default 1)."},
             "scale": {"type": "number", "minimum": 0.1, "maximum": 1, "description": "Size of the picture against the stage: 1 = 1920x1080, default 0.5."}}},
         "annotations": RO},
        {"name": "import_file", "title": "Import a PowerPoint or Markdown file",
         "description": "Make a new deck from a .pptx or .md file that is in the folder of decks: <name>/index.html, pictures copied into its assets/. Returns the new deck's path and what the import could not carry over.",
         "inputSchema": {"type": "object", "required": ["source"], "properties": {
             "source": {"type": "string", "description": "The .pptx or .md file, as a path inside the folder of decks."},
             "name": {"type": "string", "description": "The new deck's folder name (default: the file's name)."}}},
         "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": False}},
        {"name": "export_pdf", "title": "Export a PDF",
         "description": "Print the deck to a PDF next to it, one page per slide at the stage's size (skipped slides left out, every step revealed, charts as their picture), as Diapo's File > Export > PDF does, with the Chrome or Edge of this computer.",
         "inputSchema": {"type": "object", "required": ["path"], "properties": {
             "path": PATH, "to": {"type": "string", "description": "The PDF's file name, in the deck's folder (default: the deck's name)."}}},
         "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}},
    ]


INSTRUCTIONS = """Diapo decks are single .html files on a fixed stage (1920x1080 px unless read_deck says otherwise): \
<main class="deck-stage"> holds one <section class="slide"> per slide. Work like this: list_decks, read_deck (keep its \
version), read one similar slide with slide_html, write_slide / set_notes / move_slide / delete_slide passing the \
version (each write returns the next one), then check_deck and render_slide to see the result. Keep the deck's own \
classes and absolute px positions; do not add slides by other means. Scripts you add stay paused until the user \
trusts the deck in Diapo. If a write is refused because the deck changed, read it again: the user may be editing it."""


# ------------------------------------------------------------------
# MCP: JSON-RPC 2.0 over stdio, one message per line
# ------------------------------------------------------------------
PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR = -32700, -32600, -32601, -32602, -32603


class McpServer:
    """The protocol, apart from the transport: handle(message) -> reply or None."""

    def __init__(self, tools, version):
        self.tools = tools
        self.version = version
        self.protocol = PROTOCOL_VERSIONS[0]
        self.initialized = False

    @staticmethod
    def error(id_, code, message):
        return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}

    def handle(self, msg):
        if isinstance(msg, list):                         # a batch (2025-03-26 allowed them)
            replies = [r for r in (self.handle(m) for m in msg) if r is not None]
            return replies or None
        if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
            return self.error(msg.get("id") if isinstance(msg, dict) else None, INVALID_REQUEST, "not a JSON-RPC 2.0 message")
        method = msg.get("method")
        if method is None:
            return None                                    # a reply to something we never ask
        is_request = "id" in msg
        params = msg.get("params") or {}
        if not isinstance(params, dict):
            return self.error(msg.get("id"), INVALID_PARAMS, "params must be an object") if is_request else None
        if not is_request:
            if method == "notifications/initialized":
                self.initialized = True
            return None                                    # notifications/cancelled and the rest: nothing to do
        id_ = msg["id"]
        try:
            if method == "initialize":
                asked = params.get("protocolVersion")
                self.protocol = asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0]
                result = {"protocolVersion": self.protocol,
                          "capabilities": {"tools": {"listChanged": False}},
                          "serverInfo": {"name": SERVER_NAME, "title": "Diapo", "version": self.version},
                          "instructions": INSTRUCTIONS}
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": tool_list()}
            elif method == "tools/call":
                result = self.call(params)
            elif method in ("resources/list", "prompts/list", "resources/templates/list"):
                result = {"resources/list": {"resources": []}, "prompts/list": {"prompts": []},
                          "resources/templates/list": {"resourceTemplates": []}}[method]
            elif method == "logging/setLevel":
                result = {}
            else:
                return self.error(id_, METHOD_NOT_FOUND, f"unknown method: {method}")
        except InvalidParams as e:
            return self.error(id_, INVALID_PARAMS, str(e))
        except Exception as e:  # noqa: BLE001
            log(traceback.format_exc())
            return self.error(id_, INTERNAL_ERROR, f"{type(e).__name__}: {e}")
        return {"jsonrpc": "2.0", "id": id_, "result": result}

    def call(self, params):
        name = params.get("name")
        args = params.get("arguments") or {}
        names = {t["name"] for t in tool_list()}
        if name not in names:
            raise InvalidParams(f"unknown tool: {name}")
        if not isinstance(args, dict):
            raise InvalidParams("arguments must be an object")
        try:
            content = getattr(self.tools, name)(args)
            return {"content": content, "isError": False}
        except ToolError as e:
            return {"content": [{"type": "text", "text": str(e)}], "isError": True}
        except PermissionError as e:
            return {"content": [{"type": "text", "text": f"refused: {e}"}], "isError": True}
        except OSError as e:
            return {"content": [{"type": "text", "text": f"{type(e).__name__}: {e}"}], "isError": True}
        except Exception as e:  # noqa: BLE001 - a tool that fails says so to the agent
            log(traceback.format_exc())
            return {"content": [{"type": "text", "text": f"{name} failed: {type(e).__name__}: {e}"}], "isError": True}


class InvalidParams(Exception):
    pass


def send(obj):
    PROTOCOL_OUT.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n")
    PROTOCOL_OUT.flush()


def serve_stdio(server):
    stdin = sys.stdin.buffer if hasattr(sys.stdin, "buffer") else sys.stdin
    for raw in stdin:
        line = raw.decode("utf-8", "replace").strip() if isinstance(raw, bytes) else raw.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            send(McpServer.error(None, PARSE_ERROR, "not valid JSON"))
            continue
        reply = server.handle(msg)
        if reply is not None:
            send(reply)


def main(argv):
    if "-h" in argv or "--help" in argv:
        print(__doc__, file=sys.stderr)
        return 0
    settings_file = os.path.abspath(option(argv, "--settings") or os.path.join(os.path.expanduser("~"), ".deck-editor.json"))
    settings = read_settings(settings_file)
    folder = option(argv, "--folder") or settings.get("workspace")
    if not folder:
        log("no folder of decks: start with --folder <path> (Diapo's settings name no last folder)")
        return 2
    if not os.path.isdir(folder):
        log(f"no such folder: {folder}")
        return 2
    global serve
    serve = load_serve(folder, settings)
    root = Folder(folder, online="--online" in argv)
    log(f"Diapo MCP server {serve.APP_VERSION}, folder {root.root}" + (" (online)" if root.online else ""))
    try:
        serve_stdio(McpServer(Tools(root), serve.APP_VERSION))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
