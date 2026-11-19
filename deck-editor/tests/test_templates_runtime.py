"""Every template carries the current presentation scripts: app/deck-runtime.js
verbatim, and blank.html's controller. tools/build-templates.py writes them in,
the imported designs included, so a template left on an older edition fails here."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..", "app")
TEMPLATES = os.path.join(APP, "templates")
CONTROLLER = "<script>\n/* ===========================================\n   SLIDE PRESENTATION CONTROLLER"


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read().replace("\r\n", "\n")


def scripts(text):
    c0 = text.index(CONTROLLER) + len("<script>\n")
    c1 = text.index("</script>", c0)
    r0 = text.index('<script id="deck-runtime">') + len('<script id="deck-runtime">')
    r1 = text.index("</script>", r0)
    return text[c0:c1].strip("\n"), text[r0:r1].strip("\n")


class TemplatesRuntime(unittest.TestCase):
    def test_every_template_has_the_current_scripts(self):
        runtime = read(os.path.join(APP, "deck-runtime.js")).strip("\n")
        controller, _ = scripts(read(os.path.join(TEMPLATES, "blank.html")))
        version = re.search(r"version: *(\d+)", runtime).group(1)
        names = sorted(n for n in os.listdir(TEMPLATES) if n.endswith(".html"))
        self.assertGreater(len(names), 30)
        for name in names:
            with self.subTest(template=name):
                c, r = scripts(read(os.path.join(TEMPLATES, name)))
                self.assertEqual(r, runtime, f"{name} carries an older runtime than {version}: run tools/build-templates.py")
                self.assertEqual(c, controller, f"{name} carries another controller than blank.html's")


if __name__ == "__main__":
    unittest.main()
