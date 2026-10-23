"""serve.py for the unit tests: it reads its command line when imported, so it is imported
here once, pointed at a throw-away workspace and settings file (TMP, removed at exit)."""
import atexit
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

TMP = tempfile.mkdtemp(prefix="diapo-serve-")
atexit.register(shutil.rmtree, TMP, True)
_argv = sys.argv
sys.argv = ["serve.py", TMP, "--settings", os.path.join(TMP, "settings.json"), "--no-open"]
try:
    import serve  # noqa: E402,F401
finally:
    sys.argv = _argv
