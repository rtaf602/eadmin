/**
 * ระบบ Login และให้สิทธิ์ผู้ใช้งาน ฝูง.602 — ระบบหลังบ้าน (Google Apps Script)
 *
 * หน้าเว็บบน GitHub Pages (โฟลเดอร์ docs/) เรียกสคริปต์นี้เพื่อ
 *   1) ตรวจการ Login จากชีท LOGIN DATABASE
 *   2) ให้ Admin สร้าง One Time Link, Reset Password และเปลี่ยน Role
 *   3) ให้ผู้ใช้ตั้ง Password ของตัวเองจาก One Time Link
 *   4) บันทึกประวัติลงชีท BACKLOG
 * สคริปต์ทำงานในนามเจ้าของสคริปต์ ชีททั้งสองไฟล์จึงตั้ง Share เป็น Restricted ได้
 * เลขบัตร วันเกิด Salt และ hash ไม่ถูกส่งออกไปที่หน้าเว็บ
 *
 * วิธีติดตั้งอยู่ในไฟล์ SETUP_TH.md — แก้เฉพาะส่วน SETUP ด้านล่าง แล้วกด Run ที่ฟังก์ชัน setup หนึ่งครั้ง
 * ห้ามนำค่าที่กรอกในส่วน SETUP ขึ้น GitHub: กรอกในหน้า Apps Script เท่านั้น
 */

// ============================== SETUP: แก้เฉพาะตรงนี้ ==============================
const SETUP = {
  // ลิงก์ (หรือรหัสไฟล์) ของ Google Sheet "LOGIN DATABASE"
  loginSheet: '',
  // ลิงก์ (หรือรหัสไฟล์) ของ Google Sheet "BACKLOG DATA GENERATE AND RESET PASSWORD"
  backlogSheet: '',
  // Username ของ Admin หลัก: คนเดียวที่ตั้ง Admin คนใหม่ แก้ Username และ Reset Password ของ Admin คนอื่นได้
  superAdmin: '',
  // Username ที่จะออกลิงก์ตั้ง Password ครั้งแรกด้วยฟังก์ชัน createFirstAdminLinks เช่น ['aaa_b', 'ccc_d']
  firstAdmins: [],
  // ที่อยู่เว็บบน GitHub Pages ลงท้ายด้วย / เช่น 'https://xxxx.github.io/eadmin/' (ใช้ตอนออกลิงก์ครั้งแรกเท่านั้น)
  siteUrl: '',
};
// ====================================================================================

const OPT = {
  sessionHours: 8,            // เข้าสู่ระบบหนึ่งครั้งใช้งานได้กี่ชั่วโมง
  linkMinutes: 30,            // อายุของ One Time Link
  maxBirthAttempts: 5,        // กรอกวันเกิดผิดได้กี่ครั้งก่อนลิงก์ถูกยกเลิก
  minPasswordLength: 10,
  maxPasswordLength: 200,
  pbkdf2Iterations: 5000,     // จำนวนรอบของการ hash (ค่านี้ถูกบันทึกไว้กับ hash แต่ละตัว จึงเปลี่ยนภายหลังได้)
  loginMaxFails: 5,           // Login ผิดติดกันกี่ครั้งจึงพักบัญชีนั้น
  loginLockMinutes: 15,
  loginTab: 'DATABASE LOGIN',
  tokenTab: 'LINK TOKEN',
  roles: ['Admin', 'Editor', 'Viewer'],
  tz: 'Asia/Bangkok',
};

const PROP = { db: 'DB_ID', log: 'LOG_ID', superId: 'SUPER_ID', secret: 'SECRET', site: 'SITE_URL', first: 'FIRST_ADMINS' };
// the header cells of the LOGIN DATABASE tab; columns are found by these names, not by their letters
const COL = { rank: 'ยศ', name: 'ชื่อ-สกุล', pos: 'ตำแหน่งงาน', idGov: 'ID Card ขรก.', idCit: 'ID Card ปชช.', birth: 'BIRTH DATE', role: 'Role', username: 'Username', salt: 'Salt', hash: 'hash', end: 'วันสิ้นสุดการใช้งาน' };
// what a row must hold before a link can be made for it (Role, Username, Salt and hash are filled in by this system)
const BASE = [['name', 'ชื่อ-สกุล'], ['pos', 'ตำแหน่งงาน'], ['idGov', 'ID Card ขรก.'], ['idCit', 'ID Card ปชช.'], ['birth', 'BIRTH DATE']];
const TOKEN_HEAD = ['Link ID', 'Token Hash', 'Username', 'Action', 'Created At', 'Expire At', 'Used', 'Attempts'];
const LOG_HEAD = ['Timestamp', 'Action', 'Event', 'กลุ่ม', 'ยศ ชื่อ-สกุล', 'Username', 'Username เดิม', 'Username ใหม่', 'Role', 'Role เดิม', 'Admin ผู้ดำเนินการ', 'Link ID', 'Link หมดอายุ', 'หมายเหตุ'];
const DT_FMT = 'd mmm yyyy hh:mm:ss', D_FMT = 'd-mmm-yyyy';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MSG = {
  login: 'ข้อมูลไม่ถูกต้อง หรือบัญชียังไม่พร้อมใช้งาน ให้ติดต่อ Admin',
  expired: 'สิ้นสุดระยะเวลาในการเข้าถึงข้อมูลของท่าน หากต้องการขยายระยะเวลา ให้ติดต่อ Admin',
  auth: 'หมดเวลาใช้งาน หรือยังไม่ได้เข้าสู่ระบบ ให้เข้าสู่ระบบใหม่',
  link: 'ลิงก์นี้ใช้ไม่ได้แล้ว อาจหมดอายุ ถูกใช้ไปแล้ว หรือถูกยกเลิก ให้ติดต่อ Admin เพื่อขอลิงก์ใหม่',
  admin: 'หน้านี้ใช้ได้เฉพาะผู้ที่มี Role Admin',
};

/* ------------------------------ run from the editor ------------------------------ */

// Run once after filling in SETUP, and again whenever SETUP changes.
function setup() {
  const props = PropertiesService.getScriptProperties();
  const dbId = fileId_(SETUP.loginSheet), logId = fileId_(SETUP.backlogSheet), superName = str_(SETUP.superAdmin).toLowerCase();
  if (!dbId) throw new Error('ใส่ลิงก์ไฟล์ LOGIN DATABASE ในช่อง SETUP.loginSheet แล้วกด Run อีกครั้ง');
  if (!logId) throw new Error('ใส่ลิงก์ไฟล์ BACKLOG ในช่อง SETUP.backlogSheet แล้วกด Run อีกครั้ง');
  if (dbId === logId) throw new Error('SETUP.loginSheet และ SETUP.backlogSheet ต้องเป็นคนละไฟล์');
  if (!superName) throw new Error('ใส่ Username ของ Admin หลักในช่อง SETUP.superAdmin แล้วกด Run อีกครั้ง');

  const ss = SpreadsheetApp.openById(dbId), main = ss.getSheetByName(OPT.loginTab);
  if (!main) throw new Error('ไม่พบแท็บ "' + OPT.loginTab + '" ในไฟล์ LOGIN DATABASE');
  const db = parseDb_(main.getDataRange().getValues(), ss.getSpreadsheetTimeZone() || OPT.tz);
  const supers = db.people.filter(function (p) { return p.username.toLowerCase() === superName; });
  if (supers.length !== 1) throw new Error('ในชีทต้องมี Username "' + superName + '" หนึ่งแถวพอดี (พบ ' + supers.length + ' แถว)');
  if (!supers[0].idGov) throw new Error('แถวของ Admin หลักยังไม่มี ID Card ขรก.');
  if (sameId_(db, supers[0]).length) throw new Error('ID Card ขรก. ของ Admin หลักซ้ำกับแถวที่ ' + sameId_(db, supers[0])[0].row + ' ในชีท แก้ให้ไม่ซ้ำก่อน');

  let tk = ss.getSheetByName(OPT.tokenTab);
  if (!tk) tk = ss.insertSheet(OPT.tokenTab);
  head_(tk, TOKEN_HEAD, 'แท็บ ' + OPT.tokenTab);
  tk.getRange('E2:F').setNumberFormat(DT_FMT);
  const log = SpreadsheetApp.openById(logId).getSheets()[0];
  head_(log, LOG_HEAD, 'ไฟล์ BACKLOG');
  log.getRange('A2:A').setNumberFormat(DT_FMT);
  log.getRange('M2:M').setNumberFormat(DT_FMT);

  props.setProperty(PROP.db, dbId);
  props.setProperty(PROP.log, logId);
  // the main administrator is remembered by the ID card number of the row, so a later change of Username keeps the rights
  props.setProperty(PROP.superId, supers[0].idGov);
  props.setProperty(PROP.site, siteUrl_(SETUP.siteUrl));
  props.setProperty(PROP.first, JSON.stringify((SETUP.firstAdmins || []).map(function (u) { return str_(u).toLowerCase(); }).filter(String)));
  if (!props.getProperty(PROP.secret)) props.setProperty(PROP.secret, hex_(randomBytes_()) + hex_(randomBytes_()));

  // a short health report of the sheet: row numbers only
  const seen = {}, ids = {}, dup = [], dupId = [], noUser = [], incomplete = [];
  db.people.forEach(function (p) {
    const u = p.username.toLowerCase();
    if (!u) noUser.push(p.row); else if (seen[u]) dup.push(p.row + ' กับ ' + seen[u]); else seen[u] = p.row;
    if (p.idGov) { if (ids[p.idGov]) dupId.push(p.row + ' กับ ' + ids[p.idGov]); else ids[p.idGov] = p.row; }
    if (missing_(p).length) incomplete.push(p.row);
  });
  Logger.log('ตั้งค่าเสร็จแล้ว: พบรายชื่อ ' + db.people.length + ' คน');
  if (supers[0].role !== 'Admin') Logger.log('คำเตือน: แถวของ Admin หลักยังไม่มี Role "Admin" ในชีท ให้ใส่ก่อนออกลิงก์ครั้งแรก');
  if (dup.length) Logger.log('คำเตือน: Username ซ้ำกันที่แถว ' + dup.join(', ') + ' (บัญชีที่ซ้ำจะ Login ไม่ได้)');
  if (dupId.length) Logger.log('คำเตือน: ID Card ขรก. ซ้ำกันที่แถว ' + dupId.join(', ') + ' (บัญชีที่ซ้ำจะ Login ไม่ได้)');
  if (noUser.length) Logger.log('แถวที่ยังไม่มี Username: ' + noUser.join(', '));
  if (incomplete.length) Logger.log('แถวที่ข้อมูลยังไม่ครบ (ออกลิงก์ไม่ได้): ' + incomplete.join(', '));
  Logger.log('ขั้นต่อไป: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone)');
}

// Run after setup() to give the first administrators (SETUP.firstAdmins) a link for setting their own password.
// Also the way back in when every administrator has lost their password. The links appear in the execution log only.
function createFirstAdminLinks() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP.db) || !props.getProperty(PROP.secret)) throw new Error('กด Run ที่ฟังก์ชัน setup ก่อน');
  let names = [];
  try { names = JSON.parse(props.getProperty(PROP.first) || '[]'); } catch (x) { names = []; }
  if (!names.length) throw new Error('ใส่ Username ในช่อง SETUP.firstAdmins กด Run ที่ setup อีกครั้ง แล้วจึง Run ฟังก์ชันนี้');
  const site = props.getProperty(PROP.site) || '', ctx = { props: props, now: Date.now() };
  const lock = LockService.getScriptLock();
  lock.waitLock(28000);
  try {
    const db = db_(ctx);
    names.forEach(function (name) {
      const who = db.people.filter(function (p) { return p.username.toLowerCase() === name; });
      if (who.length !== 1) { Logger.log(name + ': ข้าม เพราะในชีทมี Username นี้ ' + who.length + ' แถว'); return; }
      const t = who[0], miss = missing_(t);
      if (miss.length) { Logger.log(name + ': ข้าม เพราะข้อมูลในชีทยังไม่ครบ ขาด ' + miss.join(', ')); return; }
      if (t.role !== 'Admin') { Logger.log(name + ': ข้าม เพราะคอลัมน์ Role ในชีทยังไม่เป็น Admin'); return; }
      const action = t.hash ? 'RESET' : 'CREATE';
      revoke_(ctx, [t.username], t, 'SETUP');
      const link = newLink_(ctx, t.username, action);
      backlog_(ctx, { action: action, event: 'LINK_GENERATED', p: t, admin: 'SETUP (เจ้าของสคริปต์)', link: link, note: 'ออกลิงก์จากหน้า Apps Script' });
      Logger.log(name + ' (ใช้ได้ ' + OPT.linkMinutes + ' นาที ครั้งเดียว): ' + (site ? site + 'set-password.html#token=' + link.raw : 'ต่อท้ายที่อยู่เว็บด้วย set-password.html#token=' + link.raw));
    });
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}

/* ------------------------------ web app entry points ------------------------------ */

function doGet() {
  const props = PropertiesService.getScriptProperties();
  return json_({ ok: true, service: 'eadmin602', ready: !!(props.getProperty(PROP.db) && props.getProperty(PROP.log) && props.getProperty(PROP.secret)) });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return json_({ ok: false, error: { code: 'bad_request', message: 'not JSON' } }); }
  try { return json_(handle_(req)); }
  catch (x) { return json_({ ok: false, error: asError_(x) }); }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function err_(code, message, extra) { return { isErr_: true, code: code, message: message || code, extra: extra || null }; }
function asError_(x) {
  if (x && x.isErr_) return Object.assign({ code: x.code, message: x.message }, x.extra || {});
  console.error(x && x.stack ? x.stack : String(x));        // the detail stays in the owner's execution log
  return { code: 'server_error', message: 'ระบบขัดข้อง ลองอีกครั้ง ถ้ายังไม่ได้ให้แจ้ง Admin' };
}

const OPS = {
  'info': opInfo_, 'login': opLogin_, 'me': opMe_,
  'link.info': opLinkInfo_, 'link.use': opLinkUse_,
  'admin.list': opAdminList_, 'admin.link': opAdminLink_, 'admin.role': opAdminRole_,
};
// these change a sheet, so they run one at a time
const WRITES = { 'link.info': 1, 'link.use': 1, 'admin.link': 1, 'admin.role': 1 };

function handle_(req) {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP.db) || !props.getProperty(PROP.log) || !props.getProperty(PROP.secret)) return { ok: false, error: { code: 'not_ready', message: 'ยังไม่ได้ตั้งค่าระบบหลังบ้าน (รันฟังก์ชัน setup)' } };
  const op = String((req && req.op) || '');
  if (!Object.prototype.hasOwnProperty.call(OPS, op)) return { ok: false, error: { code: 'bad_request', message: 'unknown op' } };
  const ctx = { props: props, now: Date.now() };
  const lock = WRITES[op] ? LockService.getScriptLock() : null;
  if (lock) { try { lock.waitLock(28000); } catch (x) { return { ok: false, error: { code: 'busy', message: 'ระบบกำลังทำรายการอื่นอยู่ ลองอีกครั้ง' } }; } }
  try { return Object.assign({ ok: true, now: ctx.now }, OPS[op](ctx, req)); }
  finally { if (lock) { try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); } } }
}

/* ------------------------------ small helpers ------------------------------ */

function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function norm_(v) { return str_(v).toLowerCase().replace(/\s+/g, ' '); }
function digits_(v) { return str_(v).replace(/\D/g, ''); }
function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
function fileId_(v) { const s = str_(v), m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(s); return m ? m[1] : (/^[A-Za-z0-9_-]{20,}$/.test(s) ? s : ''); }
function siteUrl_(v) { const s = str_(v); if (!s) return ''; if (!/^(https:\/\/|http:\/\/127\.0\.0\.1:\d+\/)[^\s]*$/.test(s)) throw new Error('SETUP.siteUrl ต้องขึ้นต้นด้วย https://'); return s.replace(/[^\/]*\.html.*$/, '').replace(/\/*$/, '/'); }

// year, month, day → 'yyyy-mm-dd', or '' when it is not a real date. A Buddhist-era year is taken as one.
function iso_(y, m, d) {
  if (y > 2400) y -= 543;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return '';
  return y + '-' + pad2_(m) + '-' + pad2_(d);
}
// a cell of the sheet (a date, or text such as 1-Jan-1987, 1/1/2530, 1987-01-01) → 'yyyy-mm-dd', or ''
function toIso_(v, tz) {
  if (isDate_(v)) { if (isNaN(v.getTime())) return ''; const p = Utilities.formatDate(v, tz, 'yyyy-MM-dd').split('-'); return iso_(+p[0], +p[1], +p[2]); }
  const s = str_(v);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return iso_(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-\s\/.]([A-Za-z]{3,9})\.?[-\s\/.](\d{4})$/.exec(s);
  if (m) { const i = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); return i < 0 ? '' : iso_(+m[3], i + 1, +m[1]); }
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s);
  if (m) return iso_(+m[3], +m[2], +m[1]);
  return '';
}
function isoOk_(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s)); return !!m && iso_(+m[1], +m[2], +m[3]) === s; }
function today_() { return Utilities.formatDate(new Date(), OPT.tz, 'yyyy-MM-dd'); }
function ms_(v) { return isDate_(v) ? v.getTime() : (typeof v === 'number' ? v : 0); }

/* ------------------------------ hashing and tokens ------------------------------ */

function utf8_(s) { return Utilities.newBlob(String(s)).getBytes(); }
function sha256_(bytes) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes); }
function hmac_(bytes, keyBytes) { return Utilities.computeHmacSha256Signature(bytes, keyBytes); }
function hex_(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += ((bytes[i] & 255) + 256).toString(16).slice(1); return s; }
function b64_(bytes) { return Utilities.base64EncodeWebSafe(bytes); }
function randomBytes_() { return sha256_(utf8_(Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid())); }      // 32 bytes
// compares all of both strings whatever they hold
function same_(a, b) { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i % (b.length || 1)); return d === 0; }

// PBKDF2-HMAC-SHA256, one 32-byte block
function list_(bytes) { const o = []; for (let i = 0; i < bytes.length; i++) o.push(bytes[i]); return o; }
function pbkdf2_(password, salt, rounds) {
  const key = utf8_(password);
  let u = hmac_(list_(utf8_(salt)).concat([0, 0, 0, 1]), key);
  const out = list_(u);
  for (let i = 1; i < rounds; i++) { u = hmac_(u, key); for (let j = 0; j < out.length; j++) out[j] ^= u[j]; }
  return out;
}
function pwHash_(password, salt, rounds) { rounds = rounds || OPT.pbkdf2Iterations; return 'pbkdf2-sha256$' + rounds + '$' + hex_(pbkdf2_(password, salt, rounds)); }
function pwCheck_(password, salt, stored) {
  const m = /^pbkdf2-sha256\$(\d{1,6})\$([0-9a-f]{64})$/.exec(str_(stored)), rounds = m ? +m[1] : 0;
  if (!m || !salt || rounds < 1000 || rounds > 200000) { pwHash_(password, 'no-such-account'); return false; }       // the same work either way
  return same_(pwHash_(password, salt, rounds), m[0]);
}
function tokenHash_(raw) { return 'sha256:' + hex_(sha256_(utf8_(raw))); }
function secret_(ctx) { if (!ctx.secret) ctx.secret = utf8_(ctx.props.getProperty(PROP.secret)); return ctx.secret; }
function sign_(ctx, text) { return hex_(hmac_(utf8_(text), secret_(ctx))); }

/* ------------------------------ the LOGIN DATABASE tab ------------------------------
   One tab holds several groups. Each group starts with a title row (one filled cell) and may repeat the header row.
   Rows are people when the name column is filled. Columns are found by the header names. */

function parseDb_(values, tz) {
  let head = -1;
  for (let i = 0; i < values.length && head < 0; i++) { const r = values[i].map(norm_); if (r.indexOf(norm_(COL.username)) >= 0 && r.indexOf(norm_(COL.name)) >= 0) head = i; }
  if (head < 0) throw err_('config_error', 'ไม่พบแถวหัวคอลัมน์ (ต้องมี "' + COL.name + '" และ "' + COL.username + '") ในแท็บ ' + OPT.loginTab);
  const hr = values[head].map(norm_), col = {}, lost = [];
  Object.keys(COL).forEach(function (k) { col[k] = hr.indexOf(norm_(COL[k])); if (col[k] < 0) lost.push(COL[k]); });
  if (lost.length) throw err_('config_error', 'แท็บ ' + OPT.loginTab + ' ไม่มีคอลัมน์: ' + lost.join(', '));
  const people = [], nameHead = norm_(COL.name);
  let group = '';
  for (let i = 0; i < values.length; i++) {
    const r = values[i], name = str_(r[col.name]);
    if (norm_(name) === nameHead) continue;                                  // a header row
    if (!name) { const filled = r.map(str_).filter(String); if (filled.length === 1) group = filled[0]; continue; }
    const endRaw = r[col.end], end = toIso_(endRaw, tz), roleText = norm_(r[col.role]);
    people.push({
      row: i + 1, group: group, rank: str_(r[col.rank]), name: name, pos: str_(r[col.pos]),
      idGov: digits_(r[col.idGov]), idCit: digits_(r[col.idCit]), birth: toIso_(r[col.birth], tz),
      role: OPT.roles.filter(function (x) { return x.toLowerCase() === roleText; })[0] || '',
      username: str_(r[col.username]), salt: str_(r[col.salt]), hash: str_(r[col.hash]),
      end: end, endBad: !end && str_(endRaw) !== '',                          // something is written there that is not a date
    });
  }
  return { col: col, people: people, tz: tz };
}
function db_(ctx) {
  if (ctx.db) return ctx.db;
  const ss = SpreadsheetApp.openById(ctx.props.getProperty(PROP.db)), sh = ss.getSheetByName(OPT.loginTab);
  if (!sh) throw err_('config_error', 'ไม่พบแท็บ "' + OPT.loginTab + '" ในไฟล์ LOGIN DATABASE');
  ctx.db = parseDb_(sh.getDataRange().getValues(), ss.getSpreadsheetTimeZone() || OPT.tz);
  ctx.db.ss = ss; ctx.db.sh = sh;
  return ctx.db;
}
function missing_(p) { return BASE.filter(function (b) { return !p[b[0]]; }).map(function (b) { return b[1]; }); }
function sameId_(db, t) { return db.people.filter(function (p) { return p !== t && !!t.idGov && p.idGov === t.idGov; }); }
function canLogin_(p) { return !missing_(p).length && !!p.role && !!p.username && !!p.salt && !!p.hash; }
function isSuper_(ctx, p) { return !!p.idGov && p.idGov === ctx.props.getProperty(PROP.superId); }
function isAdmin_(p) { return p.role === 'Admin' && canLogin_(p); }
function over_(ctx, p) { return !isSuper_(ctx, p) && (p.endBad || (!!p.end && today_() > p.end)); }
function full_(p) { return (p.rank ? p.rank + ' ' : '') + p.name; }
function superName_(ctx) { const s = db_(ctx).people.filter(function (p) { return isSuper_(ctx, p); })[0]; return s && s.username ? s.username : 'Admin หลัก'; }
function sameUser_(db, t, username) { const u = username.toLowerCase(); return db.people.filter(function (p) { return p !== t && p.username.toLowerCase() === u; }); }
function setCell_(ctx, p, key, value) { ctx.db.sh.getRange(p.row, ctx.db.col[key] + 1).setValue(value); }
function setEnd_(ctx, p, iso) {
  const cell = ctx.db.sh.getRange(p.row, ctx.db.col.end + 1);
  if (!iso) { cell.clearContent(); return; }
  // noon of that day in the spreadsheet's own time zone, so the sheet shows the same date wherever the script runs
  cell.setValue(Utilities.parseDate(iso + ' 12:00', ctx.db.tz, 'yyyy-MM-dd HH:mm')).setNumberFormat(D_FMT);
}

// What administrator `a` may do to account `t`.
//   the main administrator: everything, except changing his own role; he has no end date
//   other administrators:   nothing on the main administrator's account, nothing on another administrator's;
//                           they cannot change any Username or make anyone an Admin
function perm_(ctx, a, t) {
  const o = { link: false, user: false, role: false, admin: false, end: false, why: '' }, aSuper = isSuper_(ctx, a), self = a === t;
  if (!isAdmin_(a)) { o.why = MSG.admin; return o; }
  if (!aSuper && isSuper_(ctx, t)) { o.why = 'บัญชี ' + superName_(ctx) + ' แก้ไขได้เฉพาะเจ้าของบัญชี Admin คนอื่นเปลี่ยน Role แก้ Username หรือ Reset Password ให้ไม่ได้'; return o; }
  if (!aSuper && t.role === 'Admin' && !self) { o.why = 'Admin ด้วยกันเปลี่ยน Role หรือ Reset Password ให้กันไม่ได้ ต้องให้ ' + superName_(ctx) + ' ดำเนินการ'; return o; }
  o.link = true;
  o.user = aSuper;
  o.role = !(aSuper && self);
  o.admin = aSuper && !self;
  o.end = !isSuper_(ctx, t);
  return o;
}

/* ------------------------------ sessions ------------------------------
   A session is a signed note { ID card number of the row, expiry, a mark of the current password }. Nothing is kept
   on the server; the row is read again on every request, so a change of Role, of end date or of password takes
   effect at once. */

function pwMark_(ctx, p) { return sign_(ctx, 'pw|' + p.hash).slice(0, 16); }
function session_(ctx, p) {
  const exp = ctx.now + OPT.sessionHours * 3600000, body = b64_(utf8_(JSON.stringify({ i: p.idGov, e: exp, p: pwMark_(ctx, p) })));
  return { token: body + '.' + sign_(ctx, 'session|' + body), exp: exp };
}
function auth_(ctx, req) {
  const tok = String((req && req.session) || ''), cut = tok.lastIndexOf('.');
  if (cut < 1 || tok.length > 800 || !same_(sign_(ctx, 'session|' + tok.slice(0, cut)), tok.slice(cut + 1))) throw err_('auth', MSG.auth);
  let s;
  try { s = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(tok.slice(0, cut))).getDataAsString()); } catch (x) { throw err_('auth', MSG.auth); }
  if (!s || !(+s.e > ctx.now)) throw err_('auth', MSG.auth);
  const who = db_(ctx).people.filter(function (p) { return p.idGov && p.idGov === s.i; });
  if (who.length !== 1 || !canLogin_(who[0]) || !same_(pwMark_(ctx, who[0]), s.p)) throw err_('auth', MSG.auth);
  if (over_(ctx, who[0])) throw err_('expired', MSG.expired);
  ctx.exp = +s.e;
  return who[0];
}
function admin_(ctx, req) { const a = auth_(ctx, req); if (!isAdmin_(a)) throw err_('forbidden', MSG.admin); return a; }
function user_(ctx, p) { return { rank: p.rank, name: p.name, pos: p.pos, username: p.username, role: p.role, isSuper: isSuper_(ctx, p) }; }

// What the page uses to point at a row. It carries no ID number, and stops working when the row moves or changes owner.
function ref_(ctx, p) { return p.row + '.' + sign_(ctx, 'row|' + p.row + '|' + p.idGov + '|' + p.name).slice(0, 20); }
function byRef_(ctx, ref) {
  const m = /^(\d{1,6})\.([0-9a-f]{20})$/.exec(String(ref || '')), t = m && db_(ctx).people.filter(function (p) { return p.row === +m[1]; })[0];
  if (!t || !same_(ref_(ctx, t), m[0])) throw err_('stale', 'รายชื่อในชีทเปลี่ยนไป ให้โหลดหน้านี้ใหม่แล้วเลือกชื่ออีกครั้ง');
  return t;
}

/* ------------------------------ one-time links and the log ------------------------------ */

function tokens_(ctx) {
  if (ctx.tk) return ctx.tk;
  const sh = db_(ctx).ss.getSheetByName(OPT.tokenTab);
  if (!sh) throw err_('config_error', 'ไม่พบแท็บ "' + OPT.tokenTab + '" (รันฟังก์ชัน setup)');
  const rows = sh.getDataRange().getValues().slice(1).map(function (r, i) {
    return { row: i + 2, id: str_(r[0]), hash: str_(r[1]), username: str_(r[2]).toLowerCase(), action: str_(r[3]) === 'RESET' ? 'RESET' : 'CREATE', expire: ms_(r[5]), used: str_(r[6]).toUpperCase(), attempts: Number(r[7]) || 0 };
  }).filter(function (x) { return x.id; });
  ctx.tk = { sh: sh, rows: rows };
  return ctx.tk;
}
function mark_(ctx, link, used, attempts) {
  const sh = tokens_(ctx).sh;
  if (used) { sh.getRange(link.row, 7).setValue(used); link.used = used; }
  if (attempts !== undefined) { sh.getRange(link.row, 8).setValue(attempts); link.attempts = attempts; }
}
function newLink_(ctx, username, action) {
  const raw = b64_(randomBytes_()).replace(/=+$/, '');
  const id = 'LK-' + Utilities.formatDate(new Date(ctx.now), OPT.tz, 'yyyyMMdd-HHmmss') + '-' + hex_(randomBytes_()).slice(0, 4);
  const expire = ctx.now + OPT.linkMinutes * 60000;
  tokens_(ctx).sh.appendRow([id, tokenHash_(raw), username, action, new Date(ctx.now), new Date(expire), 'FALSE', 0]);
  return { raw: raw, id: id, expire: expire };
}
// the links of this person that could still be used stop working: a new link replaces them
function revoke_(ctx, usernames, p, adminName) {
  const names = usernames.map(function (u) { return str_(u).toLowerCase(); }).filter(String);
  tokens_(ctx).rows.forEach(function (link) {
    if (link.used !== 'FALSE' || names.indexOf(link.username) < 0) return;
    const dead = ctx.now >= link.expire;
    mark_(ctx, link, dead ? 'EXPIRED' : 'REVOKED');
    backlog_(ctx, { action: link.action, event: dead ? 'LINK_EXPIRED' : 'LINK_REVOKED', p: p, admin: dead ? '' : adminName, link: link, note: dead ? 'ไม่มีการใช้ลิงก์ภายใน ' + OPT.linkMinutes + ' นาที' : 'สร้างลิงก์ใหม่แทน' });
  });
}
// the row of a link that can be used now; anything else is answered the same way
function liveLink_(ctx, token) {
  const raw = String(token || '');
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(raw)) throw err_('link_invalid', MSG.link);
  const h = tokenHash_(raw), link = tokens_(ctx).rows.filter(function (x) { return same_(x.hash, h); })[0];
  if (!link) throw err_('link_invalid', MSG.link);
  if (link.used === 'FALSE' && ctx.now >= link.expire) {
    mark_(ctx, link, 'EXPIRED');
    backlog_(ctx, { action: link.action, event: 'LINK_EXPIRED', p: ownerOf_(ctx, link) || { username: link.username }, link: link, note: 'ไม่มีการใช้ลิงก์ภายใน ' + OPT.linkMinutes + ' นาที' });
  }
  if (link.used !== 'FALSE') throw err_('link_invalid', MSG.link);
  return link;
}
function ownerOf_(ctx, link) { const who = db_(ctx).people.filter(function (p) { return p.username.toLowerCase() === link.username; }); return who.length === 1 ? who[0] : null; }

// one row per event, added at the bottom. Never a password, a salt, a hash or a token.
function backlog_(ctx, e) {
  if (!ctx.log) ctx.log = SpreadsheetApp.openById(ctx.props.getProperty(PROP.log)).getSheets()[0];
  const p = e.p || {}, link = e.link || null;
  ctx.log.appendRow([new Date(ctx.now), e.action, e.event, p.group || '', p.name ? full_(p) : '', e.username !== undefined ? e.username : (p.username || ''), e.userOld || '', e.userNew || '',
    e.role !== undefined ? e.role : (p.role || ''), e.roleOld || '', e.admin || '', link ? link.id : '', link ? new Date(link.expire) : '', e.note || '']);
}

/* ------------------------------ what the pages may ask ------------------------------ */

function opInfo_() { return { sessionHours: OPT.sessionHours, linkMinutes: OPT.linkMinutes, minPasswordLength: OPT.minPasswordLength }; }

function opLogin_(ctx, req) {
  const username = str_(req.username).toLowerCase(), password = String(req.password === null || req.password === undefined ? '' : req.password);
  if (!username || !password || username.length > 60 || password.length > OPT.maxPasswordLength) throw err_('login_failed', MSG.login);
  const cache = CacheService.getScriptCache(), key = 'lf:' + hex_(sha256_(utf8_(username))).slice(0, 32), fails = Number(cache.get(key)) || 0;
  if (fails >= OPT.loginMaxFails) throw err_('login_locked', 'Login ผิดหลายครั้งเกินไป ให้รอ ' + OPT.loginLockMinutes + ' นาทีแล้วลองใหม่');
  const who = db_(ctx).people.filter(function (p) { return p.username.toLowerCase() === username; });
  // an account is one row: a Username or an ID card number that two rows share belongs to nobody
  const p = who.length === 1 && canLogin_(who[0]) && !sameId_(db_(ctx), who[0]).length ? who[0] : null;
  // all three are always checked, and the password is always worked out, whether or not the account exists
  const okPw = pwCheck_(password, p ? p.salt : '', p ? p.hash : ''), okId = !!p && same_(p.idGov, digits_(req.idGov)), okBirth = !!p && same_(p.birth, str_(req.birth));
  if (!(okPw && okId && okBirth)) { cache.put(key, String(fails + 1), OPT.loginLockMinutes * 60); Utilities.sleep(600); throw err_('login_failed', MSG.login); }
  if (over_(ctx, p)) throw err_('expired', MSG.expired);
  cache.remove(key);
  const s = session_(ctx, p);
  return { session: s.token, expiresAt: s.exp, user: user_(ctx, p) };
}

function opMe_(ctx, req) { const p = auth_(ctx, req); return { user: user_(ctx, p), expiresAt: ctx.exp }; }

// The list for the administrator page. Rank, name, position, Username and Role only, plus what the page needs to know
// about each row without seeing it: whether a password is set, which required cells are empty, the end date.
function opAdminList_(ctx, req) {
  const a = admin_(ctx, req);
  return {
    me: user_(ctx, a), mainAdmin: superName_(ctx), today: today_(), expiresAt: ctx.exp,
    people: db_(ctx).people.map(function (p) {
      const sup = isSuper_(ctx, p);
      return { ref: ref_(ctx, p), group: p.group, rank: p.rank, name: p.name, pos: p.pos, username: p.username, role: p.role, hasPw: !!p.hash, end: sup ? '' : p.end, endBad: !sup && p.endBad, missing: missing_(p), isSuper: sup, isMe: p === a };
    }),
  };
}

function usernameFor_(ctx, t, o, want) {
  const db = db_(ctx), old = t.username;
  if (!o.user) {
    if (!old) throw err_('bad_username', 'บัญชีนี้ยังไม่มี Username ต้องให้ ' + superName_(ctx) + ' กำหนดก่อน');
    if (sameUser_(db, t, old).length) throw err_('bad_username', 'Username นี้ซ้ำกับคนอื่นในชีท ต้องให้ ' + superName_(ctx) + ' แก้ก่อน');
    return old;
  }
  const u = str_(want).toLowerCase();
  if (!u) throw err_('bad_username', 'กรอก Username ก่อน');
  if (!/^[a-z][a-z0-9_.]{2,29}$/.test(u) || u === 'true' || u === 'false') throw err_('bad_username', 'Username ใช้ตัวอักษรอังกฤษตัวเล็ก ตัวเลข จุด หรือขีดล่าง ยาว 3–30 ตัว และขึ้นต้นด้วยตัวอักษร');
  const clash = sameUser_(db, t, u);
  if (clash.length) throw err_('bad_username', 'Username นี้ซ้ำกับ ' + full_(clash[0]) + ' ต้องใช้ชื่ออื่น');
  return u;
}
function roleFor_(ctx, t, o, want) {
  if (!o.role) return t.role;                                      // the main administrator's own role stays as it is
  const role = OPT.roles.indexOf(String(want)) >= 0 ? String(want) : '';
  if (!role) throw err_('bad_role', 'เลือก Role ก่อน');
  if (role === 'Admin' && t.role !== 'Admin' && !o.admin) throw err_('forbidden', 'ตั้งเป็น Admin ได้เฉพาะ ' + superName_(ctx));
  return role;
}
function endFor_(t, o, want) {
  if (!o.end) return t.end;
  const s = str_(want);
  if (s && !isoOk_(s)) throw err_('bad_date', 'วันสิ้นสุดการใช้งานไม่ถูกต้อง');
  return s;
}
function endNote_(t, end) { return end !== t.end || t.endBad ? 'วันสิ้นสุดการใช้งาน: ' + (end || 'ไม่จำกัด') : ''; }

// Generate One Time Link: a first password, or a reset. The Username (when changed), the Role and the end date are
// written now; the password itself is set by the person, through the link.
function opAdminLink_(ctx, req) {
  const a = admin_(ctx, req), t = byRef_(ctx, req.ref), o = perm_(ctx, a, t);
  if (!o.link) throw err_('forbidden', o.why);
  const miss = missing_(t);
  if (miss.length) throw err_('incomplete', 'ข้อมูลของคนนี้ในชีทยังไม่ครบ ขาด: ' + miss.join(', '));
  const old = t.username, username = usernameFor_(ctx, t, o, req.username), role = roleFor_(ctx, t, o, req.role), end = endFor_(t, o, req.end);
  const action = t.hash ? 'RESET' : 'CREATE', changed = username !== old, note = endNote_(t, end);
  revoke_(ctx, [old, username], t, a.username);
  if (changed) setCell_(ctx, t, 'username', username);
  if (role !== t.role) setCell_(ctx, t, 'role', role);
  if (note) setEnd_(ctx, t, end);
  const link = newLink_(ctx, username, action);
  backlog_(ctx, { action: action, event: 'LINK_GENERATED', p: t, username: username, userOld: changed ? old : '', userNew: changed ? username : '', role: role, roleOld: role !== t.role ? t.role : '',
    admin: a === t && changed ? username : a.username, link: link, note: note });
  return { token: link.raw, linkId: link.id, expiresAt: link.expire, action: action, username: username, role: role };
}

// CHANGE ROLE: for an account that already has a password. Written at once; no link, no new password.
function opAdminRole_(ctx, req) {
  const a = admin_(ctx, req), t = byRef_(ctx, req.ref), o = perm_(ctx, a, t);
  if (o.why) throw err_('forbidden', o.why);
  if (!t.hash) throw err_('no_password', 'บัญชีนี้ยังไม่เคยตั้ง Password ให้ใช้ Generate One Time Link');
  const role = roleFor_(ctx, t, o, req.role), end = endFor_(t, o, req.end), note = endNote_(t, end);
  if (role === t.role && !note) throw err_('no_change', 'ยังไม่มีการเปลี่ยนแปลง');
  if (role !== t.role) setCell_(ctx, t, 'role', role);
  if (note) setEnd_(ctx, t, end);
  backlog_(ctx, { action: 'CHANGE_ROLE', event: role !== t.role ? 'ROLE_CHANGED' : 'END_DATE_CHANGED', p: t, role: role, roleOld: role !== t.role ? t.role : '', admin: a.username, note: note });
  return { role: role, end: end };
}

function opLinkInfo_(ctx, req) {
  const link = liveLink_(ctx, req.token), t = ownerOf_(ctx, link);
  if (!t) throw err_('link_invalid', MSG.link);
  return { username: t.username, action: link.action, expiresAt: link.expire, minPasswordLength: OPT.minPasswordLength };
}

// The person sets the password. The date of birth is compared here; the page is only told right or wrong.
// Only the salt and the hash are written. The password is not kept anywhere.
function opLinkUse_(ctx, req) {
  const link = liveLink_(ctx, req.token), t = ownerOf_(ctx, link);
  if (!t || missing_(t).length) throw err_('link_invalid', MSG.link);
  const password = String(req.password === null || req.password === undefined ? '' : req.password);
  if (password.length < OPT.minPasswordLength) throw err_('bad_password', 'Password ต้องยาวอย่างน้อย ' + OPT.minPasswordLength + ' ตัวอักษร');
  if (password.length > OPT.maxPasswordLength) throw err_('bad_password', 'Password ยาวเกินไป');
  if (!same_(t.birth, str_(req.birth))) {
    const n = link.attempts + 1, left = OPT.maxBirthAttempts - n;
    if (left <= 0) {
      mark_(ctx, link, 'LOCKED', n);
      backlog_(ctx, { action: link.action, event: 'VERIFY_FAILED', p: t, link: link, note: 'กรอกวันเกิดผิดครบ ' + OPT.maxBirthAttempts + ' ครั้ง ลิงก์ถูกยกเลิก' });
      throw err_('link_invalid', 'กรอกวันเดือนปีเกิดผิดครบ ' + OPT.maxBirthAttempts + ' ครั้ง ลิงก์นี้ถูกยกเลิกแล้ว ให้ติดต่อ Admin เพื่อขอลิงก์ใหม่');
    }
    mark_(ctx, link, '', n);
    throw err_('birth_wrong', 'วันเดือนปีเกิดไม่ถูกต้อง ลองได้อีก ' + left + ' ครั้ง', { left: left });
  }
  const salt = 's' + hex_(randomBytes_()).slice(0, 31);          // starts with a letter, so a sheet can never read it as a number
  setCell_(ctx, t, 'salt', salt);
  setCell_(ctx, t, 'hash', pwHash_(password, salt));
  mark_(ctx, link, 'TRUE');
  backlog_(ctx, { action: link.action, event: 'PASSWORD_SET', p: t, link: link });
  return { action: link.action, username: t.username };
}

// first row of a tab: written when the tab is empty, otherwise it has to be the expected one
function head_(sh, head, what) {
  const have = sh.getLastRow() ? sh.getRange(1, 1, 1, head.length).getValues()[0].map(str_) : [];
  if (!have.filter(String).length) { sh.getRange(1, 1, 1, head.length).setValues([head]); sh.setFrozenRows(1); return; }
  const off = head.filter(function (h, i) { return have[i] !== h; });
  if (off.length) throw new Error(what + ': หัวคอลัมน์แถวที่ 1 ไม่ตรงกับที่ระบบใช้ ต้องเป็น ' + head.join(' | '));
}
