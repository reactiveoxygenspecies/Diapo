"""Unit tests for Diapo stopping itself: the heartbeat watcher (QuitWatch), the "open in" setting,
and the routes the editor uses (/api/heartbeat, /api/quit, /api/open-settings).

    py -3 -m unittest tests.test_quit     (from deck-editor/)

The watcher takes its clock and timings as arguments, so these run in milliseconds.
"""
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from serve_for_tests import serve, TMP  # noqa: E402


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t

    def advance(self, s):
        self.t += s


def watch(**kw):
    quits = []
    clock = Clock()
    w = serve.QuitWatch(lambda: quits.append(1), idle=kw.pop("idle", 180), grace=kw.pop("grace", 15), skip=kw.pop("skip", 20), clock=clock)
    w.enabled = kw.pop("enabled", True)
    return w, clock, quits


def run_for(w, clock, seconds, step=2):
    """Time passing as the watching thread sees it: a look every `step` seconds (a jump of more
    than QuitWatch.skip would be taken for a sleep). True when it quit meanwhile."""
    fired = False
    for _ in range(int(seconds / step)):
        clock.advance(step)
        fired = w.check() or fired
    return fired


class Watcher(unittest.TestCase):
    def test_nothing_quits_before_the_first_page_has_called(self):
        w, clock, quits = watch()
        clock.advance(3600)
        self.assertFalse(w.check())
        self.assertEqual(quits, [])

    def test_a_page_that_keeps_calling_keeps_diapo_running(self):
        w, clock, quits = watch()
        for _ in range(100):
            w.beat("a")
            clock.advance(5)
            self.assertFalse(w.check())
        self.assertEqual(quits, [])

    def test_a_page_that_says_goodbye_stops_diapo_after_the_grace_period_only(self):
        w, clock, quits = watch()
        w.beat("a")
        w.bye("a")
        clock.advance(14)
        self.assertFalse(w.check())
        clock.advance(2)
        self.assertTrue(w.check())
        self.assertEqual(quits, [1])
        clock.advance(100)
        self.assertFalse(w.check())                      # once only
        self.assertEqual(quits, [1])

    def test_a_reload_does_not_stop_diapo(self):
        w, clock, quits = watch()
        w.beat("old")
        w.bye("old")                                     # pagehide of the page being reloaded
        clock.advance(3)
        w.beat("new")                                    # the new page is up a few seconds later
        for _ in range(60):
            clock.advance(5)
            w.beat("new")
            w.check()
        self.assertEqual(quits, [])

    def test_another_tab_keeps_diapo_running_when_one_is_closed(self):
        w, clock, quits = watch()
        w.beat("a"); w.beat("b")
        w.bye("a")
        self.assertFalse(run_for(w, clock, 100))
        w.beat("b")
        w.check()
        self.assertEqual(quits, [])
        w.bye("b")
        clock.advance(16)
        self.assertTrue(w.check())

    def test_a_hidden_tab_that_calls_once_a_minute_is_still_there(self):
        w, clock, quits = watch()
        for _ in range(30):
            w.beat("hidden")
            for _ in range(12):                          # a minute, looked at every five seconds
                clock.advance(5)
                self.assertFalse(w.check())
        self.assertEqual(quits, [])

    def test_a_page_that_vanished_without_goodbye_is_given_up_after_the_idle_time(self):
        w, clock, quits = watch()
        w.beat("crashed")
        self.assertFalse(run_for(w, clock, 178))
        self.assertTrue(run_for(w, clock, 4))

    def test_a_long_job_holds_off_the_quit(self):
        w, clock, quits = watch()
        w.beat("a")
        w.bye("a")
        with w.working():
            self.assertFalse(run_for(w, clock, 500))
            self.assertEqual(quits, [])
        self.assertTrue(w.check())                       # the job is over and nobody is left

    def test_a_computer_that_slept_does_not_look_like_a_closed_tab(self):
        w, clock, quits = watch()
        w.beat("a")
        clock.advance(100)
        w.check()
        clock.advance(8 * 3600)                          # the lid was closed; the clock counted it
        self.assertFalse(w.check())
        self.assertEqual(w.pages, {"a": mock.ANY})
        clock.advance(5)
        w.beat("a")                                      # the page wakes and calls
        for _ in range(10):
            clock.advance(5)
            w.check()
        self.assertEqual(quits, [])

    def test_sleep_gives_back_only_the_time_a_page_had_left(self):
        w, clock, quits = watch()
        w.beat("a")
        w.bye("a")                                       # 15 s to go
        clock.advance(5)
        w.check()
        clock.advance(8 * 3600)
        self.assertFalse(w.check())                      # forgiven the sleep
        clock.advance(11)                                # the 10 s it had left
        self.assertTrue(w.check())

    def test_off_when_diapo_was_not_opened_in_a_tab(self):
        w, clock, quits = watch(enabled=False)
        w.beat("a")
        w.bye("a")
        clock.advance(1000)
        self.assertFalse(w.check())
        self.assertEqual(quits, [])

    def test_the_watching_thread_quits_in_milliseconds(self):
        done = threading.Event()
        w = serve.QuitWatch(done.set, idle=0.3, grace=0.05, skip=5, tick=0.02)
        w.enabled = True
        w.start()
        w.beat("a")
        time.sleep(0.15)
        self.assertFalse(done.is_set())                  # still open
        w.bye("a")
        self.assertTrue(done.wait(2))


class OpenInSetting(unittest.TestCase):
    def setUp(self):
        self.patches = [mock.patch.object(serve, "SETTINGS_FILE", os.path.join(tempfile.mkdtemp(dir=TMP), "s.json")),
                        mock.patch.object(serve, "SETTINGS", {}),
                        mock.patch.object(serve, "SETTINGS_WRITABLE", True)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()

    def test_its_own_window_unless_the_user_chose_the_browser(self):
        self.assertEqual(serve.open_in_setting(), "window")
        serve.SETTINGS["open_in"] = "browser"
        self.assertEqual(serve.open_in_setting(), "browser")
        serve.SETTINGS["open_in"] = "nonsense"
        self.assertEqual(serve.open_in_setting(), "window")

    def _open(self, argv, chrome="C:/chrome.exe"):
        with mock.patch.object(serve.sys, "argv", ["serve.py"] + argv), \
                mock.patch.object(serve, "find_chrome", return_value=chrome), \
                mock.patch.object(serve.webbrowser, "open") as tab, \
                mock.patch.object(serve.subprocess, "Popen") as popen, \
                mock.patch("builtins.print"):
            win = serve.open_window("http://127.0.0.1:1/", 1, console=False)
        return win, tab, popen

    def test_window_mode_starts_the_app_window(self):
        win, tab, popen = self._open([])
        self.assertIsNotNone(win)
        self.assertTrue(popen.call_args[0][0][1].startswith("--app="))
        tab.assert_not_called()

    def test_browser_mode_opens_a_tab_even_with_chrome_installed(self):
        serve.SETTINGS["open_in"] = "browser"
        win, tab, popen = self._open([])
        self.assertIsNone(win)
        tab.assert_called_once()
        popen.assert_not_called()

    def test_the_tab_option_wins_over_the_window_setting(self):
        win, tab, popen = self._open(["--tab"])
        self.assertIsNone(win)
        tab.assert_called_once()
        popen.assert_not_called()

    def test_without_chrome_the_window_setting_falls_back_to_a_tab(self):
        win, tab, popen = self._open([], chrome=None)
        self.assertIsNone(win)
        tab.assert_called_once()


class Routes(unittest.TestCase):
    """The handler on a real socket: the heartbeat, the quit and the setting."""

    @classmethod
    def setUpClass(cls):
        cls.server = serve.http.server.ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler)
        cls.port = cls.server.server_address[1]
        cls.old_port = serve.PORT
        serve.PORT = cls.port
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        serve.PORT = cls.old_port

    def setUp(self):
        self.watch = serve.QuitWatch(lambda: None)
        self.patches = [mock.patch.object(serve, "QUIT_WATCH", self.watch),
                        mock.patch.object(serve, "SETTINGS_FILE", os.path.join(tempfile.mkdtemp(dir=TMP), "s.json")),
                        mock.patch.object(serve, "SETTINGS", {}),
                        mock.patch.object(serve, "SETTINGS_WRITABLE", True)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()

    def post(self, path):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method="POST", data=b"",
                                     headers={"Origin": f"http://127.0.0.1:{self.port}"})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    def test_heartbeat_registers_and_bye_shortens_the_page(self):
        self.assertEqual(self.post("/api/heartbeat?id=tab1")[0], 200)
        self.assertIn("tab1", self.watch.pages)
        self.assertTrue(self.watch.seen)
        before = self.watch.pages["tab1"]
        self.assertEqual(self.post("/api/heartbeat?id=tab1&bye=1")[0], 200)
        self.assertLess(self.watch.pages["tab1"], before)

    def test_page_ids_are_cleaned(self):
        self.post("/api/heartbeat?id=" + "a/../b%20c" + "x" * 100)
        (pid,) = self.watch.pages
        self.assertRegex(pid, r"^[\w.-]{1,64}$")

    def test_a_request_in_flight_counts_as_work_but_the_heartbeat_does_not(self):
        seen = []
        orig = self.watch.working

        def spy():
            seen.append(1)
            return orig()
        self.watch.working = spy
        self.post("/api/heartbeat?id=t")
        self.assertEqual(seen, [])
        self.post("/api/open-settings?in=browser")
        self.assertEqual(seen, [1])
        self.assertEqual(self.watch.busy, 0)

    def test_open_settings_keeps_the_choice_and_refuses_anything_else(self):
        self.assertEqual(self.post("/api/open-settings?in=browser"), (200, {"ok": True, "open_in": "browser"}))
        self.assertEqual(serve.SETTINGS["open_in"], "browser")
        with open(serve.SETTINGS_FILE, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["open_in"], "browser")
        self.assertEqual(self.post("/api/open-settings?in=elsewhere")[0], 400)
        self.assertEqual(serve.SETTINGS["open_in"], "browser")

    def test_quit_stops_the_server_after_answering(self):
        with mock.patch.object(serve, "stop_server") as stop, mock.patch("builtins.print"):
            self.assertEqual(self.post("/api/quit"), (200, {"ok": True}))
        stop.assert_called_once()

    def test_a_request_from_another_site_cannot_quit_diapo(self):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/api/quit", method="POST", data=b"",
                                     headers={"Origin": "http://evil.example"})
        with mock.patch.object(serve, "stop_server") as stop:
            with self.assertRaises(urllib.error.HTTPError) as cm:
                urllib.request.urlopen(req, timeout=5)
        self.assertEqual(cm.exception.code, 403)
        stop.assert_not_called()


if __name__ == "__main__":
    unittest.main()
