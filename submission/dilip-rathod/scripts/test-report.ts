/**
 * Runs the test suite and writes a readable HTML report to reports/test-report.html.
 * The report is written even when tests fail; the exit code is the test run's.
 * Run: npm run test:report
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface VitestTest {
  ancestorTitles: string[];
  title: string;
  status: string;
  duration?: number;
  failureMessages: string[];
}
interface VitestFile {
  name: string;
  endTime: number;
  assertionResults: VitestTest[];
}
interface VitestResults {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  startTime: number;
  testResults: VitestFile[];
}

const REPORT_DIR = path.resolve(__dirname, '..', 'reports');
const RESULTS = path.join(REPORT_DIR, 'results.json');
const OUTPUT = path.join(REPORT_DIR, 'test-report.html');

const platformName = () => ({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' })[process.platform as string] ?? process.platform;

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.rmSync(RESULTS, { force: true });
const run = spawnSync('npx', ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${RESULTS}`], {
  stdio: 'inherit',
  shell: true,
});
if (!fs.existsSync(RESULTS)) {
  console.error('Vitest did not produce results; no report written.');
  process.exit(run.status ?? 1);
}
const r = JSON.parse(fs.readFileSync(RESULTS, 'utf8')) as VitestResults;

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ENTITIES[c]);
const LEVELS: Record<string, string> = {
  api: 'API contract & validation',
  lifecycle: 'State machine / lifecycle',
  webhooks: 'Webhooks: idempotency & ordering',
  provider: 'Payment provider (mock)',
  persistence: 'Persistence / database',
  e2e: 'End to end',
};

const files = r.testResults.map((f) => {
  const rel = f.name.replace(/\\/g, '/').split('/test/specs/')[1] ?? f.name;
  const level = rel.split('/')[0];
  const tests = f.assertionResults;
  const duration = tests.reduce((a, t) => a + (t.duration ?? 0), 0);
  return { rel, level, tests, duration, failed: tests.filter((t) => t.status !== 'passed').length };
});
const order = Object.keys(LEVELS);
files.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level) || a.rel.localeCompare(b.rel));

const total = r.numTotalTests, passed = r.numPassedTests, failed = r.numFailedTests;
const wall = ((Math.max(...r.testResults.map((f) => f.endTime)) - r.startTime) / 1000).toFixed(2);
const when = new Date(r.startTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

const levelRows = order
  .map((lvl) => {
    const fs_ = files.filter((f) => f.level === lvl);
    const n = fs_.reduce((a, f) => a + f.tests.length, 0);
    const bad = fs_.reduce((a, f) => a + f.failed, 0);
    return `<tr><td>${LEVELS[lvl]}</td><td class="num">${fs_.length}</td><td class="num">${n}</td><td class="num ${bad ? 'bad' : 'ok'}">${bad ? bad + ' failed' : 'all passed'}</td></tr>`;
  })
  .join('');

const fileSections = files
  .map((f) => {
    const groups = new Map<string, VitestTest[]>();
    for (const t of f.tests) {
      const key = t.ancestorTitles.join(' › ');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    const body = [...groups]
      .map(([g, ts]) => `<div class="group"><div class="gtitle">${esc(g)}</div><ul>${ts
        .map((t) => `<li class="${t.status}"><span class="mark">${t.status === 'passed' ? '✓' : '✗'}</span><span class="tname">${esc(t.title)}</span><span class="dur">${Math.round(t.duration ?? 0)} ms</span>${t.failureMessages.length ? `<pre>${esc(t.failureMessages.join('\n'))}</pre>` : ''}</li>`)
        .join('')}</ul></div>`)
      .join('');
    return `<details${f.failed ? ' open' : ''}><summary><span class="badge ${f.failed ? 'bad' : 'ok'}">${f.failed ? f.failed + ' failed' : f.tests.length + ' passed'}</span><code>${esc(f.rel)}</code><span class="lvl">${LEVELS[f.level] ?? ''}</span><span class="dur">${(f.duration / 1000).toFixed(2)} s</span></summary>${body}</details>`;
  })
  .join('');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test Report</title>
<style>
:root{--bg:#f7f8fa;--card:#fff;--ink:#1d2330;--muted:#5d6676;--line:#e3e6eb;--ok:#137a3f;--okbg:#e6f4ec;--bad:#b42318;--badbg:#fdecea;--accent:#2b5cd6}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#12151b;--card:#1a1e26;--ink:#e6e9ef;--muted:#9aa3b2;--line:#2a303b;--ok:#5fd394;--okbg:#173225;--bad:#ff8a80;--badbg:#3a1d1b;--accent:#8fb0ff}}
:root[data-theme="dark"]{--bg:#12151b;--card:#1a1e26;--ink:#e6e9ef;--muted:#9aa3b2;--line:#2a303b;--ok:#5fd394;--okbg:#173225;--bad:#ff8a80;--badbg:#3a1d1b;--accent:#8fb0ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:26px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 24px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.tile .v{font-size:28px;font-weight:650;font-variant-numeric:tabular-nums}.tile .k{color:var(--muted);font-size:13px}
.tile.ok .v{color:var(--ok)}.tile.bad .v{color:var(--bad)}
h2{font-size:17px;margin:28px 0 10px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line)}th{font-size:13px;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}.num{text-align:right;font-variant-numeric:tabular-nums}td.ok{color:var(--ok)}td.bad{color:var(--bad)}
details{background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:10px}
summary{cursor:pointer;padding:12px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
summary code{font-size:13.5px;word-break:break-all}.lvl{color:var(--muted);font-size:13px}
summary .dur{margin-left:auto}.dur{color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
.badge{font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px}.badge.ok{background:var(--okbg);color:var(--ok)}.badge.bad{background:var(--badbg);color:var(--bad)}
.group{padding:4px 14px 10px;border-top:1px solid var(--line)}.gtitle{font-size:13px;font-weight:600;color:var(--accent);margin:8px 0 4px}
ul{list-style:none;margin:0;padding:0}li{display:flex;gap:8px;align-items:baseline;padding:3px 0;flex-wrap:wrap}
.mark{width:14px;flex:none;font-weight:700}li.passed .mark{color:var(--ok)}li.failed .mark{color:var(--bad)}
.tname{flex:1;min-width:0}pre{width:100%;white-space:pre-wrap;background:var(--badbg);color:var(--bad);padding:8px;border-radius:6px;font-size:12px}
</style></head><body><main>
<h1>Subscription &amp; Billing: Test Report</h1>
<p class="sub">Vitest run on ${esc(when)} IST · ${esc(platformName())}, Node ${esc(process.version)}</p>
<div class="tiles">
<div class="tile ${failed ? 'bad' : 'ok'}"><div class="v">${passed}/${total}</div><div class="k">tests passed</div></div>
<div class="tile"><div class="v">${files.length}</div><div class="k">spec files</div></div>
<div class="tile ${failed ? 'bad' : ''}"><div class="v">${failed}</div><div class="k">failed</div></div>
<div class="tile"><div class="v">${wall} s</div><div class="k">wall-clock time</div></div>
</div>
<h2>By test level</h2>
<table><thead><tr><th>Level</th><th class="num">Files</th><th class="num">Tests</th><th class="num">Result</th></tr></thead><tbody>${levelRows}</tbody></table>
<h2>All test cases</h2>
<p class="sub">Click a file to expand its test cases.</p>
${fileSections}
</main></body></html>`;

fs.writeFileSync(OUTPUT, html);
console.log(`
Test report: ${OUTPUT} (${passed}/${total} passed)`);
process.exit(run.status ?? 1);
