# Releasing Diapo

What has to happen for a build to go to users, in order. Most of it is one
command; the rest needs the owner (signing, uploading).

## Version and date

A build knows its own version and release date from `APP_VERSION` and
`APP_RELEASED` in `serve.py`. Between releases the repository keeps the last
release's version and date, and the changes wait under `## Unreleased` in
`CHANGELOG.md`. A build made from there (a test exe, say) says it is the last
release; do not hand it out.

## Check

    py -3 tools/release.py check

This checks four things:

- `serve.py`, `package.json`, `package-lock.json` and the newest dated
  changelog heading agree on the version, and the changelog's date is
  `APP_RELEASED`.
- The generated files are current: `diapo-format/` and the skill's runtime
  (`tools/build-format.py`), `app/known-scripts.json`
  (`tools/build-known-scripts.py`) and the site's version line
  (`site/build.py`). It rebuilds them; commit what changed.
- The Python tests pass.
- The browser tests pass (`--no-browser-tests` skips them).

It also notes whether changes are waiting under Unreleased.

## Release

    py -3 tools/release.py 0.2.0                  (dated today; --date YYYY-MM-DD for another day)

The working tree must be clean and `## Unreleased` must have something in it.
The command:

1. sets `APP_VERSION` and `APP_RELEASED`, the version in `package.json` and
   `package-lock.json`, and turns `## Unreleased` into `## 0.2.0 - <date>`;
2. rebuilds the generated files (as in Check), so every script this release
   puts into decks is in `known-scripts.json` and decks made with it are never
   paused by a later Diapo;
3. runs the Python and browser tests;
4. builds `dist/diapo.exe` (`--no-exe` skips it);
5. prints the commands to commit and tag. It commits nothing itself.

Then, by hand:

- **Sign the executable.** `signtool sign /fd sha256 /tr <timestamp URL> /td sha256 /f <certificate> dist\diapo.exe`
  (an unsigned exe gets a SmartScreen warning on every download until it has a
  reputation). The certificate is the owner's to buy.
- **A Mac build**, if there is one: `py -3 build-exe.py` on a Mac, then
  sign and notarise it there. The site's macOS card says "soon" until then.
- **The site.** `site/build.py` (run by the release) lists what still holds a
  placeholder (contact address, hosting provider, the download button's
  link). Fill them
  in, then upload `site/` as it is (a static site).
- **Commit and tag** with the printed commands, and push wherever the
  repository lives.

## Not yet

- **CI.** The repository has no remote, so nothing runs the tests on a push.
  Once it lives somewhere (GitHub, say), a workflow on a Windows runner can
  run `npm run test:py` and `npx playwright test`; Chrome is already on
  those runners. Until then `tools/release.py check` is the gate.
- **Merging** two Diapo processes' settings files; see `save_settings` in
  `serve.py`.
