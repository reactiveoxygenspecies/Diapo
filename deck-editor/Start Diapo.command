#!/bin/sh
# macOS: double-click to start Diapo (Finder opens this in Terminal).
# The first time, macOS may ask you to allow it: right-click > Open, or run
#   chmod +x "Start Diapo.command" start-diapo.sh
# once from a terminal in this folder.
cd "$(dirname "$0")" || exit 1
exec sh ./start-diapo.sh "$@"
