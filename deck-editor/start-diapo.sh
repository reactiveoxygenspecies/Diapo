#!/bin/sh
# Starts Diapo on macOS or Linux. It reopens the folder you used last
# time; the first time it uses the workspace folder beside this one. Pass a folder to start with
# that folder instead. Change folders any time from the Decks drawer in the browser.
cd "$(dirname "$0")" || exit 1
PY=python3
command -v python3 >/dev/null 2>&1 || PY=python
if [ -z "$1" ]; then
  exec "$PY" serve.py --default ../workspace
else
  exec "$PY" serve.py "$1"
fi
