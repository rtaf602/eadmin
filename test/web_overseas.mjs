// A web of another repo on this login, end to end: overseas-mission (github.com/rtaf602/overseas-mission, cloned next to
// this repo, or OM_DIR). The real back end of this repo on its stand-in (gas_sim), the real overseas-mission Code.gs on a
// small stand-in of its own, and both pages in a browser on one origin, as on GitHub Pages (/eadmin/ and /overseas-mission/).
// Skipped when that repo is not there. Every person and password here is made up.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { startSim, fourFiles, SETUP4, BIRTH, idGov, ROOT } from './gas_sim.mjs';

const EAD = ROOT, OM = process.env.OM_DIR || path.join(ROOT, '..', 'overseas-mission'), OUT = path.join(ROOT, 'test/out/overseas');
if (!fs.existsSync(path.join(OM, 'apps-script/Code.gs'))) { console.log('skipped: overseas-mission is not at ' + OM + ' (set OM_DIR)'); console.log('errors: []'); process.exit(0); }
const WEB = /WEB_CODE:\s*'([A-Z][A-Z0-9_]{1,19})'/.exec(fs.readFileSync(path.join(OM, 'apps-script/Code.gs'), 'utf8'))[1];
const pageCode = /webCode:\s*'([^']*)'/.exec(fs.readFileSync(path.join(OM, 'config.js'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
const bad = []; const check = (name, cond, got) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + JSON.stringify(got))); if (!cond) bad.push(name); };
const J = JSON.stringify;

/* ---------- the login system ---------- */
const sim = await startSim({ files: fourFiles() });
const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/eadmin/assets/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('window.EADMIN_CONFIG = ' + J({ backendUrl: sim.backendUrl }) + ';'); return; }
  if (p === '/overseas-mission/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('window.OM_CONFIG = ' + J({ apiUrl: omUrl, webCode: WEB }) + ';'); return; }
  let file = null;
  if (p.startsWith('/eadmin/')) file = path.join(EAD, 'docs', path.normalize(p.slice(8)));
  else if (p.startsWith('/overseas-mission/')) file = path.join(OM, path.normalize(p.slice(18)));
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
  const t = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
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
check('web list: overseas-mission added', post('admin.webList', { session: S, act: 'add', code: WEB, name: 'ภารกิจต่างประเทศ', link: 'https://example.github.io/overseas-mission/' }).ok);
post('admin.web', { session: S, ref: ref('thana_t'), web: { [WEB]: 'Editor' } });
post('admin.web', { session: S, ref: ref('phum_s'), web: { [WEB]: 'Viewer' } });
post('logout', { session: S });

/* ---------- the overseas-mission back end, on a stand-in of its own ---------- */
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
const book = (id) => { const b = (books[id] = books[id] || {}); return { getName: () => 'ไฟล์ ' + id.slice(0, 6), getSheetByName: (n) => (b[n] ? sheetMock(b[n]) : null), insertSheet: (n) => { b[n] = { rows: [], maxRows: 1000, maxCols: 26 }; return sheetMock(b[n]); } }; };
const oprops = {}, ocache = new Map(), clock = () => Date.now() + sim.offset, created = [];
const box = {
  console, JSON, Math, Object, String, Number, Array, Error,
  SpreadsheetApp: { openById: (id) => book(id), flush() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in oprops ? oprops[k] : null), setProperty: (k, v) => { oprops[k] = String(v); }, deleteProperty: (k) => { delete oprops[k]; } }) },
  CacheService: { getScriptCache: () => ({ get: (k) => { const e = ocache.get(k); return e && e.until > clock() ? e.v : null; }, put: (k, v, s) => ocache.set(k, { v, until: clock() + s * 1000 }), remove: (k) => ocache.delete(k) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }) },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'owner' }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (a, t) => Array.from(crypto.createHash('sha256').update(String(t), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
    getUuid: () => crypto.randomUUID(), sleep() {},
    formatDate: (d, tz, f) => { const o = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d).forEach((p) => { o[p.type] = p.value; }); return f.replace('yyyy', o.year).replace('MM', o.month).replace('dd', o.day).replace('HH', o.hour).replace('mm', o.minute).replace('ss', o.second); },
    base64Decode: (s) => Array.from(Buffer.from(s, 'base64')),
    base64DecodeWebSafe: (s) => Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: (b, t, n) => ({ n, getDataAsString: () => Buffer.from(b.map((x) => (x + 256) % 256)).toString('utf8') }),
  },
  MimeType: { MICROSOFT_EXCEL: 'xlsx' },
  DriveApp: { getFolderById: () => ({ getName: () => 'f', createFile: (b) => { created.push(b.n); return { getName: () => b.n, getUrl: () => 'https://drive/' + b.n, getId: () => 'x', getDateCreated: () => new Date() }; }, getFiles: () => ({ hasNext: () => false }), getFilesByType: () => ({ hasNext: () => false }), searchFiles: () => ({ hasNext: () => false }) }) },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => { const t = { timeBased: () => t, everyMinutes: () => t, atHour: () => t, nearMinute: () => t, everyDays: () => t, inTimezone: () => t, create: () => t }; return t; } },
  // the call to the login system: straight into the stand-in of eadmin
  UrlFetchApp: { fetch: (url, o) => { fetches++; if (url !== sim.backendUrl) throw new Error('wrong url ' + url); const out = o && o.method === 'post' ? sim.post(JSON.parse(o.payload)) : { ok: true, service: 'eadmin602' }; return { getContentText: () => JSON.stringify(out) }; } },
  Logger: { log: (s) => omLogs.push(String(s)) },
};
const omLogs = [];
const octx = vm.createContext(box);
box.__clock = clock;
vm.runInContext('(function () { const R = Date; function D() { const a = arguments; return a.length ? new R(...a) : new R(__clock()); } D.prototype = R.prototype; D.now = function () { return __clock(); }; D.UTC = R.UTC; D.parse = R.parse; globalThis.Date = D; })();', octx);
vm.runInContext(fs.readFileSync(path.join(OM, 'apps-script/Code.gs'), 'utf8'), octx, { filename: 'om/Code.gs' });
vm.runInContext('renderDisplay_ = function () {}; renderDirty_ = function () {}; backupExcel_ = function (n) { return { name: n }; };', octx);   // the display file and Drive are not part of this test
oprops.CODE_HASH = 'old-access-code';
const setupErr = (() => { try { vm.runInContext('setup()', octx); return ''; } catch (e) { return e.message; } })();
check('setup refuses to run without the address of the login system', /CFG\.LOGIN_URL/.test(setupErr), setupErr);
vm.runInContext('CFG.LOGIN_URL = "https://script.google.com/macros/s/XYZ_abc-123/exec";', octx);
const sErr = (() => { try { vm.runInContext('setup()', octx); return ''; } catch (e) { return e.message; } })();
check('setup checks that the login system answers (here: the made-up address does not)', /ติดต่อระบบ Login/.test(sErr) || sErr === 'wrong url https://script.google.com/macros/s/XYZ_abc-123/exec', sErr);
oprops.LOGIN_URL = sim.backendUrl;
vm.runInContext('CFG.LOGIN_URL = ""; var __real = loginUrlOk_; loginUrlOk_ = function (u) { return u === ' + J(sim.backendUrl) + ' || __real(u); };', octx);
vm.runInContext('setup()', octx);
check('setup: ran, said the login system answered, removed the old access code, warned that the admin code is not set', omLogs.some((l) => /ระบบ Login ตอบแล้ว/.test(l)) && !('CODE_HASH' in oprops) && omLogs.some((l) => /ยังไม่ได้ตั้งรหัส admin/.test(l)), omLogs);
const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
oprops.ADMIN_HASH = sha('Admin-Code-Test-77');
check('setCodes keeps only the admin code (no access code any more)', !/ACCESS_CODE/.test(fs.readFileSync(path.join(OM, 'apps-script/Code.gs'), 'utf8')));
const opost = (o) => JSON.parse(octx.doPost({ postData: { contents: J(o) } }).getContent());
const SRC = vm.runInContext('CFG.SOURCE_ID', octx);

/* ---------- the back end by itself ---------- */
const login = (u, pw, n) => post('login', { username: u, password: pw, idGov: String(idGov(n)), birth: BIRTH });
const sT = login('thana_t', PW.thana, 3).session, sP = login('phum_s', PW.phum, 5).session, sM = login('somchai_t', PW.som, 9).session;
S = login('chan_t', PW.chan, 8).session;
const passOf = (s, w) => post('web.enter', { session: s, web: w || WEB }).pass;
const T = passOf(sT), P = passOf(sP), A0 = passOf(S);
post('admin.web', { session: S, ref: ref('somchai_t'), web: { [WEB]: 'Viewer' } });
const M = passOf(sM);
post('admin.web', { session: S, ref: ref('somchai_t'), web: { [WEB]: '' } });
const ce = (r) => (r.error || {}).code;
check('no pass: refused, nothing read', ce(opost({ action: 'sync', ver: 0 })) === 'auth' && ce(opost({ action: 'listLogs' })) === 'auth');
check('the old name + access-code login is gone', ce(opost({ action: 'login', name: 'x', code: 'y' })) === 'bad_action');
check('a made-up pass: refused by the login system', ce(opost({ action: 'sync', pass: 'abc.def' })) === 'auth');
check('a session instead of a pass: refused (the back end of a web never gets a login)', ce(opost({ action: 'sync', pass: sT })) === 'auth');
post('admin.webList', { session: S, act: 'add', code: 'OTHER', name: 'อีกเว็บ', link: 'https://example.github.io/other/' });
check('a pass for another web: refused, and said why', ce(opost({ action: 'sync', pass: passOf(S, 'OTHER') })) === 'wrong_web');
const yT = opost({ action: 'sync', pass: T, ver: 0 });
check('Editor: the plan, with the name of the account (column ชื่อ-สกุล, no rank) and the Role; not the main admin', !yT.error && yT.me.name === 'ธนา ทดลองกิจ' && yT.me.role === 'Editor' && yT.me.super === false && !!yT.missions, yT.me || yT);
const yP = opost({ action: 'sync', pass: P, ver: 0 });
check('Viewer: may look, Role Viewer', !yP.error && yP.me.role === 'Viewer', yP.me || yP);
const yA = opost({ action: 'sync', pass: A0, ver: 0 });
check('the main admin: Admin of this web, and known as the main admin', !yA.error && yA.me.role === 'Admin' && yA.me.super === true, yA.me || yA);
const yM = opost({ action: 'sync', pass: M, ver: 0 });
check('no access to this web: refused with the agreed message', ce(yM) === 'no_web' && /ไม่มีสิทธิ์ใช้งานเว็บนี้/.test(yM.error.message), yM);
check('Viewer cannot write, keep a version, change holidays, redraw, paste links or log an export', ['write', 'save', 'setHolidays', 'render', 'setFiles', 'exported'].every((a) => ce(opost({ action: a, pass: P, ops: [], fy: 70, map: {}, kind: 'pdf' })) === 'forbidden'));
check('Viewer can look: the history and the saved versions', !opost({ action: 'listLogs', pass: P, fy: 70 }).error && !opost({ action: 'listSnaps', pass: P, fy: 70 }).error);
const mission = { order: 1, no: 1, callsign: 'TEST01', mission: 'ภารกิจทดลอง', route: 'BKK-NRT', aircraft: 'A320', ranges: [{ s: '2026-12-01', e: '2026-12-03' }], status: 'รอยืนยันภารกิจ', updatedByName: 'ชื่อปลอม' };
const wr = opost({ action: 'write', pass: T, fy: 70, ops: [{ op: 'set', id: 'm1', fy: 70, data: mission }, { op: 'log', fy: 70, data: { action: 'add', no: 1, mission: 'ภารกิจทดลอง', byName: 'ชื่อปลอม' } }] });
const m1 = (opost({ action: 'sync', pass: P, ver: 0 }).missions['70'] || []).find((m) => m.id === 'm1');
const lg1 = opost({ action: 'listLogs', pass: P, fy: 70 }).list;
check('Editor writes; the mission and the history carry the account name, not one the page sends', wr.ok && m1 && m1.updatedByName === 'ธนา ทดลองกิจ' && lg1[0].byName === 'ธนา ทดลองกิจ' && !J(books[SRC]).includes('ชื่อปลอม'), [m1, lg1[0]]);
const f0 = fetches; for (let i = 0; i < 5; i++) opost({ action: 'sync', pass: P, ver: 0 });
check('frequent syncs ask the login system at most once per minute', fetches - f0 === 0, fetches - f0);
const f1 = fetches; opost({ action: 'write', pass: T, fy: 70, ops: [] });
check('every write asks the login system afresh', fetches - f1 === 1, fetches - f1);
const sv = opost({ action: 'save', pass: T, fy: 70, label: 'ฉบับทดลอง', at: '2026-11-12T10:00:00Z', xlsx: '', filename: 'x' });
const snaps = opost({ action: 'listSnaps', pass: P, fy: 70 }).list;
check('a version kept by the editor carries the account name', sv.ok && snaps[0] && snaps[0].byName !== undefined ? snaps[0].byName === 'ธนา ทดลองกิจ' : (sv.snap && sv.snap.by === 'ธนา ทดลองกิจ'), [sv.snap, snaps[0]]);
const ex1 = opost({ action: 'exported', pass: T, fy: 70, kind: 'pdf', filename: 'plan.pdf' }), ex2 = opost({ action: 'exported', pass: T, fy: 70, kind: 'xlsx', filename: 'plan.xlsx' });
const lg2 = opost({ action: 'listLogs', pass: P, fy: 70 }).list;
check('EXPORT TO PDF / EXCEL: in the history with the name from the column ชื่อ-สกุล', ex1.ok && ex2.ok && lg2[0].action === 'export' && lg2[0].field === 'EXPORT TO EXCEL' && lg2[0].label === 'plan.xlsx' && lg2[0].byName === 'ธนา ทดลองกิจ' && lg2[1].field === 'EXPORT TO PDF', lg2.slice(0, 2));
check('…an unknown kind of file is refused', ce(opost({ action: 'exported', pass: T, fy: 70, kind: 'doc', filename: 'x' })) === 'bad_request');
// the links of a new fiscal year: the main admin only, and the admin code as well
const LINK = (c) => 'https://docs.google.com/spreadsheets/d/' + c.repeat(30) + '/edit';
post('admin.web', { session: S, ref: ref('thana_t'), web: { [WEB]: 'Admin' } });
const T2 = passOf(sT);
const sfA = opost({ action: 'setFiles', pass: T2, fy: 71, src: LINK('a'), disp: LINK('b'), admin: 'Admin-Code-Test-77' });
check('links of a new fiscal year: an Admin of this web who is not the main admin is refused, even with the right code', ce(sfA) === 'not_super' && !J(oprops.FILES || '').includes('aaaa'), sfA);
post('admin.web', { session: S, ref: ref('thana_t'), web: { [WEB]: 'Editor' } });
const sfB = opost({ action: 'setFiles', pass: A0, fy: 71, src: LINK('a'), disp: LINK('b'), admin: 'wrong-code' });
check('…the main admin with a wrong admin code: refused', ce(sfB) === 'bad_admin', sfB);
const sfC = opost({ action: 'setFiles', pass: A0, fy: 71, src: LINK('a'), disp: LINK('b'), admin: 'Admin-Code-Test-77' });
check('…the main admin with the admin code: the links are kept, under the account name', sfC.ok && sfC.files['71'] && JSON.parse(oprops.FILES)['71'].by === 'ชาญ ตัวอย่างหลัก', sfC);
// access taken away in the Admin page
const T3 = passOf(sT);
post('admin.web', { session: S, ref: ref('thana_t'), web: { [WEB]: '' } });
check('access taken away: the next write is refused at once', ce(opost({ action: 'write', pass: T3, fy: 70, ops: [] })) === 'no_web');
sim.advance(61000);
check('…and looking is refused within a minute', ce(opost({ action: 'sync', pass: T3, ver: 0 })) === 'no_web');
post('admin.web', { session: S, ref: ref('thana_t'), web: { [WEB]: 'Editor' } });
post('admin.webList', { session: S, act: 'close', code: WEB });
check('the web closed in the Admin page: refused (web_closed)', ce(opost({ action: 'write', pass: T3, fy: 70, ops: [] })) === 'web_closed');
post('admin.webList', { session: S, act: 'open', code: WEB });
sim.advance(3600000);
check('the hour of the login is over: refused (auth)', ce(opost({ action: 'sync', pass: T3, ver: 0 })) === 'auth');
check('nothing in the properties or cache holds a pass', ![T, P, A0, T3].some((x) => J(oprops).includes(x.slice(-40)) || [...ocache.keys(), ...[...ocache.values()].map((e) => e.v)].some((k) => String(k).includes(x.slice(-40)))));
delete oprops.FILES; ocache.clear(); sim.offset = 0;
[sT, sP, sM, S].forEach((x) => post('logout', { session: x }));

/* ---------- the back end over HTTP, as Apps Script answers ---------- */
const pend = new Map(); let seq = 0;
const omApp = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(405); res.end(); return; }
  if (u.pathname === '/echo') { const b = pend.get(u.searchParams.get('t')); res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(b || '{}'); return; }
  let body = ''; for await (const c of req) body += c;
  const out = octx.doPost({ postData: { contents: body } }).getContent();
  const t = String(++seq); pend.set(t, out);
  res.writeHead(302, { Location: omUrl.replace('/exec', '/echo?t=' + t), 'Access-Control-Allow-Origin': '*' }); res.end();
});
await new Promise((r) => omApp.listen(0, '127.0.0.1', r));
var omUrl = 'http://127.0.0.1:' + omApp.address().port + '/exec';

/* ---------- in a browser ---------- */
const browser = await chromium.launch();
const errors = [], omBodies = [];
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true }), page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ' PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push(name + ' ' + m.text()); });
  page.on('request', (r) => { if (r.url() === omUrl && r.method() === 'POST') omBodies.push(r.postData() || ''); });
  return { ctx, page };
}
const signIn = async (page, u, pw, n) => {
  await page.fill('#user', u); await page.fill('#pw', pw); await page.fill('#card', String(idGov(n)));
  await page.selectOption('#birth-d', '1'); await page.selectOption('#birth-m', '1'); await page.selectOption('#birth-y', '2530');
  await page.click('#go');
};
const omLog = () => (books[SRC].logs.rows || []).slice(1).filter((r) => r && r[0]).reverse().map((r) => ({ by: r[2], action: r[3], detail: r[5] }));

const E = await device('editor');
await E.page.goto(ORIGIN + '/overseas-mission/');
await E.page.waitForURL(/\/eadmin\/index\.html\?next=/);
check('no login: the page sends the browser to the login page, with the way back', E.page.url() === ORIGIN + '/eadmin/index.html?next=%2Foverseas-mission%2F', E.page.url());
check('…no name or access code is asked on the page any more', !/lockName|lockIn|รหัสเปิดใช้งาน/.test(fs.readFileSync(path.join(OM, 'index.html'), 'utf8')));
await signIn(E.page, 'thana_t', PW.thana, 3);
await E.page.waitForURL(ORIGIN + '/overseas-mission/');
await E.page.waitForSelector('#editBtn', { timeout: 15000 });
check('after the login: back on the page, the plan shown, the account name at the top', (await E.page.isHidden('#lock')) && /ผู้ใช้งาน: ธนา ทดลองกิจ/.test(await E.page.innerText('#who')) && /TEST01/.test(await E.page.innerText('#app')));
check('Editor: edit, PREVIEW and export are there; the sign-out button', (await E.page.isVisible('#editBtn')) && (await E.page.isVisible('#pvBtn')) && (await E.page.isVisible('#expBtn')) && /ออกจากระบบ/.test(await E.page.innerText('#lockBtn')));
await E.page.screenshot({ path: path.join(OUT, '1-editor.png') });
const n0 = omLog().length;
await E.page.click('#expBtn'); const dl = E.page.waitForEvent('download'); await E.page.click('.pop .mi:has-text("EXPORT TO EXCEL")'); await dl;
await E.page.waitForTimeout(1500);
const lgB = omLog();
check('in the page: EXPORT TO EXCEL clicked → the file, and a line in the history with the account name', lgB.length === n0 + 1 && lgB[0].action === 'export' && lgB[0].by === 'ธนา ทดลองกิจ' && /EXPORT TO EXCEL/.test(lgB[0].detail) && /\.xlsx/.test(lgB[0].detail), lgB[0]);
await E.page.click('#editBtn'); await E.page.waitForSelector('#addBtn', { timeout: 10000 });
await E.page.click('#addBtn'); await E.page.waitForTimeout(2500);
const newRow = Object.values((books[SRC].missions || { rows: [] }).rows).slice(1).find((r) => r && r[0] && r[0] !== 'm1');
const head = books[SRC].missions.rows[0];
check('Editor adds a mission from the page: stored under the account name', !!newRow && newRow[head.indexOf('updatedByName')] === 'ธนา ทดลองกิจ', newRow);
await E.page.click('#filesBtn'); await E.page.waitForTimeout(300);
check('Editor: the files panel shows the links but no form to paste links of a new fiscal year', (await E.page.isVisible('.panel, #panel').catch(() => true)) && !(await E.page.isVisible('#ffAdmin')));
await E.page.keyboard.press('Escape');

const V = await device('viewer');
await V.page.goto(ORIGIN + '/overseas-mission/'); await V.page.waitForURL(/next=/);
await signIn(V.page, 'phum_s', PW.phum, 5); await V.page.waitForURL(ORIGIN + '/overseas-mission/');
await V.page.waitForFunction(() => /ภูมิ/.test(document.getElementById('who').textContent), null, { timeout: 15000 });
check('Viewer: looks only; no edit, PREVIEW or export, and says so', !(await V.page.isVisible('#editBtn')) && !(await V.page.isVisible('#pvBtn')) && !(await V.page.isVisible('#expBtn')) && /ดูอย่างเดียว \(Viewer\)/.test(await V.page.innerText('#ribbon')) && /TEST01/.test(await V.page.innerText('#app')));
await V.page.screenshot({ path: path.join(OUT, '2-viewer.png') });
const vDirect = await V.page.evaluate(async ([url, WEB]) => { const e = await App.enterWeb(WEB); const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'write', pass: e.pass, fy: 70, ops: [{ op: 'delete', id: 'm1', fy: 70 }] }) }); return r.json(); }, [omUrl, WEB]);
check('Viewer sending a write by hand from the browser: refused by the back end', (vDirect.error || {}).code === 'forbidden', vDirect);

const N = await device('noweb');
await N.page.goto(ORIGIN + '/overseas-mission/'); await N.page.waitForURL(/next=/);
await signIn(N.page, 'somchai_t', PW.som, 9); await N.page.waitForURL(ORIGIN + '/overseas-mission/');
await N.page.waitForSelector('#lockGo:not([hidden])', { timeout: 15000 });
check('no access: the plan is not shown, the agreed message, a way back to the login page', (await N.page.isHidden('#app')) && /บัญชีนี้ไม่มีสิทธิ์ใช้งานเว็บนี้ ให้ติดต่อ Admin/.test(await N.page.innerText('#lockErr')) && !/TEST01/.test(await N.page.innerText('body')));
await N.page.screenshot({ path: path.join(OUT, '3-noweb.png') });

const A = await device('main admin');
await A.page.goto(ORIGIN + '/overseas-mission/'); await A.page.waitForURL(/next=/);
await signIn(A.page, 'chan_t', PW.chan, 8); await A.page.waitForURL(ORIGIN + '/overseas-mission/');
await A.page.waitForSelector('#editBtn', { timeout: 15000 });
await A.page.click('#filesBtn'); await A.page.waitForSelector('#ffAdmin', { timeout: 5000 }).catch(() => {});
check('the main admin: the form to paste links of a new fiscal year, still asking for the admin code', await A.page.isVisible('#ffAdmin'));
await A.page.fill('#ffSrc', LINK('c')); await A.page.fill('#ffDisp', LINK('d')); await A.page.fill('#ffAdmin', 'Admin-Code-Test-77');
await A.page.click('#ffSave'); await A.page.waitForTimeout(2500);
check('…pasted from the page with the admin code: kept', J(oprops.FILES || '').includes('cccc'), oprops.FILES);
await A.page.screenshot({ path: path.join(OUT, '4-main-admin-files.png') });

// sign out on this page: every tab of that browser is at the login page
const E2 = await E.ctx.newPage();
await E2.goto(ORIGIN + '/overseas-mission/'); await E2.waitForSelector('#lockBtn', { state: 'visible', timeout: 15000 });
await E2.click('#lockBtn');
await E2.waitForURL(/\/eadmin\/index\.html/, { timeout: 15000 });
await E.page.waitForURL(/\/eadmin\/index\.html/, { timeout: 15000 });
check('sign out on this page: this tab and the other tab are at the login page, nobody signed in', (await E.page.evaluate(() => localStorage.getItem('eadmin602:session'))) === null);

const sessionsSeen = await Promise.all([V, N, A].map((d) => d.page.evaluate(() => (JSON.parse(localStorage.getItem('eadmin602:session') || 'null') || {}).token || '').catch(() => '')));
check('the pages never sent a session to this back end, only passes', omBodies.length > 5 && omBodies.every((b) => /"pass":"[^"]{40,}"/.test(b)) && omBodies.every((b) => !/"session"|"token"/.test(b)) && !sessionsSeen.filter(Boolean).some((t) => omBodies.some((b) => b.includes(t))), omBodies.length);
await browser.close(); site.close(); omApp.close(); sim.close();
check('no page errors', errors.length === 0, errors);
console.log(bad.length ? bad.length + ' check(s) FAILED' : 'all checks passed');
console.log('errors:', JSON.stringify(bad));
process.exit(bad.length ? 1 : 0);
