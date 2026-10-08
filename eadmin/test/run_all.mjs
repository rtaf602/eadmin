// Runs every scenario one after another and prints a summary.
// A run counts as clean when the process exits 0 and every "errors" line it prints is an empty list.
//   node test/run_all.mjs              all of them
//   node test/run_all.mjs auth_api     only some; set VERBOSE=1 to see every line
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('.', import.meta.url));
const tests = ['auth_api', 'auth_site'];
const only = process.argv.slice(2);
let bad = 0;
for (const t of tests.filter((x) => !only.length || only.includes(x))) {
  const r = spawnSync(process.execPath, [dir + t + '.mjs'], { encoding: 'utf8', timeout: 600000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const errs = [...out.matchAll(/errors[^:\n]*:\s*(\[.*?\])(?=\s|$)/g)].map((m) => m[1]);
  const clean = r.status === 0 && errs.every((e) => e === '[]');
  if (!clean) bad++;
  console.log((clean ? 'ok   ' : 'CHECK') + ' ' + t + '  (' + (out.match(/^ok {3}/gm) || []).length + ' checks)' + (clean ? '' : '  exit ' + r.status));
  if (!clean || process.env.VERBOSE) console.log(out.split('\n').map((l) => '      ' + l.slice(0, 400)).join('\n'));
}
console.log(bad ? bad + ' scenario(s) need a look' : 'all scenarios clean');
process.exit(bad ? 1 : 0);
