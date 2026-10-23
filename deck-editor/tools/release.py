#!/usr/bin/env python3
"""Make a release of Diapo, or check that the repository is ready for one.

    py -3 tools/release.py check                 is everything consistent? (changes nothing but the
                                                 generated files, which it brings up to date)
    py -3 tools/release.py 0.2.0                 make release 0.2.0, dated today
    py -3 tools/release.py 0.2.0 --date 2026-10-05 --no-browser-tests --no-exe

Every build that goes to users carries its own version and release date
(APP_VERSION and APP_RELEASED in serve.py), shown in the editor and on the site.

A release (see RELEASING.md for the whole list, signing and the site included):
  1. the working tree must be clean and CHANGELOG.md must have an "## Unreleased"
     section with something in it;
  2. APP_VERSION and APP_RELEASED (serve.py), the version in package.json and
     package-lock.json, and the changelog heading ("## 0.2.0 - 2026-10-05") are set;
  3. the generated files are rebuilt: diapo-format/ and the skill's copies
     (tools/build-format.py), app/known-scripts.json (tools/build-known-scripts.py),
     the site's version line (site/build.py, which also lists the placeholders);
  4. the tests run (Python, then the browser tests unless --no-browser-tests);
  5. the executable is built (unless --no-exe);
  6. the commands to commit and tag are printed; nothing is committed here.
"""
import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
EDITOR = os.path.normpath(os.path.join(HERE, ".."))
ROOT = os.path.normpath(os.path.join(EDITOR, ".."))
SERVE = os.path.join(EDITOR, "serve.py")
CHANGELOG = os.path.join(EDITOR, "CHANGELOG.md")
PACKAGE = os.path.join(EDITOR, "package.json")
LOCK = os.path.join(EDITOR, "package-lock.json")
GENERATED = ["diapo-format", "skills/diapo-deck/deck-runtime.js", "deck-editor/app/known-scripts.json", "site/index.html"]
PY = [sys.executable]
NPM = shutil.which("npm") or "npm"            # npm.cmd on Windows
NPX = shutil.which("npx") or "npx"


def read(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def run(args, cwd=EDITOR, check=True):
    print("  $ " + " ".join(args))
    r = subprocess.run(args, cwd=cwd)
    if check and r.returncode != 0:
        sys.exit(f"failed: {' '.join(args)}")
    return r.returncode == 0


def git(*args):
    return subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True, check=True).stdout


def app_constants():
    src = read(SERVE)
    return (re.search(r'^APP_VERSION = "([^"]+)"', src, re.M).group(1),
            re.search(r'^APP_RELEASED = "([^"]+)"', src, re.M).group(1))


def changelog_releases():
    """[(version, date)] of the dated headings, newest first, and whether an Unreleased section has content."""
    text = read(CHANGELOG)
    releases = re.findall(r"^## (\d+\.\d+\.\d+) - (\d{4}-\d\d-\d\d)\s*$", text, re.M)
    m = re.search(r"^## Unreleased\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    return releases, bool(m and m.group(1).strip())


def package_versions():
    return json.loads(read(PACKAGE))["version"], json.loads(read(LOCK))["version"]


def rebuild_generated():
    """Bring the generated files up to date; returns the ones that changed."""
    run(PY + ["tools/build-format.py"])
    run(PY + ["tools/build-known-scripts.py"])
    run(PY + [os.path.join(ROOT, "site", "build.py")])
    changed = git("status", "--porcelain", "--", *GENERATED).splitlines()
    return [line[3:] for line in changed]


def check(args):
    problems, notes = [], []
    version, released = app_constants()
    pkg, lock = package_versions()
    releases, pending = changelog_releases()
    print(f"serve.py: APP_VERSION {version}, APP_RELEASED {released}")
    if pkg != version or lock != version:
        problems.append(f"package.json says {pkg} and package-lock.json {lock}, serve.py {version}")
    if not releases:
        problems.append("CHANGELOG.md has no dated release heading (## x.y.z - YYYY-MM-DD)")
    else:
        last_v, last_d = releases[0]
        if last_v != version:
            problems.append(f"the newest release in CHANGELOG.md is {last_v}, serve.py says {version}")
        elif last_d != released:
            problems.append(f"CHANGELOG.md dates {last_v} {last_d}, APP_RELEASED says {released}")
    if pending:
        notes.append("CHANGELOG.md has changes under Unreleased: the build carries them under the old version and date "
                     "until a release (py -3 tools/release.py <version>)")
    print("Generated files:")
    stale = rebuild_generated()
    if stale:
        notes.append("brought up to date, commit them: " + ", ".join(stale))
    print("Tests:")
    if not run([NPM, "run", "test:py"], check=False):
        problems.append("the Python tests fail")
    if args.browser_tests and not run([NPX, "playwright", "test"], check=False):
        problems.append("the browser tests fail")
    print()
    for n in notes:
        print("note:", n)
    for p in problems:
        print("PROBLEM:", p)
    if not problems:
        print("Consistent." + (" Ready to release." if not stale else ""))
    return 1 if problems else 0


def bump(version, date):
    src = read(SERVE)
    src = re.sub(r'^APP_VERSION = "[^"]+"', f'APP_VERSION = "{version}"', src, count=1, flags=re.M)
    src = re.sub(r'^APP_RELEASED = "[^"]+"', f'APP_RELEASED = "{date}"', src, count=1, flags=re.M)
    write(SERVE, src)
    for path in (PACKAGE, LOCK):
        data = json.loads(read(path))
        data["version"] = version
        if path == LOCK:
            data["name"] = json.loads(read(PACKAGE))["name"]
            if "" in data.get("packages", {}):
                data["packages"][""]["version"] = version
                data["packages"][""]["name"] = data["name"]
        write(path, json.dumps(data, indent=2) + "\n")
    text = read(CHANGELOG)
    write(CHANGELOG, re.sub(r"^## Unreleased[ \t]*$", f"## {version} - {date}", text, count=1, flags=re.M))


def release(args):
    version = args.version
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        sys.exit("a version is three numbers: 0.2.0")
    current, _ = app_constants()
    if tuple(map(int, version.split("."))) <= tuple(map(int, current.split("."))):
        sys.exit(f"{version} is not after the current {current}")
    date = args.date or datetime.date.today().isoformat()
    datetime.date.fromisoformat(date)
    if git("status", "--porcelain").strip():
        sys.exit("the working tree has uncommitted changes: commit or stash them first")
    _, pending = changelog_releases()
    if not pending:
        sys.exit("CHANGELOG.md has nothing under ## Unreleased: what is in this release?")
    print(f"Release {version}, dated {date}")
    bump(version, date)
    print("Generated files:")
    rebuild_generated()
    print("Tests:")
    run([NPM, "run", "test:py"])
    if args.browser_tests:
        run([NPX, "playwright", "test"])
    if args.exe:
        print("Executable:")
        run(PY + ["build-exe.py"])
    print(f"""
Release {version} is ready. Look over the changes (git diff), then:

    git -C "{ROOT}" add -A
    git -C "{ROOT}" commit -m "Release {version}"
    git -C "{ROOT}" tag v{version}

Still by hand (RELEASING.md): sign deck-editor/dist/diapo.exe, upload it and the
site (site/), and fill in the placeholders site/build.py listed above.""")
    return 0


def main():
    p = argparse.ArgumentParser(description="Make a release of Diapo, or check that the repository is ready for one.")
    p.add_argument("version", help='"check", or the new version (x.y.z)')
    p.add_argument("--date", help="release date, YYYY-MM-DD (default: today)")
    p.add_argument("--no-browser-tests", dest="browser_tests", action="store_false", help="skip the Playwright tests")
    p.add_argument("--no-exe", dest="exe", action="store_false", help="do not build the executable")
    args = p.parse_args()
    sys.stdout.reconfigure(line_buffering=True)        # this script's lines in order with the commands' output
    os.chdir(EDITOR)
    sys.exit(check(args) if args.version == "check" else release(args))


if __name__ == "__main__":
    main()
