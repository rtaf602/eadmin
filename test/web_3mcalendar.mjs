// A web of another repo on this login, end to end: 3mcalendar (github.com/rtaf602/3mcalendar, cloned next to this
// repo, or CAL_DIR). The real back end of this repo on its stand-in (gas_sim), the real 3mcalendar Code.gs on a small
// stand-in of its own, and both pages in a browser on one origin, as on GitHub Pages (/eadmin/ and /3mcalendar/).
// Skipped when that repo is not there. Every person and password here is made up.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { startSim, fourFiles, SETUP4, BIRTH, idGov, ROOT } from './gas_sim.mjs';

const EAD = ROOT, CAL = process.env.CAL_DIR || path.join(ROOT, '..', '3mcalendar'), OUT = path.join(ROOT, 'test/out/3mcalendar');
if (!fs.existsSync(path.join(CAL, 'apps-script/Code.gs'))) { console.log('skipped: 3mcalendar is not at ' + CAL + ' (set CAL_DIR)'); console.log('errors: []'); process.exit(0); }
// the code of this web, as the calendar has it (CFG.WEB_CODE); config.js of the page must say the same
const WEB = /WEB_CODE:\s*'([A-Z][A-Z0-9_]{1,19})'/.exec(fs.readFileSync(path.join(CAL, 'apps-script/Code.gs'), 'utf8'))[1];
const pageCode = /webCode:\s*'([^']*)'/.exec(fs.readFileSync(path.join(CAL, 'config.js'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
const bad = []; const check = (name, cond, got) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + JSON.stringify(got))); if (!cond) bad.push(name); };
const J = JSON.stringify;

/* ---------- the login system ---------- */
const sim = await startSim({ files: fourFiles() });
// the site: /eadmin/ and /3mcalendar/ on one origin
const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/eadmin/assets/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('window.EADMIN_CONFIG = ' + J({ backendUrl: sim.backendUrl }) + ';'); return; }
  if (p === '/3mcalendar/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('window.MP_CONFIG = ' + J({ apiUrl: calUrl, webCode: WEB }) + ';'); return; }
  let file = null;
  if (p.startsWith('/eadmin/')) file = path.join(EAD, 'docs', path.normalize(p.slice(8)));
  else if (p.startsWith('/3mcalendar/')) file = path.join(CAL, path.normalize(p.slice(12)));
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
  const t = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': t }); res.end(fs.readFileSync(file));
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + site.address().port;
sim.setup(Object.assign({}, SETUP4, { superAdmin: 'chan_t', firstAdmins: ['chan_t'], siteUrl: ORIGIN + '/eadmin/' }));
sim.run('OPT.pollSeconds = 2');
const post = (op, o) => sim.post(Object.assign({ v: 1, op }, o || {}));
const first = sim.firstLinks(), tok = (l) => /#token=([A-Za-z0-9_-]+)/.exec(l)[1];
const PW = { chan: 'Main-Admin-Pass-01', thana: 'Editor-Password-05', phum: 'Viewer-Password-03', som: 'NoWeb-Password-09' };
post('link.use', { token: tok(first.find((l) => l.startsWith('chan_t'))), password: PW.chan, birth: BIRTH });
let S = post('login', { username: 'chan_t', password: PW.chan, idGov: String(idGov(8)), birth: BIRTH }).session;
const people = () => post('admin.list', { session: S }).people;
const ref = (u) => people().find((p) => p.username === u).ref;
for (const [u, pw] of [['thana_t', PW.thana], ['phum_s', PW.phum], ['somchai_t', PW.som]]) {
  const g = post('admin.link', { session: S, ref: ref(u), role: 'User', end: '' });
  post('link.use', { token: g.token, password: pw, birth: BIRTH });
}
check('the code of the web is the same in Code.gs and config.js (' + WEB + ')', !!pageCode && pageCode[1] === WEB, pageCode && pageCode[1]);
check('web list: the calendar added', post('admin.webList', { session: S, act: 'add', code: WEB, name: 'Master Plan 3 เดือน', link: 'https://example.github.io/3mcalendar/' }).ok);
post('admin.web', { session: S, ref: ref('thana_t'), web: { [WEB]: 'Editor' } });
post('admin.web', { session: S, ref: ref('phum_s'), web: { [WEB]: 'Viewer' } });
post('logout', { session: S });

/* ---------- the 3mcalendar back end, on a stand-in of its own ---------- */
const books = {}; let fetches = 0;
function sheetMock(sh) {
  const last = () => { let n = sh.rows.length; while (n && !(sh.rows[n - 1] || []).some((v) => v !== '' && v != null)) n--; return n; };
  const range = (r, c, nr, nc) => {
    const api = {
      setNumberFormat: () => api, setFontWeight: () => api, setBackground: () => api,
      setValues(v) { v.forEach((row, i) => { const t = (sh.rows[r - 1 + i] = sh.rows[r - 1 + i] || []); row.forEach((x, j) => { t[c - 1 + j] = x; }); }); return api; },
      setValue(x) { const t = (sh.rows[r - 1] = sh.rows[r - 1] || []); t[c - 1] = x; return api; },
      getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = sh.rows[r - 1 + i] || [], a = []; for (let j = 0; j < nc; j++) a.push(row[c - 1 + j] ?? ''); o.push(a); } return o; },
      clearContent() { for (let i = 0; i < nr; i++) { const row = sh.rows[r - 1 + i]; if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = ''; } return api; },
    };
    return api;
  };
  return {
    getRange: (r, c, nr, nc) => range(r, c, nr || 1, nc || 1),
    getDataRange: () => range(1, 1, Math.max(1, last()), Math.max(1, ...sh.rows.map((x) => (x || []).length))),
    getLastRow: last, getLastColumn: () => Math.max(0, ...sh.rows.map((x) => (x || []).length)),
    getMaxRows: () => sh.maxRows, getMaxColumns: () => sh.maxCols,
    insertRowsAfter: (a, n) => { sh.maxRows += n; }, insertColumnsAfter: (a, n) => { sh.maxCols += n; },
    deleteRows: (a, n) => { sh.rows.splice(a - 1, n); }, deleteRow: (a) => { sh.rows.splice(a - 1, 1); },
    setFrozenRows() {},
  };
}
const book = (id) => { const b = (books[id] = books[id] || {}); return { getSheetByName: (n) => (b[n] ? sheetMock(b[n]) : null), insertSheet: (n) => { b[n] = { rows: [], maxRows: 1000, maxCols: 26 }; return sheetMock(b[n]); } }; };
const cprops = {}, ccache = new Map(), clock = () => Date.now() + sim.offset, created = [];
const box = {
  console, JSON, Math, Object, String, Number, Array, Error,
  SpreadsheetApp: { openById: (id) => book(id), flush() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in cprops ? cprops[k] : null), setProperty: (k, v) => { cprops[k] = String(v); }, deleteProperty: (k) => { delete cprops[k]; } }) },
  CacheService: { getScriptCache: () => ({ get: (k) => { const e = ccache.get(k); return e && e.until > clock() ? e.v : null; }, getAll: (ks) => { const o = {}; ks.forEach((k) => { const e = ccache.get(k); if (e && e.until > clock()) o[k] = e.v; }); return o; }, put: (k, v, s) => ccache.set(k, { v, until: clock() + s * 1000 }), remove: (k) => ccache.delete(k) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (a, t) => Array.from(crypto.createHash('sha256').update(String(t), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
    getUuid: () => crypto.randomUUID(), sleep() {},
    formatDate: (d, tz, f) => { const o = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d).forEach((p) => { o[p.type] = p.value; }); return f.replace('yyyy', o.year).replace('MM', o.month).replace('dd', o.day).replace('HH', o.hour).replace('mm', o.minute).replace('ss', o.second).replace(/\bM\b/, String(+o.month)).replace(/\bd\b/, String(+o.day)); },
    base64Decode: (s) => Array.from(Buffer.from(s, 'base64')),
    base64DecodeWebSafe: (s) => Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: (b, t, n) => ({ n, getDataAsString: () => Buffer.from(b.map((x) => (x + 256) % 256)).toString('utf8') }),
  },
  MimeType: { MICROSOFT_EXCEL: 'xlsx' },
  DriveApp: { getFolderById: () => ({ getName: () => 'f', createFile: (b) => { created.push(b.n); return { getName: () => b.n, getUrl: () => 'https://drive/' + b.n }; }, getFilesByType: () => ({ hasNext: () => false }) }) },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => { const t = { timeBased: () => t, everyMinutes: () => t, atHour: () => t, nearMinute: () => t, everyDays: () => t, inTimezone: () => t, create: () => t }; return t; } },
  // the call to the login system: straight into the stand-in of eadmin, as a POST that Apps Script would redirect
  UrlFetchApp: { fetch: (url, o) => { fetches++; if (url !== sim.backendUrl) throw new Error('wrong url ' + url); const out = o && o.method === 'post' ? sim.post(JSON.parse(o.payload)) : { ok: true, service: 'eadmin602' }; return { getContentText: () => JSON.stringify(out) }; } },
  Logger: { log: (s) => calLogs.push(String(s)) },
};
const calLogs = [];
const cctx = vm.createContext(box);
box.__clock = clock;
vm.runInContext('(function () { const R = Date; function D() { const a = arguments; return a.length ? new R(...a) : new R(__clock()); } D.prototype = R.prototype; D.now = function () { return __clock(); }; D.UTC = R.UTC; D.parse = R.parse; globalThis.Date = D; })();', cctx);
vm.runInContext(fs.readFileSync(path.join(CAL, 'apps-script/Code.gs'), 'utf8'), cctx, { filename: 'cal/Code.gs' });
vm.runInContext('renderDisplay_ = function () { setDirty_(false); };', cctx);      // the display file is not part of this test
const setupErr = (() => { try { vm.runInContext('setup()', cctx); return ''; } catch (e) { return e.message; } })();
check('calendar setup refuses to run without the address of the login system', /CFG\.LOGIN_URL/.test(setupErr), setupErr);
vm.runInContext('CFG.LOGIN_URL = "https://script.google.com/macros/s/XYZ_abc-123/exec";', cctx);
// the stand-in of eadmin answers on 127.0.0.1; the address is checked in setup, so it is swapped in after
const sErr = (() => { try { vm.runInContext('setup()', cctx); return ''; } catch (e) { return e.message; } })();
check('calendar setup checks that the login system answers (here: the made-up address does not)', /ติดต่อระบบ Login/.test(sErr) || sErr === 'wrong url https://script.google.com/macros/s/XYZ_abc-123/exec', sErr);
cprops.LOGIN_URL = sim.backendUrl;
vm.runInContext('CFG.LOGIN_URL = ""; var __real = loginUrlOk_; loginUrlOk_ = function (u) { return u === ' + J(sim.backendUrl) + ' || __real(u); };', cctx);
vm.runInContext('setup()', cctx);
check('calendar setup: ran, said the login system answered, removed the old access code', calLogs.some((l) => /ระบบ Login ตอบแล้ว/.test(l)) && !('CODE_HASH' in cprops), calLogs);
const cpost = (o) => JSON.parse(cctx.doPost({ postData: { contents: J(o) } }).getContent());

/* ---------- the calendar back end, by itself ---------- */
const login = (u, pw, n) => post('login', { username: u, password: pw, idGov: String(idGov(n)), birth: BIRTH });
const sT = login('thana_t', PW.thana, 3).session, sP = login('phum_s', PW.phum, 5).session, sM = login('somchai_t', PW.som, 9).session;
S = login('chan_t', PW.chan, 8).session;
const passOf = (s, w) => post('web.enter', { session: s, web: w || WEB }).pass;
const T = passOf(sT), P = passOf(sP);
post('admin.web', { session: S, ref: ref('somchai_t'), web: { [WEB]: 'Viewer' } });
const M = passOf(sM);
post('admin.web', { session: S, ref: ref('somchai_t'), web: { [WEB]: '' } });
check('the pages get a pass for the web; somebody without access gets none', !!T && !!P && !!M && !post('web.enter', { session: sM, web: WEB }).pass);
const ce = (r) => (r.error || {}).code;
check('no session: refused, nothing read', ce(cpost({ action: 'load' })) === 'auth' && ce(cpost({ action: 'poll', tab: 't1' })) === 'auth');
check('the old access-code login is gone', ce(cpost({ action: 'login', name: 'x', code: 'operation.slide' })) === 'bad_action');
check('a made-up pass: refused by the login system', ce(cpost({ action: 'load', pass: 'abc.def' })) === 'auth');
check('a session instead of a pass: refused (the back end of a web never gets a login)', ce(cpost({ action: 'load', pass: sT })) === 'auth');
post('admin.webList', { session: S, act: 'add', code: 'OTHER', name: 'อีกเว็บ', link: 'https://example.github.io/other/' });
const other = passOf(S, 'OTHER');
check('a pass for another web: refused, and said why', ce(cpost({ action: 'load', pass: other })) === 'wrong_web');
const lT = cpost({ action: 'load', pass: T });
check('Editor: loads the plan, with the name of the account and the Role', !lT.error && lT.me.role === 'Editor' && lT.me.name === 'ธนา ทดลองกิจ' && !!lT.state, lT);
const lP = cpost({ action: 'load', pass: P });
check('Viewer: loads the plan, Role Viewer', !lP.error && lP.me.role === 'Viewer', lP);
const lM = cpost({ action: 'load', pass: M });
check('no access to this web: refused with the agreed message', ce(lM) === 'no_web' && /ไม่มีสิทธิ์ใช้งานเว็บนี้/.test(lM.error.message), lM);
check('Viewer cannot take the edit lock, write, save, restore or redraw', ['lock', 'write', 'save', 'restore', 'render'].every((a) => ce(cpost({ action: a, pass: P, tab: 'p1', mode: 'acquire', ops: [] })) === 'forbidden'));
check('Viewer can look: poll, history, saved versions', !cpost({ action: 'poll', pass: P, tab: 'p1' }).error && !cpost({ action: 'listLogs', pass: P }).error && !cpost({ action: 'listSnaps', pass: P }).error);
const lk = cpost({ action: 'lock', pass: T, tab: 't1', mode: 'acquire' });
check('Editor takes the edit lock, shown with the account name', lk.ok && lk.lock.by === 'ธนา ทดลองกิจ', lk);
const wr = cpost({ action: 'write', pass: T, tab: 't1', ops: [{ c: 'events', op: 'set', id: 'e1', data: { month: '2026-11', start: 3, end: 5, lane: 0, rows: 1, text: 'ภารกิจทดลอง', type: 'a32x', by: 'someone else' } }, { c: 'logs', data: { action: 'เพิ่มภารกิจ', detail: 'x' } }] });
check('Editor writes; the history and the mission carry the account name, not one the page sends', wr.ok && books[vm.runInContext('CFG.SOURCE_ID', cctx)].events.rows[1][16] === 'ธนา ทดลองกิจ' && cpost({ action: 'listLogs', pass: P }).list[0].by === 'ธนา ทดลองกิจ', wr);
check('another login of an editor cannot write under the lock of this tab', ce(cpost({ action: 'write', pass: passOf(S), tab: 't1', ops: [] })) === 'not_lock_holder');
const pres = cpost({ action: 'poll', pass: P, tab: 'p1', presence: { name: 'ปลอมตัว', mode: 'view' } });
check('presence: the name shown to others is the account name, never one the page makes up', pres.peers.some((x) => x.presence.name === 'ภูมิ สาธิตพงศ์') && !J(pres.peers).includes('ปลอมตัว'), pres.peers);
const f0 = fetches; for (let i = 0; i < 5; i++) cpost({ action: 'poll', pass: P, tab: 'p1' });
check('frequent polls ask the login system at most once per minute', fetches - f0 === 0, fetches - f0);
const f1 = fetches; cpost({ action: 'write', pass: T, tab: 't1', ops: [] });
check('every write asks the login system afresh', fetches - f1 === 1, fetches - f1);
const snapNow = cpost({ action: 'save', pass: T, tab: 't1', label: 'x', iso: '2026-11-11', xlsx: '', filename: 'f' });
const dirty0 = cpost({ action: 'lastSnap', pass: P }).dirty;
const ex1 = cpost({ action: 'exported', pass: T, kind: 'pdf', filename: 'plan.pdf' }), ex2 = cpost({ action: 'exported', pass: T, kind: 'xlsx', filename: 'plan.xlsx' });
const lg = cpost({ action: 'listLogs', pass: P }).list;
check('export to PDF / Excel: in the history with the name from the column ชื่อ-สกุล (no rank), without the edit lock', snapNow.ok && ex1.ok && ex2.ok && lg[0].action === 'EXPORT TO EXCEL' && lg[1].action === 'EXPORT TO PDF' && lg[0].by === 'ธนา ทดลองกิจ' && lg[1].detail === 'plan.pdf', lg.slice(0, 2));
check('…an export is no edit: the plan does not become "not yet closed"', dirty0 === false && cpost({ action: 'lastSnap', pass: P }).dirty === false);
check('…a Viewer cannot write an export into the history', ce(cpost({ action: 'exported', pass: P, kind: 'pdf', filename: 'x' })) === 'forbidden');
// access taken away in the Admin page
post('admin.web', { session: S, ref: ref('thana_t'), web: { [WEB]: '' } });
check('access taken away: the next write is refused at once', ce(cpost({ action: 'write', pass: T, tab: 't1', ops: [] })) === 'no_web');
sim.advance(61000);
check('…and looking is refused within a minute', ce(cpost({ action: 'poll', pass: T, tab: 't1' })) === 'no_web');
post('admin.web', { session: S, ref: ref('thana_t'), web: { [WEB]: 'Editor' } });
post('admin.web', { session: S, ref: ref('phum_s'), web: { [WEB]: 'Editor' } });
check('Viewer made Editor: may edit at once (the edit lock is busy with the other editor, not refused)', (() => { const r = cpost({ action: 'lock', pass: P, tab: 'p2', mode: 'acquire' }); return !r.error; })());
post('admin.web', { session: S, ref: ref('phum_s'), web: { [WEB]: 'Viewer' } });
post('admin.webList', { session: S, act: 'close', code: WEB });
check('the web closed in the Admin page: refused (web_closed)', ce(cpost({ action: 'lock', pass: T, tab: 't9', mode: 'acquire' })) === 'web_closed');
post('admin.webList', { session: S, act: 'open', code: WEB });
sim.advance(3600000);
check('the hour of the login is over: refused (auth)', ce(cpost({ action: 'load', pass: T })) === 'auth');
check('nothing in the calendar\'s properties or cache holds a pass', !J(cprops).includes(T.slice(-40)) && ![...ccache.keys(), ...[...ccache.values()].map((e) => e.v)].some((x) => String(x).includes(T.slice(-40))));
delete cprops.EDIT_LOCK; ccache.clear(); sim.offset = 0; [sT, sP, sM, S].forEach((x) => post('logout', { session: x }));

/* ---------- the calendar back end over HTTP, as Apps Script answers ---------- */
const pend = new Map(); let seq = 0;
const calApp = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(405); res.end(); return; }
  if (u.pathname === '/echo') { const b = pend.get(u.searchParams.get('t')); res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(b || '{}'); return; }
  let body = ''; for await (const c of req) body += c;
  const out = cctx.doPost({ postData: { contents: body } }).getContent();
  const t = String(++seq); pend.set(t, out);
  res.writeHead(302, { Location: calUrl.replace('/exec', '/echo?t=' + t), 'Access-Control-Allow-Origin': '*' }); res.end();
});
await new Promise((r) => calApp.listen(0, '127.0.0.1', r));
var calUrl = 'http://127.0.0.1:' + calApp.address().port + '/exec';

/* ---------- in a browser ---------- */
const browser = await chromium.launch();
const errors = [], calBodies = [];
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } }), page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ' PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push(name + ' ' + m.text()); });
  page.on('request', (r) => { if (r.url() === calUrl && r.method() === 'POST') calBodies.push(r.postData() || ''); });
  return { ctx, page };
}
const signIn = async (page, u, pw, n) => {
  await page.fill('#user', u); await page.fill('#pw', pw); await page.fill('#card', String(idGov(n)));
  await page.selectOption('#birth-d', '1'); await page.selectOption('#birth-m', '1'); await page.selectOption('#birth-y', '2530');
  await page.click('#go');
};
const A = await device('editor');
await A.page.goto(ORIGIN + '/3mcalendar/');
await A.page.waitForURL(/\/eadmin\/index\.html\?next=/);
check('no login: the calendar sends the browser to the login page, with the way back', A.page.url() === ORIGIN + '/eadmin/index.html?next=%2F3mcalendar%2F', A.page.url());
check('…the login page reached from a web is titled LOGIN PAGE, not E ADMIN SITE', /^LOGIN PAGE\s+SQUADRON 602$/.test((await A.page.innerText('#brand')).trim()) && (await A.page.title()) === 'LOGIN PAGE · SQUADRON 602', await A.page.innerText('#brand'));
{
  // a slow phone: the shared script takes long to arrive. The name must already be LOGIN PAGE while it is on its way,
  // not E ADMIN SITE until the script has run.
  const S = await device('slow phone'); let release; const held = new Promise((r) => { release = r; });
  await S.page.route('**/eadmin/assets/app.js', async (route) => { await held; await route.continue(); });
  const seen = S.page.goto(ORIGIN + '/eadmin/index.html?next=' + encodeURIComponent('/app/'), { waitUntil: 'commit' });
  await S.page.waitForSelector('#brand', { state: 'attached' }); await seen;
  const early = { brand: (await S.page.textContent('#brand')).trim(), title: await S.page.title(), app: await S.page.evaluate(() => typeof window.App) };
  check('slow phone: LOGIN PAGE from the first moment, before the shared script has arrived', early.app === 'undefined' && /^LOGIN PAGE\s+SQUADRON 602$/.test(early.brand) && early.title === 'LOGIN PAGE · SQUADRON 602', early);
  release(); await S.page.waitForSelector('#login:not([hidden])');
  const plain = await (await browser.newContext()).newPage();
  await plain.goto(ORIGIN + '/eadmin/index.html');
  check('opened directly (no ?next=): still E ADMIN SITE', /^E ADMIN SITE\s+SQUADRON 602$/.test((await plain.textContent('#brand')).trim()) && (await plain.title()) === 'E ADMIN SITE · SQUADRON 602', await plain.textContent('#brand'));
  const bad2 = await (await browser.newContext()).newPage();
  await bad2.goto(ORIGIN + '/eadmin/index.html?next=' + encodeURIComponent('//evil.example/x'));
  check('a ?next= that leaves this site does not rename the page', /^E ADMIN SITE/.test((await bad2.textContent('#brand')).trim()), await bad2.textContent('#brand'));
  await S.ctx.close();
}
await signIn(A.page, 'thana_t', PW.thana, 3);
await A.page.waitForURL(ORIGIN + '/3mcalendar/');
await A.page.waitForSelector('#editBtn', { timeout: 15000 });
check('after the login: back on the calendar, the plan shown, the account name and Role in the status line', (await A.page.isHidden('#lock')) && /ธนา ทดลองกิจ · Editor/.test(await A.page.innerText('.statusline')) && /ภารกิจทดลอง/.test(await A.page.innerText('#sheet')));
check('Editor: the edit button and export are there', (await A.page.isVisible('#editBtn')) && (await A.page.isVisible('#expBtn')));
await A.page.screenshot({ path: path.join(OUT, '1-editor.png') });
const calLog = () => books[vm.runInContext('CFG.SOURCE_ID', cctx)].logs.rows.slice(1).filter((r) => r[0]).reverse().map((r) => ({ by: r[2], action: r[3], detail: r[4] }));
const nLogs = calLog().length;
await A.page.click('#expBtn'); const dl = A.page.waitForEvent('download'); await A.page.click('[data-v="xlsx"]'); await dl;
await A.page.waitForTimeout(1500);
const lgB = calLog();
check('in the page: EXPORT TO EXCEL clicked → the file, and a line in the history with the account name', lgB.length === nLogs + 1 && lgB[0].action === 'EXPORT TO EXCEL' && lgB[0].by === 'ธนา ทดลองกิจ' && /\.xlsx$/.test(lgB[0].detail), lgB[0]);
await A.page.click('#editBtn');
await A.page.waitForSelector('.lockbar.mine', { timeout: 10000 });
check('Editor: edit mode, the edit lock taken', /คุณกำลังแก้ไขแผน/.test(await A.page.innerText('#lockBar')));

const V = await device('viewer');
await V.page.goto(ORIGIN + '/eadmin/index.html');
await signIn(V.page, 'phum_s', PW.phum, 5);
await V.page.waitForSelector('#inside:not([hidden])');
check('the login page lists no webs after login', !/Master Plan 3 เดือน/.test(await V.page.content()));
await V.page.goto(ORIGIN + '/3mcalendar/');
await V.page.waitForFunction(() => document.querySelector('.statusline') && /Viewer/.test(document.querySelector('.statusline').innerText), null, { timeout: 15000 });
check('Viewer: looks only; no edit button, no PREVIEW or export', !(await V.page.isVisible('#editBtn')) && !(await V.page.isVisible('#expBtn')) && !(await V.page.isVisible('#pvBtn')) && /ดูอย่างเดียว \(Viewer\)/.test(await V.page.innerText('.statusline')));
await V.page.screenshot({ path: path.join(OUT, '2-viewer.png') });
const vDirect = await V.page.evaluate(async ([url, WEB]) => { const s = JSON.parse(localStorage.getItem('eadmin602:session')).token; const e = await App.enterWeb(WEB); const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'write', pass: e.pass, tab: 'x', ops: [{ c: 'events', op: 'delete', id: 'e1' }] }) }); return r.json(); }, [calUrl, WEB]);
check('Viewer sending a write by hand from the browser: refused by the calendar back end', (vDirect.error || {}).code === 'forbidden', vDirect);

const N = await device('noweb');
await N.page.goto(ORIGIN + '/3mcalendar/');
await N.page.waitForURL(/next=/);
await signIn(N.page, 'somchai_t', PW.som, 9);
await N.page.waitForURL(ORIGIN + '/3mcalendar/');
await N.page.waitForSelector('#lockGo:not([hidden])', { timeout: 15000 });
check('no access: the plan is not shown, the agreed message, a way back to the login page', (await N.page.isHidden('#app')) && /บัญชีนี้ไม่มีสิทธิ์ใช้งานเว็บนี้ ให้ติดต่อ Admin/.test(await N.page.innerText('#lockErr')) && !/ภารกิจทดลอง/.test(await N.page.content()));
await N.page.screenshot({ path: path.join(OUT, '3-noweb.png') });
await N.page.click('#lockGo'); await N.page.waitForURL(ORIGIN + '/eadmin/index.html');
check('…the way back leads to the login page, signed in, without a loop', (await N.page.isVisible('#inside')) && N.page.url() === ORIGIN + '/eadmin/index.html');

// another device logs in with the editor's account: the calendar page shows the notice of the login system
const B2 = await device('editor-2');
await B2.page.goto(ORIGIN + '/eadmin/index.html');
await signIn(B2.page, 'thana_t', PW.thana, 3);
await A.page.waitForSelector('#app-take:not([hidden])', { timeout: 15000 });
check('1.12.1 on the calendar page: the notice of a login from another device, with the countdown and the refuse button', /มีผู้ Login เข้าใช้งานบัญชีนี้จากเครื่องอื่น/.test(await A.page.innerText('#app-take')) && (await A.page.isVisible('#app-deny')));
await A.page.screenshot({ path: path.join(OUT, '4-takeover.png') });
await A.page.click('#app-deny');
await B2.page.waitForSelector('#msg:not([hidden])', { timeout: 15000 });
check('…refused from the calendar page: the other device is turned away', /ไม่อนุญาตให้เข้าใช้งานซ้อน/.test(await B2.page.innerText('#msg')));

// in a second tab of the editor's browser: sign out from the calendar → every tab goes to the login page
const A2 = await A.ctx.newPage();
await A2.goto(ORIGIN + '/3mcalendar/');
await A2.waitForSelector('#sheet .cell, #sheet .ev, #lockBtn', { timeout: 15000 });
await A2.click('#lockBtn').catch(async () => { await A2.click('#closeBtn').catch(() => {}); });
await A2.waitForURL(/\/eadmin\/index\.html/, { timeout: 15000 });
await A.page.waitForURL(/\/eadmin\/index\.html/, { timeout: 15000 });
check('sign out on the calendar: this tab and the other tab are at the login page, nobody is signed in', (await A.page.evaluate(() => localStorage.getItem('eadmin602:session'))) === null && (await A.page.isVisible('#login')));

// the hour runs out on the viewer: back to the login page with the message, and back to the calendar after logging in
await V.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('eadmin602:session')); s.exp = Date.now() + 1500; localStorage.setItem('eadmin602:session', JSON.stringify(s)); });
await V.page.waitForURL(/\/eadmin\/index\.html\?next=%2F3mcalendar%2F/, { timeout: 15000 });
check('1.10.2 the hour over on the calendar: at the login page with "หมดเวลาใช้งาน", the way back kept', /หมดเวลาใช้งาน ให้เข้าสู่ระบบใหม่/.test(await V.page.innerText('#flash')));
// (only the copy in the browser was made to run out here; the back end still counts the login as alive, so this
// login waits up to 30 seconds as a second device would — at Google the hour runs out at both ends together)
await signIn(V.page, 'phum_s', PW.phum, 5);
await V.page.waitForURL(ORIGIN + '/3mcalendar/', { timeout: 60000 });
check('…logged in again: back on the calendar', true);

// a made-up ?next= that leaves the site is not followed
const X = await device('evil');
await X.page.goto(ORIGIN + '/eadmin/index.html?next=' + encodeURIComponent('//evil.example/x'));
await signIn(X.page, 'chan_t', PW.chan, 8);
await X.page.waitForSelector('#inside:not([hidden])', { timeout: 15000 });
check('?next= that points away from this site is ignored', X.page.url().startsWith(ORIGIN + '/eadmin/'));
await X.page.goto(ORIGIN + '/eadmin/index.html');
check('the login page opened by itself is titled E ADMIN SITE', /^E ADMIN SITE/.test((await X.page.innerText('#brand')).trim()));

const sessionsSeen = await Promise.all([A, V, N, X].map((d) => d.page.evaluate(() => (JSON.parse(localStorage.getItem('eadmin602:session') || 'null') || {}).token || '').catch(() => '')));
check('the pages never sent a session to the calendar back end, only passes', calBodies.length > 5 && calBodies.every((b) => /"pass":"[^"]{40,}"/.test(b)) && calBodies.every((b) => !/"session"/.test(b)) && !sessionsSeen.filter(Boolean).some((t) => calBodies.some((b) => b.includes(t))), calBodies.length);
await browser.close(); site.close(); calApp.close(); sim.close();
check('no page errors', errors.length === 0, errors);
console.log(bad.length ? bad.length + ' check(s) FAILED' : 'all checks passed');
console.log('errors:', JSON.stringify(bad));
process.exit(bad.length ? 1 : 0);
