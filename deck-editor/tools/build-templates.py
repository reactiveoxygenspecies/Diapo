"""Build app/templates/<slug>.html from tools/templates-src/<slug>.html.

A source is a complete deck with two markers:
    /* @@BASE@@ */          in its <style>: replaced by the editor's base CSS
                            (the fixed stage, print, reduced motion and the
                            reveal family) taken from app/templates/blank.html
    <!-- @@SCRIPTS@@ -->    in its <body>: replaced by blank.html's controller
                            and runtime scripts, verbatim
so the hand-made templates always carry the same base as the editor's own
template. Run it after changing blank.html's base block, controller or runtime
(it ends by writing diapo-format/ and the skill's runtime, see build-format.py):

    py -3 tools/build-templates.py            # every source
    py -3 tools/build-templates.py folio      # one slug
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..", "app", "templates")
SRC = os.path.join(HERE, "templates-src")


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


if __name__ == "__main__":
    base, scripts = blocks()
    slugs = sys.argv[1:] or sorted(f[:-5] for f in os.listdir(SRC) if f.endswith(".html"))
    for slug in slugs:
        build(slug, base, scripts)
    # The MIT-licensed part of every deck is published from the same blocks.
    import importlib.util
    spec = importlib.util.spec_from_file_location("build_format", os.path.join(HERE, "build-format.py"))
    fmt = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fmt)
    fmt.main()
