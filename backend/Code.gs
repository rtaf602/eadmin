/**
 * ระบบ Login และให้สิทธิ์ผู้ใช้งาน ฝูง.602 — ระบบหลังบ้าน (Google Apps Script)
 *
 * หน้าเว็บบน GitHub Pages (โฟลเดอร์ docs/) เรียกสคริปต์นี้เพื่อ
 *   1) ตรวจการ Login จากชีท LOGIN DATABASE
 *   2) ให้ Admin สร้าง One Time Link, Reset Password และเปลี่ยน Role
 *   3) ให้ผู้ใช้ตั้ง Password ของตัวเองจาก One Time Link
 *   4) บันทึกประวัติลงชีท BACKLOG
 *   5) คัดลอกข้อมูลไปไฟล์ Backup สองไฟล์ และตั้ง Protect sheet ให้ทุกแท็บของไฟล์ Backup
 * สคริปต์ทำงานในนามเจ้าของสคริปต์ ชีททุกไฟล์จึงตั้ง Share เป็น Restricted ได้
 * ติดตั้งสคริปต์นี้ด้วยบัญชี Google ที่เป็นเจ้าของไฟล์ Backup (บัญชีนั้นต้องแก้ไขไฟล์ LOGIN DATABASE และ BACKLOG ได้ด้วย)
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
  // ลิงก์ (หรือรหัสไฟล์) ของ Google Sheet "BACKUP LOGIN DATABASE" (ไฟล์ Backup ของ LOGIN DATABASE)
  backupLoginSheet: '',
  // ลิงก์ (หรือรหัสไฟล์) ของ Google Sheet "BACKUP BACKLOG" (ไฟล์ Backup ของ BACKLOG ต้องเป็นคนละไฟล์กับ BACKLOG ตัวหลัก)
  backupBacklogSheet: '',
  // Username ของ Admin หลัก: คนเดียวที่ตั้ง Admin คนใหม่ เปลี่ยน Username และ Reset Password ของ Admin คนอื่นได้
  superAdmin: '',
  // Username ที่จะออกลิงก์ตั้ง Password ครั้งแรกด้วยฟังก์ชัน createFirstAdminLinks เช่น ['aaa_b', 'ccc_d']
  firstAdmins: [],
  // ที่อยู่เว็บบน GitHub Pages ลงท้ายด้วย / เช่น 'https://xxxx.github.io/eadmin/' (ใช้ตอนออกลิงก์ครั้งแรกเท่านั้น)
  siteUrl: '',
};
// ====================================================================================

const OPT = {
  sessionMinutes: 60,         // เข้าสู่ระบบหนึ่งครั้งใช้งานได้กี่นาที นับจากเวลาที่ Login ไม่ต่ออายุตามการใช้งาน
  warnMinutes: 5,             // หน้าเว็บเตือนก่อนหมดเวลากี่นาที
  pollSeconds: 10,            // หน้าเว็บที่ Login อยู่ถามระบบหลังบ้านทุกกี่วินาที ว่ามีการ Login ซ้อนจากเครื่องอื่นหรือไม่
  takeoverSeconds: 10,        // เครื่องเดิมมีเวลากี่วินาทีในการกด "ไม่อนุญาต" ก่อนถูกให้ออก
  awaySeconds: 30,            // เครื่องเดิมไม่ถามระบบมานานเท่านี้ ถือว่าไม่ได้เปิดหน้าเว็บอยู่ เครื่องใหม่เข้าใช้งานได้
  backupKeepDays: 60,         // ไฟล์ BACKUP LOGIN DATABASE เก็บแท็บรายวันกี่วัน (แท็บสุดท้ายของแต่ละเดือนเก็บถาวร)
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

const PROP = { db: 'DB_ID', log: 'LOG_ID', bdb: 'BACKUP_DB_ID', blog: 'BACKUP_LOG_ID', superId: 'SUPER_ID', secret: 'SECRET', site: 'SITE_URL', first: 'FIRST_ADMINS', bkProt: 'BK_PROTECTED', bkEvents: 'BK_EVENTS' };
// the settings: read once and kept in the script cache, so a page that asks every few seconds costs no property reads
const CFG = [PROP.db, PROP.log, PROP.bdb, PROP.blog, PROP.superId, PROP.secret, PROP.site, PROP.first];
// one device per account: seconds of slack for a refusal on its way, how long a waiting device may stay silent, how
// often it asks, how long its ticket lasts, how long a refusal is remembered
const DEV = { grace: 3, gone: 10, waitPollMs: 2500, ticket: 120, denyKeep: 60 };
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
  auth: 'ยังไม่ได้เข้าสู่ระบบ ให้เข้าสู่ระบบใหม่',
  timeout: 'หมดเวลาใช้งาน ให้เข้าสู่ระบบใหม่',
  pwChanged: 'Password ของบัญชีนี้ถูกเปลี่ยนแล้ว ให้เข้าสู่ระบบใหม่ด้วย Password ใหม่',
  taken: 'บัญชีของคุณถูกออกจากระบบ เพราะมีการ Login จากเครื่องอื่น หากไม่ใช่คุณ ให้ติดต่อ Admin เพื่อ Reset Password',
  denied: 'บัญชีนี้กำลังถูกใช้งานที่เครื่องอื่น และเครื่องนั้นไม่อนุญาตให้เข้าใช้งานซ้อน',
  waitBusy: 'มีการขอเข้าใช้งานบัญชีนี้จากอีกเครื่องหนึ่งค้างอยู่ ให้รอสักครู่แล้วลองใหม่',
  waitGone: 'การขอเข้าใช้งานหมดเวลา ให้เข้าสู่ระบบใหม่',
  link: 'ลิงก์นี้ใช้ไม่ได้แล้ว อาจหมดอายุ ถูกใช้ไปแล้ว หรือถูกยกเลิก ให้ติดต่อ Admin เพื่อขอลิงก์ใหม่',
  admin: 'หน้านี้ใช้ได้เฉพาะผู้ที่มี Role Admin',
};

/* ------------------------------ run from the editor ------------------------------ */

// Run once after filling in SETUP, and again whenever SETUP changes.
function setup() {
  const props = PropertiesService.getScriptProperties();
  const dbId = fileId_(SETUP.loginSheet), logId = fileId_(SETUP.backlogSheet), bdbId = fileId_(SETUP.backupLoginSheet), blogId = fileId_(SETUP.backupBacklogSheet), superName = str_(SETUP.superAdmin).toLowerCase();
  if (!dbId) throw new Error('ใส่ลิงก์ไฟล์ LOGIN DATABASE ในช่อง SETUP.loginSheet แล้วกด Run อีกครั้ง');
  if (!logId) throw new Error('ใส่ลิงก์ไฟล์ BACKLOG ในช่อง SETUP.backlogSheet แล้วกด Run อีกครั้ง');
  if (!bdbId) throw new Error('ใส่ลิงก์ไฟล์ BACKUP LOGIN DATABASE ในช่อง SETUP.backupLoginSheet แล้วกด Run อีกครั้ง');
  if (!blogId) throw new Error('ใส่ลิงก์ไฟล์ BACKUP BACKLOG ในช่อง SETUP.backupBacklogSheet แล้วกด Run อีกครั้ง');
  const four = [dbId, logId, bdbId, blogId];
  if (four.some(function (x, i) { return four.indexOf(x) !== i; })) throw new Error('ไฟล์ทั้งสี่ในส่วน SETUP ต้องเป็นคนละไฟล์กัน (LOGIN DATABASE, BACKLOG, BACKUP LOGIN DATABASE, BACKUP BACKLOG)');
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
  // the two backup files: the account that runs this script has to be able to edit them (it should own them)
  let bss, blogSs, blog;
  try { bss = SpreadsheetApp.openById(bdbId); bss.getSheets(); } catch (x) { throw new Error('เปิดไฟล์ BACKUP LOGIN DATABASE ไม่ได้ ตรวจว่าบัญชีที่ติดตั้งระบบนี้เป็นเจ้าของไฟล์นั้น'); }
  try { blogSs = SpreadsheetApp.openById(blogId); blog = blogSs.getSheets()[0]; } catch (x) { throw new Error('เปิดไฟล์ BACKUP BACKLOG ไม่ได้ ตรวจว่าบัญชีที่ติดตั้งระบบนี้เป็นเจ้าของไฟล์นั้น'); }
  head_(blog, LOG_HEAD, 'ไฟล์ BACKUP BACKLOG');
  blog.getRange('A2:A').setNumberFormat(DT_FMT);
  blog.getRange('M2:M').setNumberFormat(DT_FMT);

  props.setProperty(PROP.db, dbId);
  props.setProperty(PROP.log, logId);
  props.setProperty(PROP.bdb, bdbId);
  props.setProperty(PROP.blog, blogId);
  // the main administrator is remembered by the ID card number of the row, so a later change of Username keeps the rights
  props.setProperty(PROP.superId, supers[0].idGov);
  props.setProperty(PROP.site, siteUrl_(SETUP.siteUrl));
  props.setProperty(PROP.first, JSON.stringify((SETUP.firstAdmins || []).map(function (u) { return str_(u).toLowerCase(); }).filter(String)));
  if (!props.getProperty(PROP.secret)) props.setProperty(PROP.secret, hex_(randomBytes_()) + hex_(randomBytes_()));
  CacheService.getScriptCache().remove('cfg');

  // the first backup, with Protect on every tab of both backup files. A failure here stops the setup: better now than later.
  const ctx = { props: props_(), now: Date.now(), locked: true };
  db_(ctx); ctx.log = log; bk_(ctx).logSs = blogSs; bk_(ctx).logSh = blog;
  backupDb_(ctx); backupLog_(ctx, true); guardAll_(ctx);       // what BACKLOG already holds goes into its backup here
  const failed = bk_(ctx).ev.filter(function (e) { return e.e === 'BACKUP_FAILED'; });
  if (failed.length) throw new Error(failed[0].x + ' ตรวจว่าบัญชีที่ติดตั้งระบบนี้เป็นเจ้าของไฟล์ Backup ทั้งสองไฟล์ แล้วกด Run อีกครั้ง');
  events_(ctx);
  backupLog_(ctx);
  SpreadsheetApp.flush();

  // a short health report of the sheet: row numbers only
  const seen = {}, ids = {}, dup = [], dupId = [], noUser = [], incomplete = [];
  db.people.forEach(function (p) {
    const u = p.username.toLowerCase();
    if (!u) noUser.push(p.row); else if (seen[u]) dup.push(p.row + ' กับ ' + seen[u]); else seen[u] = p.row;
    if (p.idGov) { if (ids[p.idGov]) dupId.push(p.row + ' กับ ' + ids[p.idGov]); else ids[p.idGov] = p.row; }
    if (missing_(p).length) incomplete.push(p.row);
  });
  Logger.log('ตั้งค่าเสร็จแล้ว: พบรายชื่อ ' + db.people.length + ' คน');
  Logger.log('Backup: คัดลอกแท็บ ' + OPT.loginTab + ' ไปไฟล์ BACKUP LOGIN DATABASE แท็บ ' + today_() + ' แล้ว และตั้ง Protect sheet ให้ทุกแท็บของไฟล์ Backup ทั้งสองไฟล์แล้ว');
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
  const props = props_();
  if (!ready_(props)) throw new Error('กด Run ที่ฟังก์ชัน setup ก่อน');
  let names = [];
  try { names = JSON.parse(props.getProperty(PROP.first) || '[]'); } catch (x) { names = []; }
  if (!names.length) throw new Error('ใส่ Username ในช่อง SETUP.firstAdmins กด Run ที่ setup อีกครั้ง แล้วจึง Run ฟังก์ชันนี้');
  const site = props.getProperty(PROP.site) || '', ctx = { props: props, now: Date.now(), locked: true };
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
    finishBackup_(ctx);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}

/* ------------------------------ web app entry points ------------------------------ */

function doGet() { return json_({ ok: true, service: 'eadmin602', ready: ready_(props_()) }); }

// The script properties. The settings come from the script cache when it has them (setup() empties it); everything
// else is read and written straight through.
function props_() {
  const real = PropertiesService.getScriptProperties(), cache = CacheService.getScriptCache();
  let cfg = null;
  try { cfg = JSON.parse(cache.get('cfg') || 'null'); } catch (x) { cfg = null; }
  if (!cfg) {
    const all = real.getProperties(); cfg = {};
    CFG.forEach(function (k) { if (all[k] !== undefined && all[k] !== null) cfg[k] = all[k]; });
    if (cfg[PROP.secret] && cfg[PROP.bdb] && cfg[PROP.blog]) cache.put('cfg', JSON.stringify(cfg), 21600);
  }
  return {
    getProperty: function (k) { return CFG.indexOf(k) >= 0 ? (Object.prototype.hasOwnProperty.call(cfg, k) ? cfg[k] : null) : real.getProperty(k); },
    setProperty: function (k, v) { real.setProperty(k, v); },
    deleteProperty: function (k) { real.deleteProperty(k); },
  };
}
function ready_(props) { return !!(props.getProperty(PROP.db) && props.getProperty(PROP.log) && props.getProperty(PROP.bdb) && props.getProperty(PROP.blog) && props.getProperty(PROP.secret)); }

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
  'info': opInfo_, 'login': opLogin_, 'login.wait': opLoginWait_, 'login.cancel': opLoginCancel_, 'me': opMe_, 'ping': opPing_, 'session.deny': opDeny_, 'logout': opLogout_,
  'link.info': opLinkInfo_, 'link.use': opLinkUse_,
  'admin.list': opAdminList_, 'admin.link': opAdminLink_, 'admin.role': opAdminRole_, 'admin.username': opAdminUsername_, 'admin.backupAck': opBackupAck_,
};
// these change a sheet, so they run one at a time
const WRITES = { 'link.info': 1, 'link.use': 1, 'admin.link': 1, 'admin.role': 1, 'admin.username': 1, 'admin.backupAck': 1 };
const BUSY = 'ระบบกำลังทำรายการอื่นอยู่ ลองอีกครั้ง';

function handle_(req) {
  const props = props_();
  if (!ready_(props)) return { ok: false, error: { code: 'not_ready', message: 'ยังไม่ได้ตั้งค่าระบบหลังบ้าน (รันฟังก์ชัน setup)' } };
  const op = String((req && req.op) || '');
  if (!Object.prototype.hasOwnProperty.call(OPS, op)) return { ok: false, error: { code: 'bad_request', message: 'unknown op' } };
  const ctx = { props: props, now: Date.now(), locked: false };
  let lock = null;
  if (WRITES[op]) {
    // what can be refused without reading a sheet is refused before the lock is asked for: the lock is shared by everyone
    if (op.indexOf('admin.') === 0) token_(ctx, req);
    else if (!/^[A-Za-z0-9_-]{30,80}$/.test(String((req && req.token) || ''))) throw err_('link_invalid', MSG.link);
    lock = LockService.getScriptLock();
    try { lock.waitLock(28000); } catch (x) { return { ok: false, error: { code: 'busy', message: BUSY } }; }
    ctx.locked = true; ctx.now = Date.now();                        // the wait may have been long
  }
  try {
    const out = OPS[op](ctx, req);
    if (lock) SpreadsheetApp.flush();                               // a write that Google refuses fails here, as part of the work itself
    // the device in use is told on whatever it asks next that another device wants this account (ข้อ 1.12.1)
    return Object.assign({ ok: true, now: ctx.now }, out, ctx.take ? { take: ctx.take } : {});
  } finally {
    if (lock) {
      // the backup comes after the work itself and never undoes it (ข้อ 1.13.6)
      try { finishBackup_(ctx); SpreadsheetApp.flush(); } catch (x) { console.error(x && x.stack ? x.stack : String(x)); }
      lock.releaseLock();
    }
  }
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
function setCell_(ctx, p, key, value) { ctx.db.sh.getRange(p.row, ctx.db.col[key] + 1).setValue(value); ctx.dbDirty = true; }      // dbDirty: the tab is copied to its backup when the request ends
function setEnd_(ctx, p, iso) {
  const cell = ctx.db.sh.getRange(p.row, ctx.db.col.end + 1);
  ctx.dbDirty = true;
  if (!iso) { cell.clearContent(); return; }
  // noon of that day in the spreadsheet's own time zone, so the sheet shows the same date wherever the script runs
  cell.setValue(Utilities.parseDate(iso + ' 12:00', ctx.db.tz, 'yyyy-MM-dd HH:mm')).setNumberFormat(D_FMT);
}

// What administrator `a` may do to account `t`.
//   the main administrator: everything, except changing his own role; he has no end date
//   other administrators:   nothing on the main administrator's account, nothing on another administrator's;
//                           they cannot change any Username (their own included) or make anyone an Admin
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
   A session is a signed note { a mark of the ID card number of the row (never the number itself), expiry, a mark of
   the current password, the id of this login }. The row is read again on every request, so a change of Role, of end date or of password takes effect at
   once. A session lasts OPT.sessionMinutes from the login and is never extended (ข้อ 1.10). */

function pwMark_(ctx, p) { return sign_(ctx, 'pw|' + p.hash).slice(0, 16); }
function seal_(ctx, kind, o) { const body = b64_(utf8_(JSON.stringify(o))); return body + '.' + sign_(ctx, kind + '|' + body); }
function open_(ctx, kind, token) {
  const tok = String(token || ''), cut = tok.lastIndexOf('.');
  if (cut < 1 || tok.length > 800 || !same_(sign_(ctx, kind + '|' + tok.slice(0, cut)), tok.slice(cut + 1))) return null;
  try { const o = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(tok.slice(0, cut))).getDataAsString()); return o && typeof o === 'object' ? o : null; } catch (x) { return null; }
}
function session_(ctx, p, sid, exp) { return seal_(ctx, 'session', { i: devKey_(ctx, p.idGov), e: exp, p: pwMark_(ctx, p), s: sid }); }
// The row a session or a ticket belongs to, from the mark it carries. Which mark is whose is remembered in the script
// cache; when it is not there, the mark of every row is worked out once.
function byKey_(ctx, k) {
  const cache = CacheService.getScriptCache(), people = db_(ctx).people, id = cache.get('who:' + k);
  let who = id ? people.filter(function (p) { return p.idGov === id; }) : [];
  if (who.length !== 1 || !same_(devKey_(ctx, who[0].idGov), k)) {
    who = people.filter(function (p) { return p.idGov && same_(devKey_(ctx, p.idGov), k); });
    if (who.length === 1) cache.put('who:' + k, who[0].idGov, 21600);
  }
  return who.length === 1 ? who[0] : null;
}
// the note itself: signed by this system and not past its time. The sheet is not read here.
function token_(ctx, req) {
  const s = open_(ctx, 'session', req && req.session);
  if (!s || !s.i || !s.s) throw err_('auth', MSG.auth);
  if (!(+s.e > ctx.now)) throw err_('auth', MSG.timeout);
  return s;
}
function auth_(ctx, req) {
  const s = token_(ctx, req), p = byKey_(ctx, String(s.i));
  if (!p || !canLogin_(p)) throw err_('auth', MSG.auth);
  if (!same_(pwMark_(ctx, p), s.p)) throw err_('auth', MSG.pwChanged);              // ข้อ 1.9
  if (over_(ctx, p)) throw err_('expired', MSG.expired);
  device_(ctx, s);                                                                  // ข้อ 1.12
  ctx.exp = +s.e;
  return p;
}

/* ------------------------------ one device per account (ข้อ 1.12) ------------------------------
   For each account the back end keeps which login is the one in use: { s: its id, p: its password mark, e: its end }.
   A login from another device while that one is alive becomes a request q: { r: id, p, at, seen }.
     - the device in use learns of it on its next question (it asks every OPT.pollSeconds), has OPT.takeoverSeconds to
       refuse, and is out when it does not
     - a device that has not asked for OPT.awaySeconds is taken to have the page closed, and the new one is let in
     - a refusal is kept as d (the id refused) until the new device has heard it
   The state lives in a script property (the truth) and in the script cache (what the frequent questions read).
   Changes are made one at a time under the script lock. Who gets the account is decided here, never in a page. */

function devKey_(ctx, idGov) { return sign_(ctx, 'dev|' + idGov).slice(0, 24); }
function rid_(ctx, r) { return sign_(ctx, 'rid|' + r).slice(0, 16); }                // what the device in use is shown of a request
function devRead_(ctx, k, fresh) {
  const cache = CacheService.getScriptCache();
  let raw = fresh ? null : cache.get('dev:' + k);
  // read without the lock, a copy is kept for a short while only: a change made meanwhile must not be covered by it for long
  if (raw === null) { raw = ctx.props.getProperty('DEV_' + k) || '-'; if (!fresh) cache.put('dev:' + k, raw, 30); }
  if (raw === '-') return null;
  try { return JSON.parse(raw); } catch (x) { return null; }
}
function devWrite_(ctx, k, st) {
  if (st) ctx.props.setProperty('DEV_' + k, JSON.stringify(st)); else ctx.props.deleteProperty('DEV_' + k);
  CacheService.getScriptCache().put('dev:' + k, st ? JSON.stringify(st) : '-', 21600);
}
function devEmpty_(st) { return !st || (!st.s && !st.q && !st.d && !st.why); }
// what the passing of time has decided since the state was written. Returns the state as it stands now.
function devSettle_(ctx, k, st) {
  if (!st) return null;
  const now = ctx.now, cache = CacheService.getScriptCache();
  if (!(st.e > now)) { st.s = ''; st.why = ''; }                                     // that login has run its hour
  if (st.d && !(st.dt + DEV.denyKeep * 1000 > now)) st.d = '';
  if (st.q) {
    const q = st.q, lastNew = Number(cache.get('dq:' + q.r)) || q.at;
    let give = false;
    if (now - lastNew > DEV.gone * 1000) st.q = null;                                // the new device stopped waiting
    else if (!st.s) give = true;                                                     // the device in use has left
    else if (q.seen) give = now >= q.seen + (OPT.takeoverSeconds + DEV.grace) * 1000;      // it was told, and did not refuse
    else give = now >= (Number(cache.get('ds:' + k)) || q.at) + OPT.awaySeconds * 1000;    // it is not looking at the page
    if (give) st = { s: q.r, p: q.p, e: now + OPT.sessionMinutes * 60000 };
  }
  return devEmpty_(st) ? null : st;
}
// one change to the state of an account, made alone. fn gets the state as it stands and returns { st: the new state, … }.
// alive: the cache key that says "this device has just asked" ('ds:…' or 'dq:…'), stamped once the lock is held.
function devSync_(ctx, k, fn, alive) {
  const lock = ctx.locked ? null : LockService.getScriptLock();
  if (lock) { try { lock.waitLock(20000); } catch (x) { throw err_('busy', BUSY); } ctx.now = Date.now(); }       // the wait may have been long
  try {
    const cache = CacheService.getScriptCache();
    if (alive) cache.put(alive, String(ctx.now), 3600);
    const was = devRead_(ctx, k, true), before = JSON.stringify(was || null);
    const out = fn(devSettle_(ctx, k, was));
    if (devEmpty_(out.st)) out.st = null;
    if (JSON.stringify(out.st) !== before) devWrite_(ctx, k, out.st);
    else cache.put('dev:' + k, out.st ? JSON.stringify(out.st) : '-', 21600);        // the copy in the cache is the truth again
    return out;
  } finally { if (lock) lock.releaseLock(); }
}
// Is this login still the one in use? Called on every request that carries a session. Notes that the device is alive,
// and puts into ctx.take the request it has to be told about.
function device_(ctx, s) {
  const k = String(s.i), read = devRead_(ctx, k), before = JSON.stringify(read || null);
  let st = devSettle_(ctx, k, read);
  if (JSON.stringify(st) !== before) st = devSync_(ctx, k, function (x) { return { st: x }; }).st;      // time moved something on: write it down
  if (!st || st.s !== s.s) {
    if (st && (st.why === 'pw' || (st.s && st.p !== s.p))) throw err_('auth', MSG.pwChanged);
    if (st && st.s) throw err_('taken', MSG.taken);
    throw err_('auth', MSG.auth);
  }
  CacheService.getScriptCache().put('ds:' + k, String(ctx.now), 3600);
  if (!st.q) return;
  if (!st.q.seen) st = devSync_(ctx, k, function (x) { if (x && x.s === s.s && x.q && !x.q.seen) x.q.seen = ctx.now; return { st: x }; }).st;
  if (st && st.s === s.s && st.q && st.q.seen) ctx.take = { rid: rid_(ctx, st.q.r), until: st.q.seen + OPT.takeoverSeconds * 1000 };
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
function revoke_(ctx, usernames, p, adminName, why) {
  const names = usernames.map(function (u) { return str_(u).toLowerCase(); }).filter(String);
  tokens_(ctx).rows.forEach(function (link) {
    if (link.used !== 'FALSE' || names.indexOf(link.username) < 0) return;
    const dead = ctx.now >= link.expire;
    mark_(ctx, link, dead ? 'EXPIRED' : 'REVOKED');
    backlog_(ctx, { action: link.action, event: dead ? 'LINK_EXPIRED' : 'LINK_REVOKED', p: p, admin: dead ? '' : adminName, link: link, note: dead ? 'ไม่มีการใช้ลิงก์ภายใน ' + OPT.linkMinutes + ' นาที' : (why || 'สร้างลิงก์ใหม่แทน') });
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
  const row = [new Date(ctx.now), e.action, e.event, p.group || '', p.name ? full_(p) : '', e.username !== undefined ? e.username : (p.username || ''), e.userOld || '', e.userNew || '',
    e.role !== undefined ? e.role : (p.role || ''), e.roleOld || '', e.admin || '', link ? link.id : '', link ? new Date(link.expire) : '', e.note || ''];
  ctx.log.appendRow(row);
  bk_(ctx).rows.push(row);                                          // ข้อ 1.13.2: the same rows go to BACKUP BACKLOG when the request ends
}

/* ------------------------------ what the pages may ask ------------------------------ */

function opInfo_() { return { sessionMinutes: OPT.sessionMinutes, warnMinutes: OPT.warnMinutes, pollSeconds: OPT.pollSeconds, takeoverSeconds: OPT.takeoverSeconds, linkMinutes: OPT.linkMinutes, minPasswordLength: OPT.minPasswordLength }; }

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
  // one device per account (ข้อ 1.12): in at once when nobody is using the account, or when the device that was has
  // not asked for OPT.awaySeconds; otherwise this device waits for that one to leave
  const sid = hex_(randomBytes_()).slice(0, 24), mark = pwMark_(ctx, p), k = devKey_(ctx, p.idGov);
  cache.put('who:' + k, p.idGov, 21600);
  const r = devSync_(ctx, k, function (st) {
    if (st && st.s) {
      if (st.q) return { st: st, busy: true };
      // when it is not known when the device in use last asked, it is taken to have asked just now
      const last = Number(cache.get('ds:' + k)) || ctx.now;
      if (ctx.now < last + OPT.awaySeconds * 1000) { st.q = { r: sid, p: mark, at: ctx.now, seen: 0 }; return { st: st, wait: true }; }
    }
    return { st: { s: sid, p: mark, e: ctx.now + OPT.sessionMinutes * 60000 } };
  }, 'dq:' + sid);
  if (r.busy) throw err_('login_busy', MSG.waitBusy);
  if (r.wait) return { wait: true, ticket: seal_(ctx, 'ticket', { i: k, r: sid, p: mark, e: ctx.now + DEV.ticket * 1000 }), pollMs: DEV.waitPollMs, username: p.username };
  cache.put('ds:' + k, String(ctx.now), 3600);
  sweep_(ctx);
  return { session: session_(ctx, p, sid, r.st.e), expiresAt: r.st.e, user: user_(ctx, p) };
}
// Now and then (every six hours at most) what is kept about logins that ended long ago is thrown away.
function sweep_(ctx) {
  const cache = CacheService.getScriptCache();
  if (cache.get('sweep')) return;
  cache.put('sweep', '1', 21600);
  try {
    const all = PropertiesService.getScriptProperties().getProperties();
    Object.keys(all).forEach(function (name) {
      if (name.indexOf('DEV_') !== 0) return;
      let st = null; try { st = JSON.parse(all[name]); } catch (x) { st = null; }
      if (!st || (!(st.e > ctx.now) && !st.q)) { ctx.props.deleteProperty(name); cache.remove('dev:' + name.slice(4)); }
    });
  } catch (x) { console.error('sweep: ' + String(x)); }
}

// The device that is waiting asks again. It is let in when the device in use has left, has not refused in time, or
// is not looking at the page; it is turned away when that device refused.
function opLoginWait_(ctx, req) {
  const t = open_(ctx, 'ticket', req.ticket);
  if (!t || !t.i || !t.r || !(+t.e > ctx.now)) throw err_('login_gone', MSG.waitGone);
  const cache = CacheService.getScriptCache(), k = String(t.i);
  const r = devSync_(ctx, k, function (st) {
    if (st && st.s === t.r) return { st: st, inside: true };
    if (st && st.d === t.r) { st.d = ''; return { st: st, denied: true }; }
    if (st && st.q && st.q.r === t.r) return { st: st, wait: true, left: st.q.seen ? st.q.seen + (OPT.takeoverSeconds + DEV.grace) * 1000 - ctx.now : (Number(cache.get('ds:' + k)) || st.q.at) + OPT.awaySeconds * 1000 - ctx.now };
    if (!st) return { st: { s: t.r, p: t.p, e: ctx.now + OPT.sessionMinutes * 60000 }, inside: true };        // nobody is using the account any more
    return { st: st, gone: true };
  }, 'dq:' + t.r);
  if (r.denied) throw err_('login_denied', MSG.denied);
  if (r.gone) throw err_('login_gone', MSG.waitGone);
  if (r.wait) return { wait: true, left: Math.max(0, Math.ceil(r.left / 1000)) };
  // let in: the row is read once more, as a login does
  const row = byKey_(ctx, k), p = row && canLogin_(row) && same_(pwMark_(ctx, row), t.p) ? row : null;
  if (!p || over_(ctx, p)) {
    devSync_(ctx, k, function (st) { return { st: st && st.s === t.r ? null : st }; });
    throw p ? err_('expired', MSG.expired) : err_('login_failed', MSG.login);
  }
  cache.put('ds:' + k, String(ctx.now), 3600);
  return { session: session_(ctx, p, t.r, r.st.e), expiresAt: r.st.e, user: user_(ctx, p) };
}

// The device that is waiting gives up ("ยกเลิก", or its page is closed): the device in use is left alone at once.
function opLoginCancel_(ctx, req) {
  const t = open_(ctx, 'ticket', req && req.ticket);
  if (t && t.i && t.r) devSync_(ctx, String(t.i), function (st) { if (st && st.q && st.q.r === t.r) st.q = null; if (st && st.s === t.r) st.s = ''; return { st: st }; });
  return {};
}

function opMe_(ctx, req) { const p = auth_(ctx, req); return { user: user_(ctx, p), expiresAt: ctx.exp }; }

// What a signed-in page asks every OPT.pollSeconds: am I still the device in use, and does another device want in?
// The sheet is not read here; Role, end date and password are checked on every other request.
function opPing_(ctx, req) { const s = token_(ctx, req); device_(ctx, s); return { expiresAt: +s.e }; }

// "ไม่อนุญาต ฉันกำลังใช้งานอยู่": the device in use keeps the account, the new device is turned away (ข้อ 1.12.5)
function opDeny_(ctx, req) {
  const s = token_(ctx, req);
  const r = devSync_(ctx, String(s.i), function (st) {
    if (!st || st.s !== s.s) return { st: st, late: true };
    if (st.q && same_(rid_(ctx, st.q.r), String(req.rid || ''))) { st.d = st.q.r; st.dt = ctx.now; st.q = null; return { st: st, denied: true }; }
    return { st: st, denied: false };
  });
  if (r.late) throw err_('taken', MSG.taken);
  return { denied: r.denied };                                       // false: that request is no longer the one waiting
}

// "ออกจากระบบ": the account is free at once, and a device that is waiting for it gets in
function opLogout_(ctx, req) {
  const s = open_(ctx, 'session', req && req.session);
  if (s && s.i && s.s) devSync_(ctx, String(s.i), function (st) { if (st && st.s === s.s) st.s = ''; return { st: st }; });
  return {};
}

// The list for the administrator page. Rank, name, position, Username and Role only, plus what the page needs to know
// about each row without seeing it: whether a password is set, which required cells are empty, the end date.
function opAdminList_(ctx, req) {
  const a = admin_(ctx, req);
  return {
    me: user_(ctx, a), mainAdmin: superName_(ctx), today: today_(), expiresAt: ctx.exp,
    backupEvents: bkEvents_(ctx).map(function (e) { return { at: e.t, event: e.e, text: e.x }; }),        // ข้อ 1.13.7.2: shown until the main administrator acknowledges
    people: db_(ctx).people.map(function (p) {
      const sup = isSuper_(ctx, p);
      return { ref: ref_(ctx, p), group: p.group, rank: p.rank, name: p.name, pos: p.pos, username: p.username, role: p.role, hasPw: !!p.hash, end: sup ? '' : p.end, endBad: !sup && p.endBad, missing: missing_(p), isSuper: sup, isMe: p === a };
    }),
  };
}

// Generate One Time Link uses the Username that is saved in the sheet (ข้อ 1.2.1.3)
function savedUser_(ctx, t, o) {
  if (!t.username) throw err_('bad_username', o.user ? 'บัญชีนี้ยังไม่มี Username ให้บันทึก Username ก่อน' : 'บัญชีนี้ยังไม่มี Username ต้องให้ ' + superName_(ctx) + ' กำหนดก่อน');
  if (sameUser_(db_(ctx), t, t.username).length) throw err_('bad_username', 'Username นี้ซ้ำกับคนอื่นในชีท ต้องให้ ' + superName_(ctx) + ' แก้ก่อน');
  return t.username;
}
function newUser_(ctx, t, want) {
  const u = str_(want).toLowerCase();
  if (!u) throw err_('bad_username', 'กรอก Username ก่อน');
  if (!/^[a-z][a-z0-9_.]{2,29}$/.test(u) || u === 'true' || u === 'false') throw err_('bad_username', 'Username ใช้ตัวอักษรอังกฤษตัวเล็ก ตัวเลข จุด หรือขีดล่าง ยาว 3–30 ตัว และขึ้นต้นด้วยตัวอักษร');
  const clash = sameUser_(db_(ctx), t, u);
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

// Generate One Time Link: a first password, or a reset. The Role and the end date are written now; the password
// itself is set by the person, through the link. The Username is the saved one: it has a button of its own.
function opAdminLink_(ctx, req) {
  const a = admin_(ctx, req), t = byRef_(ctx, req.ref), o = perm_(ctx, a, t);
  if (!o.link) throw err_('forbidden', o.why);
  const miss = missing_(t);
  if (miss.length) throw err_('incomplete', 'ข้อมูลของคนนี้ในชีทยังไม่ครบ ขาด: ' + miss.join(', '));
  const username = savedUser_(ctx, t, o), role = roleFor_(ctx, t, o, req.role), end = endFor_(t, o, req.end);
  const action = t.hash ? 'RESET' : 'CREATE', note = endNote_(t, end);
  revoke_(ctx, [username], t, a.username);
  if (role !== t.role) setCell_(ctx, t, 'role', role);
  if (note) setEnd_(ctx, t, end);
  const link = newLink_(ctx, username, action);
  backlog_(ctx, { action: action, event: 'LINK_GENERATED', p: t, role: role, roleOld: role !== t.role ? t.role : '', admin: a.username, link: link, note: note });
  return { token: link.raw, linkId: link.id, expiresAt: link.expire, action: action, username: username, role: role };
}

// เปลี่ยน Username: the main administrator only. Written over the old one at once; no link, and the password, the
// Role and the end date stay as they are. A link of that account that was not used yet stops working. (ข้อ 1.2.1)
function opAdminUsername_(ctx, req) {
  const a = admin_(ctx, req), t = byRef_(ctx, req.ref), o = perm_(ctx, a, t);
  if (o.why) throw err_('forbidden', o.why);
  if (!o.user) throw err_('forbidden', 'เปลี่ยน Username ได้เฉพาะ ' + superName_(ctx));
  const old = t.username, username = newUser_(ctx, t, req.username);
  if (username === old) throw err_('no_change', 'ยังไม่มีการเปลี่ยนแปลง');
  revoke_(ctx, [old, username], t, a.username, 'เปลี่ยน Username ลิงก์เดิมจึงถูกยกเลิก');
  setCell_(ctx, t, 'username', username);
  backlog_(ctx, { action: 'CHANGE_USERNAME', event: 'USERNAME_CHANGED', p: t, username: username, userOld: old, userNew: username, admin: a === t ? username : a.username, note: old ? '' : 'กำหนด Username ครั้งแรก' });
  return { username: username, old: old };
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
  // ข้อ 1.9: the devices signed in with the old password are out at once (auth_ sees the new password mark). This note
  // lets a page that only asks "am I still in" hear it within seconds, and be told why. The password is set either way.
  try { devSync_(ctx, devKey_(ctx, t.idGov), function () { return { st: { s: '', e: ctx.now + OPT.sessionMinutes * 60000, why: 'pw' } }; }); }
  catch (x) { console.error('devices not told of the new password: ' + String(x)); }
  return { action: link.action, username: t.username };
}

/* ------------------------------ backup (ข้อ 1.13) ------------------------------
   BACKUP LOGIN DATABASE: after a request has written to the DATABASE LOGIN tab, the whole tab is copied to a tab
     named after the day (2026-10-09, Bangkok time). A second copy on the same day replaces that day's tab. Daily tabs
     are kept OPT.backupKeepDays days; older ones are deleted, except the last tab of each month.
   BACKUP BACKLOG: every row added to BACKLOG is added there too, when the request ends.
   Every tab of both files is protected so that only the owner of the file can edit it. This script runs as the owner,
   so it can write. A tab that this system protected and that is found unprotected is protected again, and the
   administrators are told (BACKLOG rows, and a list on the Admin page until the main administrator acknowledges).
   A backup that fails never fails the work it follows. No page reads the backup files. */

function bk_(ctx) { return ctx.bk || (ctx.bk = { ev: [], rows: [], logOff: false, closed: false }); }
// the detail of a failure stays in the owner's execution log; the sheets get a plain sentence without file ids
function bkFail_(ctx, file, x) {
  console.error('backup of ' + file + ' failed: ' + (x && x.stack ? x.stack : String(x)));
  const b = bk_(ctx), text = 'Backup ไม่สำเร็จ: ไฟล์ ' + file + ' (งานหลักบันทึกแล้ว ดูสาเหตุได้ที่หน้า Executions ของ Apps Script)';
  if (!b.closed && !b.ev.some(function (e) { return e.x === text; })) b.ev.push({ e: 'BACKUP_FAILED', x: text });
}
// BACKUP BACKLOG gets the rows this request added to BACKLOG. When it is behind (an earlier backup failed, or it is
// new), it first gets every row it lacks. Rows are only ever added: a BACKLOG that has lost rows takes nothing away.
function backupLog_(ctx, catchUp) {
  const b = bk_(ctx), rows = b.rows;
  if (b.logOff || (!rows.length && !catchUp)) return;               // logOff: it failed once in this request: said once, not tried again
  try {
    if (!ctx.log) ctx.log = SpreadsheetApp.openById(ctx.props.getProperty(PROP.log)).getSheets()[0];
    if (!b.logSh) { b.logSs = SpreadsheetApp.openById(ctx.props.getProperty(PROP.blog)); b.logSh = b.logSs.getSheets()[0]; }
    const w = LOG_HEAD.length, have = Math.max(1, b.logSh.getLastRow()), before = ctx.log.getLastRow() - rows.length;
    const add = have < before ? ctx.log.getRange(have + 1, 1, before - have, w).getValues().concat(rows) : rows;
    if (add.length) {
      const room = b.logSh.getMaxRows() - have;
      if (add.length > room) b.logSh.insertRowsAfter(have + room, add.length - room);
      b.logSh.getRange(have + 1, 1, add.length, w).setValues(add);
    }
    b.rows = [];
  } catch (x) { b.logOff = true; bkFail_(ctx, 'BACKUP BACKLOG', x); }
}
function dayShift_(iso, days) { const p = iso.split('-').map(Number), t = new Date(Date.UTC(p[0], p[1] - 1, p[2]) + days * 86400000); return t.getUTCFullYear() + '-' + pad2_(t.getUTCMonth() + 1) + '-' + pad2_(t.getUTCDate()); }
function backupDb_(ctx) {
  const b = bk_(ctx);
  let made = null, ss = null;
  try {
    ss = SpreadsheetApp.openById(ctx.props.getProperty(PROP.bdb));
    const name = today_(), old = ss.getSheetByName(name);
    // a copy of the tab as it is: text stays text, dates stay dates. Formulas are frozen into their values.
    const src = db_(ctx).sh.getDataRange(), values = src.getValues(), formulas = src.getFormulas();
    made = db_(ctx).sh.copyTo(ss);
    const all = made.getDataRange();
    all.copyTo(all, { contentsOnly: true });
    // a formula that looked at another tab or another file cannot work in the copy: its cell gets the value the
    // original shows, written column by column for each run of such cells
    for (let c = 0; c < (formulas[0] || []).length; c++) {
      for (let r = 0; r < formulas.length; r++) {
        if (!formulas[r][c]) continue;
        let n = 1; while (r + n < formulas.length && formulas[r + n][c]) n++;
        made.getRange(r + 1, c + 1, n, 1).setValues(values.slice(r, r + n).map(function (row) { return [row[c]]; }));
        r += n - 1;
      }
    }
    if (old) {
      // today's tab is about to be replaced: if it lost its Protect since the last backup, that is still reported
      const ps = old.getProtections(SpreadsheetApp.ProtectionType.SHEET);
      if ((!ps.length || ps[0].isWarningOnly()) && (bkKnown_(ctx).d || []).indexOf(old.getSheetId()) >= 0) b.lostDb = [name];
      ss.deleteSheet(old);
    }
    made.setName(name);
    b.dbSs = ss;
    try {                                                            // ข้อ 1.13.1.1: no empty rows or columns left over
      const rows = Math.max(1, made.getLastRow()), cols = Math.max(1, made.getLastColumn()), mr = made.getMaxRows(), mc = made.getMaxColumns();
      if (mr > rows) made.deleteRows(rows + 1, mr - rows);
      if (mc > cols) made.deleteColumns(cols + 1, mc - cols);
    } catch (x) { console.error('backup tab not trimmed: ' + String(x)); }
    // ข้อ 1.13.1.2 and 1.13.1.3: only tabs whose name is a date are ever deleted
    const cut = dayShift_(name, -OPT.backupKeepDays), days = [], lastOf = {};
    ss.getSheets().forEach(function (sh) { const n = sh.getName(); if (isoOk_(n)) days.push({ n: n, sh: sh }); });
    days.sort(function (x, y) { return x.n < y.n ? -1 : 1; });
    days.forEach(function (d) { lastOf[d.n.slice(0, 7)] = d.n; });
    days.forEach(function (d) { if (d.n < cut && lastOf[d.n.slice(0, 7)] !== d.n) ss.deleteSheet(d.sh); });
  } catch (x) {
    if (made && ss) { try { if (!isoOk_(made.getName())) ss.deleteSheet(made); } catch (y) { /* the half-made copy stays; it is protected with the rest */ } }
    if (ss) b.dbSs = ss;
    bkFail_(ctx, 'BACKUP LOGIN DATABASE', x);
  }
}
function protect_(sh) {
  const had = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET), p = had.length ? had[0] : sh.protect();
  if (p.isWarningOnly()) p.setWarningOnly(false);                    // ข้อ 1.13.3.2: a limit on who can edit, not a warning
  p.removeEditors(p.getEditors());                                   // the owner of the file (and this script, which runs as the owner) always stays
  if (p.canDomainEdit()) p.setDomainEdit(false);
  p.setDescription('BACKUP: แก้ไขได้เฉพาะเจ้าของไฟล์ (ระบบตั้งให้)');
}
function bkKnown_(ctx) { try { const o = JSON.parse(ctx.props.getProperty(PROP.bkProt) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (x) { return {}; } }
// every tab of one backup file has Protect; a tab that had it from this system and lost it is reported (ข้อ 1.13.3.4)
function guard_(ctx, ss, key, file, lostBefore) {
  const known = bkKnown_(ctx), had = known[key] || [], good = {}, ids = [], lost = (lostBefore || []).slice();
  ss.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { if (!p.isWarningOnly()) good[p.getRange().getSheet().getSheetId()] = true; });
  ss.getSheets().forEach(function (sh) {
    const id = sh.getSheetId();
    if (!good[id]) { protect_(sh); if (had.indexOf(id) >= 0) lost.push(sh.getName()); }
    ids.push(id);
  });
  if (JSON.stringify(ids) !== JSON.stringify(had)) { known[key] = ids; ctx.props.setProperty(PROP.bkProt, JSON.stringify(known)); }
  const b = bk_(ctx), named = lost.slice(0, 10).join(', ') + (lost.length > 10 ? ' และอีก ' + (lost.length - 10) + ' แท็บ' : '');
  if (lost.length && !b.closed) b.ev.push({ e: 'PROTECT_RESTORED', x: 'ระบบพบว่าแท็บ ' + named + ' ของไฟล์ ' + file + ' ไม่มี Protect sheet จึงตั้ง Protect ใหม่แล้ว' });
}
function guardAll_(ctx) {
  const b = bk_(ctx);
  if (b.dbSs) { try { guard_(ctx, b.dbSs, 'd', 'BACKUP LOGIN DATABASE', b.lostDb); b.lostDb = null; } catch (x) { bkFail_(ctx, 'BACKUP LOGIN DATABASE (ตั้ง Protect)', x); } }
  if (b.logSs && !b.logOff) { try { guard_(ctx, b.logSs, 'l', 'BACKUP BACKLOG'); } catch (x) { bkFail_(ctx, 'BACKUP BACKLOG (ตั้ง Protect)', x); } }
}
function bkEvents_(ctx) { try { const a = JSON.parse(ctx.props.getProperty(PROP.bkEvents) || '[]'); return Array.isArray(a) ? a : []; } catch (x) { return []; } }
// ข้อ 1.13.7: one BACKLOG row for each event, and the list that the Admin page shows until it is acknowledged
function events_(ctx) {
  const b = bk_(ctx), ev = b.ev.slice();
  b.closed = true; b.ev = [];
  if (!ev.length) return;
  ev.forEach(function (e) { backlog_(ctx, { action: 'BACKUP', event: e.e, note: e.x }); });
  // the list for the Admin page: the newest 50, and never more than a script property can hold (BACKLOG has them all)
  let list = bkEvents_(ctx).concat(ev.map(function (e) { return { t: ctx.now, e: e.e, x: e.x }; })).slice(-50);
  while (list.length > 1 && utf8_(JSON.stringify(list)).length > 8000) list = list.slice(1);
  try { ctx.props.setProperty(PROP.bkEvents, JSON.stringify(list)); } catch (x) { console.error('backup events not kept for the Admin page: ' + String(x)); }
}
// called once at the end of every request that writes, while the lock is still held
function finishBackup_(ctx) {
  if (!ctx.dbDirty && !ctx.bk) return;
  if (ctx.dbDirty) { ctx.dbDirty = false; backupDb_(ctx); }
  backupLog_(ctx, true);
  guardAll_(ctx);
  events_(ctx);
  backupLog_(ctx);                                                  // the rows about the events themselves
}

// "รับทราบ": the main administrator only. The list is emptied, and BACKLOG says who did it and when. (ข้อ 1.13.7.3)
function opBackupAck_(ctx, req) {
  const a = admin_(ctx, req);
  if (!isSuper_(ctx, a)) throw err_('forbidden', 'รับทราบได้เฉพาะ ' + superName_(ctx));
  const n = bkEvents_(ctx).length;
  if (!n) throw err_('no_change', 'ไม่มีเหตุการณ์ที่รอรับทราบ');
  ctx.props.deleteProperty(PROP.bkEvents);
  backlog_(ctx, { action: 'BACKUP', event: 'BACKUP_ACKNOWLEDGED', admin: a.username, note: 'รับทราบเหตุการณ์ของไฟล์ Backup ' + n + ' เหตุการณ์' });
  return { acknowledged: n };
}

// first row of a tab: written when the tab is empty, otherwise it has to be the expected one
function head_(sh, head, what) {
  const have = sh.getLastRow() ? sh.getRange(1, 1, 1, head.length).getValues()[0].map(str_) : [];
  if (!have.filter(String).length) { sh.getRange(1, 1, 1, head.length).setValues([head]); sh.setFrozenRows(1); return; }
  const off = head.filter(function (h, i) { return have[i] !== h; });
  if (off.length) throw new Error(what + ': หัวคอลัมน์แถวที่ 1 ไม่ตรงกับที่ระบบใช้ ต้องเป็น ' + head.join(' | '));
}
