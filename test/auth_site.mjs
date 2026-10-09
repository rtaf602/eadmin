// The three pages (docs/) together with the real back-end code, end to end in a browser, on the stand-in for Google
// (test/gas_sim.mjs): first administrator link → set password → login → administrator page → link for a user →
// that user sets a password and logs in → the rules between administrators → change of Role and end date.
// Every person and password here is made up.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { startSim, fourFiles, SETUP4, DB, LOG, BDB, BLOG, idGov, idCit, rowOf, PEOPLE, ROOT } from './gas_sim.mjs';

const OUT = path.join(ROOT, 'test/out'); fs.mkdirSync(OUT, { recursive: true });
const sim = await startSim({ files: fourFiles() });
sim.setup(Object.assign({}, SETUP4, { superAdmin: 'chan_t', firstAdmins: ['chan_t', 'weera_t'], siteUrl: sim.siteUrl }));
// the pages ask the back end every 2 seconds here instead of every 10, so the scenarios about two devices do not take minutes
sim.run('OPT.pollSeconds = 2');
const first = sim.firstLinks(), linkOf = (name) => first.find((l) => l.startsWith(name + ' ')).split(': ').pop();
const bad = []; const check = (name, cond, got) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + JSON.stringify(got))); if (!cond) bad.push(name); };
const PW = { chan: 'Main-Admin-Pass-01', weera: 'Second-Admin-02', phum: 'Viewer-Password-03', thana: 'Editor-Password-05', thana2: 'Editor-Password-06' };
const KEY = 'eadmin602:session', stored = (d) => d.page.evaluate((k) => localStorage.getItem(k), KEY);
const cell = (key, col) => rowOf(sim, key).cells[col];
const log = () => sim.sheet(LOG).slice(1);

const browser = await chromium.launch();
const errors = [], seen = [], outside = [];
async function device(name, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts || {})), page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ' PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push(name + ' ' + m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1:')) outside.push(r.url()); });
  page.on('response', async (r) => { if (r.url().includes('/echo')) { try { seen.push(await r.text()); } catch (e) { /* the page moved on */ } } });
  const birth = async (id, d, m, y) => { await page.selectOption('#' + id + '-d', String(d)); await page.selectOption('#' + id + '-m', String(m)); await page.selectOption('#' + id + '-y', String(y)); };
  const setPassword = async (url, pw, steps) => {
    await page.goto(url); await page.waitForSelector('#form:not([hidden]), #dead:not([hidden])');
    if (await page.isVisible('#dead')) return page.innerText('#dead');
    if (steps) await steps();
    await page.fill('#pw1', pw); await page.fill('#pw2', pw); await birth('birth', 1, 1, 2530);
    await page.click('#go'); await page.click('#yes');
    await page.waitForSelector('#done:not([hidden]), #dead:not([hidden])');
    return page.innerText((await page.isVisible('#done')) ? '#done-t' : '#dead');
  };
  const login = async (user, pw, n, wrongYear) => {
    await page.goto(sim.siteUrl); await page.waitForSelector('#login:not([hidden])');
    await page.fill('#user', user); await page.fill('#pw', pw); await page.fill('#card', String(idGov(n))); await birth('birth', 1, 1, wrongYear || 2530);
    await page.click('#go');
    await page.waitForFunction(() => !document.getElementById('inside').hidden || !document.getElementById('msg').hidden || !document.getElementById('waiting').hidden);
    return (await page.isVisible('#inside')) ? 'in' : (await page.isVisible('#waiting')) ? 'waiting' : page.innerText('#msg');
  };
  const admin = async () => { await page.goto(sim.siteUrl + 'admin.html'); await page.waitForSelector('#bench:not([hidden]), #denied:not([hidden])'); };
  const pick = async (q) => { await page.fill('#who', q); await page.keyboard.press('Enter'); await page.waitForTimeout(50); };
  const save = async () => { await page.click('#go'); await page.waitForSelector('#done:not([hidden]), #fail:not([hidden]), #selfc:not([hidden]), #denied:not([hidden])'); };
  // the main administrator's own button for a Username: type, press, confirm
  const rename = async (to) => { await page.fill('#uname', to); await page.click('#uname-go'); await page.click('#uname-yes'); await page.waitForSelector('#uname-done:not([hidden]), #uname-err:not([hidden])'); };
  return { page, ctx, birth, setPassword, login, admin, pick, save, rename };
}

/* ---------- the main administrator sets his first password ---------- */
const A = await device('main-admin');
await A.page.goto(linkOf('chan_t')); await A.page.waitForSelector('#form:not([hidden])');
check('the token is taken off the address bar at once', !(await A.page.url()).includes('token') && (await A.page.evaluate(() => location.hash)) === '', await A.page.url());
check('set-password: Username shown and locked, the kind of link in the heading', (await A.page.inputValue('#user')) === 'chan_t' && (await A.page.getAttribute('#user', 'readonly')) !== null && (await A.page.innerText('#kind')) === 'สร้าง Password สำหรับใช้งานครั้งแรก' && /^(29|30):\d\d$/.test(await A.page.innerText('#left')), await A.page.innerText('#left'));
await A.page.fill('#pw1', 'short');
check('a short password: message, button off', (await A.page.isDisabled('#go')) && /อย่างน้อย 10/.test(await A.page.innerText('#msg')));
await A.page.fill('#pw1', PW.chan); await A.page.fill('#pw2', PW.chan + 'x');
check('Confirm Password differs: message, button off', (await A.page.isDisabled('#go')) && /ไม่ตรง/.test(await A.page.innerText('#msg')));
await A.page.fill('#pw2', PW.chan); await A.birth('birth', 2, 1, 2530);
await A.page.click('#go');
check('the warning before the password is set', /ไม่สามารถเปลี่ยนแปลงได้เอง \(หากต้องการเปลี่ยน Password ให้ติดต่อ Admin\) คุณต้องการใช้ Password นี้หรือไม่/.test(await A.page.innerText('#confirm')) && !(await A.page.isVisible('#actions')));
await A.page.click('#yes'); await A.page.waitForSelector('#msg:not([hidden])');
check('wrong date of birth: told how many tries are left, the form comes back', /ลองได้อีก 4 ครั้ง/.test(await A.page.innerText('#msg')) && (await A.page.isVisible('#actions')), await A.page.innerText('#msg'));
await A.birth('birth', 1, 1, 2530); await A.page.click('#go'); await A.page.click('#yes'); await A.page.waitForSelector('#done:not([hidden])');
check('the right date: "สร้าง Password สำเร็จ"', (await A.page.innerText('#done-t')) === 'สร้าง Password สำเร็จ' && !(await A.page.isVisible('#form')));
check('opening the same link again: refused', /ใช้ไม่ได้แล้ว/.test(await A.setPassword(linkOf('chan_t'), PW.chan)));
await A.page.goto(sim.siteUrl + 'set-password.html'); await A.page.waitForSelector('#dead:not([hidden])');
check('the page without a link says so', /One Time Link/.test(await A.page.innerText('#dead')));

/* ---------- login ---------- */
check('login with a wrong password: the one general message', /ข้อมูลไม่ถูกต้อง หรือบัญชียังไม่พร้อมใช้งาน/.test(await A.login('chan_t', 'Wrong-Password-00', 8)));
check('login with a wrong year of birth: the same message', /ข้อมูลไม่ถูกต้อง หรือบัญชียังไม่พร้อมใช้งาน/.test(await A.login('chan_t', PW.chan, 8, 2531)));
await A.page.goto(sim.siteUrl); await A.page.click('#go');
check('login with empty fields is stopped in the page', /กรอกให้ครบ/.test(await A.page.innerText('#msg')));
check('login as the main administrator', (await A.login('chan_t', PW.chan, 8)) === 'in');
check('after login: name, Role, the Admin column marked, the way to the Admin page', /ชาญ ตัวอย่างหลัก/.test(await A.page.innerText('#in-name')) && /Role: Admin/.test(await A.page.innerText('#in-chips')) && (await A.page.locator('#matrix th.on').innerText()) === 'Admin' && (await A.page.isVisible('#to-admin')));
check('the login page says how long a session lasts (ข้อ 1.10)', /ใช้งานได้ 1 ชั่วโมง/.test(await A.page.goto(sim.siteUrl).then(() => A.page.waitForSelector('#hours:not([hidden])', { state: 'attached' })).then(() => A.page.evaluate(() => document.getElementById('hours').textContent))));
check('the login is kept for the whole browser, not for one tab, and the password fields are emptied', (await A.page.evaluate(() => Object.keys(sessionStorage).join() + '|' + Object.keys(localStorage).filter((k) => /session/.test(k)).join())) === '|eadmin602:session' && (await A.page.inputValue('#pw')) === '');
check('signed in: the page says which account and shows no login form (ข้อ 1.11.1)', (await A.page.isHidden('#login')) && (await A.page.isVisible('#inside')) && /chan_t/.test(await A.page.innerText('#in-chips')) && (await A.page.isVisible('#out')));
await A.page.screenshot({ path: path.join(OUT, 'login-inside.png'), fullPage: true });

/* ---------- the administrator page ---------- */
await A.page.click('#to-admin'); await A.page.waitForSelector('#bench:not([hidden])');
check('admin page opens for the main administrator', (await A.page.innerText('#me-name')) === 'chan_t' && /เปลี่ยน Username ได้คนเดียว/.test(await A.page.innerText('#rights-body')) && (await A.page.isHidden('#bk')));
await A.page.click('#who');
check('the list is grouped as in the sheet, with the position after each name', (await A.page.locator('#who-list li.grp').allInnerTexts()).join('|') === 'นักบินผู้บังคับบัญชา|นักบิน A319 / A320|นักบิน SSJ|เจ้าหน้าที่ช่างอากาศ|เจ้าหน้าที่สื่อสาร' && (await A.page.locator('#who-list li[role=option]').count()) === 12 && (await A.page.locator('#who-list li[role=option]').first().innerText()) === 'น.อ. กฤษณ์ สมมุติเดช (ผบช.)');
await A.pick('zzzz'); await A.page.click('h1');
check('a name that is not in the list cannot be chosen', (await A.page.inputValue('#who')) === '' && (await A.page.isHidden('#after')));
await A.pick('ภูมิ');
check('choosing a name: its group, Role and password state; the form for a first password', /นักบิน A319 \/ A320/.test(await A.page.innerText('#who-info')) && /ยังไม่ตั้ง/.test(await A.page.innerText('#who-info')) && (await A.page.isHidden('#had')) && (await A.page.inputValue('#uname')) === 'phum_s' && (await A.page.isDisabled('#go')) && (await A.page.innerText('#go-why')) === 'เลือก Role ก่อน');
check('the main administrator has a button of his own for the Username, with nothing to save yet', (await A.page.isVisible('#uname-go')) && (await A.page.isDisabled('#uname-go')) && (await A.page.innerText('#uname-go')) === 'เปลี่ยน Username' && /แยกจากการ Generate One Time Link/.test(await A.page.innerText('#uname-hint')));
await A.page.selectOption('#role', 'Viewer'); await A.save();
const url = await A.page.inputValue('#lk-url');
check('Generate One Time Link: the link, its countdown and the copy button', /^http:\/\/127\.0\.0\.1:\d+\/set-password\.html#token=[A-Za-z0-9_-]{40,}$/.test(url) && /^(29|30):\d\d$/.test(await A.page.innerText('#lk-left')) && (await A.page.isEnabled('#lk-copy')) && /ส่งลิงก์ให้ น\.ต\. ภูมิ สาธิตพงศ์ ภายใน 30 นาที/.test(await A.page.innerText('#done')), [url, await A.page.innerText('#lk-left')]);
check('…the Role is in the sheet, and the form still shows the same person', cell('phum_s', 10) === 'Viewer' && (await A.page.inputValue('#who')) === 'น.ต. ภูมิ สาธิตพงศ์ (นบ.)' && /Role: Viewer/.test(await A.page.innerText('#who-info')));
await A.page.screenshot({ path: path.join(OUT, 'admin-link.png'), fullPage: true });
await A.pick('เมธี');
check('a row with missing data: named, and no link', /BIRTH DATE/.test(await A.page.innerText('#miss')) && (await A.page.isDisabled('#go')));
/* ---------- เปลี่ยน Username: its own button (ข้อ 1.2.1) ---------- */
await A.pick('ประเสริฐ'); await A.page.fill('#uname', 'thana_t');
check('a Username that someone else has: warned, nothing can be saved and no link made', /ซ้ำกับ น\.อ\. ธนา ทดลองกิจ/.test(await A.page.innerText('#uname-err')) && (await A.page.isDisabled('#uname-go')) && (await A.page.isDisabled('#go')));
await A.page.fill('#uname', 'prasert_new'); await A.page.selectOption('#role', 'Editor');
check('a Username that was typed but not saved blocks Generate One Time Link (ข้อ 1.2.1.3)', (await A.page.isEnabled('#uname-go')) && (await A.page.isDisabled('#go')) && /กด "เปลี่ยน Username"/.test(await A.page.innerText('#go-why')), await A.page.innerText('#go-why'));
await A.page.click('#uname-go');
check('the question on the administrator\'s screen names the old and the new, with ยืนยัน and ยกเลิก', (await A.page.innerText('#uname-c-t')) === 'ต้องการเปลี่ยน Username จาก prasert_j เป็น prasert_new หรือไม่ หลังเปลี่ยนแล้วให้แจ้งเจ้าของบัญชีว่าต้อง Login ด้วย Username ใหม่' && (await A.page.innerText('#uname-yes')) === 'ยืนยัน' && (await A.page.innerText('#uname-no')) === 'ยกเลิก', await A.page.innerText('#uname-c-t'));
await A.page.click('#uname-no');
check('ยกเลิก: nothing is saved', (await A.page.isHidden('#uname-c')) && cell('prasert_j', 11) === 'prasert_j' && !log().some((r) => r[1] === 'CHANGE_USERNAME'));
const linksBefore = sim.sheet(DB, 'LINK TOKEN').length;
await A.page.click('#uname-go'); await A.page.click('#uname-yes'); await A.page.waitForSelector('#uname-done:not([hidden])');
check('ยืนยัน: saved at once with "เปลี่ยน Username สำเร็จ", and no link is made', /^เปลี่ยน Username สำเร็จ/.test(await A.page.innerText('#uname-done')) && cell('prasert_new', 11) === 'prasert_new' && sim.sheet(DB, 'LINK TOKEN').length === linksBefore && (await A.page.isHidden('#linkbox') || !/ประเสริฐ/.test(await A.page.innerText('#lk-for'))) && (await A.page.inputValue('#who')) === 'พ.อ.อ. ประเสริฐ จำลองวงศ์ (จนท.สอ.)');
check('…BACKLOG has the old and the new Username and who did it', log().some((r) => r[1] === 'CHANGE_USERNAME' && r[2] === 'USERNAME_CHANGED' && r[6] === 'prasert_j' && r[7] === 'prasert_new' && r[10] === 'chan_t'));
await A.page.selectOption('#role', 'Editor'); await A.save();
check('…and now a link can be made, for the saved Username', cell('prasert_new', 10) === 'Editor' && /ประเสริฐ/.test(await A.page.innerText('#lk-for')) && log().some((r) => r[2] === 'LINK_GENERATED' && r[5] === 'prasert_new'));
await A.pick('ชาญ');
check('the main administrator on his own account: Role locked, no end date, reset allowed', (await A.page.isDisabled('#role')) && (await A.page.isDisabled('#m-role')) && (await A.page.isDisabled('#end-d')) && (await A.page.isEnabled('#go')) && /เปลี่ยน Role ของตัวเองไม่ได้/.test(await A.page.innerText('#role-hint')));

/* ---------- the new user ---------- */
const B = await device('user');
check('the user opens the link and sets a password', (await B.setPassword(url, PW.phum)) === 'สร้าง Password สำเร็จ');
check('the user logs in: Viewer, no way to the Admin page', (await B.login('phum_s', PW.phum, 5)) === 'in' && /Role: Viewer/.test(await B.page.innerText('#in-chips')) && (await B.page.locator('#matrix th.on').innerText()) === 'Viewer' && (await B.page.isHidden('#to-admin')));
await B.admin();
check('a Viewer who types the address of the Admin page is refused by the back end', (await B.page.isVisible('#denied')) && /ไม่มี Role Admin/.test(await B.page.innerText('#denied-t')) && (await B.page.isHidden('#bench')));
const C0 = await device('nobody'); await C0.page.goto(sim.siteUrl + 'admin.html'); await C0.page.waitForSelector('#login');
check('the Admin page without a login goes to the login page', (await C0.page.url()) === sim.siteUrl + 'index.html' || (await C0.page.url()) === sim.siteUrl);

/* ---------- another administrator ---------- */
const C = await device('second-admin');
check('second administrator: first password, login', (await C.setPassword(linkOf('weera_t'), PW.weera)) === 'สร้าง Password สำเร็จ' && (await C.login('weera_t', PW.weera, 6)) === 'in');
await C.admin();
check('other admin: the rules shown for his account', /เปลี่ยน Username ของใครไม่ได้/.test(await C.page.innerText('#rights-body')) && /chan_t/.test(await C.page.innerText('#rights-body')));
await C.pick('ชาญ');
check('other admin on the main administrator: locked, with the reason', /แก้ไขได้เฉพาะเจ้าของบัญชี/.test(await C.page.innerText('#lock')) && (await C.page.isDisabled('#go')) && (await C.page.isHidden('#had')) && (await C.page.locator('#rights-body .chip.ok').count()) === 0);
await C.pick('อนันต์');
check('other admin on another administrator: locked', /Admin ด้วยกัน/.test(await C.page.innerText('#lock')) && (await C.page.isDisabled('#go')));
await C.pick('กฤษณ์');
check('other admin on an ordinary account: Username locked and no button for it, Admin not selectable', (await C.page.getAttribute('#uname', 'readonly')) !== null && (await C.page.isHidden('#uname-go')) && /เปลี่ยน Username ได้เฉพาะ chan_t/.test(await C.page.innerText('#uname-hint')) && (await C.page.evaluate(() => document.querySelector('#role option[value=Admin]').disabled)) && /ตั้งได้เฉพาะ chan_t/.test(await C.page.evaluate(() => document.querySelector('#role option[value=Admin]').textContent)));
await C.page.selectOption('#role', 'Editor'); await C.save();
check('…and can give Editor', cell('krit_s', 10) === 'Editor' && (await C.page.isVisible('#linkbox')));
await C.pick('วิทยา');
check('other admin on an account without a Username: has to wait for the main administrator', (await C.page.isDisabled('#go')) && /ยังไม่มี Username/.test(await C.page.innerText('#go-why')));
// someone who alters the page still meets the back end
const forced = await C.page.evaluate(async () => { const s = JSON.parse(localStorage.getItem('eadmin602:session')); const call = (o) => fetch(window.EADMIN_CONFIG.backendUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ v: 1, session: s.token }, o)) }).then((r) => r.json()); const l = await call({ op: 'admin.list' }); const k = l.people.find((p) => p.username === 'krit_s'), m = l.people.find((p) => p.isSuper); return [(await call({ op: 'admin.link', ref: k.ref, role: 'Admin', username: 'krit_s' })).error.code, (await call({ op: 'admin.link', ref: m.ref, role: 'Viewer', username: m.username })).error.code, (await call({ op: 'admin.role', ref: m.ref, role: 'Viewer' })).error.code, (await call({ op: 'admin.username', ref: k.ref, username: 'krit_new' })).error.code, (await call({ op: 'admin.backupAck' })).error.code]; });
check('…the same requests sent by hand from his browser are refused by the back end (ข้อ 1.0.3)', forced.join() === 'forbidden,forbidden,forbidden,forbidden,forbidden' && cell('krit_s', 10) === 'Editor' && cell('krit_s', 11) === 'krit_s' && cell('chan_t', 10) === 'Admin', forced);
await C.pick('วีระ');
check('other admin on his own account: asked what to do', (await C.page.isVisible('#had')) && (await C.page.isEnabled('#m-role')));
await C.page.check('#m-role'); await C.page.selectOption('#role', 'Viewer'); await C.save();
check('lowering his own Role is asked about first', (await C.page.isVisible('#selfc')) && /chan_t/.test(await C.page.innerText('#selfc')) && cell('weera_t', 10) === 'Admin');
await C.page.click('#selfc-no');
check('…and "ยกเลิก" puts the Role back', (await C.page.inputValue('#role')) === 'Admin' && (await C.page.isHidden('#selfc')));
await C.page.selectOption('#role', 'Viewer'); await C.page.click('#go'); await C.page.click('#selfc-yes'); await C.page.waitForSelector('#denied:not([hidden])');
check('…after confirming, the page closes for him', cell('weera_t', 10) === 'Viewer' && /ไม่มี Role Admin/.test(await C.page.innerText('#denied-t')));

/* ---------- change of Role and of end date, by the main administrator ---------- */
await A.admin(); await A.pick('ภูมิ');
check('an account with a password: the two choices, without the old wording', (await A.page.isVisible('#had')) && !/เลือกสิ่งที่ต้องการทำ/.test(await A.page.innerText('#had')) && (await A.page.innerText('#go')) === 'Generate One Time Link');
await A.page.check('#m-role');
check('CHANGE ROLE: the button says so, and there is nothing to save yet', (await A.page.innerText('#go')) === 'บันทึก Role' && (await A.page.isDisabled('#go')) && (await A.page.innerText('#go-why')) === 'ยังไม่มีการเปลี่ยนแปลง');
await A.page.selectOption('#role', 'Editor'); await A.save();
check('CHANGE ROLE saved at once and logged', /มี Role Editor/.test(await A.page.innerText('#done')) && cell('phum_s', 10) === 'Editor' && log().some((r) => r[1] === 'CHANGE_ROLE' && r[5] === 'phum_s' && r[8] === 'Editor' && r[9] === 'Viewer'));
await B.page.goto(sim.siteUrl); await B.page.waitForFunction(() => /Role: Editor/.test(document.getElementById('in-chips').textContent));
check('the user sees the new Role on the next visit, without logging in again', (await B.page.locator('#matrix th.on').innerText()) === 'Editor');
await A.pick('ภูมิ'); await A.page.check('#m-role'); await A.birth('end', 1, 1, await A.page.evaluate(() => App.beYear()));
await A.save();
check('an end date in the past is saved and shown', /เลยวันสิ้นสุด 1 ม\.ค\./.test(await A.page.innerText('#who-info')), await A.page.innerText('#who-info'));
await B.page.goto(sim.siteUrl); await B.page.waitForSelector('#flash:not([hidden])');
check('the user is put out, with the agreed message', /สิ้นสุดระยะเวลาในการเข้าถึงข้อมูลของท่าน หากต้องการขยายระยะเวลา ให้ติดต่อ Admin/.test(await B.page.innerText('#flash')) && (await B.page.isVisible('#login')) && (await stored(B)) === null);
check('…and cannot log in again', /สิ้นสุดระยะเวลา/.test(await B.login('phum_s', PW.phum, 5)));
await A.page.click('#out'); await A.page.waitForSelector('#login:not([hidden])');
check('"ออกจากระบบ" forgets the login', (await stored(A)) === null);

/* ---------- one browser, one account (ข้อ 1.11) ---------- */
const T = await device('two-tabs'), tab2 = await T.ctx.newPage();
tab2.on('pageerror', (e) => errors.push('tab2 PAGEERROR ' + e.message));
await tab2.goto(sim.siteUrl); await tab2.waitForSelector('#login:not([hidden])');
check('the main administrator signs in in one tab', (await T.login('chan_t', PW.chan, 8)) === 'in');
await tab2.waitForSelector('#inside:not([hidden])');
check('1.11 the other tab of the same browser is signed in too: the same account, no form', (await tab2.isHidden('#login')) && /chan_t/.test(await tab2.innerText('#in-chips')));
await tab2.goto(sim.siteUrl + 'admin.html'); await tab2.waitForSelector('#bench:not([hidden])');
check('…and opens the Admin page without logging in again', (await tab2.innerText('#me-name')) === 'chan_t');
// an ordinary account with a password, for what follows
await tab2.fill('#who', 'ธนา'); await tab2.keyboard.press('Enter'); await tab2.selectOption('#role', 'Editor'); await tab2.click('#go'); await tab2.waitForSelector('#done:not([hidden])');
const X = await device('thana-sets-password');
check('(an Editor is given a password)', (await X.setPassword(await tab2.inputValue('#lk-url'), PW.thana)) === 'สร้าง Password สำเร็จ');
// two logins that cross in one browser: the form is hidden once an account is in, so the second is sent as a tab that had the form open would send it
await T.page.evaluate(([u, pw, id]) => { const set = (i, v) => { document.getElementById(i).value = v; }; set('user', u); set('pw', pw); set('card', id); set('birth-d', '1'); set('birth-m', '1'); set('birth-y', '2530'); document.getElementById('login').requestSubmit(); }, ['thana_t', PW.thana, String(idGov(3))]);
await T.page.waitForFunction(() => /thana_t/.test(document.getElementById('in-chips').textContent));
check('1.11.2 two logins cross in one browser: the later account stays, the earlier one is signed out, and the page says so', (await T.page.innerText('#overlap')) === 'ตรวจพบการเข้าสู่ระบบซ้อนกันในเบราว์เซอร์นี้ บัญชี chan_t ถูกออกจากระบบแล้ว ทุกแท็บใช้บัญชี thana_t' && JSON.parse(await stored(T)).user.username === 'thana_t', await T.page.innerText('#overlap'));
await tab2.waitForSelector('#denied:not([hidden])');
check('…the other tab follows: it now runs as the later account, which is no administrator', /ไม่มี Role Admin/.test(await tab2.innerText('#denied-t')) && (await tab2.isHidden('#bench')));
await tab2.goto(sim.siteUrl); await tab2.waitForSelector('#inside:not([hidden])');
await T.page.click('#out'); await T.page.waitForSelector('#login:not([hidden])');
await tab2.waitForSelector('#login:not([hidden])');
check('1.11.3 signing out in one tab signs out every tab of that browser', (await tab2.isHidden('#inside')) && (await stored(T)) === null);
await tab2.goto(sim.siteUrl + 'admin.html'); await tab2.waitForSelector('#login');
check('…and the Admin page in the other tab is closed too', (await tab2.url()).replace(/index\.html$/, '') === sim.siteUrl);
await tab2.close();

/* ---------- one account, one device (ข้อ 1.12) ---------- */
const DENIED = 'บัญชีนี้กำลังถูกใช้งานที่เครื่องอื่น และเครื่องนั้นไม่อนุญาตให้เข้าใช้งานซ้อน', TAKEN = 'บัญชีของคุณถูกออกจากระบบ เพราะมีการ Login จากเครื่องอื่น หากไม่ใช่คุณ ให้ติดต่อ Admin เพื่อ Reset Password';
const D1 = await device('device-1'), D2 = await device('device-2');
check('device 1 signs in: nobody else is using the account, so there is no wait (the sign-out above freed it)', (await D1.login('thana_t', PW.thana, 3)) === 'in');
check('device 2 signs in with the same account: it is not let in, it waits (ข้อ 1.12.2)', (await D2.login('thana_t', PW.thana, 3)) === 'waiting' && (await D2.page.innerText('#wt-h')) === 'กำลังรอเครื่องเดิมออกจากระบบ' && (await D2.page.innerText('#wt-user')) === 'thana_t' && (await D2.page.isHidden('#login')) && (await D2.page.isHidden('#inside')) && (await stored(D2)) === null);
await D1.page.waitForSelector('#app-take:not([hidden])');
const takeText = (await D1.page.innerText('#app-take-t')).replace(/\s+/g, ' ');
check('1.12.1 device 1 is told, with a countdown from 10 seconds and the button', /^มีผู้ Login เข้าใช้งานบัญชีนี้จากเครื่องอื่น บัญชีของคุณจะถูกออกจากระบบอัตโนมัติใน (10|9|8) วินาที หากไม่ใช่คุณ ให้กดไม่อนุญาต แล้วติดต่อ Admin$/.test(takeText) && (await D1.page.innerText('#app-deny')) === 'ไม่อนุญาต ฉันกำลังใช้งานอยู่' && (await D1.page.isVisible('#inside')), takeText);
await D1.page.screenshot({ path: path.join(OUT, 'takeover-notice.png'), fullPage: true });
await D2.page.screenshot({ path: path.join(OUT, 'takeover-waiting.png'), fullPage: true });
await D1.page.click('#app-deny'); await D2.page.waitForSelector('#msg:not([hidden])');
check('1.12.5 refused: device 2 gets the agreed message and its form back', (await D2.page.innerText('#msg')) === DENIED && (await D2.page.isVisible('#login')) && (await D2.page.isHidden('#waiting')) && (await stored(D2)) === null, await D2.page.innerText('#msg'));
await D1.page.waitForSelector('#app-note:not([hidden])');
check('…device 1 carries on, the notice is gone, and it is told what to do if that was not its owner', (await D1.page.isHidden('#app-take')) && /คุณไม่อนุญาตการ Login จากเครื่องอื่น และใช้งานต่อได้ หากไม่ใช่คุณที่ Login ให้ติดต่อ Admin เพื่อ Reset Password/.test(await D1.page.innerText('#app-note')) && (await D1.page.isVisible('#inside')) && (await stored(D1)) !== null);
check('device 2 tries again and waits', (await D2.login('thana_t', PW.thana, 3)) === 'waiting');
await D2.page.click('#wt-cancel');
check('…and calls it off: its form is back', (await D2.page.isVisible('#login')) && (await D2.page.innerText('#msg')) === 'ยกเลิกการรอแล้ว');
await D1.page.waitForTimeout(5000);
check('…device 1 is left alone: no notice stays on its screen, and it is still in', (await D1.page.isHidden('#app-take')) && (await D1.page.isVisible('#inside')) && (await stored(D1)) !== null);
check('device 2 tries a third time', (await D2.login('thana_t', PW.thana, 3)) === 'waiting');
await D1.page.waitForSelector('#app-take:not([hidden])'); const t0 = Date.now();
await D2.page.waitForSelector('#inside:not([hidden])', { timeout: 40000 }); const took = Date.now() - t0;
await D1.page.waitForSelector('#login:not([hidden])');
check('not refused: about 10 seconds after the notice device 1 is signed out with the reason, and only then is device 2 in', took >= 8000 && took <= 20000 && (await D1.page.innerText('#flash')) === TAKEN && (await stored(D1)) === null && /thana_t/.test(await D2.page.innerText('#in-chips')) && (await D2.page.isHidden('#app-take')), [took, await D1.page.innerText('#flash')]);
await D2.page.goto('about:blank');                                   // the device in use closes the page
check('device 1 signs in while the other has the page closed: it waits at first', (await D1.login('thana_t', PW.thana, 3)) === 'waiting');
sim.advance(31000);
await D1.page.waitForSelector('#inside:not([hidden])');
check('1.12.3 …and is let in once 30 seconds have passed without a word from the other', /thana_t/.test(await D1.page.innerText('#in-chips')));
await D2.page.goto(sim.siteUrl); await D2.page.waitForSelector('#flash:not([hidden])');
check('…the device that had the page closed finds itself signed out when it comes back, with the reason', (await D2.page.innerText('#flash')) === TAKEN && (await D2.page.isVisible('#login')) && (await stored(D2)) === null);

/* ---------- the password is changed (ข้อ 1.9) ---------- */
const M = await device('main-admin-again');
check('the main administrator signs in again and opens the Admin page', (await M.login('chan_t', PW.chan, 8)) === 'in');
await M.admin(); await M.pick('ธนา'); await M.save();
const reset = await M.page.inputValue('#lk-url');
await D1.page.waitForTimeout(4500);
check('1.9.1 a reset link was made: the device that is signed in stays in', /Reset Password/.test(await M.page.innerText('#lk-for')) && (await D1.page.isVisible('#inside')) && (await stored(D1)) !== null);
check('the owner sets a new password through the link', (await X.setPassword(reset, PW.thana2)) === 'Reset Password สำเร็จ');
await D1.page.waitForSelector('#login:not([hidden])');
check('1.9 the device signed in with the old password is out within seconds, and is told why', (await D1.page.innerText('#flash')) === 'Password ของบัญชีนี้ถูกเปลี่ยนแล้ว ให้เข้าสู่ระบบใหม่ด้วย Password ใหม่' && (await stored(D1)) === null, await D1.page.innerText('#flash'));
check('…the old password no longer works, the new one does', /ข้อมูลไม่ถูกต้อง/.test(await D1.login('thana_t', PW.thana, 3)) && (await D1.login('thana_t', PW.thana2, 3)) === 'in');

/* ---------- what happened to the backup files, on the Admin page (ข้อ 1.13.7) ---------- */
const bkTabs = sim.tabs(BDB), todayTab = () => bkTabs.find((t) => t.name === sim.today());
check('every change made through the pages was copied: today\'s tab in the backup file, protected', !!todayTab() && !!todayTab().prot && sim.tabs(BLOG).every((t) => !!t.prot) && sim.sheet(BLOG).length === sim.sheet(LOG).length);
todayTab().prot = null;                                              // someone signed in as the owner of the backup files takes Protect off
await M.pick('วีระ'); await M.page.check('#m-role'); await M.page.selectOption('#role', 'Admin'); await M.save();
await M.page.waitForSelector('#bk:not([hidden])');
check('the next change puts Protect back, and the Admin page says what happened and when', !!todayTab().prot && /ไม่มี Protect sheet จึงตั้ง Protect ใหม่แล้ว/.test(await M.page.innerText('#bk-list')) && (await M.page.innerText('#bk-list')).includes(sim.today()) && /ระบบยังทำงานตามปกติ/.test(await M.page.innerText('#bk')) && (await M.page.isVisible('#bk-ok')) && /มี Role Admin/.test(await M.page.innerText('#done')), await M.page.innerText('#bk'));
await M.page.screenshot({ path: path.join(OUT, 'admin-backup-event.png'), fullPage: true });
await C.admin();
check('another administrator sees it too, but cannot acknowledge (ข้อ 1.13.7.2)', (await C.page.isVisible('#bk')) && (await C.page.isHidden('#bk-ok')) && (await C.page.innerText('#bk-why')) === 'รับทราบได้เฉพาะ chan_t');
await M.page.click('#bk-ok'); await M.page.waitForSelector('#bk', { state: 'hidden' });
check('the main administrator acknowledges: the notice is gone, and BACKLOG says who (ข้อ 1.13.7.3)', log().some((r) => r[1] === 'BACKUP' && r[2] === 'BACKUP_ACKNOWLEDGED' && r[10] === 'chan_t') && log().some((r) => r[2] === 'PROTECT_RESTORED') && sim.sheet(BLOG).length === sim.sheet(LOG).length);
await C.admin();
check('…and it is gone for the other administrator as well', await C.page.isHidden('#bk'));

/* ---------- one hour (ข้อ 1.10) ---------- */
sim.advance(56 * 60000);
await M.page.waitForSelector('#app-warn:not([hidden])');
check('1.10.1 five minutes before the hour is over the page warns to save the work', /^ใกล้หมดเวลาใช้งาน ให้บันทึกงานก่อน เมื่อหมดเวลาต้องเข้าสู่ระบบใหม่ \(เหลือ 0[1-4]:\d\d\)$/.test(await M.page.innerText('#app-warn')) && (await M.page.isVisible('#bench')), await M.page.innerText('#app-warn'));
await M.page.screenshot({ path: path.join(OUT, 'admin-warning.png') });
sim.advance(4.5 * 60000);
await M.page.waitForSelector('#login:not([hidden])');
check('1.10.2 when the hour is over: back to the login page with the agreed message', (await M.page.innerText('#flash')) === 'หมดเวลาใช้งาน ให้เข้าสู่ระบบใหม่' && (await stored(M)) === null && (await M.page.url()).replace(/index\.html$/, '') === sim.siteUrl, await M.page.innerText('#flash'));
check('…and logging in again gives a new hour', (await M.login('chan_t', PW.chan, 8)) === 'in' && /ใช้งานได้ถึง/.test(await M.page.innerText('#in-chips')));
await M.page.click('#out'); await M.page.waitForSelector('#login:not([hidden])');

/* ---------- a computer whose clock is wrong ---------- */
sim.advance(-2 * 3600000);                                           // the back end is two hours behind this computer, that is: its clock is two hours fast
const G = await device('fast-clock');
check('a computer whose clock is two hours fast can sign in', (await G.login('chan_t', PW.chan, 8)) === 'in');
await G.admin();
check('…and stays signed in on the next page: whether the hour is over is judged by the back end\'s clock', (await G.page.isVisible('#bench')) && (await stored(G)) !== null);
await G.page.reload(); await G.page.waitForSelector('#bench:not([hidden]), #login:not([hidden])');
check('…and after the page is loaded again', (await G.page.isVisible('#bench')) && (await G.page.isHidden('#app-warn')));
await G.page.click('#out'); await G.page.waitForSelector('#login:not([hidden])');
sim.advance(2 * 3600000);

/* ---------- what travelled ---------- */
const wire = seen.join('\n');
check('nothing the pages received holds an ID card number, a date of birth, a salt or a hash', seen.length > 20 && !PEOPLE.some((p) => p.n && (wire.includes(String(idGov(p.n))) || wire.includes(String(idCit(p.n))))) && !/1987-01-01|Jan-1987|\/2530|"birth"|pbkdf2|"salt"|"hash"/.test(wire), seen.length);
check('every request to the back end was a plain-text POST (no preflight)', sim.hits.length > 20 && sim.hits.every((h) => /^text\/plain/.test(h.type)), sim.hits.find((h) => !/^text\/plain/.test(h.type)));
check('the pages loaded nothing from any other site', outside.length === 0, outside);

/* ---------- when things are missing ---------- */
sim.noBackend = true;
const D = await device('unset'); await D.page.goto(sim.siteUrl);
check('without a back-end address the login page says so', /assets\/config\.js/.test(await D.page.innerText('#flash')) && (await D.page.isDisabled('#go')));
sim.noBackend = false; sim.down = true;
const E = await device('offline'); await E.page.goto(sim.siteUrl); await E.page.fill('#user', 'chan_t'); await E.page.fill('#pw', PW.chan); await E.page.fill('#card', '1'); await E.birth('birth', 1, 1, 2530); await E.page.click('#go'); await E.page.waitForSelector('#msg:not([hidden])');
check('when the back end cannot be reached the page says so', /ติดต่อระบบไม่ได้/.test(await E.page.innerText('#msg')));
sim.down = false;

/* ---------- phone width ---------- */
const F = await device('phone', { viewport: { width: 400, height: 800 } });
const fits = () => F.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
await F.login('chan_t', PW.chan, 8); const fit1 = await fits();
await F.admin(); await F.pick('ธนา'); const fit2 = await fits(); await F.page.screenshot({ path: path.join(OUT, 'admin-phone.png'), fullPage: true });
await F.page.goto(sim.siteUrl + 'set-password.html'); await F.page.waitForSelector('#dead:not([hidden])');
check('at phone width no page scrolls sideways', fit1 && fit2 && (await fits()), [fit1, fit2]);

await browser.close(); sim.close();
console.log(bad.length ? bad.length + ' check(s) FAILED' : 'all checks passed');
console.log('errors:', JSON.stringify(bad.concat(errors)));
process.exit(bad.length || errors.length ? 1 : 0);
