#!/usr/bin/env python3
"""Check a deck against the deck editor's file contract. Standard library only.

Usage:
  py -3 check-deck.py <deck.html> [--json]

Prints ERROR / WARN / INFO lines and exits 1 when there is at least one error.
Errors are things the editor or the deck itself will get wrong; warnings are
things that work but degrade the experience; info is worth a sentence to the
user. This is a static check: run the browser checks of editor-integration.md too.
"""
import base64
import hashlib
import json
import os
import re
import sys
from html.parser import HTMLParser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import deckeditor  # noqa: E402

REQUIRED_BASE = [
    (".slide.active, .slide.visible", r"\.slide\.active\s*,\s*\.slide\.visible\s*\{[^}]*visibility:\s*visible"),
    ("stage transform-origin", r"\.deck-stage\s*\{[^}]*transform-origin:\s*0 0"),
    ("print one slide per page", r"@media print\s*\{[\s\S]*?\.slide\s*\{[^}]*break-after:\s*page"),
    ("reduced motion", r"prefers-reduced-motion"),
]
RUNTIME_KEYS = "'p', 'o', 'l', 'd', 'e', 'c', 'P', 'O', 'L', 'D', 'E', 'C'".replace(" ", "").split(",")
# A comment before a slide that only names it is not speaker notes (same test as the runtime's).
SLIDE_LABEL = re.compile(r"^slides?\s*\d+(\s*[-–—]\s*\d+)?\b", re.I)
CHART_KINDS = ("column", "bar", "line", "area", "pie", "doughnut")


def _read(path):
    try:
        with open(path, encoding="utf-8", newline="") as f:
            return f.read().replace("\r\n", "\n")
    except OSError:
        return None


def _hash(text):
    return base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode("ascii")


def diapo_scripts():
    """Hashes (of the text without the whitespace round it) of the scripts Diapo runs in a deck
    without asking: the controller and runtime of this skill and of the editor, the inline
    scripts of the editor's templates, and past editions (app/known-scripts.json). The same
    test as the editor's server; a script not in here is paused until the user trusts the deck."""
    skill = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    texts = [_read(os.path.join(skill, "deck-controller.js")), _read(os.path.join(skill, "deck-runtime.js"))]
    known = set()
    home = deckeditor.find_editor()
    if home:
        texts.append(_read(os.path.join(home, "app", "deck-runtime.js")))
        tdir = os.path.join(home, "app", "templates")
        for name in sorted(os.listdir(tdir)) if os.path.isdir(tdir) else []:
            if name.endswith(".html"):
                page = _read(os.path.join(tdir, name)) or ""
                texts += [m.group(2) for m in re.finditer(r"<script\b([^>]*)>(.*?)</script>", page, re.S)
                          if "src=" not in m.group(1) and "json" not in m.group(1)]
        try:
            with open(os.path.join(home, "app", "known-scripts.json"), encoding="utf-8") as f:
                known.update(json.load(f).get("trimmed", []))
        except (OSError, ValueError):
            pass
    return known | {_hash(t.strip()) for t in texts if t}


def current_runtime_version():
    m = re.search(r"version:\s*(\d+)\s*\}", _read(deckeditor.runtime_path()) or "")
    return int(m.group(1)) if m else None


class Deck(HTMLParser):
    """Collects what the checks need: the tree of stage/slides, ids, assets, scripts, styles."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []            # (tag, attrs) for open elements
        self.viewport = self.stage = 0
        self.stage_children = []   # (tag, attrs) direct children of .deck-stage
        self.slides = []           # dicts: attrs, notes, comments_before, text, hosts
        self.ids = {}
        self.assets = []           # (attr, value)
        self.scripts = []          # (attrs, text)
        self.styles = []           # text
        self.links = []            # attrs
        self.title = ""
        self.charset = False
        self._buf = None           # collecting script/style text
        self._buf_attrs = None
        self.last_comment = ""
        self.contenteditable = 0
        self.host_content = []     # (kind, name, snippet) content inside data-fig/data-svg/data-generated
        self._host = None          # (kind, name, depth, content list)
        self.notes_asides = []     # (has_hidden, slide index)
        self.aside_depth = None
        self.deck_stage_tag = None

    # --- helpers
    def _cls(self, attrs):
        return (dict(attrs).get("class") or "").split()

    def _in_stage(self):
        return any(s[2] == "stage" for s in self.stack)

    def _slide_index(self):
        return len(self.slides) - 1

    # --- parser callbacks
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = self._cls(attrs)
        if tag in ("script", "style"):
            self._buf, self._buf_attrs = [], a
        if tag == "meta" and (a.get("charset") or "utf-8" in (a.get("content") or "").lower()):
            self.charset = True
        if tag == "link":
            self.links.append(a)
        if a.get("id"):
            self.ids[a["id"]] = self.ids.get(a["id"], 0) + 1
        for k in ("src", "data-svg", "poster"):
            if a.get(k) and tag != "a":
                self.assets.append((k, a[k]))
        if tag == "link" and a.get("rel") == "stylesheet" and a.get("href"):
            self.assets.append(("href", a["href"]))
        if "contenteditable" in a:
            self.contenteditable += 1
        if "deck-viewport" in cls:
            self.viewport += 1
        if "deck-stage" in cls:
            self.stage += 1
            self.deck_stage_tag = (tag, a)
            self.stack.append((tag, a, "stage"))
            return
        if self._in_stage() and self.stack and self.stack[-1][2] == "stage":
            self.stage_children.append((tag, a))
            if "slide" in cls:
                self.slides.append({"attrs": a, "comment_before": self.last_comment, "text": [], "notes": 0, "tag": tag})
                self.stack.append((tag, a, "slide"))
                self.last_comment = ""
                return
        if self._in_stage() and any(k in a for k in ("data-fig", "data-svg", "data-generated")) and self._host is None:
            kind = "data-fig" if "data-fig" in a else "data-svg" if "data-svg" in a else "data-generated"
            self._host = (kind, a.get(kind, ""), len(self.stack), [])
        elif self._host is not None:
            self._host[3].append("<%s>" % tag)
        if tag == "aside" and "notes" in cls and self.slides and any(s[2] == "slide" for s in self.stack):
            self.notes_asides.append(("hidden" in a, self._slide_index()))
            self.slides[-1]["notes"] += 1
        self.stack.append((tag, a, ""))
        if tag in ("br", "img", "meta", "link", "input", "hr", "source", "track", "wbr"):
            self.handle_endtag(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in ("br", "img", "meta", "link", "input", "hr", "source", "track", "wbr"):
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._buf is not None:
            text = "".join(self._buf)
            (self.scripts if tag == "script" else self.styles).append((self._buf_attrs, text) if tag == "script" else text)
            self._buf = None
        # pop to the matching open tag
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                if self._host is not None and i == self._host[2]:
                    kind, name, _, content = self._host
                    snippet = "".join(content).strip()
                    if kind == "data-svg":
                        snippet = re.sub(r"<img>", "", snippet).strip()
                    if snippet:
                        self.host_content.append((kind, name, snippet[:60]))
                    self._host = None
                del self.stack[i:]
                break

    def handle_data(self, data):
        if self._buf is not None:
            self._buf.append(data)
            return
        if self.stack and self.stack[-1][0] == "title":
            self.title += data
        if self.slides and any(s[2] == "slide" for s in self.stack) and data.strip():
            self.slides[-1]["text"].append(data.strip())
        if self._host is not None and data.strip():
            self._host[3].append(data.strip())

    def handle_comment(self, data):
        # Only a comment that is a direct child of the stage can precede a slide.
        if self.stack and self.stack[-1][2] == "stage":
            self.last_comment = data.strip()


def check(path):
    out = []
    err = lambda m: out.append(("ERROR", m))
    warn = lambda m: out.append(("WARN", m))
    info = lambda m: out.append(("INFO", m))

    with open(path, "rb") as f:
        raw = f.read()
    try:
        html = raw.decode("utf-8")
    except UnicodeDecodeError:
        err("file is not UTF-8")
        html = raw.decode("utf-8", errors="replace")
    if "�" in html[:5]:
        html = html.lstrip("﻿")
    deck_dir = os.path.dirname(os.path.abspath(path))

    p = Deck()
    p.feed(html)
    css = "\n".join(p.styles)
    scripts_text = "\n".join(t for _, t in p.scripts)

    # --- structure
    if not re.match(r"\s*<!DOCTYPE html>", html, re.I):
        warn("no <!DOCTYPE html> first line")
    if not p.charset:
        err("no <meta charset=\"UTF-8\">")
    if not p.title.strip():
        warn("empty <title>")
    if not p.viewport:
        err("no .deck-viewport wrapper")
    if not p.deck_stage_tag:
        err("no .deck-stage element (the editor refuses to open or save a file without it)")
    else:
        tag, a = p.deck_stage_tag
        if tag != "main":
            info(".deck-stage is a <%s>; the template uses <main>" % tag)
        if a.get("id") != "deckStage":
            err(".deck-stage must have id=\"deckStage\" (the controller looks it up)")
    if not p.slides:
        err("no .slide sections inside .deck-stage")
    else:
        actives = [i for i, s in enumerate(p.slides) if "active" in (s["attrs"].get("class") or "").split()]
        visibles = [i for i, s in enumerate(p.slides) if "visible" in (s["attrs"].get("class") or "").split()]
        if not actives:
            warn("no slide carries class \"active\" in the file (the controller adds it at load; the editor writes it on the first slide)")
        elif actives != [0]:
            err("only the first slide may carry class \"active\" in the file (found on slides %s)" % [i + 1 for i in actives])
        if visibles:
            warn("class \"visible\" in the file on slides %s; the controller adds it at runtime" % [i + 1 for i in visibles])
        non_section = [i + 1 for i, s in enumerate(p.slides) if s["tag"] != "section"]
        if non_section:
            info("slides %s are not <section> elements" % non_section)
        no_name = [i + 1 for i, s in enumerate(p.slides) if not s["attrs"].get("data-name")]
        if len(no_name) > len(p.slides) // 2:
            info("%d of %d slides have no data-name (labels in the slide strip and presenter)" % (len(no_name), len(p.slides)))
        # legacy comment notes
        for i, s in enumerate(p.slides):
            c = s["comment_before"]
            if c:
                lines = [re.sub(r"^[\s=\-*#]+|[\s=\-*#]+$", "", l) for l in c.splitlines()]
                lines = [l for l in lines if l]
                if lines and not SLIDE_LABEL.match("\n".join(lines)):
                    info("slide %d: the HTML comment before it is read as speaker notes (supported; the editor writes <aside class=\"notes\" hidden>)" % (i + 1))
            if s["notes"] > 1:
                warn("slide %d has %d notes asides; the presenter shows the first" % (i + 1, s["notes"]))
        empty = [i + 1 for i, s in enumerate(p.slides) if not s["text"]]
        if empty:
            info("slides without any text: %s" % empty)
    for hidden, idx in p.notes_asides:
        if not hidden:
            info("slide %d: <aside class=\"notes\"> without the hidden attribute (the base CSS hides it; the editor writes the hidden form)" % (idx + 1))

    # --- master layer
    master = [(t, a) for t, a in p.stage_children if "slide" not in (a.get("class") or "").split() and t not in ("script", "style", "template")]
    if master:
        if not re.search(r"data-page-now", html):
            info("master layer present (%s) without a page counter (data-page-now / data-page-total)" % ", ".join("<%s class=\"%s\">" % (t, a.get("class", "")) for t, a in master[:3]))
    else:
        info("no master layer (footer / page number shown on every slide)")

    # --- CSS
    for name, rx in REQUIRED_BASE:
        if not re.search(rx, css):
            err("base CSS missing: %s (paste deck-base.css in full)" % name)
    # display:none inside a rule that targets .slide (not .slide .x)
    for m in re.finditer(r"([^{}]+)\{([^}]*)\}", css):
        sel, body = m.group(1).strip(), m.group(2)
        if "display" in body and re.search(r"display\s*:\s*none", body):
            parts = [s.strip() for s in sel.split(",")]
            if any(re.fullmatch(r"(\.[\w-]+)*\.slide(\.[\w-]+)*(:[\w-]+(\([^)]*\))?)*", s) for s in parts):
                err("display:none on slides (%s); slides are hidden with visibility/opacity only" % sel[:60])
    if re.search(r"\.reveal\b", html) and not re.search(r"\.slide\.visible[^{]*\.reveal[^{]*\{[^}]*var\(--dx", css):
        err(".reveal is used but the .slide.visible .reveal rule does not end in translate(var(--dx, 0px), var(--dy, 0px))")
    if re.search(r"\.reveal[^{]*:nth-child\(\d+\)\s*\{[^}]*transition-delay", css):
        warn("stagger with :nth-child delays; use style=\"--i:n\" so the editor can show and edit the order")
    if re.search(r"\bscroll-snap", css):
        err("scroll-snap in the CSS: slides do not scroll")
    for unit in ("vw", "vh", "clamp("):
        n = len(re.findall(r"(?<![\w-])\d*\.?\d+%s\b" % re.escape(unit) if unit != "clamp(" else r"clamp\(", css))
        if n:
            warn("%d uses of %s in the CSS; stage content is authored in px at 1920x1080 (fine outside the stage)" % (n, unit.rstrip("(")))
    if re.search(r"-\s*(clamp|min|max)\(", css):
        err("negated CSS function (-clamp( / -min( ); browsers ignore the declaration, use calc(-1 * ...)")
    imp = len(re.findall(r"!important", css))
    if imp > 12:
        info("%d !important declarations; keep them off properties the user edits in the editor" % imp)
    sizes = set(re.findall(r"\.deck-stage[^{]*\{[^}]*?width:\s*(\d+)px;?[^}]*?height:\s*(\d+)px", css))
    if sizes and len(sizes) > 1:
        info("stage sizes in the CSS: %s (the last rule wins; the editor reads the laid-out size)" % sorted(sizes))
    elif sizes and sizes != {("1920", "1080")}:
        info("stage size %sx%s (not 16:9 1920x1080)" % next(iter(sizes)))

    # --- theme variables
    root = re.search(r":root\s*\{([^}]*)\}", css)
    if not root:
        warn("no :root block; the editor's Theme panel and swatches read custom properties there")
    else:
        props = dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", root.group(1)))
        colours = [k for k, v in props.items() if re.match(r"^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()", v.strip(), re.I)]
        fonts = [k for k, v in props.items() if "font" in k and re.search(r"[a-z]", v, re.I) and not v.strip().startswith(("var(", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"))]
        if len(colours) < 3:
            warn("only %d literal colour variables on :root (aliases like var(--x) are not offered as swatches)" % len(colours))
        if not fonts:
            warn("no --font* variable on :root; the editor's font tools and inserted elements read it")
        elif "--font" not in props:
            info("no --font variable (the body font); the editor's new elements fall back to the computed font")
        if not any(re.search(r"accent|primary|brand", k) for k in colours):
            info("no accent-like colour variable (--accent, --primary, --brand); the editor's new-slide layouts fall back to blue")
        if "--slide-bg" not in props and "--stage-bg" not in props:
            info("no --slide-bg / --stage-bg; deck-base.css defaults to white slides on a black letterbox")

    # --- fonts
    google = [l for l in p.links if "fonts.googleapis.com" in (l.get("href") or "") and l.get("rel") == "stylesheet"]
    fontshare = [l for l in p.links if "fontshare" in (l.get("href") or "")]
    if not google and not re.search(r"fonts\.googleapis\.com", css) and not fontshare and "@font-face" not in css:
        warn("no web font (Google Fonts <link>, @import or @font-face); system fonts read as generic")
    if fontshare:
        info("Fontshare fonts: they work in the deck, but the editor cannot download or embed them (Google Fonts only)")
    if len(google) > 1:
        info("%d Google Fonts links; one link with every family is easier for the editor to manage" % len(google))

    # --- scripts
    runtime = [a for a, t in p.scripts if a.get("id") == "deck-runtime"]
    if not runtime:
        warn("no <script id=\"deck-runtime\">: no presenter (P), overview (O), fragments, transitions in the deck alone (the editor can add it: Presenter > Add presentation features)")
    else:
        rt = next(t for a, t in p.scripts if a.get("id") == "deck-runtime")
        v = re.search(r"version:\s*(\d+)", rt)
        if not v:
            warn("runtime script has no version marker; the editor will offer to replace it")
        elif current_runtime_version() and int(v.group(1)) < current_runtime_version():
            warn("runtime version %s, current is %d: paste the file `deckeditor.py runtime` names (the editor offers the update, and makes it on save)"
                 % (v.group(1), current_runtime_version()))
        if p.scripts[-1][0].get("id") != "deck-runtime":
            info("the runtime is not the last script in the body")
    if not re.search(r"deck:slide", scripts_text):
        err("the controller never dispatches deck:slide (paste deck-controller.js verbatim)")
    if not re.search(r"location\.hash", scripts_text):
        err("the controller does not honour #n in the URL (paste deck-controller.js verbatim)")
    if not re.search(r"--ed-panel", scripts_text):
        warn("the controller ignores --ed-panel (the editor's host CSS covers scaling, but the template's controller reads it)")
    if not re.search(r"deck:rescale", scripts_text):
        info("the controller does not listen for deck:rescale")
    if re.search(r"offsetWidth\s*\|\|\s*1920|stage\.offsetWidth", scripts_text) is None and re.search(r"/\s*1920", scripts_text):
        info("the controller assumes 1920x1080 (the template reads the stage's size, so Theme > Slide size works)")
    for a, t in p.scripts:
        if a.get("src", "").endswith("editor.js"):
            err("in-deck editor script (%s): the deck editor replaces it; remove" % a["src"])
        if a.get("id") != "deck-runtime" and re.search(r"</(body|script)>", t):
            warn("a script contains the literal </body> or </script>; the editor copes, but split the string ('<' + '/body>') to be safe")
    if p.contenteditable:
        err("%d contenteditable attributes in the file; the editor manages text editing" % p.contenteditable)
    if re.search(r"edit-hotzone|editToggle|toggleEditMode", html):
        err("in-deck inline-editing UI found (edit-hotzone / editToggle); remove it, the deck editor is the editor")
    if re.search(r"localStorage\.(setItem|getItem)", scripts_text):
        warn("localStorage used by a deck script; drafts and edits are the editor's job")
    for m in re.finditer(r"e(?:vent)?\.key\s*===?\s*'([A-Za-z])'", scripts_text):
        k = m.group(1)
        if k.lower() in "polde" and not re.search(r"deck-runtime", "".join(a.get("id", "") for a, t in p.scripts if m.group(0) in t)):
            warn("a deck script handles the '%s' key; P, O, L, D belong to the runtime, E to the old in-deck editor" % k)
    # only the runtime should handle these keys
    for a, t in p.scripts:
        if a.get("id") == "deck-runtime":
            continue
        for k in re.findall(r"case\s*'([A-Za-z])'", t):
            if k.lower() in "pold":
                warn("a deck script handles the '%s' key; P, O, L, D belong to the runtime" % k)
    # scripts Diapo pauses until the user trusts the deck
    known = diapo_scripts()
    own, paused_nav = [], False
    for a, t in p.scripts:
        kind = (a.get("type") or "").strip().lower()
        if kind not in ("", "module") and not any(k in kind for k in ("javascript", "ecmascript")):
            continue                                  # a data block (the charts' JSON): never runs
        if a.get("src"):
            own.append(a["src"])
        elif t.strip() and _hash(t.replace("\r\n", "\n").strip()) not in known:
            own.append("the runtime" if a.get("id") == "deck-runtime" else "an inline script")
            paused_nav = paused_nav or "deck:slide" in t
    if paused_nav:
        err("the controller is not Diapo's text (edited or re-indented): Diapo pauses it until the deck is trusted, "
            "so the deck neither scales nor navigates; paste deck-controller.js unchanged")
    if own:
        warn("%d script(s) of the deck's own (%s): Diapo pauses them until the user trusts the deck, and asks with a bar"
             % (len(own), ", ".join(sorted(set(own))[:4])))
    bare = re.sub(r"<(script|style)\b.*?</\1>", "", html, flags=re.S | re.I)
    handlers = sorted(set(re.findall(r"<[a-z][^>]*?\s(on[a-z]+)\s*=", bare, re.I)))
    if handlers:
        warn("inline event handlers (%s): paused until the deck is trusted; use the runtime's data-href or CSS" % ", ".join(handlers[:5]))
    if re.search(r"""href\s*=\s*["']?\s*javascript:""", bare, re.I):
        warn("javascript: links: paused until the deck is trusted")

    # the editor's charts
    for m in re.finditer(r"<figure\b([^>]*\bdata-chart\b[^>]*)>(.*?)</figure>", html, re.S | re.I):
        kind = re.search(r"""data-chart\s*=\s*["']([^"']*)""", m.group(1))
        kind = kind.group(1) if kind else ""
        data = re.search(r"<script\b[^>]*data-chart-data[^>]*>(.*?)</script>", m.group(2), re.S)
        if kind not in CHART_KINDS:
            err("chart figure with data-chart=\"%s\"; one of %s" % (kind, ", ".join(CHART_KINDS)))
        if not data:
            err("chart figure without <script type=\"application/json\" data-chart-data> (the editor draws from that table)")
            continue
        try:
            spec = json.loads(data.group(1))
            if not isinstance(spec.get("labels"), list) or not isinstance(spec.get("series"), list) or not spec["series"]:
                err("chart %s: the table needs \"labels\" and a non-empty \"series\" list" % kind)
        except (ValueError, AttributeError) as e:
            err("chart %s: its JSON table does not parse (%s)" % (kind, e))
            continue
        if not re.search(r"<svg\b", m.group(2), re.I):
            warn("chart %s has its table but no drawing yet: open the deck in the editor and save (Ctrl+S), "
                 "or it shows empty outside the editor" % kind)

    # the editor's equations and structures: the source in the attribute, the drawing made by the editor
    for m in re.finditer(r"<figure\b([^>]*\bdata-(math|chem)\b[^>]*)>(.*?)</figure>", html, re.S | re.I):
        what = "equation" if m.group(2).lower() == "math" else "structure"
        src = re.search(r"""\bdata-%s\s*=\s*(["'])(.*?)\1""" % m.group(2), m.group(1), re.S)
        if not src or not src.group(2).strip():
            err("%s figure without its source (data-%s=\"...\")" % (what, m.group(2)))
            continue
        if what == "structure" and not re.search(r"""\bheight\s*:""", m.group(1)):
            warn("structure %s has no height in its style: give the figure a box (width and height in stage px)" % src.group(2)[:40])
        if not re.search(r"<svg\b", m.group(3), re.I):
            warn("%s %s has no drawing yet: open the deck in the editor and save (Ctrl+S), "
                 "or it shows empty outside the editor" % (what, src.group(2)[:40]))

    if re.search(r"customElements\.define|<deck-stage", html):
        err("web components / <deck-stage>: shadow DOM is invisible to the editor; use the plain stage")
    if re.search(r"IntersectionObserver", scripts_text):
        info("IntersectionObserver used; slides do not scroll, the .visible class is the trigger")

    # --- generated content
    for kind, name, snippet in p.host_content:
        err("[%s=\"%s\"] host is not empty in the file (%s...); the editor strips generated content on save, so it must be regenerated at load" % (kind, name, snippet))
    if re.search(r"<svg[^>]*class=\"[^\"]*dots", html):
        info("svg.dots present: its content is emptied on save unless a shape was edited")

    # --- editor blocks
    for bid in ("deck-editor-overrides", "deck-editor-fonts"):
        if bid in p.ids:
            info("<style id=\"%s\"> present: this file was edited in the editor; keep the block" % bid)
    if "deck-editor-host" in p.ids or "deck-editor-print" in p.ids:
        err("editor artefacts (deck-editor-host / deck-editor-print) inside the file")
    dup = [k for k, n in p.ids.items() if n > 1]
    if dup:
        warn("duplicate ids: %s" % dup[:8])

    # --- assets
    missing, external = [], 0
    for attr, val in p.assets:
        v = val.strip()
        if not v or v.startswith(("data:", "#", "javascript:")):
            continue
        if re.match(r"^[a-z]+:", v) or v.startswith("//"):
            if "fonts.googleapis.com" not in v and "fonts.gstatic.com" not in v:
                external += 1
            continue
        if re.match(r"^([A-Za-z]:[\\/]|/)", v):
            err("absolute path in %s=\"%s\"; use a path relative to the deck" % (attr, v[:60]))
            continue
        local = os.path.normpath(os.path.join(deck_dir, v.split("?")[0].split("#")[0]))
        if not os.path.exists(local):
            missing.append(v)
    for v in re.findall(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", css):
        v = v.strip()
        if v.startswith(("data:", "http", "//", "#")):
            continue
        local = os.path.normpath(os.path.join(deck_dir, v.split("?")[0]))
        if not os.path.exists(local):
            missing.append(v)
    if missing:
        err("missing local files: %s" % sorted(set(missing))[:12])
    if external:
        info("%d external resources (work online only; the editor's single-file export cannot embed them)" % external)
    if re.search(r"\bsrcset=", html):
        info("srcset used; the editor's single-file export skips it")
    big = [v for _, v in p.assets if not re.match(r"^[a-z]+:", v) and os.path.isfile(os.path.join(deck_dir, v)) and os.path.getsize(os.path.join(deck_dir, v)) > 3_000_000]
    if big:
        info("large assets over 3 MB: %s" % big[:6])
    if "—" in html:
        n = html.count("—")
        info("%d em dashes in the file; the house style uses hyphens" % n)

    return out


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    path = argv[0]
    as_json = "--json" in argv
    if not os.path.isfile(path):
        print("no such file: " + path, file=sys.stderr)
        return 1
    results = check(path)
    order = {"ERROR": 0, "WARN": 1, "INFO": 2}
    results.sort(key=lambda r: order[r[0]])
    if as_json:
        print(json.dumps([{"level": l, "message": m} for l, m in results], indent=1))
    else:
        for level, msg in results:
            print("%-5s %s" % (level, msg))
        n_err = sum(1 for l, _ in results if l == "ERROR")
        n_warn = sum(1 for l, _ in results if l == "WARN")
        print("%s: %d errors, %d warnings" % (os.path.basename(path), n_err, n_warn))
    return 1 if any(l == "ERROR" for l, _ in results) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
