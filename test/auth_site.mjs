// The three pages (docs/) together with the real back-end code, end to end in a browser, on the stand-in for Google
// (test/gas_sim.mjs): first administrator link → set password → login → administrator page → link for a user →
// that user sets a password and logs in → the rules between administrators → change of Role and end date.
// Every person and password here is made up.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { startSim, loginDb, backlogFile, DB, LOG, idGov, idCit, rowOf, PEOPLE, ROOT } from './gas_sim.mjs';

const OUT = path.join(ROOT, 'test/out'); fs.mkdirSync(OUT, { recursive: true });
const sim = await startSim({ files: { [DB]: loginDb(), [LOG]: backlogFile() } });
sim.setup({ loginSheet: DB, backlogSheet: LOG, superAdmin: 'chan_t', firstAdmins: ['chan_t', 'weera_t'], siteUrl: sim.siteUrl });
const first = sim.firstLinks(), linkOf = (name) => first.find((l) => l.startsWith(name + ' ')).split(': ').pop();
const bad = []; const check = (name, cond, got) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + JSON.stringify(got))); if (!cond) bad.push(name); };
const PW = { chan: 'Main-Admin-Pass-01', weera: 'Second-Admin-02', phum: 'Viewer-Password-03' };
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
    await page.waitForFunction(() => !document.getElementById('inside').hidden || !document.getElementById('msg').hidden);
    return (await page.isVisible('#inside')) ? 'in' : page.innerText('#msg');
  };
  const admin = async () => { await page.goto(sim.siteUrl + 'admin.html'); await page.waitForSelector('#bench:not([hidden]), #denied:not([hidden])'); };
  const pick = async (q) => { await page.fill('#who', q); await page.keyboard.press('Enter'); await page.waitForTimeout(50); };
  const save = async () => { await page.click('#go'); await page.waitForSelector('#done:not([hidden]), #fail:not([hidden]), #selfc:not([hidden]), #denied:not([hidden])'); };
  return { page, ctx, birth, setPassword, login, admin, pick, save };
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
check('the login page says how long a session lasts', /ใช้งานได้ 8 ชั่วโมง/.test(await A.page.goto(sim.siteUrl).then(() => A.page.waitForSelector('#hours:not([hidden])', { state: 'attached' })).then(() => A.page.evaluate(() => document.getElementById('hours').textContent))));
check('the session is kept for the tab only, and the password fields are emptied', (await A.page.evaluate(() => Object.keys(sessionStorage).join() + '|' + Object.keys(localStorage).join())) === 'eadmin602:session|' && (await A.page.inputValue('#pw')) === '');
await A.page.screenshot({ path: path.join(OUT, 'login-inside.png'), fullPage: true });

/* ---------- the administrator page ---------- */
await A.page.click('#to-admin'); await A.page.waitForSelector('#bench:not([hidden])');
check('admin page opens for the main administrator', (await A.page.innerText('#me-name')) === 'chan_t' && /แก้ Username ได้คนเดียว/.test(await A.page.innerText('#rights-body')));
await A.page.click('#who');
check('the list is grouped as in the sheet, with the position after each name', (await A.page.locator('#who-list li.grp').allInnerTexts()).join('|') === 'นักบินผู้บังคับบัญชา|นักบิน A319 / A320|นักบิน SSJ|เจ้าหน้าที่ช่างอากาศ|เจ้าหน้าที่สื่อสาร' && (await A.page.locator('#who-list li[role=option]').count()) === 12 && (await A.page.locator('#who-list li[role=option]').first().innerText()) === 'น.อ. กฤษณ์ สมมุติเดช (ผบช.)');
await A.pick('zzzz'); await A.page.click('h1');
check('a name that is not in the list cannot be chosen', (await A.page.inputValue('#who')) === '' && (await A.page.isHidden('#after')));
await A.pick('ภูมิ');
check('choosing a name: its group, Role and password state; the form for a first password', /นักบิน A319 \/ A320/.test(await A.page.innerText('#who-info')) && /ยังไม่ตั้ง/.test(await A.page.innerText('#who-info')) && (await A.page.isHidden('#had')) && (await A.page.inputValue('#uname')) === 'phum_s' && (await A.page.isDisabled('#go')) && (await A.page.innerText('#go-why')) === 'เลือก Role ก่อน');
await A.page.selectOption('#role', 'Viewer'); await A.save();
const url = await A.page.inputValue('#lk-url');
check('Generate One Time Link: the link, its countdown and the copy button', /^http:\/\/127\.0\.0\.1:\d+\/set-password\.html#token=[A-Za-z0-9_-]{40,}$/.test(url) && /^(29|30):\d\d$/.test(await A.page.innerText('#lk-left')) && (await A.page.isEnabled('#lk-copy')) && /ส่งลิงก์ให้ น\.ต\. ภูมิ สาธิตพงศ์ ภายใน 30 นาที/.test(await A.page.innerText('#done')), [url, await A.page.innerText('#lk-left')]);
check('…the Role is in the sheet, and the form still shows the same person', cell('phum_s', 10) === 'Viewer' && (await A.page.inputValue('#who')) === 'น.ต. ภูมิ สาธิตพงศ์ (นบ.)' && /Role: Viewer/.test(await A.page.innerText('#who-info')));
await A.page.screenshot({ path: path.join(OUT, 'admin-link.png'), fullPage: true });
await A.pick('เมธี');
check('a row with missing data: named, and no link', /BIRTH DATE/.test(await A.page.innerText('#miss')) && (await A.page.isDisabled('#go')));
await A.pick('ประเสริฐ'); await A.page.fill('#uname', 'thana_t');
check('a Username that someone else has: warned, and no link', /ซ้ำกับ น\.อ\. ธนา ทดลองกิจ/.test(await A.page.innerText('#uname-err')) && (await A.page.isDisabled('#go')));
await A.page.fill('#uname', 'prasert_new'); await A.page.selectOption('#role', 'Editor'); await A.save();
check('the main administrator changes a Username: sheet and BACKLOG', cell('prasert_new', 11) === 'prasert_new' && log().some((r) => r[6] === 'prasert_j' && r[7] === 'prasert_new' && r[10] === 'chan_t'));
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
check('other admin: the rules shown for his account', /แก้ Username ของใครไม่ได้/.test(await C.page.innerText('#rights-body')) && /chan_t/.test(await C.page.innerText('#rights-body')));
await C.pick('ชาญ');
check('other admin on the main administrator: locked, with the reason', /แก้ไขได้เฉพาะเจ้าของบัญชี/.test(await C.page.innerText('#lock')) && (await C.page.isDisabled('#go')) && (await C.page.isHidden('#had')) && (await C.page.locator('#rights-body .chip.ok').count()) === 0);
await C.pick('อนันต์');
check('other admin on another administrator: locked', /Admin ด้วยกัน/.test(await C.page.innerText('#lock')) && (await C.page.isDisabled('#go')));
await C.pick('กฤษณ์');
check('other admin on an ordinary account: Username locked, Admin not selectable', (await C.page.getAttribute('#uname', 'readonly')) !== null && /แก้ Username ได้เฉพาะ chan_t/.test(await C.page.innerText('#uname-hint')) && (await C.page.evaluate(() => document.querySelector('#role option[value=Admin]').disabled)) && /ตั้งได้เฉพาะ chan_t/.test(await C.page.evaluate(() => document.querySelector('#role option[value=Admin]').textContent)));
await C.page.selectOption('#role', 'Editor'); await C.save();
check('…and can give Editor', cell('krit_s', 10) === 'Editor' && (await C.page.isVisible('#linkbox')));
await C.pick('วิทยา');
check('other admin on an account without a Username: has to wait for the main administrator', (await C.page.isDisabled('#go')) && /ยังไม่มี Username/.test(await C.page.innerText('#go-why')));
// someone who alters the page still meets the back end
const forced = await C.page.evaluate(async () => { const s = JSON.parse(sessionStorage.getItem('eadmin602:session')); const call = (o) => fetch(window.EADMIN_CONFIG.backendUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ v: 1, session: s.token }, o)) }).then((r) => r.json()); const l = await call({ op: 'admin.list' }); const k = l.people.find((p) => p.username === 'krit_s'), m = l.people.find((p) => p.isSuper); return [(await call({ op: 'admin.link', ref: k.ref, role: 'Admin', username: 'krit_s' })).error.code, (await call({ op: 'admin.link', ref: m.ref, role: 'Viewer', username: m.username })).error.code, (await call({ op: 'admin.role', ref: m.ref, role: 'Viewer' })).error.code]; });
check('…the same requests sent by hand from his browser are refused by the back end', forced.join() === 'forbidden,forbidden,forbidden' && cell('krit_s', 10) === 'Editor' && cell('chan_t', 10) === 'Admin', forced);
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
check('CHANGE ROLE: Username locked, nothing to save yet', (await A.page.getAttribute('#uname', 'readonly')) !== null && (await A.page.innerText('#go')) === 'บันทึก Role' && (await A.page.isDisabled('#go')) && (await A.page.innerText('#go-why')) === 'ยังไม่มีการเปลี่ยนแปลง');
await A.page.selectOption('#role', 'Editor'); await A.save();
check('CHANGE ROLE saved at once and logged', /มี Role Editor/.test(await A.page.innerText('#done')) && cell('phum_s', 10) === 'Editor' && log().some((r) => r[1] === 'CHANGE_ROLE' && r[5] === 'phum_s' && r[8] === 'Editor' && r[9] === 'Viewer'));
await B.page.goto(sim.siteUrl); await B.page.waitForFunction(() => /Role: Editor/.test(document.getElementById('in-chips').textContent));
check('the user sees the new Role on the next visit, without logging in again', (await B.page.locator('#matrix th.on').innerText()) === 'Editor');
await A.pick('ภูมิ'); await A.page.check('#m-role'); await A.birth('end', 1, 1, await A.page.evaluate(() => App.beYear()));
await A.save();
check('an end date in the past is saved and shown', /เลยวันสิ้นสุด 1 ม\.ค\./.test(await A.page.innerText('#who-info')), await A.page.innerText('#who-info'));
await B.page.goto(sim.siteUrl); await B.page.waitForSelector('#flash:not([hidden])');
check('the user is put out, with the agreed message', /สิ้นสุดระยะเวลาในการเข้าถึงข้อมูลของท่าน หากต้องการขยายระยะเวลา ให้ติดต่อ Admin/.test(await B.page.innerText('#flash')) && (await B.page.isVisible('#login')) && (await B.page.evaluate(() => sessionStorage.getItem('eadmin602:session'))) === null);
check('…and cannot log in again', /สิ้นสุดระยะเวลา/.test(await B.login('phum_s', PW.phum, 5)));
await A.page.click('#out'); await A.page.waitForSelector('#login:not([hidden])');
check('"ออกจากระบบ" forgets the session', (await A.page.evaluate(() => sessionStorage.getItem('eadmin602:session'))) === null);

/* ---------- what travelled ---------- */
const wire = seen.join('\n');
check('nothing the pages received holds an ID card number, a date of birth, a salt or a hash', seen.length > 20 && !PEOPLE.some((p) => p.n && (wire.includes(String(idGov(p.n))) || wire.includes(String(idCit(p.n))))) && !wire.includes('1987') && !/pbkdf2|"salt"|"hash"/.test(wire), seen.length);
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
