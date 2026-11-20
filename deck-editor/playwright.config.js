// Playwright configuration for the deck editor's acceptance tests.
// The tests start serve.py on a throw-away workspace (tests/.tmp-workspace)
// that global-setup fills with the sample deck fixture.
const { defineConfig } = require('@playwright/test');
const path = require('path');

// DIAPO_TEST_PORT / DIAPO_TEST_WS let two runs work side by side (each its own server and workspace).
const PORT = +process.env.DIAPO_TEST_PORT || 8811;
const WORKSPACE = process.env.DIAPO_TEST_WS || path.join(__dirname, 'tests', '.tmp-workspace');

// The server starts before globalSetup would run, so the workspace is prepared here.
require('./tests/global-setup.js').prepare();

const TOOLS = process.env.PPTX_SHOTS ? [] : [/zz-pptx/];

module.exports = defineConfig({
    testDir: './tests',
    timeout: 30000,
    fullyParallel: false,
    workers: 1,
    // On GitHub's Windows runners a test now and then fails for the machine, not for Diapo
    // (net::ERR_NO_BUFFER_SPACE loading editor.js): there a failed test runs once more, and the
    // report lists it as flaky. Locally a failure is a failure.
    retries: process.env.CI ? 1 : 0,
    reporter: [['list']],
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        viewport: { width: 1400, height: 900 },
        trace: 'retain-on-failure',
    },
    // `npm test` runs chrome; `npm run test:firefox` runs the same specs in Playwright's
    // Firefox (downloaded once with `npx playwright install firefox`).
    // tests/zz-pptx.spec.js is a tool, not a test (PowerPoint exports of the templates with
    // screenshots beside them, for tools/pptx-compare.js): it runs only when asked,
    // PPTX_SHOTS=1 npx playwright test --project=chrome zz-pptx
    projects: [
        { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' }, testIgnore: TOOLS },   // the installed Chrome, so no browser download is needed
        { name: 'firefox', use: { browserName: 'firefox' }, testIgnore: [/fonts-local/].concat(TOOLS) },   // installed fonts are a Chrome feature
    ],
    webServer: {
        command: `${process.platform === 'win32' ? 'py -3' : 'python3'} serve.py "${WORKSPACE}" ${PORT} --no-open --settings "${path.join(WORKSPACE, 'settings.json')}"`,
        url: `http://127.0.0.1:${PORT}/api/status`,
        env: { ...process.env, DECK_EDITOR_NO_DIALOG: '1', DIAPO_UPDATE_URL: path.join(WORKSPACE, 'update-stub.json') },     // a dialog would hang a test; the typed-path fallback is tested instead
        reuseExistingServer: false,
        timeout: 15000,
    },
});
