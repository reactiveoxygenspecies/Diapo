"""mcp_server.py driven as an agent would: a subprocess spoken to over stdio (JSON-RPC, one
message per line), on a throw-away folder holding a copy of the sample deck.

    py -3 -m unittest tests.test_mcp_server     (from deck-editor/)
"""
import base64
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from serve_for_tests import serve  # noqa: E402

EDITOR = os.path.dirname(HERE)
FIXTURE = os.path.join(HERE, "fixtures", "sample-deck")
DECK = "sample/index.html"


class Client:
    def __init__(self, folder, settings, *extra):
        self.proc = subprocess.Popen([sys.executable, os.path.join(EDITOR, "mcp_server.py"), "--folder", folder,
                                      "--settings", settings, *extra],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.n = 0

    def send(self, obj):
        self.proc.stdin.write((json.dumps(obj) + "\n").encode("utf-8"))
        self.proc.stdin.flush()

    def recv(self):
        line = self.proc.stdout.readline()
        if not line:
            raise AssertionError("the server closed stdout: " + self.proc.stderr.read().decode("utf-8", "replace"))
        return json.loads(line)

    def rpc(self, method, params=None):
        self.n += 1
        self.send({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params or {}})
        reply = self.recv()
        assert reply.get("id") == self.n, reply
        return reply

    def call(self, _tool, **args):
        return self.rpc("tools/call", {"name": _tool, "arguments": args})["result"]

    def json_call(self, _tool, **args):
        r = self.call(_tool, **args)
        assert not r["isError"], r["content"][0]["text"]
        return json.loads(r["content"][0]["text"])

    def close(self):
        try:
            self.proc.stdin.close()
            self.proc.wait(timeout=10)
        finally:
            self.proc.stdout.close()
            self.proc.stderr.close()


class McpServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="diapo-mcp-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.folder = os.path.join(self.tmp, "decks")
        shutil.copytree(FIXTURE, os.path.join(self.folder, "sample"))
        self.settings = os.path.join(self.tmp, "settings.json")
        self.client = None

    def start(self, settings=None, *extra):
        if settings is not None:
            with open(self.settings, "w", encoding="utf-8") as f:
                json.dump(settings, f)
        self.client = Client(self.folder, self.settings, *extra)
        self.addCleanup(self.client.close)
        init = self.client.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                              "clientInfo": {"name": "unittest", "version": "1"}})
        self.client.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return self.client, init

    def deck_file(self):
        return os.path.join(self.folder, "sample", "index.html")

    # -- protocol --------------------------------------------------
    def test_initialize_and_tools_list(self):
        c, init = self.start()
        r = init["result"]
        self.assertEqual(r["protocolVersion"], "2025-06-18")            # a version it knows is kept
        self.assertEqual(r["serverInfo"]["name"], "diapo")
        self.assertIn("tools", r["capabilities"])
        self.assertEqual(c.rpc("ping")["result"], {})
        tools = {t["name"]: t for t in c.rpc("tools/list")["result"]["tools"]}
        self.assertEqual(set(tools), {"list_decks", "read_deck", "write_slide", "set_notes", "delete_slide", "move_slide",
                                      "create_deck", "check_deck", "render_slide", "import_file", "export_pdf"})
        for t in tools.values():
            self.assertEqual(t["inputSchema"]["type"], "object")
            self.assertTrue(t["description"])
        self.assertTrue(tools["read_deck"]["annotations"]["readOnlyHint"])
        self.assertEqual(c.rpc("no/such")["error"]["code"], -32601)
        self.assertEqual(c.rpc("tools/call", {"name": "nope", "arguments": {}})["error"]["code"], -32602)
        c.proc.stdin.write(b"this is not json\n")
        c.proc.stdin.flush()
        self.assertEqual(c.recv()["error"]["code"], -32700)

    def test_an_unknown_protocol_version_gets_the_newest(self):
        c, _ = self.start()
        r = c.rpc("initialize", {"protocolVersion": "1999-01-01", "capabilities": {}, "clientInfo": {"name": "x", "version": "0"}})
        self.assertEqual(r["result"]["protocolVersion"], "2025-11-25")

    # -- reading ---------------------------------------------------
    def test_list_and_read_the_fixture(self):
        c, _ = self.start()
        decks = c.json_call("list_decks")["decks"]
        self.assertEqual([(d["path"], d["slides"]) for d in decks], [(DECK, 3)])
        deck = c.json_call("read_deck", path=DECK, slide_html="bullets")
        self.assertEqual(len(deck["version"]), 24)
        self.assertEqual([s["name"] for s in deck["slides"]], ["title", "chart", "bullets"])
        first = deck["slides"][0]
        self.assertEqual(first["title"], "Sample deck title")
        self.assertEqual(first["notes"], "Notes for slide one.")
        self.assertIn({"type": "paragraph", "text": "Subtitle or author"}, first["content"])
        self.assertIn({"type": "list", "ordered": False, "items": ["First point", "Second point", "Third point"]},
                      deck["slides"][2]["content"])
        self.assertIn({"type": "drawing", "src": "assets/shape.svg", "alt": "Two shapes"}, deck["slides"][1]["content"])
        self.assertEqual(deck["slides"][1]["element_ids"], ["genKey"])
        self.assertTrue(deck["slide_html"]["html"].startswith('<section class="slide body-slide" data-name="bullets">'))
        self.assertTrue(deck["slide_html"]["html"].endswith("</section>"))
        self.assertEqual(deck["own_scripts"], {"count": 1, "trusted": False})

    # -- writing ---------------------------------------------------
    def test_write_a_slide_and_read_it_back(self):
        c, _ = self.start()
        with open(self.deck_file(), "rb") as f:
            before = f.read()
        v = c.json_call("read_deck", path=DECK)["version"]
        new = ('<section class="slide body-slide active" data-name="results">\n    <div class="content"><h2>Results</h2>'
               '<p>Rate <span data-math="k_{obs}">k</span> doubles.</p>'
               '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
               '<img src="assets/missing.png" alt="A plot"></div>\n</section>')
        w = c.json_call("write_slide", path=DECK, version=v, after=1, html=new)
        self.assertEqual((w["slide"], w["slide_count"], w["backup"]), (2, 4, ".deck-editor/index.html.bak"))
        with open(os.path.join(self.folder, "sample", ".deck-editor", "index.html.bak"), "rb") as f:
            self.assertEqual(f.read(), before)                               # the previous file, as the editor keeps it
        deck = c.json_call("read_deck", path=DECK, slide_html=2)
        self.assertEqual(deck["version"], w["version"])
        s = deck["slides"][1]
        self.assertEqual((s["name"], s["title"]), ("results", "Results"))
        self.assertIn({"type": "paragraph", "text": "Rate \\(k_{obs}\\) doubles."}, s["content"])
        self.assertIn({"type": "table", "rows": [["A", "B"], ["1", "2"]]}, s["content"])
        self.assertIn({"type": "picture", "src": "assets/missing.png", "alt": "A plot", "missing": True}, s["content"])
        self.assertNotIn("active", deck["slide_html"]["html"])                # only the first slide carries it
        with open(self.deck_file(), "rb") as f:
            after = f.read()
        # Everything outside the stage is byte for byte what it was: the head, the runtime, the scripts.
        cut = before.index(b"</main>")
        self.assertEqual(after[after.index(b"</main>"):], before[cut:])
        self.assertEqual(after[:after.index(b"<!-- ======")], before[:before.index(b"<!-- ======")])

        # Replace, notes, move, delete, each with the version the last write gave.
        v = c.json_call("write_slide", path=DECK, version=w["version"], slide="bullets",
                        html='<section class="slide body-slide" data-name="bullets"><h2>Two points</h2></section>')["version"]
        v = c.json_call("set_notes", path=DECK, version=v, slide=1, notes="Say hello.\nThen the plan.")["version"]
        v = c.json_call("move_slide", path=DECK, version=v, slide="results", to=4)["version"]
        v = c.json_call("delete_slide", path=DECK, version=v, slide="chart")["version"]
        deck = c.json_call("read_deck", path=DECK)
        self.assertEqual([s["name"] for s in deck["slides"]], ["title", "bullets", "results"])
        self.assertEqual(deck["slides"][0]["notes"], "Say hello.\nThen the plan.")
        self.assertEqual(deck["slides"][1]["title"], "Two points")
        with open(self.deck_file(), encoding="utf-8") as f:
            text = f.read()
        self.assertIn('<aside class="notes" hidden>Say hello.<br>Then the plan.</aside>', text)
        self.assertNotIn("SLIDE 2 - Chart", text)                             # the slide's label comment went with it
        self.assertTrue(os.path.isfile(os.path.join(self.folder, "sample", ".deck-editor", "index.html.~3.bak")))

    def test_a_stale_write_is_refused(self):
        c, _ = self.start()
        v = c.json_call("read_deck", path=DECK)["version"]
        with open(self.deck_file(), "a", encoding="utf-8") as f:
            f.write("\n<!-- saved by the editor meanwhile -->\n")
        with open(self.deck_file(), "rb") as f:
            changed = f.read()
        r = c.call("write_slide", path=DECK, version=v, slide=1, html='<section class="slide">Mine</section>')
        self.assertTrue(r["isError"])
        self.assertIn("changed since you read it", r["content"][0]["text"])
        r = c.call("set_notes", path=DECK, slide=1, notes="x")             # no version at all
        self.assertTrue(r["isError"])
        with open(self.deck_file(), "rb") as f:
            self.assertEqual(f.read(), changed)
        self.assertFalse(os.path.exists(os.path.join(self.folder, "sample", ".deck-editor")))

    def test_bad_slide_html_is_refused(self):
        c, _ = self.start()
        v = c.json_call("read_deck", path=DECK)["version"]
        for html in ("<div>no slide</div>", '<section class="slide">a</section><section class="slide">b</section>',
                     '<section class="slide">not closed'):
            with self.subTest(html=html):
                r = c.call("write_slide", path=DECK, version=v, slide=1, html=html)
                self.assertTrue(r["isError"])

    def test_paths_outside_the_folder_are_refused(self):
        outside = os.path.join(self.tmp, "outside")
        shutil.copytree(FIXTURE, outside)
        link = os.path.join(self.folder, "link")
        try:
            os.symlink(outside, link, target_is_directory=True)
        except (OSError, NotImplementedError):
            if sys.platform != "win32":
                raise
            import _winapi
            _winapi.CreateJunction(outside, link)                          # no privilege needed, unlike a symlink
        c, _ = self.start()
        for path in ("../outside/index.html", os.path.join(outside, "index.html"), "link/index.html",
                     "sample/../../outside/index.html", "C:index.html", "@diapo/welcome/index.html"):
            with self.subTest(path=path):
                r = c.call("read_deck", path=path)
                self.assertTrue(r["isError"], r)
        r = c.call("create_deck", path="../escape/index.html")
        self.assertTrue(r["isError"])
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "escape")))
        r = c.call("list_decks", folder="..")
        self.assertTrue(r["isError"])
        # An absolute path inside the folder is fine.
        self.assertEqual(c.json_call("read_deck", path=self.deck_file())["path"], DECK)
        # The linked folder's decks are not listed either (the walk does not follow it outside).
        self.assertEqual([d["path"] for d in c.json_call("list_decks")["decks"]], [DECK])

    def test_scripts_an_agent_writes_stay_paused(self):
        # The user trusted the deck with its one script; the settings file is only read.
        full = os.path.realpath(self.deck_file())
        with open(full, "rb") as f:
            own = serve.scan_deck(full, f.read())["own"]
        settings = {"workspace": self.folder, "trusted_decks": {full: serve.scripts_fingerprint(own)}}
        c, _ = self.start(settings)
        with open(self.settings, "rb") as f:
            settings_bytes = f.read()
        deck = c.json_call("read_deck", path=DECK)
        self.assertEqual(deck["own_scripts"], {"count": 1, "trusted": True})
        c.json_call("write_slide", path=DECK, version=deck["version"], slide=3,
                    html='<section class="slide"><h2>Hi</h2><script>document.title = "ran"</script></section>')
        deck = c.json_call("read_deck", path=DECK)
        self.assertEqual(deck["own_scripts"], {"count": 2, "trusted": False})   # paused again until trusted again
        with open(full, "rb") as f:
            data = f.read()
        scan = serve.scan_deck(full, data)
        self.assertNotEqual(serve.scripts_fingerprint(scan["own"]), settings["trusted_decks"][full])
        self.assertNotIn(serve.script_hash('document.title = "ran"'), serve.deck_csp(scan["allow"]))
        with open(self.settings, "rb") as f:
            self.assertEqual(f.read(), settings_bytes)                        # never written

    def test_check_deck(self):
        c, _ = self.start()
        v = c.json_call("read_deck", path=DECK)["version"]
        c.json_call("write_slide", path=DECK, version=v, slide=3,
                    html='<section class="slide" data-name="eq"><figure data-math="\\frac{a}{b"></figure>'
                         '<img src="assets/nowhere.png" alt=""></section>')
        r = c.json_call("check_deck", path=DECK)
        messages = [p["message"] for p in r["problems"] if p["level"] == "ERROR"]
        self.assertTrue(any("nowhere.png" in m for m in messages), messages)
        self.assertTrue(any("slide 3" in m and "will not draw" in m for m in messages), messages)
        self.assertEqual(r["errors"], len(messages))
        self.assertTrue(any("pauses them" in p["message"] for p in r["problems"]))

    def test_create_and_import(self):
        c, _ = self.start()
        made = c.json_call("create_deck", path="talk", template="minimal")
        self.assertEqual(made["path"], "talk/index.html")
        self.assertGreater(made["slide_count"], 1)
        with open(os.path.join(self.folder, "talk", "index.html"), encoding="utf-8") as f:
            self.assertIn("<title>Talk</title>", f.read())
        self.assertTrue(c.call("create_deck", path="talk/index.html")["isError"])          # exists already
        self.assertTrue(c.call("create_deck", path="x.html", template="nope")["isError"])
        with open(os.path.join(self.folder, "notes.md"), "w", encoding="utf-8") as f:
            f.write("# First\n\nHello\n\n---\n\n# Second\n\n- a\n- b\n")
        imp = c.json_call("import_file", source="notes.md", name="from-md")
        self.assertEqual(imp["path"], "from-md/index.html")
        deck = c.json_call("read_deck", path=imp["path"])
        self.assertEqual([s["title"] for s in deck["slides"]][:2], ["First", "Second"])
        self.assertTrue(c.call("import_file", source="../notes.md")["isError"])

    # -- the browser -----------------------------------------------
    @unittest.skipUnless(serve.find_chrome(), "no Chrome or Edge on this computer")
    def test_render_slide_returns_a_png(self):
        c, _ = self.start()
        r = c.call("render_slide", path=DECK, slide=2, scale=0.25)
        self.assertFalse(r["isError"], r["content"][0].get("text"))
        image = r["content"][0]
        self.assertEqual((image["type"], image["mimeType"]), ("image", "image/png"))
        png = base64.b64decode(image["data"])
        self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(struct.unpack(">II", png[16:24]), (480, 270))
        self.assertIn("Slide 2 of 3", r["content"][1]["text"])

    @unittest.skipUnless(serve.find_chrome(), "no Chrome or Edge on this computer")
    def test_export_pdf(self):
        c, _ = self.start()
        r = c.json_call("export_pdf", path=DECK, to="handout")
        self.assertEqual((r["pdf"], r["pages"]), ("sample/handout.pdf", 3))
        with open(os.path.join(self.folder, "sample", "handout.pdf"), "rb") as f:
            self.assertEqual(f.read(5), b"%PDF-")
        self.assertEqual(sorted(n for n in os.listdir(os.path.join(self.folder, "sample")) if n.startswith(".deck-editor-print")), [])


if __name__ == "__main__":
    unittest.main()
