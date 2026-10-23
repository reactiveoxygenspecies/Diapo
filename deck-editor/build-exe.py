"""Build a single-file executable of Diapo with PyInstaller, so a machine
without Python can run it.

    py -3 -m pip install pyinstaller      (once)
    py -3 build-exe.py                    -> dist/diapo.exe (Windows), dist/diapo (macOS, Linux)

The executable is the server plus the app files (app/ is unpacked at start into a
temporary folder that serve.py finds through sys._MEIPASS). Run it like serve.py:

    diapo [folder] [port] [--tab | --no-open] [--backups N]

It opens Diapo in its own window (the Chrome or Edge of that machine in app
mode) and quits when the window closes; it remembers the last folder in
~/.deck-editor.json like the script does. The build is windowed: no console,
so what the server would print goes to ~/.deck-editor.log and a fatal error
is shown in a message box. On macOS --windowed also produces dist/diapo.app.
Build on the platform you distribute to (PyInstaller does not cross-compile).
Chrome or Edge on the target machine is what shows the window and prints PDFs.

The executable's icon is app/brand/icon.ico on Windows and app/brand/icon.icns
on macOS when that file exists (make it on a Mac with `iconutil` from
app/brand/icon-256.png); both come from `node tools/build-icon.js`, with
the page's icons for the Chrome app window.
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        sys.exit("PyInstaller is not installed. Run:  " + sys.executable + " -m pip install pyinstaller")
    os.chdir(HERE)
    for d in ("build", "dist"):
        shutil.rmtree(d, ignore_errors=True)
    sep = os.pathsep                      # ";" on Windows, ":" elsewhere, as --add-data wants
    args = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile",
        "--name", "diapo",
        "--add-data", "app" + sep + "app",
        "--hidden-import", "tkinter", "--hidden-import", "tkinter.filedialog",   # the picker imports them at run time
        "--hidden-import", "pptx_import", "--hidden-import", "pptx_chart", "--hidden-import", "emf_svg",
        "--hidden-import", "pptx_export", "--hidden-import", "pptx_chart_export",  # imported inside functions
        "--windowed",                     # no console: the app window is the program; output goes to ~/.deck-editor.log
    ]
    icon = os.path.join("app", "brand", "icon.icns" if sys.platform == "darwin" else "icon.ico")
    if sys.platform != "linux" and os.path.exists(icon):   # PyInstaller has no icon option on Linux
        args += ["--icon", icon]
    args.append("serve.py")
    print(" ".join(args))
    r = subprocess.run(args)
    if r.returncode != 0:
        sys.exit("PyInstaller failed")
    exe = os.path.join(HERE, "dist", "diapo" + (".exe" if sys.platform == "win32" else ""))
    print("\nBuilt", exe, f"({os.path.getsize(exe) // (1024 * 1024)} MB)")
    print("Start it with a folder of decks as the argument, or double-click it and choose the folder in the Decks drawer.")


if __name__ == "__main__":
    main()
