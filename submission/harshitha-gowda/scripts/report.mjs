// Runs the suite and writes reports/junit.xml and reports/test-report.html (no extra dependencies).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const files = globSync('tests/specs/*.spec.ts');
const run = spawnSync('npx', ['tsx', '--test', '--test-reporter=junit', ...files], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
const xml = run.stdout;
mkdirSync('reports', { recursive: true });
writeFileSync('reports/junit.xml', xml);

const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const suites = [];
for (const m of xml.matchAll(/<testsuite name="([^"]*)"[^>]*>([\s\S]*?)<\/testsuite>/g)) {
  const cases = [];
  for (const c of m[2].matchAll(/<testcase name="([^"]*)" time="([^"]*)"[^>]*?(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    cases.push({ name: unescape(c[1]), time: Number(c[2]), failed: Boolean(c[3] && c[3].includes('<failure')), detail: c[3] ?? '' });
  }
  if (cases.length) suites.push({ name: unescape(m[1]), cases });
}

const all = suites.flatMap((s) => s.cases);
const failed = all.filter((c) => c.failed).length;
const passed = all.length - failed;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Test report</title>
<style>
body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
.summary{display:flex;gap:1rem;margin:1rem 0}.card{padding:1rem 1.5rem;border-radius:8px;color:#fff;font-size:1.1rem}
.p{background:#2e7d32}.f{background:${failed ? '#c62828' : '#9e9e9e'}}.t{background:#37474f}
h2{margin-top:1.8rem;font-size:1.05rem}table{width:100%;border-collapse:collapse}
td{padding:.35rem .5rem;border-bottom:1px solid #e0e0e0;font-size:.92rem}td.s{width:2rem}td.d{width:5rem;text-align:right;color:#666}
.ok{color:#2e7d32}.bad{color:#c62828}pre{white-space:pre-wrap;color:#c62828}
</style></head><body>
<h1>Subscription &amp; Billing: test report</h1>
<div class="summary"><div class="card t">${all.length} tests</div><div class="card p">${passed} passed</div><div class="card f">${failed} failed</div></div>
${suites.map((s) => `<h2>${esc(s.name)} (${s.cases.filter((c) => !c.failed).length}/${s.cases.length})</h2><table>${s.cases.map((c) =>
  `<tr><td class="s ${c.failed ? 'bad' : 'ok'}">${c.failed ? '✘' : '✔'}</td><td>${esc(c.name)}${c.failed ? `<pre>${esc(unescape(c.detail))}</pre>` : ''}</td><td class="d">${(c.time * 1000).toFixed(0)} ms</td></tr>`).join('')}</table>`).join('')}
</body></html>`;
writeFileSync('reports/test-report.html', html);
console.log(`${passed}/${all.length} passed. Report: reports/test-report.html`);
process.exit(failed ? 1 : 0);
