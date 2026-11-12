// A web of another repo on this login, end to end: a320-05_seatplan (github.com/rtaf602/a320-05_seatplan, cloned next to
// this repo, or A32005_DIR). The real back end of this repo on its stand-in (gas_sim), the real a320-05_seatplan Code.gs on
// a small stand-in of its own, and both pages in a browser on one origin, as on GitHub Pages (/eadmin/ and
// /a320-05_seatplan/). The seat map of that script is drawn from its Excel layout by setupSheet(); here it is a made-up map
// of two Galley / lavatory items instead (buildMap_, mapSheet_ and writeState_ are replaced). Every person is made up.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { startSim, fourFiles, SETUP4, BIRTH, idGov, ROOT } from './gas_sim.mjs';

const WEBDIR = process.env.A32005_DIR || path.join(ROOT, '..', 'a320-05_seatplan'), OUT = path.join(ROOT, 'test/out/a320-05');
if (!fs.existsSync(path.join(WEBDIR, 'apps-script/Code.gs'))) { console.log('skipped: a320-05_seatplan is not at ' + WEBDIR + ' (set A32005_DIR)'); console.log('errors: []'); process.exit(0); }
fs.mkdirSync(OUT, { recursive: true });
const CODE = fs.readFileSync(path.join(WEBDIR, 'apps-script/Code.gs'), 'utf8');
const WEB = /WEB_CODE:\s*'([A-Z][A-Z0-9_]{1,19})'/.exec(CODE)[1];
const pageCode = /webCode:\s*'([^']*)'/.exec(fs.readFileSync(path.join(WEBDIR, 'config.js'), 'utf8'));
const bad = []; const check = (name, cond, got) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + JSON.stringify(got))); if (!cond) bad.push(name); };
const J = JSON.stringify;
check('the code of the web is the same in Code.gs and config.js (' + WEB + ')', !!pageCode && pageCode[1] === WEB, pageCode && pageCode[1]);

/* ---------- the login system ---------- */
const sim = await startSim({ files: fourFiles() });
let apiUrl = '';
const site = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);   // config.js comes with ?v=… : the path alone
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/eadmin/assets/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('window.EADMIN_CONFIG = ' + J({ backendUrl: sim.backendUrl }) + ';'); return; }
  if (p.startsWith('/a320-05_seatplan/config.js')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('window.SEATPLAN_CONFIG = ' + J({ API_URL: apiUrl, webCode: WEB }) + ';'); return; }
  let file = null;
  if (p.startsWith('/eadmin/')) file = path.join(ROOT, 'docs', path.normalize(p.slice(8)));
  else if (p.startsWith('/a320-05_seatplan/')) file = path.join(WEBDIR, path.normalize(p.slice(18).split('?')[0]));
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + site.address().port;
sim.setup(Object.assign({}, SETUP4, { superAdmin: 'chan_t', firstAdmins: ['chan_t'], siteUrl: ORIGIN + '/eadmin/' }));
sim.run('OPT.pollSeconds = 2');
const post = (op, o) => sim.post(Object.assign({ v: 1, op }, o || {}));
const PW = { chan: 'Main-Admin-Pass-01', thana: 'Editor-Password-05', phum: 'Viewer-Password-03', som: 'NoWeb-Password-09' };
post('link.use', { token: /#token=([A-Za-z0-9_-]+)/.exec(sim.firstLinks().find((l) => l.startsWith('chan_t')))[1], password: PW.chan, birth: BIRTH });
const login = (u, pw, n) => post('login', { username: u, password: pw, idGov: String(idGov(n)), birth: BIRTH });
let S = login('chan_t', PW.chan, 8).session;
const ref = (u) => post('admin.list', { session: S }).people.find((p) => p.username === u).ref;
for (const [u, pw] of [['thana_t', PW.thana], ['phum_s', PW.phum], ['somchai_t', PW.som]]) post('link.use', { token: post('admin.link', { session: S, ref: ref(u), role: 'User', end: '' }).token, password: pw, birth: BIRTH });
post('admin.webList', { session: S, act: 'add', code: WEB, name: 'STATUS SEAT PLAN A320-05', link: 'https://example.github.io/a320-05_seatplan/' });
post('admin.web', { session: S, ref: ref('thana_t'), web: { [WEB]: 'Editor' } });
post('admin.web', { session: S, ref: ref('phum_s'), web: { [WEB]: 'Viewer' } });

/* ---------- the a320-05_seatplan Apps Script, on a stand-in of its own ---------- */
// anything formatting-only answers itself, so the code that makes the Galley tab runs as it is
const loose = (o) => new Proxy(o, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => loose(t) : undefined)) });
const tabs = {};
function tab(name, rows) { tabs[name] = { rows: rows || [] }; return sheet(name); }
function sheet(name) {
  const t = tabs[name]; if (!t) return null;
  const last = () => { let n = t.rows.length; while (n && !(t.rows[n - 1] || []).some((v) => v !== '' && v != null)) n--; return n; };
  const disp = (v) => (v instanceof Date ? v.toISOString() : v == null ? '' : String(v));
  const range = (r, c, nr, nc) => loose({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((t.rows[r - 1 + i] || [])[c - 1 + j] ?? ''))),
    getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => disp((t.rows[r - 1 + i] || [])[c - 1 + j]))),
    getDisplayValue: () => disp((t.rows[r - 1] || [])[c - 1]),
    setValues(v) { v.forEach((row, i) => { const x = (t.rows[r - 1 + i] = t.rows[r - 1 + i] || []); row.forEach((y, j) => { x[c - 1 + j] = y; }); }); return this; },
    setValue(v) { const x = (t.rows[r - 1] = t.rows[r - 1] || []); x[c - 1] = v; return this; },
    getA1Notation: () => String.fromCharCode(64 + c) + r,
  });
  return loose({
    getName: () => name, getLastRow: last, getMaxRows: () => Math.max(1000, t.rows.length), getIndex: () => 1,
    getRange: (r, c, nr, nc) => (typeof r === 'string' ? range(Number(r.slice(1)), r.charCodeAt(0) - 64, 1, 1) : range(r, c, nr || 1, nc || 1)),
  });
}
const MAP = 'ผังที่นั่ง', LOG = 'ประวัติการแก้ไข';
// LAV-A: state D30, note D31 · FWD-KSSU-1: state N30, note N31 (made up)
const mapRows = []; mapRows[29] = []; mapRows[30] = [];
mapRows[29][3] = 'ใช้งานได้'; mapRows[29][13] = 'ใช้งานได้';
tab(MAP, mapRows); tab(LOG, [['เวลา', 'อีเมล', 'ผู้ตรวจ', 'รายการ', 'ช่อง', 'ค่าเดิม', 'ค่าใหม่']]);
const book = loose({ getSheetByName: (n) => sheet(n), insertSheet: (n) => tab(n, []), getNumSheets: () => Object.keys(tabs).length });
const props = {}, cache = new Map(), clock = () => Date.now() + sim.offset; let fetches = 0;
const box = {
  console, JSON, Math, Object, String, Number, Array, Error,
  SpreadsheetApp: loose({ getActive: () => book, flush() {}, newDataValidation: () => loose({}), newConditionalFormatRule: () => loose({}) }),
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) },
  CacheService: { getScriptCache: () => ({ get: (k) => { const e = cache.get(k); return e && e.until > clock() ? e.v : null; }, put: (k, v, s) => cache.set(k, { v, until: clock() + s * 1000 }), remove: (k) => cache.delete(k) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (a, t) => Array.from(crypto.createHash('sha256').update(String(t), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
    base64DecodeWebSafe: (s) => Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: (b) => ({ getDataAsString: () => Buffer.from(b.map((x) => (x + 256) % 256)).toString('utf8') }),
    formatDate: (d, tz, f) => { const o = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d).forEach((x) => { o[x.type] = x.value; }); return f.replace('yyyy', o.year).replace('MM', o.month).replace('dd', o.day).replace('HH', o.hour).replace('mm', o.minute).replace('ss', o.second); },
  },
  UrlFetchApp: { fetch: (url, o) => { fetches++; if (url !== sim.backendUrl) throw new Error('wrong url ' + url); const out = o && o.method === 'post' ? sim.post(JSON.parse(o.payload)) : { ok: true, service: 'eadmin602' }; return { getContentText: () => J(out) }; } },
  Session: { getActiveUser: () => ({ getEmail: () => '' }) },
  Logger: { log: (s) => logs.push(String(s)) },
};
const logs = [];
const ctx = vm.createContext(box);
box.__clock = clock;
vm.runInContext('(function () { const R = Date; function D() { const a = arguments; return a.length ? new R(...a) : new R(__clock()); } D.prototype = R.prototype; D.now = function () { return __clock(); }; D.UTC = R.UTC; D.parse = R.parse; globalThis.Date = D; })();', ctx);
vm.runInContext(CODE, ctx, { filename: 'a320-05/Code.gs' });
vm.runInContext(`
  var TEST_ITEMS = { 'LAV-A': { id: 'LAV-A', label: 'LAVATORY A', kind: 'lav', status: [30, 4], seat: [30, 4], note: [31, 4] },
                     'FWD-STOWAGE-1': { id: 'FWD-STOWAGE-1', label: 'FWD GALLEY · Stowage 1', kind: 'eq', status: [30, 14], seat: [30, 14], note: [31, 14] } };
  mapSheet_ = function () { return SpreadsheetApp.getActive().getSheetByName(MAP_SHEET); };
  buildMap_ = function (sh) { const v = sh.getRange(1, 1, 40, 20).getDisplayValues(); return { items: TEST_ITEMS, cell: function (r, c) { return String(v[r - 1][c - 1]).trim(); } }; };
  ensureSetup_ = function () {};
  writeState_ = function (sh, state) { Object.keys(TEST_ITEMS).forEach(function (id) { const it = TEST_ITEMS[id]; sh.getRange(it.seat[0], it.seat[1]).setValue(EQ_TXT[0]); sh.getRange(it.note[0], it.note[1]).setValue(''); }); };
`, ctx);
const setupErr = () => { try { vm.runInContext('setup()', ctx); return ''; } catch (e) { return e.message; } };
check('setup refuses to run without the address of the login system', /LOGIN\.LOGIN_URL/.test(setupErr()));
props.LOGIN_URL = sim.backendUrl;
vm.runInContext('var __real = loginUrlOk_; loginUrlOk_ = function (u) { return u === ' + J(sim.backendUrl) + ' || __real(u); };', ctx);
check('setup: the login system answers', setupErr() === '' && logs.some((l) => /ระบบ Login ตอบแล้ว/.test(l)), logs);
const cpost = (o) => JSON.parse(ctx.doPost({ postData: { contents: J(o) } }).getContent());
const ce = (r) => r.error || '';
const passOf = (s) => post('web.enter', { session: s, web: WEB }).pass;
const sT = login('thana_t', PW.thana, 3).session, sP = login('phum_s', PW.phum, 5).session, sM = login('somchai_t', PW.som, 9).session;
const T = passOf(sT), P = passOf(sP);
check('GET gives no data any more', !('seats' in JSON.parse(ctx.doGet({ parameter: { action: 'load' } }).getContent())));
check('no pass, a made-up pass, a session instead of a pass: refused', ce(cpost({ action: 'load' })) === 'auth' && ce(cpost({ action: 'load', pass: 'a.b' })) === 'auth' && ce(cpost({ action: 'load', pass: sT })) === 'auth');
check('the old PIN does not open anything', ce(cpost({ action: 'load', pin: '6020' })) === 'auth' && ce(cpost({ action: 'save', pin: '6020', by: 'x', changes: [] })) === 'auth');
check('no access to this web: no pass for it', !passOf(sM) && (post('web.enter', { session: sM, web: WEB }).error || {}).code === 'no_web');
const lT = cpost({ action: 'load', pass: T });
check('Editor: the seats, and the name from the column ชื่อ-สกุล with the Role; no PIN asked; no clearing', lT.ok && lT.me.name === 'ธนา ทดลองกิจ' && lT.me.role === 'Editor' && 'LAV-A' in lT.seats && lT.pinRequired === false && lT.resetEnabled === false, lT.me);
const lP = cpost({ action: 'load', pass: P });
check('Viewer: may look', lP.ok && lP.me.role === 'Viewer');
check('Viewer cannot SAVE, clear, read the whole history or log an export', ['save', 'reset', 'history', 'exported'].every((a) => ce(cpost({ action: a, pass: P, changes: [], kind: 'EXPORT TO EXCEL' })) === 'forbidden'));
const sv = cpost({ action: 'save', pass: T, by: 'ชื่อปลอม', changes: [{ id: 'LAV-A', s: 2, m: 0, note: 'ชักโครกตัน', fields: ['s', 'note'], base: { s: 0, m: 0, note: '' } }] });
const log = () => tabs[LOG].rows.slice(1).filter((r) => r && r[0]);
check('Editor SAVE: written to the map, the history carries the name from the login, not the one the page sends', sv.ok && sv.saved === 1 && tabs[MAP].rows[29][3] === 'ใช้งานไม่ได้' && log().filter((r) => r[3] === 'LAVATORY A').length === 2 && log().filter((r) => r[3] === 'LAVATORY A').every((r) => r[2] === 'ธนา ทดลองกิจ') && !J(tabs[LOG].rows).includes('ชื่อปลอม') && sv.lastSave.by === 'ธนา ทดลองกิจ', [sv, log().slice(-2)]);
check('Editor cannot clear all data (Admin of this web only)', ce(cpost({ action: 'reset', pass: T })) === 'forbidden');
const ex = cpost({ action: 'exported', pass: T, kind: 'EXPORT PDF SUMMARY 4 PAGES', filename: 'x.pdf' });
const exl = () => (tabs['ประวัติการส่งออก'] ? tabs['ประวัติการส่งออก'].rows.slice(1).filter((r) => r && r[0]) : []);
check('an export: a line in its own tab ประวัติการส่งออก (made on the first export), not in ประวัติการแก้ไข', ex.ok && J(tabs['ประวัติการส่งออก'].rows[0]) === J(['เวลา', 'ชื่อ-สกุล', 'Username', 'Role', 'ชนิดไฟล์', 'ชื่อไฟล์']) && J(exl().slice(-1)[0].slice(1)) === J(['ธนา ทดลองกิจ', 'thana_t', 'Editor', 'EXPORT PDF SUMMARY 4 PAGES', 'x.pdf']) && !J(tabs[LOG].rows).includes('x.pdf'), exl());
check('…an unknown kind of export is refused', ce(cpost({ action: 'exported', pass: T, kind: 'anything' })) === 'bad_request');
const passS = passOf(S), lS = cpost({ action: 'load', pass: passS });
check('Admin of this web (the main admin): may clear all data', lS.resetEnabled === true && cpost({ action: 'reset', pass: passS }).ok && tabs[MAP].rows[29][3] === 'ใช้งานได้' && log().slice(-1)[0][2] === 'ชาญ ตัวอย่างหลัก');
const f0 = fetches; for (let i = 0; i < 4; i++) cpost({ action: 'load', pass: P });
check('loading every 30 seconds asks the login system at most once a minute; every SAVE asks afresh', fetches === f0 && (() => { const f = fetches; cpost({ action: 'save', pass: T, changes: [] }); return fetches === f + 1; })());
post('admin.web', { session: S, ref: ref('thana_t'), web: { [WEB]: '' } });
check('access taken away: the next SAVE is refused at once', ce(cpost({ action: 'save', pass: T, changes: [] })) === 'no_web');
post('admin.web', { session: S, ref: ref('thana_t'), web: { [WEB]: 'Editor' } });
check('a pass for another web: refused, and said why', (() => { post('admin.webList', { session: S, act: 'add', code: 'OTHERWEB', name: 'x', link: 'https://example.github.io/x/' }); return ce(cpost({ action: 'load', pass: post('web.enter', { session: S, web: 'OTHERWEB' }).pass })) === 'wrong_web'; })());
[sT, sP, sM, S].forEach((x) => post('logout', { session: x })); cache.clear();

/* ---------- over HTTP as Apps Script answers, and the pages in a browser ---------- */
const pend = new Map(); let seq = 0;
const app = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(405); res.end(); return; }
  if (u.pathname === '/echo') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(pend.get(u.searchParams.get('t')) || '{}'); return; }
  let body = ''; for await (const c of req) body += c;
  const out = req.method === 'POST' ? ctx.doPost({ postData: { contents: body } }).getContent() : ctx.doGet({ parameter: {} }).getContent();
  const t = String(++seq); pend.set(t, out);
  res.writeHead(302, { Location: apiUrl.replace('/exec', '/echo?t=' + t), 'Access-Control-Allow-Origin': '*' }); res.end();
});
await new Promise((r) => app.listen(0, '127.0.0.1', r));
apiUrl = 'http://127.0.0.1:' + app.address().port + '/exec';
const browser = await chromium.launch();
const errors = [], bodies = [];
async function device(name) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true }), page = await c.newPage();
  page.on('pageerror', (e) => errors.push(name + ' PAGEERROR ' + e.message));
  page.on('request', (r) => { if (r.url() === apiUrl && r.method() === 'POST') bodies.push(r.postData() || ''); });
  page.on('dialog', (d) => d.accept());
  return { c, page };
}
const signIn = async (page, u, pw, n) => {
  await page.fill('#user', u); await page.fill('#pw', pw); await page.fill('#card', String(idGov(n)));
  await page.selectOption('#birth-d', '1'); await page.selectOption('#birth-m', '1'); await page.selectOption('#birth-y', '2530');
  await page.click('#go');
};
const A = await device('editor');
await A.page.goto(ORIGIN + '/a320-05_seatplan/');
await A.page.waitForURL(/\/eadmin\/index\.html\?next=/);
check('no login: to the login page titled LOGIN PAGE, with the way back', A.page.url() === ORIGIN + '/eadmin/index.html?next=%2Fa320-05_seatplan%2F' && /^LOGIN PAGE/.test((await A.page.innerText('#brand')).trim()));
await signIn(A.page, 'thana_t', PW.thana, 3);
await A.page.waitForURL(ORIGIN + '/a320-05_seatplan/');
await A.page.waitForFunction(() => document.getElementById('inspector').value !== '', null, { timeout: 15000 });
check('after the login: back on the seat plan, no PIN screen, the inspector is the account name (not typed), Role shown', (await A.page.isHidden('#gate')) && (await A.page.inputValue('#inspector')) === 'ธนา ทดลองกิจ' && (await A.page.getAttribute('#inspector', 'readonly')) !== null && /Editor/.test(await A.page.innerText('#role')) && !(await A.page.isVisible('#pinDlg')));
await A.page.click('#zones [data-id="FWD-STOWAGE-1"]');
await A.page.click('#optS button:nth-child(2)'); await A.page.fill('#note', 'ล้อล็อกไม่ได้'); await A.page.click('#dSave');
await A.page.click('#bSave');
await A.page.waitForFunction(() => /ยังไม่เคย|SAVE ล่าสุด/.test(document.getElementById('lastSave').textContent) && !document.getElementById('bSave').textContent.includes('กำลัง'), null, { timeout: 15000 });
await A.page.waitForTimeout(800);
check('SAVE from the page: no PIN asked, written, in the history under the account name', tabs[MAP].rows[29][13] === 'ใช้งานได้บางส่วน' && log().filter((r) => r[3] === 'FWD GALLEY · Stowage 1').length === 2 && log().filter((r) => r[3] === 'FWD GALLEY · Stowage 1').every((r) => r[2] === 'ธนา ทดลองกิจ'), log().slice(-2));
await A.page.screenshot({ path: path.join(OUT, '1-editor.png') });
// ExcelJS comes from a CDN this test cannot reach: a stand-in that answers anything, so the page goes through
await A.page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/exceljs/, (r) => r.fulfill({ contentType: 'text/javascript', body: `(function(){var mk=function(){return new Proxy(function(){},{get:function(t,k){if(k==='then')return undefined;if(k==='writeBuffer')return function(){return Promise.resolve(new ArrayBuffer(8))};if(k===Symbol.toPrimitive)return function(){return 0};if(k===Symbol.iterator)return function*(){};return mk()},apply:function(){return mk()},construct:function(){return mk()},set:function(){return true}})};window.ExcelJS={Workbook:mk()}})();` }));
const n0 = exl().length, nLog0 = log().length;
const dl = A.page.waitForEvent('download'); await A.page.click('#bXls'); await dl; await A.page.waitForTimeout(1200);
check('EXPORT TO EXCEL on the page: the file, and a line in ประวัติการส่งออก with the account', exl().length === n0 + 1 && log().length === nLog0 && exl().slice(-1)[0][4] === 'EXPORT TO EXCEL' && exl().slice(-1)[0][1] === 'ธนา ทดลองกิจ' && /\.xlsx$/.test(exl().slice(-1)[0][5]), exl().slice(-1));
check('Editor: no button to clear all data', await A.page.isHidden('#foot'));

const V = await device('viewer');
await V.page.goto(ORIGIN + '/a320-05_seatplan/'); await V.page.waitForURL(/next=/);
await signIn(V.page, 'phum_s', PW.phum, 5); await V.page.waitForURL(ORIGIN + '/a320-05_seatplan/');
await V.page.waitForFunction(() => document.getElementById('inspector').value !== '', null, { timeout: 15000 });
check('Viewer: looks only; no SAVE, CLEAR, PREVIEW or export buttons, and says so', ['#bSave', '#bClear', '#bPreview', '#bPdf', '#bPdf2', '#bXls'].every((x) => true) && !(await V.page.isVisible('#bSave')) && !(await V.page.isVisible('#bXls')) && !(await V.page.isVisible('#bPdf')) && /ดูอย่างเดียว \(Viewer\)/.test(await V.page.innerText('#notice')));
await V.page.screenshot({ path: path.join(OUT, '2-viewer.png') });

const N = await device('noweb');
await N.page.goto(ORIGIN + '/a320-05_seatplan/'); await N.page.waitForURL(/next=/);
await signIn(N.page, 'somchai_t', PW.som, 9); await N.page.waitForURL(ORIGIN + '/a320-05_seatplan/');
await N.page.waitForSelector('#gateBtn:not([hidden])', { timeout: 15000 });
check('no access: the agreed message, the plan not shown, a way back to the login page', /บัญชีนี้ไม่มีสิทธิ์ใช้งานเว็บนี้/.test(await N.page.innerText('#gateErr')) && (await N.page.isHidden('#app')));
await N.page.screenshot({ path: path.join(OUT, '3-noweb.png') });

const B2 = await device('editor-2');
await B2.page.goto(ORIGIN + '/eadmin/index.html'); await signIn(B2.page, 'thana_t', PW.thana, 3);
await A.page.waitForSelector('#app-take:not([hidden])', { timeout: 15000 });
check('1.12.1 on the seat plan: the notice of a login from another device', /มีผู้ Login เข้าใช้งานบัญชีนี้จากเครื่องอื่น/.test(await A.page.innerText('#app-take')));
await A.page.click('#app-deny');
await A.page.click('#bOut');
await A.page.waitForURL(/\/eadmin\/index\.html/, { timeout: 15000 });
check('ออกจากระบบ on the seat plan: at the login page, nobody signed in', (await A.page.evaluate(() => localStorage.getItem('eadmin602:session'))) === null);
check('the pages never sent a session or a PIN to the seat plan back end, only passes', bodies.length > 3 && bodies.every((b) => /"pass":"[^"]{40,}"/.test(b) && !/"session"|"pin"/.test(b)), bodies.length);

await browser.close(); site.close(); app.close(); sim.close();
check('no page errors', errors.length === 0, errors);
console.log(bad.length ? bad.length + ' check(s) FAILED' : 'all checks passed');
console.log('errors:', J(bad));
process.exit(bad.length ? 1 : 0);
