// A stand-in for Google, so the real back-end code (backend/Code.gs) can be run and tested without a Google account.
//   - loads Code.gs unchanged into a sandbox that has the Apps Script services it uses: SpreadsheetApp,
//     PropertiesService, CacheService, LockService, ContentService, Utilities, Logger
//   - keeps the spreadsheets in memory. A cell holds text, a number, true/false or a date, and text written into a cell
//     is read the way Google Sheets reads typed input: "=…" becomes a formula, digits a number, TRUE a boolean,
//     2026-10-08 a date. The back end has to survive that, so the stand-in does it too.
//   - serves the web app over HTTP the way Apps Script does: POST /exec answers with a redirect to a one-time address
//     that returns the JSON, cross-origin reads are allowed, and a CORS preflight is NOT answered
//   - serves the docs/ folder from a second address (another origin, as GitHub Pages is), with assets/config.js
//     pointing at the stand-in
// It checks the logic and the wire format. It cannot show what only the real service has: quotas, timing, the exact
// wording of Google's error messages, the authorisation screens.
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';
const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const bytes = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(Array.from(v, (b) => b & 255)));
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// a calendar day as Google Sheets holds it for a spreadsheet in Bangkok time: midnight there
export const day = (iso) => new Date(iso + 'T00:00:00+07:00');

// what a cell holds after this was "typed" into it
function typed(v) {
  if (typeof v !== 'string') return v === null || v === undefined ? '' : v;
  const s = v.trim();
  if (s === '') return '';
  if (/^[=+]/.test(s) || /^-\D/.test(s)) return '#NAME?';                                  // taken for a formula
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return Number(s);
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return day(m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'));
  m = /^(\d{1,2})[-\/ ]([A-Za-z]{3})[-\/ ](\d{4})$/.exec(s);
  if (m && MON.includes(m[2].toLowerCase())) return day(m[3] + '-' + String(MON.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0'));
  return v;
}

export function blankFile(title, tabs) { return { title, tz: 'Asia/Bangkok', sheets: (tabs || ['Sheet1']).map((name) => ({ name, rows: [], maxRows: 1000, maxCols: 26, frozen: 0 })) }; }

export async function startSim(opts = {}) {
  const files = opts.files || {}, props = {}, logs = [], cache = new Map();
  const sim = { files, props, logs, cache, hits: [], sleeps: 0, down: false };
  const lastRow = (sh) => { let n = sh.rows.length; while (n > 0 && !(sh.rows[n - 1] || []).some((c) => c !== '' && c !== undefined)) n--; return n; };
  const lastCol = (sh) => sh.rows.reduce((w, r) => { let n = (r || []).length; while (n > 0 && (r[n - 1] === '' || r[n - 1] === undefined)) n--; return Math.max(w, n); }, 0);
  const copy = (v) => (isDate(v) ? new Date(v.getTime()) : v === undefined ? '' : v);

  const sheetApi = (sh) => {
    const box = (r, c, nr, nc) => {
      if (r < 1 || c < 1 || r + nr - 1 > sh.maxRows || c + nc - 1 > sh.maxCols) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      const cellRow = (i) => (sh.rows[r - 1 + i] = sh.rows[r - 1 + i] || []);
      const tidy = () => { for (let i = 0; i < sh.rows.length; i++) { sh.rows[i] = sh.rows[i] || []; for (let j = 0; j < sh.rows[i].length; j++) if (sh.rows[i][j] === undefined) sh.rows[i][j] = ''; } };
      const api = {
        setNumberFormat() { return api; },
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = sh.rows[r - 1 + i] || [], o = []; for (let j = 0; j < nc; j++) o.push(copy(row[c - 1 + j])); out.push(o); } return out; },
        getValue: () => api.getValues()[0][0],
        setValues(v) {
          if (v.length !== nr || v.some((x) => x.length !== nc)) throw new Error('The number of rows or columns in the data does not match the range.');
          v.forEach((x, i) => { const row = cellRow(i); x.forEach((y, j) => { row[c - 1 + j] = typed(y); }); });
          tidy(); return api;
        },
        setValue(v) { for (let i = 0; i < nr; i++) { const row = cellRow(i); for (let j = 0; j < nc; j++) row[c - 1 + j] = typed(v); } tidy(); return api; },
        clearContent() { for (let i = 0; i < nr; i++) { const row = sh.rows[r - 1 + i]; if (row) for (let j = 0; j < nc; j++) if (c - 1 + j < row.length) row[c - 1 + j] = ''; } return api; },
      };
      return api;
    };
    return {
      getName: () => sh.name,
      getMaxRows: () => sh.maxRows, getMaxColumns: () => sh.maxCols, getLastRow: () => lastRow(sh), getLastColumn: () => lastCol(sh),
      setFrozenRows(n) { sh.frozen = n; },
      getDataRange: () => box(1, 1, Math.max(1, lastRow(sh)), Math.max(1, lastCol(sh))),
      // a range given as text ("E2:F") is only ever used here to set a number format
      getRange(r, c, nr, nc) { if (typeof r === 'string') { if (!/^[A-Z]+\d*(:[A-Z]+\d*)?$/.test(r)) throw new Error('Range not found'); return { setNumberFormat() { return this; } }; } return box(r, c, nr || 1, nc || 1); },
      appendRow(v) { const at = lastRow(sh); sh.rows.length = at; if (at + 1 > sh.maxRows) sh.maxRows = at + 1; sh.rows.push(v.map(typed)); return this; },
    };
  };
  const bookApi = (id) => {
    const f = files[id];
    if (!f) throw new Error('Document ' + id + ' is missing (perhaps it was deleted, or you don\'t have read access?)');
    return {
      getId: () => id, getSpreadsheetTimeZone: () => f.tz,
      getSheets: () => f.sheets.map(sheetApi),
      getSheetByName: (n) => { const x = f.sheets.find((q) => q.name === n); return x ? sheetApi(x) : null; },
      insertSheet(n) { if (f.sheets.some((q) => q.name === n)) throw new Error('A sheet with the name "' + n + '" already exists.'); const sh = { name: n, rows: [], maxRows: 1000, maxCols: 26, frozen: 0 }; f.sheets.push(sh); return sheetApi(sh); },
    };
  };
  const tzParts = (d, tz) => { const o = {}; new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d).forEach((p) => { o[p.type] = p.value; }); if (o.hour === '24') o.hour = '00'; return o; };
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, v) => signed(crypto.createHash(alg).update(bytes(v)).digest()),
    computeHmacSha256Signature: (v, key) => signed(crypto.createHmac('sha256', bytes(key)).update(bytes(v)).digest()),
    newBlob: (v) => { const b = bytes(v); return { getBytes: () => signed(b), getDataAsString: () => b.toString('utf8') }; },
    base64EncodeWebSafe: (v) => bytes(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) => { if (!/^[A-Za-z0-9_-]*={0,2}$/.test(s) || s.length % 4) throw new Error('Could not decode string.'); return signed(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')); },
    getUuid: () => crypto.randomUUID(),
    formatDate: (d, tz, fmt) => { const p = tzParts(d, tz); return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second); },
    parseDate: (s, tz, fmt) => { if (fmt !== 'yyyy-MM-dd HH:mm' || tz !== 'Asia/Bangkok') throw new Error('this stand-in parses yyyy-MM-dd HH:mm in Bangkok time only'); return new Date(s.replace(' ', 'T') + ':00+07:00'); },
    sleep() { sim.sleeps++; },
  };
  const sandbox = {
    console: { log() {}, error: (s) => logs.push('console.error: ' + String(s)) },
    SpreadsheetApp: { openById: (id) => bookApi(id), flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => { const e = cache.get(k); if (!e || e.until < Date.now()) { cache.delete(k); return null; } return e.v; }, put: (k, v, sec) => { cache.set(k, { v: String(v), until: Date.now() + (sec || 600) * 1000 }); }, remove: (k) => { cache.delete(k); } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },                // one request at a time here anyway
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: (s) => ({ text: s, setMimeType() { return this; }, getContent() { return this.text; } }) },
    Utilities,
    Logger: { log: (s) => logs.push(String(s)) },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(process.env.CODE_GS || path.join(ROOT, 'backend/Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });   // CODE_GS: try another copy of the back end
  sim.run = (code) => vm.runInContext(code, ctx);
  // fill in the SETUP block and run setup(), as the owner does once in the editor
  sim.setup = (o) => vm.runInContext('Object.assign(SETUP, ' + JSON.stringify(o) + '); setup();', ctx);
  sim.firstLinks = () => { const from = logs.length; vm.runInContext('createFirstAdminLinks();', ctx); return logs.slice(from); };
  sim.post = (obj) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj), type: 'text/plain' } }).getContent());   // straight into doPost, no HTTP
  sim.sheet = (id, name) => { const f = files[id], s = f && (name ? f.sheets.find((x) => x.name === name) : f.sheets[0]); return s ? s.rows : null; };

  // ---- the web app, and a second server that hands out docs/ (so the pages and the back end are different origins) ----
  const pending = new Map(); let seq = 0;
  const app = http.createServer(async (req, res) => {
    if (sim.down) { req.destroy(); return; }
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(405); res.end(); return; }                 // Apps Script does not answer a preflight
    if (url.pathname === '/echo') { const body = pending.get(url.searchParams.get('t')); pending.delete(url.searchParams.get('t')); res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(body || '{}'); return; }
    if (url.pathname !== '/exec') { res.writeHead(404); res.end(); return; }
    let body = ''; for await (const c of req) body += c;
    if (req.method === 'POST') { let op = '?'; try { op = JSON.parse(body).op; } catch (e) { /* counted as it is */ } sim.hits.push({ op, type: req.headers['content-type'] || '' }); }
    let out;
    try { out = req.method === 'POST' ? ctx.doPost({ postData: { contents: body, type: req.headers['content-type'] } }) : ctx.doGet({}); }
    catch (e) { res.writeHead(500, { 'Access-Control-Allow-Origin': '*' }); res.end(String(e)); return; }
    const t = String(++seq); pending.set(t, out.getContent());
    res.writeHead(302, { Location: sim.backendUrl.replace('/exec', '/echo?t=' + t), 'Access-Control-Allow-Origin': '*' }); res.end();
  });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  sim.backendUrl = 'http://127.0.0.1:' + app.address().port + '/exec';
  const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
  const web = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    if (p === '/assets/config.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); res.end('window.EADMIN_CONFIG = ' + JSON.stringify({ backendUrl: sim.noBackend ? '' : sim.backendUrl }) + ';\n'); return; }
    const file = path.join(ROOT, 'docs', path.normalize(p));
    if (!file.startsWith(path.join(ROOT, 'docs')) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  sim.siteUrl = 'http://127.0.0.1:' + web.address().port + '/';
  sim.close = () => { app.closeAllConnections && app.closeAllConnections(); web.closeAllConnections && web.closeAllConnections(); app.close(); web.close(); };
  return sim;
}

/* ---------- a made-up LOGIN DATABASE with the layout of the real one ----------
   One tab, several groups. The first group has its title in row 1 and the header in row 2; later groups have a title
   row, and some repeat the header row. Every person here is invented. */
export const DB = 'SIMLOGINDB' + 'A'.repeat(34), LOG = 'SIMBACKLOG' + 'B'.repeat(34);
export const HEAD = ['No.', 'ยศ', 'ชื่อ-สกุล', 'RANK', 'NAME', 'ตำแหน่งงาน', 'หน้าที่', 'ID Card ขรก.', 'ID Card ปชช.', 'BIRTH DATE', 'Role', 'Username', 'Salt', 'hash', 'วันสิ้นสุดการใช้งาน', 'หมายเหตุ'];
export const TOKEN_HEAD = ['Link ID', 'Token Hash', 'Username', 'Action', 'Created At', 'Expire At', 'Used', 'Attempts'];
export const LOG_HEAD = ['Timestamp', 'Action', 'Event', 'กลุ่ม', 'ยศ ชื่อ-สกุล', 'Username', 'Username เดิม', 'Username ใหม่', 'Role', 'Role เดิม', 'Admin ผู้ดำเนินการ', 'Link ID', 'Link หมดอายุ', 'หมายเหตุ'];
// every made-up person: ID card numbers 30000000xx / 11000000000xx, born 1 Jan 2530 (1987) unless said otherwise
export const BIRTH = '1987-01-01';
export const PEOPLE = [
  { g: 'นักบินผู้บังคับบัญชา', head: true },
  { n: 1, rank: 'น.อ.', name: 'กฤษณ์ สมมุติเดช', pos: 'ผบช.', user: 'krit_s' },
  { n: 2, rank: 'น.อ.', name: 'ปกรณ์ ตัวอย่างดี', pos: 'ผบช.', user: 'pakorn_t', birthText: '1-Jan-1987' },
  { g: 'นักบิน A319 / A320', head: false },
  { n: 3, rank: 'น.อ.', name: 'ธนา ทดลองกิจ', pos: 'นบ.', user: 'thana_t' },
  { n: 4, rank: 'น.อ.', name: 'เมธี จำลองศักดิ์', pos: 'นบ.', user: 'methi_j', birth: '' },                 // no date of birth
  { n: 5, rank: 'น.ต.', name: 'ภูมิ สาธิตพงศ์', pos: 'นบ.', user: 'phum_s' },
  { n: 6, rank: 'ร.ท.', name: 'วีระ ทดสอบการ', pos: 'นบ.', user: 'weera_t', role: 'Admin' },              // a second administrator
  { g: 'นักบิน SSJ', head: true },
  { n: 7, rank: 'น.ต.', name: 'อนันต์ สมมุติชัย', pos: 'นบ.', user: 'anan_s', role: 'Admin' },            // a third administrator
  { n: 8, rank: 'ร.อ.', name: 'ชาญ ตัวอย่างหลัก', pos: 'นบ.', user: 'chan_t', role: 'Admin' },            // the main administrator
  { g: 'เจ้าหน้าที่ช่างอากาศ', head: true },
  { n: 9, rank: 'พ.อ.อ.', name: 'สมชาย ตัวอย่างการ', pos: 'จนท.ชอ.', user: 'somchai_t' },
  { n: 10, rank: 'จ.อ.', name: 'วิทยา ทดสอบดี', pos: 'จนท.ชอ.', user: '' },                               // no Username yet
  { g: 'เจ้าหน้าที่สื่อสาร', head: true },
  { n: 11, rank: 'ร.อ.', name: 'กิตติ สาธิตกุล', pos: 'จนท.สอ.', user: 'kitti_s' },
  { n: 12, rank: 'พ.อ.อ.', name: 'ประเสริฐ จำลองวงศ์', pos: 'จนท.สอ.', user: 'prasert_j' },
];
export const idGov = (n) => 3000000000 + n, idCit = (n) => 1100000000000 + n;
export function loginDb() {
  const f = blankFile('LOGIN DATABASE', ['DATABASE LOGIN', 'LINK TOKEN']), rows = f.sheets[0].rows;
  let first = true, k = 0;
  for (const p of PEOPLE) {
    if (p.g) { rows.push([p.g]); if (p.head || first) rows.push(HEAD.slice()); first = false; k = 0; continue; }
    rows.push([++k, p.rank, p.name, '', '', p.pos, '', idGov(p.n), idCit(p.n), p.birthText || ('birth' in p ? p.birth : day(BIRTH)), p.role || '', p.user, '', '', '', '']);
  }
  f.sheets[1].rows.push(TOKEN_HEAD.slice());
  return f;
}
export function backlogFile() { const f = blankFile('BACKLOG'); f.sheets[0].rows.push(LOG_HEAD.slice()); return f; }
// the row of a person in the made-up sheet, by Username (as it is now) or by name
export function rowOf(sim, key) { const rows = sim.sheet(DB, 'DATABASE LOGIN'); const i = rows.findIndex((r) => r[11] === key || r[2] === key); return i < 0 ? null : { at: i + 1, cells: rows[i] }; }
