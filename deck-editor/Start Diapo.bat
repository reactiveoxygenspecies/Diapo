@echo off
rem Starts Diapo in its own window. It reopens the folder you used last time;
rem the first time it uses the workspace folder beside this one. Drop a folder onto this
rem file to start with that folder instead. Change folders any time from
rem the Decks drawer.
rem With the python.org launcher, pyw runs the server without a console
rem window (output goes to %USERPROFILE%\.deck-editor.log); otherwise a
rem console stays open and shows it.
cd /d "%~dp0"
set "ARGS=--default ..\workspace"
if not "%~1"=="" set ARGS="%~1"
py -3 -c "" >nul 2>&1
if not errorlevel 1 (
  start "" pyw -3 serve.py %ARGS%
) else (
  python serve.py %ARGS%
  pause
)
