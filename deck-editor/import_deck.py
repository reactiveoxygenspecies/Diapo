"""Import a Markdown file or a PowerPoint file as a deck.

Both importers produce slides in the markup of app/templates/blank.html, so the
result looks like a deck made with "New" and every element is editable. Python
standard library only.

Markdown (Marp / reveal-md style):
    slides are separated by a line of three or more dashes; a YAML front matter
    block at the top is skipped (its title: is used). Inside a slide: # is a
    title (a slide with only a # heading becomes a title / section slide), ##
    and ### are headings, - * + and 1. start lists (indented lines nest one
    level), ``` fences are code blocks, > is a quote, | tables are tables,
    a line that is only an image is a picture (copied into assets/ when it is
    a picture, video or sound in the Markdown file's folder), HTML comments are speaker notes, blank lines separate
    paragraphs. Inline **bold**, *italic*, `code`, [links](url), ~~strike~~.
    A slide with one picture and some text gets two columns.

PowerPoint (.pptx): see pptx_import.py (theme colours and fonts, layout and
    master shapes and backgrounds, the text style inheritance chain, shapes,
    lines, pictures, tables, charts, SmartArt, notes).
"""
import html
import os
import re
import shutil
import xml.etree.ElementTree as ET
import zipfile

import sys
HERE = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(HERE, "app", "templates", "blank.html")

CODE_STYLE = ("margin:0; align-self:stretch; padding:28px 34px; border-radius:14px; background:#1e1f26; color:#e6e6ea; "
              "font:28px/1.5 Consolas, 'SF Mono', Menlo, monospace; white-space:pre-wrap; overflow-wrap:anywhere; tab-size:4;")
TABLE_STYLE = "border-collapse:collapse; font-size:30px; line-height:1.4; align-self:stretch;"
CELL_STYLE = "border:2px solid var(--rule); padding:14px 22px; text-align:left; vertical-align:top;"
HEAD_STYLE = CELL_STYLE + " background:var(--paper-2); font-weight:600;"
QUOTE_STYLE = "margin:0; padding-left:36px; border-left:10px solid var(--accent); font-size:44px; line-height:1.35; font-weight:500;"
IMG_STYLE = "display:block; max-width:100%; max-height:640px; width:auto; height:auto;"
# What a Markdown picture may copy into the deck (serve.py's UPLOAD_EXT: things a slide shows).
MEDIA_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg",
             ".mp4", ".webm", ".mov", ".mp3", ".m4a", ".wav", ".ogg"}


# ------------------------------------------------------------------
# Building the file from the template
# ------------------------------------------------------------------
def esc(s):
    return html.escape(s or "", quote=False)


def attr(s):
    return html.escape(s or "", quote=True)


def slug(s):
    s = re.sub(r"[^\w\s-]", "", s or "").strip().lower()
    return re.sub(r"[\s_-]+", "-", s)[:40] or "slide"


def build_deck(sections, title, size=None, footer=True):
    """The blank template with its example slides replaced by `sections` (HTML strings).
    `size` = (w, h) writes the stage size the way the editor's Theme panel does, so a deck
    that is not 1920x1080 opens at its own size. footer=False drops the template's master
    layer (a PowerPoint deck brings its own footers with its layouts)."""
    with open(TEMPLATE, "r", encoding="utf-8") as f:
        tpl = f.read()
    if size and tuple(size) != (1920, 1080):
        w, h = size
        block = ('<style id="deck-editor-overrides">/* Theme overrides made in the deck editor. Safe to delete: the deck then uses its own styles. */\n'
                 f'/* stage size */\n.deck-stage, .deck-stage .slide {{ width: {w}px; height: {h}px; }}\n'
                 '@media print { .deck-stage { height: auto; } }\n</style>\n')
        tpl = tpl.replace("</head>", block + "</head>", 1)
    start = tpl.index('<main class="deck-stage"')
    start = tpl.index(">", start) + 1
    end = tpl.index("</main>")
    # The template's footer (the master layer every slide shows) stays, after the slides,
    # with the deck's title as its text.
    m = re.search(r'\n<div class="deck-footer">.*?</div>\n', tpl[start:end], re.S)
    footer = m.group(0).replace("<span data-edit>New deck</span>", "<span data-edit>" + esc(title or "Imported deck") + "</span>") if m and footer else ""
    body = "\n\n" + "\n\n".join(sections) + "\n" + footer + "\n"
    out = tpl[:start] + body + tpl[end:]
    out = re.sub(r"<title>.*?</title>", "<title>" + esc(title or "Imported deck") + "</title>", out, count=1)
    out = re.sub(r'<span id="pageTotal">\d+</span>', f'<span id="pageTotal">{len(sections)}</span>', out, count=1)
    out = re.sub(r'<span data-page-total>\d+</span>', f'<span data-page-total>{len(sections)}</span>', out, count=1)
    return out


def section(inner, kind="body", name="", notes="", number=None, style=""):
    cls = "slide title-slide" if kind == "title" else "slide body-slide"
    # the style is our own CSS (it may quote font names and urls with '); only " and & need escaping
    style_attr = html.escape(style or "", quote=False).replace('"', "&quot;")
    parts = [f'<section class="{cls}"' + (f' data-name="{attr(name)}"' if name else "") + (f' style="{style_attr}"' if style else "") + ">"]
    parts.append(inner)
    if notes:
        parts.append(f'    <aside class="notes" hidden>{esc(notes).replace(chr(10), "<br>")}</aside>')
    parts.append("</section>")
    return "\n".join(parts)


def copy_asset(src, deck_dir, notes):
    """Copy a local file into <deck>/assets/ (unique name); returns the relative path or None."""
    if not src or not os.path.isfile(src):
        notes.append("missing file, left as a link: " + os.path.basename(src or ""))
        return None
    assets = os.path.join(deck_dir, "assets")
    os.makedirs(assets, exist_ok=True)
    name = re.sub(r"[^\w.\-]+", "_", os.path.basename(src))
    stem, ext = os.path.splitext(name)
    dest, n = os.path.join(assets, name), 1
    while os.path.exists(dest):
        with open(dest, "rb") as a, open(src, "rb") as b:
            if a.read() == b.read():
                return "assets/" + os.path.basename(dest)
        n += 1
        dest = os.path.join(assets, f"{stem}-{n}{ext}")
    shutil.copyfile(src, dest)
    return "assets/" + os.path.basename(dest)


# ------------------------------------------------------------------
# Markdown
# ------------------------------------------------------------------
INLINE_RULES = [
    (re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)"), "img"),
    (re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)"), "a"),
    (re.compile(r"`([^`]+)`"), "code"),
    (re.compile(r"\*\*(.+?)\*\*"), "b"),
    (re.compile(r"__(.+?)__"), "b"),
    (re.compile(r"~~(.+?)~~"), "s"),
    (re.compile(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])"), "i"),
    (re.compile(r"(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])"), "i"),
]


def inline(text, ctx):
    """Inline Markdown -> HTML. Text is escaped first; markup is added on the escaped text."""
    t = esc(text)

    def img(m):
        src = ctx.resolve(m.group(2))
        return f'<img src="{attr(src)}" alt="{attr(m.group(1))}" style="max-height:1.4em; vertical-align:middle;">'
    t = INLINE_RULES[0][0].sub(img, t)
    t = INLINE_RULES[1][0].sub(lambda m: f'<a href="{attr(m.group(2))}">{m.group(1)}</a>', t)
    t = INLINE_RULES[2][0].sub(lambda m: f"<code>{m.group(1)}</code>", t)
    for rx, tag in INLINE_RULES[3:]:
        t = rx.sub(lambda m, tag=tag: f"<{tag}>{m.group(1)}</{tag}>", t)
    return t


class MdContext:
    def __init__(self, src_dir, deck_dir, notes):
        self.src_dir, self.deck_dir, self.notes = src_dir, deck_dir, notes

    def resolve(self, src):
        """The src a Markdown picture gets in the deck. A local file is copied into assets/ only
        when it is a picture, video or sound inside the Markdown file's own folder: a Markdown
        file from someone else could otherwise name any file on this computer (a key, a
        password file) and have it copied into the deck, and from there into an export."""
        src = html.unescape(src.strip())
        if re.match(r"^(https?:|data:|//)", src, re.I):
            return src
        root = os.path.realpath(self.src_dir)
        local = os.path.realpath(os.path.join(root, src.replace("/", os.sep)))
        name = os.path.basename(local)
        if not (local.startswith(root + os.sep) and os.path.splitext(local)[1].lower() in MEDIA_EXT):
            self.notes.append("not copied (only pictures, videos and sounds in the Markdown file's folder are): " + name)
            return ""
        return copy_asset(local, self.deck_dir, self.notes) or src


def split_front_matter(text):
    m = re.match(r"^---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n", text, re.S)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        k, _, v = line.partition(":")
        if _:
            meta[k.strip().lower()] = v.strip().strip("'\"")
    return meta, text[m.end():]


def split_slides(text):
    slides, cur = [], []
    in_fence = False
    for line in text.splitlines():
        if re.match(r"^\s*(```|~~~)", line):
            in_fence = not in_fence
        if not in_fence and re.match(r"^(-{3,}|\*{3,}|_{3,})\s*$", line):
            slides.append(cur)
            cur = []
            continue
        cur.append(line)
    slides.append(cur)
    return [s for s in slides if any(l.strip() for l in s)]


def parse_blocks(lines):
    """Lines of one slide -> a list of (kind, payload) blocks, plus the notes text."""
    blocks, notes, i, n = [], [], 0, len(lines)
    para = []

    def flush():
        if para:
            blocks.append(("p", " ".join(x.strip() for x in para)))
            para.clear()
    while i < n:
        line = lines[i]
        s = line.strip()
        if not s:
            flush(); i += 1; continue
        m = re.match(r"^\s*(```|~~~)\s*(\w+)?", line)
        if m:
            flush()
            fence, lang, code = m.group(1), m.group(2) or "", []
            i += 1
            while i < n and not lines[i].strip().startswith(fence):
                code.append(lines[i])
                i += 1
            i += 1
            blocks.append(("code", (lang, "\n".join(code))))
            continue
        if s.startswith("<!--"):
            flush()
            buf = []
            while i < n:
                buf.append(lines[i])
                if "-->" in lines[i]:
                    break
                i += 1
            i += 1
            txt = re.sub(r"^\s*<!--\s*(notes?:)?\s*|\s*-->\s*$", "", "\n".join(buf), flags=re.I | re.S).strip()
            if txt:
                notes.append(txt)
            continue
        m = re.match(r"^(#{1,6})\s+(.*?)\s*#*\s*$", s)
        if m:
            flush(); blocks.append(("h", (len(m.group(1)), m.group(2)))); i += 1; continue
        m = re.match(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$", line)
        if m:
            flush()
            items, ordered = [], bool(re.match(r"\d", m.group(2)))
            while i < n:
                m2 = re.match(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$", lines[i])
                if not m2:
                    if lines[i].strip() and items and lines[i].startswith("  "):
                        items[-1][1] += " " + lines[i].strip()        # lazy continuation
                        i += 1
                        continue
                    break
                items.append([len(m2.group(1).expandtabs(4)) >= 2, m2.group(3)])
                i += 1
            blocks.append(("list", (ordered, items)))
            continue
        if s.startswith(">"):
            flush()
            q = []
            while i < n and lines[i].strip().startswith(">"):
                q.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            blocks.append(("quote", " ".join(x.strip() for x in q if x.strip())))
            continue
        if s.startswith("|") and i + 1 < n and re.match(r"^\s*\|?\s*:?-{2,}", lines[i + 1]):
            flush()
            rows = []
            while i < n and lines[i].strip().startswith("|"):
                if not re.match(r"^\s*\|?\s*:?-{2,}", lines[i]):
                    rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            blocks.append(("table", rows))
            continue
        m = re.match(r"^!\[([^\]]*)\]\(([^)\s]+)\)\s*$", s)
        if m:
            flush(); blocks.append(("img", (m.group(1), m.group(2)))); i += 1; continue
        if re.match(r"^\s*notes?:\s*", s, re.I):
            flush(); notes.append(re.sub(r"^\s*notes?:\s*", "", s, flags=re.I)); i += 1; continue
        if s.startswith("<") and not s.startswith("<!"):
            flush(); blocks.append(("html", s)); i += 1; continue
        para.append(line)
        i += 1
    flush()
    return blocks, "\n".join(notes)


def render_block(kind, payload, ctx, idx):
    i = idx[0]
    idx[0] += 1
    if kind == "h":
        level, text = payload
        tag = "h2" if level <= 2 else "h3"
        return f'        <{tag} class="reveal" style="--i:{i}" data-edit>{inline(text, ctx)}</{tag}>'
    if kind == "p":
        return f'        <p class="reveal" style="--i:{i}" data-edit>{inline(payload, ctx)}</p>'
    if kind == "list":
        ordered, items = payload
        tag = "ol" if ordered else "ul"
        out = [f"        <{tag}>"]
        for nested, text in items:
            if nested and len(out) > 1:
                # A nested item goes inside the previous top-level item (a sub-list is opened there once).
                prev, item = out[-1], f'<li data-edit>{inline(text, ctx)}</li>'
                if prev.endswith(f"</{tag}></li>"):
                    out[-1] = prev[:-len(f"</{tag}></li>")] + item + f"</{tag}></li>"
                else:
                    out[-1] = prev[:-len("</li>")] + f"<{tag}>" + item + f"</{tag}></li>"
                continue
            out.append(f'            <li class="reveal" style="--i:{idx[0]}" data-edit>{inline(text, ctx)}</li>')
            idx[0] += 1
        out.append(f"        </{tag}>")
        return "\n".join(out)
    if kind == "code":
        lang, code = payload
        return (f'        <pre class="reveal" style="--i:{i}; {CODE_STYLE}" data-group><code data-edit data-code'
                + (f' data-lang="{attr(lang)}"' if lang else "") + f'>{esc(code)}</code></pre>')
    if kind == "quote":
        return f'        <blockquote class="reveal" style="--i:{i}; {QUOTE_STYLE}" data-edit>{inline(payload, ctx)}</blockquote>'
    if kind == "table":
        rows = payload
        out = [f'        <table class="reveal" style="--i:{i}; {TABLE_STYLE}" data-group>']
        for r, cells in enumerate(rows):
            tag, st = ("th", HEAD_STYLE) if r == 0 else ("td", CELL_STYLE)
            out.append("            <tr>" + "".join(f'<{tag} style="{st}" data-edit>{inline(c, ctx)}</{tag}>' for c in cells) + "</tr>")
        out.append("        </table>")
        return "\n".join(out)
    if kind == "img":
        alt, src = payload
        return f'        <img class="reveal-img" style="--i:{i}; {IMG_STYLE}" src="{attr(ctx.resolve(src))}" alt="{attr(alt)}">'
    if kind == "html":
        return "        " + payload
    return ""


def import_markdown(text, src_dir, deck_dir):
    """Markdown text -> (deck html, notes list). Local images are copied into deck_dir/assets."""
    notes = []
    ctx = MdContext(src_dir, deck_dir, notes)
    meta, body = split_front_matter(text)
    sections = []
    deck_title = meta.get("title", "")
    for k, lines in enumerate(split_slides(body)):
        blocks, speaker = parse_blocks(lines)
        heads = [b for b in blocks if b[0] == "h"]
        rest = [b for b in blocks if b[0] != "h"]
        first_h1 = heads and heads[0][1][0] == 1
        name = slug(heads[0][1][1]) if heads else f"slide-{k + 1}"
        if not deck_title and first_h1:
            deck_title = heads[0][1][1]
        idx = [0]
        # A slide that is only a top-level heading (and a line or two): a title or section slide.
        if first_h1 and all(b[0] == "p" for b in rest) and len(rest) <= 2:
            inner = ['    <div class="content">', f'        <h1 class="reveal" style="--i:0" data-edit>{inline(heads[0][1][1], ctx)}</h1>']
            for b in rest:
                idx[0] += 1
                inner.append(f'        <p class="sub reveal" style="--i:{idx[0]}" data-edit>{inline(b[1], ctx)}</p>')
            inner.append("    </div>")
            sections.append(section("\n".join(inner), "title", name, speaker))
            continue
        # The blocks flow top to bottom with a gap; the template's .content is the container.
        inner = ['    <div class="content" style="display:flex; flex-direction:column; gap:28px; align-items:flex-start;">']
        body_blocks = list(blocks)
        if heads:
            body_blocks.remove(heads[0])                  # the first heading is the slide title
            inner.append(f'        <h2 class="reveal" style="--i:0" data-edit>{inline(heads[0][1][1], ctx)}</h2>')
            idx[0] = 1
        images = [b for b in body_blocks if b[0] == "img"]
        if len(images) == 1 and len(body_blocks) > 1:
            # Two columns: everything else on the left, the picture on the right.
            body_blocks.remove(images[0])
            inner.append('        <div style="display:flex; gap:48px; align-items:flex-start; align-self:stretch;">')
            inner.append('            <div style="flex:1 1 0; min-width:0;">')
            inner += ["    " + render_block(k2, p2, ctx, idx) for k2, p2 in body_blocks]
            inner.append("            </div>")
            inner.append('            <div style="flex:1 1 0; min-width:0;">')
            inner.append("    " + render_block("img", images[0][1], ctx, idx))
            inner.append("            </div>")
            inner.append("        </div>")
        else:
            inner += [render_block(k2, p2, ctx, idx) for k2, p2 in body_blocks]
        inner.append("    </div>")
        sections.append(section("\n".join(inner), "body", name, speaker, number=k + 1))
    if not sections:
        sections.append(section('    <div class="content">\n        <h1 class="reveal" style="--i:0" data-edit>Empty file</h1>\n    </div>', "title", "title"))
    return build_deck(sections, deck_title), notes


# ------------------------------------------------------------------
# PowerPoint: pptx_import.py
# ------------------------------------------------------------------


def import_file(path, deck_dir):
    """Dispatch on the extension. Returns (html, notes)."""
    ext = os.path.splitext(path)[1].lower()
    if ext in (".md", ".markdown", ".txt"):
        with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
            return import_markdown(f.read(), os.path.dirname(os.path.abspath(path)), deck_dir)
    if ext == ".pptx":
        from pptx_import import import_pptx           # imported here: pptx_import uses this module's helpers
        return import_pptx(path, deck_dir)
    raise ValueError("not a Markdown (.md) or PowerPoint (.pptx) file")
