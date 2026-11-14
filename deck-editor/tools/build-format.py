"""Write the Diapo Format package (diapo-format/ in the repository root) from the
editor's canonical sources, so the MIT-licensed part of a deck is published
from exactly what the editor ships:

    diapo-format/deck-base.css        the base CSS block of app/templates/blank.html
    diapo-format/deck-controller.js   the controller <script> of blank.html
    diapo-format/deck-runtime.js      app/deck-runtime.js

It also refreshes the skill's copies of the runtime and the controller
(skills/diapo-deck/deck-runtime.js and deck-controller.js, byte-for-byte the
same as the published ones) and checks that the skill's deck-base.css, which
is annotated for skill readers and so is not generated, still contains every
rule of the base block. A missing rule exits with status 1, so the places
never drift apart; CI runs this through build-templates.py. build-templates.py
runs this at the end; on its own:

    py -3 tools/build-format.py
"""
import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
APP = os.path.join(HERE, "..", "app")
OUT = os.path.join(ROOT, "diapo-format")
SKILL = os.path.join(ROOT, "skills", "diapo-deck")


def _templates():
    spec = importlib.util.spec_from_file_location("build_templates", os.path.join(HERE, "build-templates.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def read(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read().replace("\r\n", "\n")


def write(path, text):
    """Write LF, and only when the content changed (keeps git quiet)."""
    if os.path.exists(path) and read(path) == text:
        return False
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return True


def pieces():
    """(base css, controller js, runtime js) as the editor ships them."""
    base, scripts = _templates().blocks()
    i = scripts.index('<script id="deck-runtime">')
    controller = scripts[len("<script>\n"):i]
    controller = controller[:controller.rindex("</script>")].rstrip("\n") + "\n"
    runtime = read(os.path.join(APP, "deck-runtime.js"))
    inner = scripts[i + len('<script id="deck-runtime">'):scripts.rindex("</script>")].strip("\n") + "\n"
    if inner != runtime:
        sys.exit("blank.html carries a runtime that differs from app/deck-runtime.js; paste the current one in")
    return base.rstrip("\n") + "\n", controller, runtime


def check_skill(base):
    """The skill's base CSS is annotated and carries fallbacks for decks that skip a
    variable, so it is not generated; compare rules only (every declaration of the
    base block must be in it)."""
    problems = []
    def norm(css):
        css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        # The skill's copy adds fallbacks (var(--dur, 0.7s)) for decks that skip a variable.
        css = re.sub(r"var\((--[\w-]+)\s*,[^()]*(?:\([^()]*\)[^()]*)*\)", r"var(\1)", css)
        return re.sub(r"\s+", " ", css).strip()
    skill_base = norm(read(os.path.join(SKILL, "deck-base.css")))
    parts = [p.strip() for p in re.split(r"[;{}]", norm(base)) if p.strip()]
    missing = [p for p in parts if p not in skill_base]
    if missing:
        problems.append("skills/diapo-deck/deck-base.css is missing %d declaration(s) of the base block, first: %s"
                        % (len(missing), missing[0][:70]))
    return problems


def main():
    base, controller, runtime = pieces()
    os.makedirs(OUT, exist_ok=True)
    changed = [name for name, text in (("deck-base.css", base), ("deck-controller.js", controller), ("deck-runtime.js", runtime))
               if write(os.path.join(OUT, name), text)]
    # The skill's runtime and controller are byte-for-byte copies of the generated ones.
    src, dst = os.path.join(APP, "deck-runtime.js"), os.path.join(SKILL, "deck-runtime.js")
    raw = open(src, "rb").read()
    if not os.path.exists(dst) or open(dst, "rb").read() != raw:
        open(dst, "wb").write(raw)
        changed.append("skills/diapo-deck/deck-runtime.js")
    if write(os.path.join(SKILL, "deck-controller.js"), controller):
        changed.append("skills/diapo-deck/deck-controller.js")
    print("diapo-format: " + (", ".join(changed) + " written" if changed else "up to date"))
    problems = check_skill(base)
    for p in problems:
        print("error: " + p)
    if problems:
        sys.exit(1)   # fails the build (and CI), so an annotated copy can't drift silently


if __name__ == "__main__":
    main()
