// Creates the throw-away workspace the tests run against, from the fixture deck.
const fs = require('fs');
const path = require('path');

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-deck');
const WORKSPACE = path.join(__dirname, '.tmp-workspace');
const DECK_DIR = path.join(WORKSPACE, 'sample');

function prepare() {
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    fs.mkdirSync(DECK_DIR, { recursive: true });
    fs.cpSync(FIXTURE, DECK_DIR, { recursive: true });
}
module.exports = { prepare };
