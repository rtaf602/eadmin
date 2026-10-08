// The back end by itself (backend/Code.gs run against the stand-in for Google, no browser): what it accepts, what it
// refuses, and what it leaves in the sheets. Every person and password here is made up.
import crypto from 'node:crypto';
import { startSim, loginDb, backlogFile, DB, LOG, BIRTH, idGov, idCit, rowOf, day, PEOPLE } from './gas_sim.mjs';

const sim = await startSim({ files: { [DB]: loginDb(), [LOG]: backlogFile() } });
const bad = []; const check = (name, cond, got) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + JSON.stringify(got))); if (!cond) bad.push(name); };
const post = (op, o) => sim.post(Object.assign({ v: 1, op }, o || {}));
const code = (r) => (r.error || {}).code;
const login = (u, pw, n, birth) => post('login', { username: u, password: pw, idGov: String(idGov(n)), birth: birth || BIRTH });
const list = (session) => post('admin.list', { session });
const person = (session, key) => list(session).people.find((p) => p.username === key || p.name === key);
const link = (session, key, extra) => { const p = person(session, key); return post('admin.link', Object.assign({ session, ref: p.ref, username: p.username, role: p.role || 'Viewer', end: p.end }, extra || {})); };
const role = (session, key, extra) => { const p = person(session, key); return post('admin.role', Object.assign({ session, ref: p.ref, role: p.role, end: p.end }, extra || {})); };
const use = (token, password, birth) => post('link.use', { token, password, birth: birth || BIRTH });
const tokens = () => sim.sheet(DB, 'LINK TOKEN').slice(1), log = () => sim.sheet(LOG).slice(1);
const lastLog = () => log()[log().length - 1];
const cell = (key, col) => rowOf(sim, key).cells[col];      // 10 Role, 11 Username, 12 Salt, 13 hash, 14 end date
const PW = { chan: 'Main-Admin-Pass-01', weera: 'Second-Admin-02', phum: 'Viewer-Password-03', phum2: 'Viewer-Password-04', thana: 'Editor-Password-05', krit: 'Another-Password-06' };
const isD = (v) => Object.prototype.toString.call(v) === '[object Date]', text = (v) => v === '' || v === undefined || typeof v === 'string';
const raws = [];                                              // every one-time token handed out, to look for in the sheets at the end

/* ---------- setup ---------- */
check('before setup: not ready', code(post('info')) === 'not_ready');
const refuses = (o, re) => { let m = ''; try { sim.setup(o); } catch (e) { m = e.message; } return re.test(m); };
check('setup refuses an empty SETUP', refuses({}, /loginSheet/));
check('setup refuses a main administrator that is not in the sheet', refuses({ loginSheet: DB, backlogSheet: LOG, superAdmin: 'nobody_x' }, /nobody_x/));
check('setup refuses the same file twice', refuses({ loginSheet: DB, backlogSheet: DB, superAdmin: 'chan_t' }, /คนละไฟล์/));
sim.setup({ loginSheet: 'https://docs.google.com/spreadsheets/d/' + DB + '/edit?usp=sharing', backlogSheet: 'https://docs.google.com/spreadsheets/d/' + LOG + '/edit#gid=0', superAdmin: ' Chan_T ', firstAdmins: ['chan_t', 'weera_t', 'krit_s'], siteUrl: 'https://example.github.io/eadmin' });
check('setup takes the sheet links and keeps only the file ids', sim.props.DB_ID === DB && sim.props.LOG_ID === LOG, sim.props);
check('the main administrator is remembered by ID card number, not by Username', sim.props.SUPER_ID === String(idGov(8)), sim.props.SUPER_ID);
check('a signing secret was made (64 bytes)', /^[0-9a-f]{128}$/.test(sim.props.SECRET));
check('the site address ends with /', sim.props.SITE_URL === 'https://example.github.io/eadmin/', sim.props.SITE_URL);
check('setup reports rows without a Username and incomplete rows, by row number only', sim.logs.some((l) => /ยังไม่มี Username: \d+/.test(l)) && sim.logs.some((l) => /ข้อมูลยังไม่ครบ.*: \d+/.test(l)) && !sim.logs.some((l) => PEOPLE.some((p) => p.name && l.includes(p.name))), sim.logs);
const secret = sim.props.SECRET; sim.setup({});
check('running setup again keeps the secret', sim.props.SECRET === secret);
const info = post('info');
check('info: session hours, link minutes, minimum password length', info.ok && info.sessionHours === 8 && info.linkMinutes === 30 && info.minPasswordLength === 10, info);
check('unknown op and non-JSON are refused', code(post('nope')) === 'bad_request' && JSON.parse(sim.run('doPost({postData:{contents:"{oops"}}).getContent()')).error.code === 'bad_request');

/* ---------- the first administrators ---------- */
check('nobody can log in before a password exists', code(login('chan_t', 'x'.repeat(12), 8)) === 'login_failed');
const first = sim.firstLinks();
const tokenOf = (name) => { const l = first.find((x) => x.startsWith(name + ' ')); const m = l && /set-password\.html#token=([A-Za-z0-9_-]+)$/.exec(l); if (m) raws.push(m[1]); return m ? m[1] : ''; };
const tChan = tokenOf('chan_t'), tWeera = tokenOf('weera_t');
check('createFirstAdminLinks: a full link for each administrator', tChan.length >= 40 && tWeera.length >= 40 && first.some((l) => l.includes('https://example.github.io/eadmin/set-password.html#token=')), first);
check('…and it skips an account whose Role in the sheet is not Admin', first.some((l) => /^krit_s: ข้าม/.test(l)), first);
check('LINK TOKEN: two rows, the token itself is not there', tokens().length === 2 && tokens().every((r) => /^sha256:[0-9a-f]{64}$/.test(r[1]) && r[6] === false && r[7] === 0) && !JSON.stringify(tokens()).includes(tChan), tokens());
check('LINK TOKEN: created and expiry are dates 30 minutes apart', tokens().every((r) => isD(r[4]) && isD(r[5]) && r[5] - r[4] === 30 * 60000));
check('BACKLOG: the links are logged as made from the editor', log().length === 2 && log()[0][2] === 'LINK_GENERATED' && /^SETUP/.test(log()[0][10]) && isD(log()[0][0]), log()[0]);
const li = post('link.info', { token: tChan });
check('link.info: Username, kind and expiry', li.ok && li.username === 'chan_t' && li.action === 'CREATE' && li.expiresAt > Date.now() && li.minPasswordLength === 10, li);
check('link.info on a made-up token', code(post('link.info', { token: 'A'.repeat(43) })) === 'link_invalid' && code(post('link.info', { token: '../x' })) === 'link_invalid');

/* ---------- setting a password ---------- */
check('a short password is refused', code(use(tChan, 'short')) === 'bad_password');
const wrong = use(tChan, PW.chan, '1987-01-02');
check('a wrong date of birth: refused, 4 tries left, counted in the sheet', code(wrong) === 'birth_wrong' && wrong.error.left === 4 && tokens()[0][7] === 1, wrong);
const set = use(tChan, PW.chan);
check('the right date of birth sets the password', set.ok && set.action === 'CREATE' && set.username === 'chan_t', set);
const salt = cell('chan_t', 12), hash = cell('chan_t', 13);
check('Salt and hash are written as text', typeof salt === 'string' && /^s[0-9a-f]{31}$/.test(salt) && /^pbkdf2-sha256\$5000\$[0-9a-f]{64}$/.test(hash), [salt, hash]);
check('the hash is standard PBKDF2-HMAC-SHA256 of the password and the salt', hash.split('$')[2] === crypto.pbkdf2Sync(PW.chan, salt, 5000, 32, 'sha256').toString('hex'));
check('the link is marked used and cannot be used twice', tokens()[0][6] === true && code(use(tChan, PW.chan)) === 'link_invalid' && code(post('link.info', { token: tChan })) === 'link_invalid');
check('BACKLOG: PASSWORD_SET with the link id', lastLog()[2] === 'PASSWORD_SET' && lastLog()[1] === 'CREATE' && lastLog()[5] === 'chan_t' && lastLog()[11] === tokens()[0][0], lastLog());
check('second administrator sets a password', use(tWeera, PW.weera).ok);

/* ---------- login ---------- */
const sameMsg = [login('chan_t', 'Wrong-Password-00', 8), post('login', { username: 'chan_t', password: PW.chan, idGov: String(idGov(1)), birth: BIRTH }), login('chan_t', PW.chan, 8, '1987-01-02'), login('ghost_x', PW.chan, 8)];
check('wrong password, wrong card number, wrong birth date, unknown user: one and the same answer', sameMsg.every((r) => code(r) === 'login_failed' && r.error.message === sameMsg[0].error.message), sameMsg.map(code));
check('a failed login is slowed down', sim.sleeps >= 4, sim.sleeps);
const inChan = login(' CHAN_T ', PW.chan, 8);
check('login: Username is not case sensitive; the answer carries rank, name, position, Username, Role only', inChan.ok && JSON.stringify(Object.keys(inChan.user).sort()) === JSON.stringify(['isSuper', 'name', 'pos', 'rank', 'role', 'username']) && inChan.user.role === 'Admin' && inChan.user.isSuper === true, inChan);
check('the session lasts 8 hours', Math.abs(inChan.expiresAt - Date.now() - 8 * 3600000) < 5000);
const S = inChan.session, W = login('weera_t', PW.weera, 6).session;
check('me: with the session', post('me', { session: S }).user.username === 'chan_t');
const flip = (s) => s.slice(0, -1) + (s.slice(-1) === '0' ? '1' : '0');
check('a changed, cut or missing session is refused', code(post('me', { session: flip(S) })) === 'auth' && code(post('me', { session: S.split('.')[0] })) === 'auth' && code(post('me', {})) === 'auth' && code(post('me', { session: 'a.b' })) === 'auth');
const forged = Buffer.from(JSON.stringify({ i: String(idGov(8)), e: Date.now() + 9e9, p: 'x' })).toString('base64url') + '.' + S.split('.')[1];
check('a session with a rewritten body is refused', code(post('me', { session: forged })) === 'auth');

/* ---------- what the administrator page receives ---------- */
const L = list(S);
check('admin.list: 12 people, with their groups', L.ok && L.people.length === 12 && L.people.find((p) => p.username === 'thana_t').group === 'นักบิน A319 / A320' && L.people.find((p) => p.username === 'kitti_s').group === 'เจ้าหน้าที่สื่อสาร' && L.people[0].group === 'นักบินผู้บังคับบัญชา', L.people && L.people.map((p) => p.group));
check('admin.list: each person carries exactly the agreed fields', L.people.every((p) => JSON.stringify(Object.keys(p).sort()) === JSON.stringify(['end', 'endBad', 'group', 'hasPw', 'isMe', 'isSuper', 'missing', 'name', 'pos', 'rank', 'ref', 'role', 'username'])));
const wire = JSON.stringify(L);
check('admin.list: no ID card number, date of birth, salt or hash leaves the back end', !PEOPLE.some((p) => p.n && (wire.includes(String(idGov(p.n))) || wire.includes(String(idCit(p.n))))) && !wire.includes('1987') && !wire.includes(salt) && !wire.includes(hash.split('$')[2]) && !/pbkdf2/.test(wire));
check('admin.list: missing cells are named, not shown', JSON.stringify(L.people.find((p) => p.username === 'methi_j').missing) === JSON.stringify(['BIRTH DATE']) && L.people.find((p) => p.username === 'pakorn_t').missing.length === 0);
check('admin.list: who has a password, who is the main administrator, who am I', L.people.filter((p) => p.hasPw).length === 2 && L.people.filter((p) => p.isSuper).map((p) => p.username).join() === 'chan_t' && L.people.filter((p) => p.isMe).map((p) => p.username).join() === 'chan_t' && L.mainAdmin === 'chan_t');
check('admin.list needs a session', code(post('admin.list', {})) === 'auth');

/* ---------- the main administrator ---------- */
const g1 = link(S, 'phum_s', { role: 'Viewer' }); raws.push(g1.token);
check('main admin: Generate One Time Link writes the Role now', g1.ok && g1.action === 'CREATE' && g1.username === 'phum_s' && cell('phum_s', 10) === 'Viewer' && Math.abs(g1.expiresAt - Date.now() - 30 * 60000) < 5000, g1);
check('BACKLOG: who made it, for whom, with which Role', lastLog()[2] === 'LINK_GENERATED' && lastLog()[10] === 'chan_t' && lastLog()[5] === 'phum_s' && lastLog()[8] === 'Viewer' && lastLog()[3] === 'นักบิน A319 / A320' && lastLog()[4] === 'น.ต. ภูมิ สาธิตพงศ์' && isD(lastLog()[12]), lastLog());
check('the new user sets a password and logs in as Viewer', use(g1.token, PW.phum).ok && login('phum_s', PW.phum, 5).user.role === 'Viewer');
let P = login('phum_s', PW.phum, 5).session;
check('a Viewer cannot use any administrator call', code(list(P)) === 'forbidden' && code(post('admin.link', { session: P, ref: L.people[0].ref, role: 'Admin' })) === 'forbidden' && code(post('admin.role', { session: P, ref: L.people[0].ref, role: 'Admin' })) === 'forbidden');
check('incomplete row (no date of birth): no link', code(link(S, 'methi_j')) === 'incomplete');
check('Username: a clash with someone else is refused', code(link(S, 'prasert_j', { username: 'thana_t' })) === 'bad_username' && /ธนา/.test(link(S, 'prasert_j', { username: 'THANA_T' }).error.message));
check('Username: bad shapes are refused', ['', 'ab', 'a b c', '1abc', 'ก_ข', 'true', '=cmd', 'x'.repeat(31)].every((u) => code(link(S, 'prasert_j', { username: u })) === 'bad_username'));
const g2 = link(S, 'prasert_j', { username: 'Prasert_New', role: 'Editor' }); raws.push(g2.token);
check('main admin changes a Username: written over the old one, lower case', g2.ok && g2.username === 'prasert_new' && cell('prasert_new', 11) === 'prasert_new' && rowOf(sim, 'prasert_j') === null, g2);
check('BACKLOG: old and new Username in their own columns', lastLog()[5] === 'prasert_new' && lastLog()[6] === 'prasert_j' && lastLog()[7] === 'prasert_new', lastLog());

/* ---------- another administrator ---------- */
check('other admin: nothing on the main administrator (link, role)', code(link(W, 'chan_t')) === 'forbidden' && code(role(W, 'chan_t', { role: 'Viewer' })) === 'forbidden' && cell('chan_t', 10) === 'Admin');
check('other admin: nothing on another administrator (link, role)', code(link(W, 'anan_s')) === 'forbidden' && code(role(W, 'anan_s', { role: 'Viewer' })) === 'forbidden');
check('other admin: cannot make anyone an Admin', code(link(W, 'krit_s', { role: 'Admin' })) === 'forbidden' && cell('krit_s', 10) === '');
check('other admin: an account without a Username has to wait for the main administrator', code(link(W, 'วิทยา ทดสอบดี', { username: 'wittaya_t' })) === 'bad_username' && cell('วิทยา ทดสอบดี', 11) === '');
const g3 = link(W, 'krit_s', { role: 'Editor', username: 'renamed_by_w' }); raws.push(g3.token);
check('other admin: can give Editor; a Username sent along is ignored', g3.ok && g3.username === 'krit_s' && cell('krit_s', 11) === 'krit_s' && cell('krit_s', 10) === 'Editor' && lastLog()[6] === '' && lastLog()[7] === '', [g3, lastLog()]);
const g3b = link(W, 'krit_s', { role: 'Editor' }); raws.push(g3b.token);
check('a new link replaces the one before it', g3b.ok && code(post('link.info', { token: g3.token })) === 'link_invalid' && post('link.info', { token: g3b.token }).ok && tokens().some((r) => r[6] === 'REVOKED') && log().some((r) => r[2] === 'LINK_REVOKED' && r[10] === 'weera_t'));
check('…and the newer one works', use(g3b.token, PW.krit).ok && login('krit_s', PW.krit, 1).user.role === 'Editor');
const gT = link(S, 'thana_t', { role: 'Editor' }); raws.push(gT.token); use(gT.token, PW.thana);
check('other admin: CHANGE ROLE of an ordinary account, at once, no link', role(W, 'thana_t', { role: 'Viewer' }).ok && cell('thana_t', 10) === 'Viewer' && lastLog()[1] === 'CHANGE_ROLE' && lastLog()[2] === 'ROLE_CHANGED' && lastLog()[8] === 'Viewer' && lastLog()[9] === 'Editor' && lastLog()[11] === '', lastLog());
check('other admin: CHANGE ROLE to Admin is refused', code(role(W, 'thana_t', { role: 'Admin' })) === 'forbidden' && cell('thana_t', 10) === 'Viewer');
check('CHANGE ROLE without a change, with a bad role, or for an account without a password', code(role(W, 'thana_t')) === 'no_change' && code(role(W, 'thana_t', { role: 'Boss' })) === 'bad_role' && code(role(S, 'somchai_t', { role: 'Viewer' })) === 'no_password');
const gW = link(W, 'weera_t'); raws.push(gW.token);
check('other admin: may reset his own password; his Role stays', gW.ok && gW.action === 'RESET' && cell('weera_t', 10) === 'Admin');
check('other admin: may lower his own Role, and then is no administrator any more', role(W, 'weera_t', { role: 'Viewer' }).ok && code(list(W)) === 'forbidden' && post('me', { session: W }).user.role === 'Viewer');
check('main admin gives the Role back; it takes effect on the next request', role(S, 'weera_t', { role: 'Admin' }).ok && list(W).ok);

/* ---------- the main administrator's own account ---------- */
check('main admin: cannot change his own Role', code(role(S, 'chan_t', { role: 'Viewer' })) === 'no_change' && cell('chan_t', 10) === 'Admin');
const gS = link(S, 'chan_t', { role: 'Viewer', end: '2020-01-01' }); raws.push(gS.token);
check('main admin: may reset his own password; a Role or end date sent along is ignored', gS.ok && gS.action === 'RESET' && gS.role === 'Admin' && cell('chan_t', 10) === 'Admin' && cell('chan_t', 14) === '');
check('main admin: may give a Username to an account that has none, and make an Admin', link(S, 'วิทยา ทดสอบดี', { username: 'wittaya_t', role: 'Admin' }).ok && cell('wittaya_t', 10) === 'Admin');

/* ---------- end date ---------- */
const T = login('thana_t', PW.thana, 3).session;
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d), today = iso(new Date()), yesterday = iso(new Date(Date.now() - 864e5));
check('end date today: still allowed', role(S, 'thana_t', { end: today }).ok && lastLog()[2] === 'END_DATE_CHANGED' && login('thana_t', PW.thana, 3).ok && post('me', { session: T }).ok, lastLog());
check('the end date is a date in the sheet, on that day in Bangkok', isD(cell('thana_t', 14)) && iso(cell('thana_t', 14)) === today, cell('thana_t', 14));
const ex = role(S, 'thana_t', { end: yesterday }) && login('thana_t', PW.thana, 3);
check('end date passed: login is refused with the agreed message, and the open session stops', code(ex) === 'expired' && /สิ้นสุดระยะเวลาในการเข้าถึงข้อมูลของท่าน/.test(ex.error.message) && code(post('me', { session: T })) === 'expired', ex);
check('…a wrong password on that account still gets the ordinary answer', code(login('thana_t', 'Wrong-Password-00', 3)) === 'login_failed');
check('end date cleared: allowed again', role(S, 'thana_t', { end: '' }).ok && cell('thana_t', 14) === '' && login('thana_t', PW.thana, 3).ok);
check('a bad end date is refused', code(role(S, 'thana_t', { end: '2026-02-31' })) === 'bad_date' && code(role(S, 'thana_t', { end: 'tomorrow' })) === 'bad_date');
rowOf(sim, 'thana_t').cells[14] = 'ถึงสิ้นปี';
check('something that is not a date in the end-date cell: treated as passed, and the page is told', code(login('thana_t', PW.thana, 3)) === 'expired' && person(S, 'thana_t').endBad === true);
rowOf(sim, 'thana_t').cells[14] = '';
rowOf(sim, 'chan_t').cells[14] = day('2020-01-01');
check('the main administrator has no end date, whatever the cell says', login('chan_t', PW.chan, 8).ok && post('me', { session: S }).ok && person(S, 'chan_t').end === '');
rowOf(sim, 'chan_t').cells[14] = '';

/* ---------- reset: the old password works until the new one is set, then old sessions stop ---------- */
const gP = link(S, 'phum_s'); raws.push(gP.token);
check('reset link made: the old password still works', gP.action === 'RESET' && login('phum_s', PW.phum, 5).ok && post('me', { session: P }).ok);
check('new password set: old session and old password stop, the new one works', use(gP.token, PW.phum2).ok && code(post('me', { session: P })) === 'auth' && code(login('phum_s', PW.phum, 5)) === 'login_failed' && login('phum_s', PW.phum2, 5).ok);
check('…and a new salt was used', lastLog()[1] === 'RESET' && lastLog()[2] === 'PASSWORD_SET');

/* ---------- links that run out ---------- */
const gK = link(S, 'kitti_s', { role: 'Viewer' }); raws.push(gK.token);
tokens().find((r) => r[2] === 'kitti_s' && r[6] === false)[5] = new Date(Date.now() - 1000);
check('a link past its 30 minutes: refused, marked EXPIRED, logged', code(post('link.info', { token: gK.token })) === 'link_invalid' && code(use(gK.token, 'Some-Password-07')) === 'link_invalid' && tokens().some((r) => r[2] === 'kitti_s' && r[6] === 'EXPIRED') && log().filter((r) => r[2] === 'LINK_EXPIRED' && r[5] === 'kitti_s').length === 1, tokens().filter((r) => r[2] === 'kitti_s'));
const gK2 = link(S, 'kitti_s'); raws.push(gK2.token);
const tries = [1, 2, 3, 4, 5].map(() => use(gK2.token, 'Some-Password-07', '1990-05-05'));
check('five wrong dates of birth: the link is cancelled and logged', tries.slice(0, 4).every((r) => code(r) === 'birth_wrong') && tries[3].error.left === 1 && code(tries[4]) === 'link_invalid' && /5 ครั้ง/.test(tries[4].error.message) && tokens().some((r) => r[2] === 'kitti_s' && r[6] === 'LOCKED' && r[7] === 5) && lastLog()[2] === 'VERIFY_FAILED', tries.map(code));
check('…even the right date no longer works on it, and no password was written', code(use(gK2.token, 'Some-Password-07')) === 'link_invalid' && cell('kitti_s', 13) === '');

/* ---------- too many failed logins ---------- */
sim.cache.clear();
const fails = [1, 2, 3, 4, 5].map(() => code(login('phum_s', 'Wrong-Password-00', 5)));
check('five failed logins: the account rests for 15 minutes, even for the right password', fails.every((c) => c === 'login_failed') && code(login('phum_s', PW.phum2, 5)) === 'login_locked' && /15 นาที/.test(login('phum_s', PW.phum2, 5).error.message));
check('…other accounts are not affected', login('chan_t', PW.chan, 8).ok);
sim.cache.clear();
check('…and it opens again afterwards', login('phum_s', PW.phum2, 5).ok);

/* ---------- when the sheet is edited by hand ---------- */
rowOf(sim, 'weera_t').cells[10] = 'admin ';
check('Role typed by hand in another case still counts', list(W).ok && person(S, 'weera_t').role === 'Admin');
rowOf(sim, 'weera_t').cells[10] = 'Admin';
const keep = rowOf(sim, 'somchai_t').cells[11]; rowOf(sim, 'somchai_t').cells[11] = 'phum_s';
check('two rows with one Username: that Username cannot log in, and no link is made for it', code(login('phum_s', PW.phum2, 5)) === 'login_failed' && code(link(W, 'ภูมิ สาธิตพงศ์')) === 'bad_username');
rowOf(sim, 'สมชาย ตัวอย่างการ').cells[11] = keep; sim.cache.clear();
const keepId = rowOf(sim, 'krit_s').cells[7]; rowOf(sim, 'krit_s').cells[7] = idGov(3);
check('two rows with one ID card number: neither can log in', code(login('krit_s', PW.krit, 3)) === 'login_failed' && code(login('thana_t', PW.thana, 3)) === 'login_failed');
rowOf(sim, 'krit_s').cells[7] = keepId; sim.cache.clear();
check('…and both can again once the sheet is put right', login('krit_s', PW.krit, 1).ok && login('thana_t', PW.thana, 3).ok);
const ref = person(S, 'kitti_s').ref;
check('a made-up or altered row reference is refused', code(post('admin.link', { session: S, ref: ref.replace(/^\d+/, '5'), role: 'Viewer' })) === 'stale' && code(post('admin.link', { session: S, ref: '5', role: 'Viewer' })) === 'stale');
sim.sheet(DB, 'DATABASE LOGIN').splice(2, 0, ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
check('rows moved since the list was read: the old reference is refused rather than hitting the wrong person', code(post('admin.link', { session: S, ref, role: 'Viewer' })) === 'stale' && link(S, 'kitti_s', { role: 'Viewer' }).ok);
raws.push(link(S, 'kitti_s').token);
rowOf(sim, 'chan_t').cells[11] = 'chan_renamed';
check('the main administrator keeps his rights after his Username changes', post('me', { session: S }).user.isSuper === true && link(S, 'somchai_t', { role: 'Admin' }).ok && list(S).mainAdmin === 'chan_renamed');
rowOf(sim, 'chan_renamed').cells[11] = 'chan_t';
check('dates of birth: a date cell, 1-Jan-1987, 1/1/2530 and 1987-01-01 all read as the same day; 31-Feb is no date', ["new Date('1987-01-01T00:00:00+07:00')", "'1-Jan-1987'", "'1/1/2530'", "'1987-01-01'", "'01 January 1987'"].every((v) => sim.run('toIso_(' + v + ", 'Asia/Bangkok')") === '1987-01-01') && sim.run("toIso_('31-Feb-2020', 'Asia/Bangkok')") === '' && sim.run("toIso_('', 'Asia/Bangkok')") === '');
check('login works for a row whose date of birth is text', (() => { const g = link(S, 'pakorn_t', { role: 'Viewer' }); raws.push(g.token); return use(g.token, 'Text-Birth-Pass-08').ok && login('pakorn_t', 'Text-Birth-Pass-08', 2).ok; })());

/* ---------- what is left in the sheets ---------- */
const everything = JSON.stringify([sim.sheet(DB, 'DATABASE LOGIN'), sim.sheet(DB, 'LINK TOKEN'), sim.sheet(LOG)]);
check('no password is anywhere in the sheets', !Object.values(PW).concat(['Text-Birth-Pass-08', 'Some-Password-07']).some((p) => everything.includes(p)));
check('no one-time token is anywhere in the sheets', raws.length >= 12 && raws.every((t) => t && !everything.includes(t)), raws.length);
check('nothing the back end wrote was taken for a formula or a number', !everything.includes('#NAME?') && sim.sheet(DB, 'DATABASE LOGIN').every((r) => text(r[12]) && text(r[13])) && tokens().every((r) => typeof r[0] === 'string' && typeof r[1] === 'string'));
check('BACKLOG rows all have 14 cells, a time, an action and an event', log().every((r) => r.length === 14 && isD(r[0]) && ['CREATE', 'RESET', 'CHANGE_ROLE'].includes(r[1]) && typeof r[2] === 'string'), log().find((r) => r.length !== 14));
check('the back end logged no unexpected error', !sim.logs.some((l) => l.startsWith('console.error')), sim.logs.filter((l) => l.startsWith('console.error')));
rowOf(sim, 'phum_s').cells[13] = 'pbkdf2-sha256$5000$zz';
check('a damaged hash cell: that account cannot log in, nothing breaks', code(login('phum_s', PW.phum2, 5)) === 'login_failed');

/* ---------- over HTTP, the way a browser reaches it ---------- */
const g = await (await fetch(sim.backendUrl)).json();
check('GET /exec answers through a redirect', g.ok && g.ready === true && g.service === 'eadmin602', g);
const p = await (await fetch(sim.backendUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ v: 1, op: 'info' }) })).json();
check('POST /exec as text/plain answers through a redirect', p.ok && p.sessionHours === 8, p);
sim.close();
console.log(bad.length ? bad.length + ' check(s) FAILED' : 'all checks passed');
console.log('errors:', JSON.stringify(bad));
process.exit(bad.length ? 1 : 0);
