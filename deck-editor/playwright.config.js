// Playwright configuration for the deck editor's acceptance tests.
// The tests start serve.py on a throw-away workspace (tests/.tmp-workspace)
// that global-setup fills with the sample deck fixture.
const { defineConfig } = require('@playwright/test');
const path = require('path');

const PORT = 8811;
const WORKSPACE = path.join(__dirname, 'tests', '.tmp-workspace');

// The server starts before globalSetup would run, so the workspace is prepared here.
require('./tests/global-setup.js').prepare();

module.exports = defineConfig({
    testDir: './tests',
    timeout: 30000,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        viewport: { width: 1400, height: 900 },
        trace: 'retain-on-failure',
    },
    // `npm test` runs chrome; `npm run test:firefox` runs the same specs in Playwright's
    // Firefox (downloaded once with `npx playwright install firefox`).
    projects: [
        { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } },   // the installed Chrome, so no browser download is needed
        { name: 'firefox', use: { browserName: 'firefox' }, testIgnore: /fonts-local/ },   // installed fonts are a Chrome feature
    ],
    webServer: {
        command: `${process.platform === 'win32' ? 'py -3' : 'python3'} serve.py "${WORKSPACE}" ${PORT} --no-open --settings "${path.join(WORKSPACE, 'settings.json')}"`,
        url: `http://127.0.0.1:${PORT}/api/status`,
        env: { ...process.env, DECK_EDITOR_NO_DIALOG: '1' },     // a dialog would hang a test; the typed-path fallback is tested instead
        reuseExistingServer: false,
        timeout: 15000,
    },
});
