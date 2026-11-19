"""Build app/templates/<slug>.html from tools/templates-src/<slug>.html.

A source is a complete deck with two markers:
    /* @@BASE@@ */          in its <style>: replaced by the editor's base CSS
                            (the fixed stage, print, reduced motion and the
                            reveal family) taken from app/templates/blank.html
    <!-- @@SCRIPTS@@ -->    in its <body>: replaced by blank.html's controller
                            and runtime scripts, verbatim
so the hand-made templates always carry the same base as the editor's own
template. Run it after changing blank.html's base block or controller, or
app/deck-runtime.js (it ends by writing diapo-format/ and the skill's runtime,
see build-format.py):

    py -3 tools/build-templates.py            # every source
    py -3 tools/build-templates.py folio      # one slug

The presentation features script has one source, app/deck-runtime.js: the build
first writes it into blank.html, then puts blank.html's controller and runtime
into every other template in app/templates that has no source here (the
designs imported by tools/import-bht.js), so no template is left on an older
edition of either script. CI runs this build and fails if anything changes.

It also writes app/templates/looks.json: the colour, font and size variables
of every design in templates.json (blank left out) with the Google Fonts
families each one loads, for the ready-made looks in the Theme panel. The
panel reads the file and never the designs themselves, so opening it costs
one small request and loads no font.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..", "app", "templates")
SRC = os.path.join(HERE, "templates-src")
LOOKS = os.path.join(APP, "looks.json")

# The reveal's variables belong to Motion, not to a look.
MOTION = {"dur", "ease-out", "stagger", "reveal-y"}
COLOUR = re.compile(r"^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()", re.I)
LENGTH = re.compile(r"^-?[\d.]+px$", re.I)
GOOGLE = re.compile(r"https://fonts\.googleapis\.com/css2?\?[^\"')\s>]+")


def blocks():
    with open(os.path.join(APP, "blank.html"), encoding="utf-8", newline="") as f:
        blank = f.read().replace("\r\n", "\n")
    # Base CSS: from the FIXED STAGE comment block to just before the SLIDE STYLES one.
    start = blank.index("/* ===========================================\n   FIXED 16:9 STAGE")
    end = blank.index("/* ===========================================\n   SLIDE STYLES")
    base = blank[start:end].rstrip("\n")
    # Scripts: the controller <script> through the runtime's </script>.
    s0 = blank.index("<script>\n/* ===========================================\n   SLIDE PRESENTATION CONTROLLER")
    s1 = blank.rindex("</script>") + len("</script>")
    scripts = blank[s0:s1]
    return base, scripts


RUNTIME_OPEN = '<script id="deck-runtime">'
CONTROLLER_OPEN = "<script>\n/* ===========================================\n   SLIDE PRESENTATION CONTROLLER"


def write_if_changed(path, text):
    with open(path, encoding="utf-8", newline="") as f:
        if f.read() == text:
            return False
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return True


def script_spans(text):
    """(start, end) of the controller's and the runtime's code in a template: the text
    between each <script> opening line and its </script>."""
    c0 = text.index(CONTROLLER_OPEN) + len("<script>\n")
    c1 = text.index("</script>", c0)
    r0 = text.index(RUNTIME_OPEN) + len(RUNTIME_OPEN)
    r1 = text.index("</script>", r0)
    return (c0, c1), (r0, r1)


def sync_blank_runtime():
    """blank.html carries app/deck-runtime.js verbatim; write the current one in, so
    changing the runtime file is all a new edition takes."""
    path = os.path.join(APP, "blank.html")
    with open(path, encoding="utf-8", newline="") as f:
        text = f.read().replace("\r\n", "\n")
    with open(os.path.join(APP, "..", "deck-runtime.js"), encoding="utf-8", newline="") as f:
        runtime = f.read().replace("\r\n", "\n")
    _, (r0, r1) = script_spans(text)
    if write_if_changed(path, text[:r0] + "\n" + runtime.strip("\n") + "\n" + text[r1:]):
        print("blank.html: runtime updated from app/deck-runtime.js")


def refresh_imported(scripts):
    """Templates without a source in templates-src (the imported designs) carry the
    controller and runtime as import-bht.js wrote them; give them the current ones,
    keeping everything around the two scripts as it is."""
    i = scripts.index(RUNTIME_OPEN)
    controller = scripts[len("<script>\n"):scripts.rindex("</script>", 0, i)].strip("\n")
    runtime = scripts[i + len(RUNTIME_OPEN):scripts.rindex("</script>")].strip("\n")
    own = {f[:-5] for f in os.listdir(SRC) if f.endswith(".html")} | {"blank"}
    for name in sorted(os.listdir(APP)):
        if not name.endswith(".html") or name[:-5] in own:
            continue
        path = os.path.join(APP, name)
        with open(path, encoding="utf-8", newline="") as f:
            text = f.read().replace("\r\n", "\n")
        if CONTROLLER_OPEN not in text or RUNTIME_OPEN not in text:
            sys.exit(name + ": no controller or runtime script to refresh")
        (c0, c1), (r0, r1) = script_spans(text)
        out = text[:c0] + controller + "\n" + text[c1:r0] + "\n" + runtime + "\n" + text[r1:]
        if write_if_changed(path, out):
            print(name[:-5], "scripts refreshed")


def build(slug, base, scripts):
    with open(os.path.join(SRC, slug + ".html"), encoding="utf-8", newline="") as f:
        src = f.read().replace("\r\n", "\n")
    if "/* @@BASE@@ */" not in src or "<!-- @@SCRIPTS@@ -->" not in src:
        sys.exit(slug + ": missing @@BASE@@ or @@SCRIPTS@@ marker")
    n = len(re.findall(r'<section class="slide', src))   # counted before the runtime (its comments mention a .slide) goes in
    out = src.replace("@@SLIDES@@", str(n)).replace("/* @@BASE@@ */", base).replace("<!-- @@SCRIPTS@@ -->", scripts)
    with open(os.path.join(APP, slug + ".html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(out)   # LF, like every text file in the repository (.gitattributes)
    print(slug, n, "slides")


def google_families(url):
    """A css2 URL -> {family: {"weights": [..], "italics": [..]}}."""
    out = {}
    query = url.replace("&amp;", "&").split("?", 1)[1]
    for part in query.split("&"):
        if not part.startswith("family="):
            continue
        name, _, axes = part[7:].partition(":")
        name = name.replace("+", " ").strip()
        g = out.setdefault(name, {"weights": [], "italics": []})
        if not axes:
            g["weights"].append(400)
            continue
        names, _, tuples = axes.partition("@")
        names = names.split(",")
        for t in tuples.split(";"):
            vals = t.split(",")
            ital = "ital" in names and vals[names.index("ital")] == "1"
            w = vals[names.index("wght")] if "wght" in names else "400"
            lo, _, hi = w.partition("..")
            ws = [x for x in range(100, 1000, 100) if int(lo) <= x <= int(hi or lo)]
            for x in ws:
                lst = g["italics" if ital else "weights"]
                if x not in lst:
                    lst.append(x)
    for g in out.values():
        g["weights"].sort()
        g["italics"].sort()
    return out


def first_family(stack):
    return stack.split(",")[0].strip().strip("'\"")


def look(slug, name):
    """One design's look: its :root colour, font and size variables, in the order
    the deck defines them (a later :root block wins, as in the browser), var()
    references resolved, and the Google families its fonts need."""
    with open(os.path.join(APP, slug + ".html"), encoding="utf-8") as f:
        html = f.read()
    head = html[:html.lower().find("<body")]
    raw = {}
    for style in re.findall(r"<style[^>]*>([\s\S]*?)</style>", head):
        for block in re.findall(r":root\s*\{([^}]*)\}", style):
            block = re.sub(r"/\*[\s\S]*?\*/", "", block)
            for k, v in re.findall(r"--([\w-]+)\s*:\s*([^;]+);", block):
                raw.pop(k, None)   # keeps the order of the last definition
                raw[k] = " ".join(v.split())

    def resolve(v, depth=0):
        m = re.match(r"^var\(--([\w-]+)\)$", v)
        if m and depth < 5 and m.group(1) in raw:
            return resolve(raw[m.group(1)], depth + 1)
        return v

    tokens = {}
    for k, v in raw.items():
        if k in MOTION:
            continue
        v = resolve(v)
        if COLOUR.match(v) or (re.search("font", k, re.I) and re.search("[a-z]", v, re.I) and not v[:1].isdigit() and not v.startswith("var(")) or LENGTH.match(v):
            tokens[k] = v
    google = {}
    for url in GOOGLE.findall(head):
        for fam, g in google_families(url).items():
            t = google.setdefault(fam, {"weights": [], "italics": []})
            t["weights"] = sorted(set(t["weights"]) | set(g["weights"]))
            t["italics"] = sorted(set(t["italics"]) | set(g["italics"]))
    used = {first_family(v) for k, v in tokens.items() if "font" in k.lower()}
    return {"slug": slug, "name": name, "vars": tokens, "google": {f: g for f, g in sorted(google.items()) if f in used}}


def looks():
    with open(os.path.join(APP, "templates.json"), encoding="utf-8") as f:
        listed = json.load(f)["templates"]
    return {"looks": [look(t["slug"], t["name"]) for t in listed if t["slug"] != "blank"]}


def write_looks():
    text = json.dumps(looks(), indent=1, ensure_ascii=False) + "\n"
    with open(LOOKS, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print("looks.json", len(json.loads(text)["looks"]), "looks")


if __name__ == "__main__":
    sync_blank_runtime()
    base, scripts = blocks()
    slugs = sys.argv[1:] or sorted(f[:-5] for f in os.listdir(SRC) if f.endswith(".html"))
    for slug in slugs:
        build(slug, base, scripts)
    refresh_imported(scripts)
    write_looks()
    # The MIT-licensed part of every deck is published from the same blocks.
    import importlib.util
    spec = importlib.util.spec_from_file_location("build_format", os.path.join(HERE, "build-format.py"))
    fmt = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fmt)
    fmt.main()
