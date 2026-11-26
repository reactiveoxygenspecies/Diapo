"""Unit tests for the script files Diapo puts beside a deck (serve.DECK_FILES: the library of an
interactive chart and its renderer): a file whose bytes are Diapo's runs without the deck being
trusted and is named in the page's policy; a file of the same name with anything else in it is
the deck's own script; saving a deck brings the files, and never writes over somebody's own.

    py -3 -m unittest tests.test_deck_files     (from deck-editor/)
"""
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from serve_for_tests import serve, TMP  # noqa: E402

PAGE = ('<!DOCTYPE html><html><head></head><body><main class="deck-stage"><section class="slide">'
        '<figure data-plot="plotly"><script type="application/json" data-plot-figure>{"data":[]}</script></figure>'
        '</section></main>\n<script src="deck-plotly.min.js" data-deck-plot="library"></script>\n'
        '<script src="deck-plot.js" data-deck-plot="renderer"></script>\n</body></html>\n')


def source(name):
    return os.path.join(serve.APP_DIR, serve.DECK_FILES[name])


class DeckFiles(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(dir=TMP)
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.deck = os.path.join(self.dir, "my talk", "index.html")
        os.makedirs(os.path.dirname(self.deck))
        with open(self.deck, "w", encoding="utf-8", newline="\n") as f:
            f.write(PAGE)

    def scan(self):
        with open(self.deck, "rb") as f:
            return serve.scan_deck(self.deck, f.read())

    def beside(self, name):
        return os.path.join(os.path.dirname(self.deck), name)

    def test_a_figure_block_is_data_and_missing_files_run_nothing(self):
        scan = self.scan()
        self.assertEqual((scan["own"], scan["files"]), ([], []))

    def test_saving_brings_the_files_and_they_count_as_diapos(self):
        self.assertEqual(sorted(serve.ensure_deck_files(self.deck, PAGE)), ["deck-plot.js", "deck-plotly.min.js"])
        for name in ("deck-plotly.min.js", "deck-plot.js"):
            with open(self.beside(name), "rb") as a, open(source(name), "rb") as b:
                self.assertEqual(a.read(), b.read(), name)
        self.assertEqual(serve.ensure_deck_files(self.deck, PAGE), [])            # nothing to do the second time
        scan = self.scan()
        self.assertEqual(scan["own"], [])                                          # no trust is asked
        self.assertEqual(scan["files"], ["deck-plotly.min.js", "deck-plot.js"])
        urls = serve.script_urls("127.0.0.1:8800", "/deck/my%20talk/index.html", scan["files"])
        self.assertEqual(urls, ["http://127.0.0.1:8800/deck/my%20talk/deck-plotly.min.js", "http://127.0.0.1:8800/deck/my%20talk/deck-plot.js"])
        policy = serve.deck_csp(scan["allow"], urls)
        self.assertTrue(policy.startswith("script-src http://127.0.0.1:8800/deck/my%20talk/deck-plotly.min.js http://127.0.0.1:8800/deck/my%20talk/deck-plot.js 'sha256-"))
        self.assertNotIn("unsafe", policy)

    def test_a_turning_3d_structure_brings_3dmol_and_its_script(self):
        page = PAGE.replace('<script src="deck-plotly.min.js" data-deck-plot="library"></script>', '<script src="deck-3dmol.min.js" data-deck-mol3d="library"></script>').replace(
            '<script src="deck-plot.js" data-deck-plot="renderer"></script>', '<script src="deck-mol3d.js" data-deck-mol3d="renderer"></script>').replace(
            '<script type="application/json" data-plot-figure>', '<script type="chemical/x-pdb" data-mol3d-source>')
        with open(self.deck, "w", encoding="utf-8", newline="\n") as f:
            f.write(page)
        self.assertEqual(sorted(serve.ensure_deck_files(self.deck, page)), ["deck-3dmol.min.js", "deck-mol3d.js"])
        scan = self.scan()
        self.assertEqual((scan["own"], scan["files"]), ([], ["deck-3dmol.min.js", "deck-mol3d.js"]))     # the structure file is data, the two scripts Diapo's

    def test_a_file_of_that_name_with_other_contents_is_the_decks_own(self):
        serve.ensure_deck_files(self.deck, PAGE)
        with open(self.beside("deck-plot.js"), "a", encoding="utf-8") as f:
            f.write("\nfetch('/api/workspace?path=/');\n")
        scan = self.scan()
        self.assertEqual(scan["files"], ["deck-plotly.min.js"])
        self.assertEqual(len(scan["own"]), 1)
        self.assertTrue(scan["own"][0].startswith("src:deck-plot.js#"))
        # ... and a save leaves it alone: it is not an edition of Diapo's to bring up to date.
        self.assertEqual(serve.ensure_deck_files(self.deck, PAGE), [])
        with open(self.beside("deck-plot.js"), encoding="utf-8") as f:
            self.assertIn("api/workspace", f.read())

    def test_an_earlier_edition_of_diapos_is_replaced(self):
        old = b"/* an earlier deck-plot.js */\n"
        with open(self.beside("deck-plot.js"), "wb") as f:
            f.write(old)
        known = serve.known_file_hashes()
        digest = serve.hashlib.sha256(old).hexdigest()
        known.add(digest)
        self.addCleanup(known.discard, digest)
        self.assertIn("deck-plot.js", serve.ensure_deck_files(self.deck, PAGE))
        with open(self.beside("deck-plot.js"), "rb") as a, open(source("deck-plot.js"), "rb") as b:
            self.assertEqual(a.read(), b.read())

    def test_only_a_file_beside_the_deck_is_brought(self):
        page = PAGE.replace('src="deck-plot.js"', 'src="../deck-plot.js"').replace('src="deck-plotly.min.js"', 'src="https://cdn.plot.ly/plotly.min.js"')
        self.assertEqual(serve.ensure_deck_files(self.deck, page), [])
        self.assertEqual(os.listdir(os.path.dirname(self.deck)), ["index.html"])

    def test_written_into_a_page_they_are_known_by_their_text(self):
        # What the single-file export writes: "\n" + the file (with "</script" escaped) + "\n".
        for name in serve.DECK_FILES:
            with open(source(name), encoding="utf-8", errors="replace") as f:
                js = f.read()
            body = "\n" + js.replace("</script", "<\\/script") + "\n"
            self.assertIn(serve.script_hash(body), serve.known_script_hashes(), name)
        inl = serve.Inliner(self.deck)
        with mock_workspace(self.dir):
            html = inl.run(PAGE, embed_google=False)
        self.assertNotIn(" src=", html)
        with open(self.deck, "w", encoding="utf-8", newline="\n") as f:
            f.write(html)
        scan = self.scan()
        self.assertEqual((scan["own"], scan["files"]), ([], []))


class mock_workspace:
    """serve.WORKSPACE set to a folder for the length of a block (the Inliner reads it when made)."""
    def __init__(self, path):
        self.path = path

    def __enter__(self):
        self.was = serve.WORKSPACE
        serve.WORKSPACE = self.path

    def __exit__(self, *exc):
        serve.WORKSPACE = self.was


if __name__ == "__main__":
    unittest.main()
