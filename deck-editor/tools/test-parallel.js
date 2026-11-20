/* The browser tests in parallel: `npm test`.

   The suite runs one test at a time against one server and one workspace, so it cannot
   use Playwright's own workers. This splits it with --shard instead: each part gets its
   own serve.py (DIAPO_TEST_PORT), its own throw-away workspace (DIAPO_TEST_WS) and its
   own results folder, and the parts run side by side. Each part's output goes to
   test-results/shard-N.log; the summary and any failures are printed at the end.

     node tools/test-parallel.js                 every spec, in Chrome
     node tools/test-parallel.js -n 4            in 4 parts (default: 6, fewer on a small machine)
     node tools/test-parallel.js tests/find.spec.js -g F2      other arguments go to Playwright

   One part on its own is what CI runs on each runner:
     npx playwright test --project=chrome --shard=2/3
*/
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
let parts = Math.max(1, Math.min(6, Math.floor(os.cpus().length / 2)));
const ni = args.indexOf('-n');
if (ni >= 0) { parts = Math.max(1, parseInt(args[ni + 1], 10) || parts); args.splice(ni, 2); }
const base = +process.env.DIAPO_TEST_PORT_BASE || 8840;
const results = path.join(ROOT, 'test-results');
fs.mkdirSync(results, { recursive: true });

// Playwright's command line run by this Node, with no shell between (arguments with spaces stay whole).
const CLI = require.resolve('@playwright/test/cli', { paths: [ROOT] });
const t0 = Date.now();
console.log(`Browser tests in ${parts} parts (logs in test-results/shard-N.log)...`);

function runPart(i) {
    return new Promise((resolve) => {
        const log = path.join(results, `shard-${i}.log`);
        const out = fs.createWriteStream(log);
        const env = {
            ...process.env,
            DIAPO_TEST_PORT: String(base + i),
            DIAPO_TEST_WS: path.join(ROOT, 'tests', `.tmp-workspace-${i}`),
        };
        const pw = [CLI, 'test', '--project=chrome', `--shard=${i}/${parts}`, '--reporter=line', `--output=${path.join('test-results', 'shard-' + i)}`, ...args];
        const child = spawn(process.execPath, pw, { cwd: ROOT, env });
        let text = '';
        const keep = (b) => { out.write(b); text += b.toString(); };
        child.stdout.on('data', keep);
        child.stderr.on('data', keep);
        child.on('close', (code) => {
            out.end();
            const secs = Math.round((Date.now() - t0) / 1000);
            const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
            const counts = (plain.match(/^\s+\d+ (passed|failed|flaky|skipped|did not run|interrupted).*$/gm) || []).map(s => s.trim()).join(', ');
            console.log(`  part ${i}: ${code === 0 ? 'ok' : 'FAILED'} after ${secs} s${counts ? ' (' + counts + ')' : ''}`);
            resolve({ i, code, plain, log });
        });
    });
}

Promise.all(Array.from({ length: parts }, (_, k) => runPart(k + 1))).then((all) => {
    const failed = all.filter(r => r.code !== 0);
    for (const r of failed) {
        // Playwright's own list of what failed, at the end of the part's output.
        const m = r.plain.match(/\n\s+\d+ failed[\s\S]*$/);
        console.log(`\n--- part ${r.i} (${path.relative(ROOT, r.log)}) ---${m ? m[0] : '\n' + r.plain.slice(-2000)}`);
    }
    console.log(`\n${failed.length ? 'FAILED' : 'All parts passed'} in ${Math.round((Date.now() - t0) / 1000)} s`);
    process.exit(failed.length ? 1 : 0);
});
