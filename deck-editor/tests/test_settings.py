"""Unit tests for the settings file (~/.deck-editor.json): it holds the workspace, the
trusted decks and the saved themes, so it is never half-written or lost.

    py -3 -m unittest tests.test_settings     (from deck-editor/)
"""
import glob
import json
import os
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from serve_for_tests import serve, TMP  # noqa: E402


class SettingsFile(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(dir=TMP)
        self.file = os.path.join(self.dir, "settings.json")
        self.patches = [mock.patch.object(serve, "SETTINGS_FILE", self.file),
                        mock.patch.object(serve, "SETTINGS", {}),
                        mock.patch.object(serve, "SETTINGS_WRITABLE", True),
                        mock.patch.object(serve, "SETTINGS_NOTES", [])]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()

    def read(self):
        with open(self.file, encoding="utf-8") as f:
            return json.load(f)

    def leftovers(self):
        return glob.glob(os.path.join(self.dir, "*.tmp"))

    def test_changes_from_many_threads_all_arrive_whole(self):
        def worker(i):
            for n in range(40):
                with serve.settings_change() as s:
                    s["k%d" % i] = n
                serve.remember_deck(self.dir, "deck%d/index.html" % i)
        threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        data = self.read()
        self.assertEqual({k: data[k] for k in data if k.startswith("k")}, {"k%d" % i: 39 for i in range(8)})
        self.assertEqual(len(data["recent"]), 8)
        self.assertEqual(self.leftovers(), [])

    def test_a_failed_write_leaves_the_previous_file(self):
        with serve.settings_change() as s:
            s["workspace"] = "KEEP"
        with mock.patch.object(serve.os, "replace", side_effect=OSError("disk full")), mock.patch("builtins.print"):
            with serve.settings_change() as s:
                s["workspace"] = None
        self.assertEqual(self.read()["workspace"], "KEEP")
        self.assertEqual(self.leftovers(), [])

    def test_a_damaged_file_is_kept_aside_not_written_over(self):
        with open(self.file, "w", encoding="utf-8") as f:
            f.write('{"workspace": "KEEP", ')
        self.assertEqual(serve.load_settings(), {})
        broken = glob.glob(self.file + ".broken-*")
        self.assertEqual(len(broken), 1)
        with open(broken[0], encoding="utf-8") as f:
            self.assertIn("KEEP", f.read())
        self.assertTrue(serve.SETTINGS_NOTES)

    def test_a_file_that_cannot_be_opened_is_left_alone(self):
        with open(self.file, "w", encoding="utf-8") as f:
            json.dump({"workspace": "KEEP"}, f)
        with mock.patch("builtins.open", side_effect=PermissionError("locked")), mock.patch.object(serve.time, "sleep"):
            self.assertEqual(serve.load_settings(), {})
        self.assertFalse(serve.SETTINGS_WRITABLE)
        with serve.settings_change() as s:              # the session goes on, without writing over the file
            s["backups"] = 3
        self.assertEqual(self.read(), {"workspace": "KEEP"})


if __name__ == "__main__":
    unittest.main()
