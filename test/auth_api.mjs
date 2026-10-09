// The back end by itself (backend/Code.gs run against the stand-in for Google, no browser): what it accepts, what it
// refuses, and what it leaves in the sheets. Every person and password here is made up.
import crypto from 'node:crypto';
import { startSim, fourFiles, SETUP4, DB, LOG, BDB, BLOG, BIRTH, idGov, idCit, rowOf, day, PEOPLE } from './gas_sim.mjs';

const sim = await startSim({ files: fourFiles() });
const bad = []; const check = (name, cond, got) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  → ' + JSON.stringify(got))); if (!cond) bad.push(name); };
const post = (op, o) => sim.post(Object.assign({ v: 1, op }, o || {}));
const code = (r) => (r.error || {}).code;
const login1 = (u, pw, n, birth) => post('login', { username: u, password: pw, idGov: String(idGov(n)), birth: birth || BIRTH });
// A login from a device of its own. When the account is in use on another device, that device is taken to have the page
// closed: 31 seconds pass without a word from it, and this one is let in (ข้อ 1.12.3).
const login = (u, pw, n, birth) => { const r = login1(u, pw, n, birth); if (!r.wait) return r; sim.advance(31000); return post('login.wait', { ticket: r.ticket }); };
const ping = (session) => post('ping', { session }), me = (session) => post('me', { session });
const list = (session) => post('admin.list', { session });
const person = (session, key) => list(session).people.find((p) => p.username === key || p.name === key);
const link = (session, key, extra) => { const p = person(session, key); return post('admin.link', Object.assign({ session, ref: p.ref, role: p.role || 'Viewer', end: p.end }, extra || {})); };
const rename = (session, key, username) => post('admin.username', { session, ref: person(session, key).ref, username });
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
check('setup refuses to go on without the two backup files', refuses({ loginSheet: DB, backlogSheet: LOG }, /backupLoginSheet/) && refuses({ loginSheet: DB, backlogSheet: LOG, backupLoginSheet: BDB }, /backupBacklogSheet/));
check('setup refuses a main administrator that is not in the sheet', refuses(Object.assign({}, SETUP4, { superAdmin: 'nobody_x' }), /nobody_x/));
check('setup refuses the same file twice, a backup file included', refuses(Object.assign({}, SETUP4, { backlogSheet: DB, superAdmin: 'chan_t' }), /คนละไฟล์/) && refuses(Object.assign({}, SETUP4, { backupBacklogSheet: LOG, superAdmin: 'chan_t' }), /คนละไฟล์/));
sim.files[BDB].gone = true;
check('setup stops when a backup file cannot be opened, and says which', refuses(Object.assign({}, SETUP4, { superAdmin: 'chan_t' }), /เปิดไฟล์ BACKUP LOGIN DATABASE ไม่ได้/) && code(post('info')) === 'not_ready');
sim.files[BDB].gone = false;
sim.setup({ loginSheet: 'https://docs.google.com/spreadsheets/d/' + DB + '/edit?usp=sharing', backlogSheet: 'https://docs.google.com/spreadsheets/d/' + LOG + '/edit#gid=0', backupLoginSheet: 'https://docs.google.com/spreadsheets/d/' + BDB + '/edit?usp=sharing', backupBacklogSheet: BLOG, superAdmin: ' Chan_T ', firstAdmins: ['chan_t', 'weera_t', 'krit_s'], siteUrl: 'https://example.github.io/eadmin' });
check('setup takes the sheet links and keeps only the file ids', sim.props.DB_ID === DB && sim.props.LOG_ID === LOG && sim.props.BACKUP_DB_ID === BDB && sim.props.BACKUP_LOG_ID === BLOG, sim.props);
check('the main administrator is remembered by ID card number, not by Username', sim.props.SUPER_ID === String(idGov(8)), sim.props.SUPER_ID);
check('a signing secret was made (64 bytes)', /^[0-9a-f]{128}$/.test(sim.props.SECRET));
check('the site address ends with /', sim.props.SITE_URL === 'https://example.github.io/eadmin/', sim.props.SITE_URL);
check('setup reports rows without a Username and incomplete rows, by row number only', sim.logs.some((l) => /ยังไม่มี Username: \d+/.test(l)) && sim.logs.some((l) => /ข้อมูลยังไม่ครบ.*: \d+/.test(l)) && !sim.logs.some((l) => PEOPLE.some((p) => p.name && l.includes(p.name))), sim.logs);
const secret = sim.props.SECRET; sim.setup({});
check('running setup again keeps the secret', sim.props.SECRET === secret);
const info = post('info');
check('info: one hour per login, warning 5 minutes before, asking every 10 seconds, link minutes, minimum password length', info.ok && info.sessionMinutes === 60 && info.warnMinutes === 5 && info.pollSeconds === 10 && info.takeoverSeconds === 10 && info.linkMinutes === 30 && info.minPasswordLength === 10, info);
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
check('the session lasts one hour (ข้อ 1.10)', Math.abs(inChan.expiresAt - Date.now() - 3600000) < 5000);
let S = inChan.session; const W = login('weera_t', PW.weera, 6).session;
check('me: with the session', post('me', { session: S }).user.username === 'chan_t');
const flip = (s) => s.slice(0, -1) + (s.slice(-1) === '0' ? '1' : '0');
check('a changed, cut or missing session is refused', code(post('me', { session: flip(S) })) === 'auth' && code(post('me', { session: S.split('.')[0] })) === 'auth' && code(post('me', {})) === 'auth' && code(post('me', { session: 'a.b' })) === 'auth');
const forged = Buffer.from(JSON.stringify({ i: String(idGov(8)), e: Date.now() + 9e9, p: 'x', s: 'x' })).toString('base64url') + '.' + S.split('.')[1];
check('a session with a rewritten body is refused', code(post('me', { session: forged })) === 'auth');

/* ---------- what the administrator page receives ---------- */
const L = list(S);
check('admin.list: 12 people, with their groups', L.ok && L.people.length === 12 && L.people.find((p) => p.username === 'thana_t').group === 'นักบิน A319 / A320' && L.people.find((p) => p.username === 'kitti_s').group === 'เจ้าหน้าที่สื่อสาร' && L.people[0].group === 'นักบินผู้บังคับบัญชา', L.people && L.people.map((p) => p.group));
check('admin.list: each person carries exactly the agreed fields', L.people.every((p) => JSON.stringify(Object.keys(p).sort()) === JSON.stringify(['end', 'endBad', 'group', 'hasPw', 'isMe', 'isSuper', 'missing', 'name', 'pos', 'rank', 'ref', 'role', 'username'])));
const wire = JSON.stringify(L);
check('admin.list: no ID card number, date of birth, salt or hash leaves the back end', !PEOPLE.some((p) => p.n && (wire.includes(String(idGov(p.n))) || wire.includes(String(idCit(p.n))))) && !/1987-01-01|Jan-1987|\/2530|"birth"/.test(wire) && !wire.includes(salt) && !wire.includes(hash.split('$')[2]) && !/pbkdf2/.test(wire));
check('admin.list: missing cells are named, not shown', JSON.stringify(L.people.find((p) => p.username === 'methi_j').missing) === JSON.stringify(['BIRTH DATE']) && L.people.find((p) => p.username === 'pakorn_t').missing.length === 0);
check('admin.list: who has a password, who is the main administrator, who am I', L.people.filter((p) => p.hasPw).length === 2 && L.people.filter((p) => p.isSuper).map((p) => p.username).join() === 'chan_t' && L.people.filter((p) => p.isMe).map((p) => p.username).join() === 'chan_t' && L.mainAdmin === 'chan_t');
check('admin.list needs a session', code(post('admin.list', {})) === 'auth');
check('the calls that write are refused without a session before anything is read', ['admin.link', 'admin.role', 'admin.username', 'admin.backupAck'].every((op) => code(post(op, {})) === 'auth' && code(post(op, { session: 'a.b' })) === 'auth'));
const inside = (tok) => JSON.parse(Buffer.from(tok.split('.')[0], 'base64url').toString('utf8'));
check('the session a browser keeps holds no ID card number: only a mark of it (ข้อ 1.6)', JSON.stringify(Object.keys(inside(S)).sort()) === JSON.stringify(['e', 'i', 'p', 's']) && /^[0-9a-f]{24}$/.test(inside(S).i) && !PEOPLE.some((p) => p.n && JSON.stringify(inside(S)).includes(String(idGov(p.n)))), inside(S));

/* ---------- the main administrator ---------- */
const g1 = link(S, 'phum_s', { role: 'Viewer' }); raws.push(g1.token);
check('main admin: Generate One Time Link writes the Role now', g1.ok && g1.action === 'CREATE' && g1.username === 'phum_s' && cell('phum_s', 10) === 'Viewer' && Math.abs(g1.expiresAt - Date.now() - 30 * 60000) < 5000, g1);
check('BACKLOG: who made it, for whom, with which Role', lastLog()[2] === 'LINK_GENERATED' && lastLog()[10] === 'chan_t' && lastLog()[5] === 'phum_s' && lastLog()[8] === 'Viewer' && lastLog()[3] === 'นักบิน A319 / A320' && lastLog()[4] === 'น.ต. ภูมิ สาธิตพงศ์' && isD(lastLog()[12]), lastLog());
check('the new user sets a password and logs in as Viewer', use(g1.token, PW.phum).ok && login('phum_s', PW.phum, 5).user.role === 'Viewer');
let P = login('phum_s', PW.phum, 5).session;
check('a Viewer cannot use any administrator call', ['admin.list', 'admin.link', 'admin.role', 'admin.username', 'admin.backupAck'].every((op) => code(post(op, { session: P, ref: L.people[0].ref, role: 'Admin', username: 'new_name' })) === 'forbidden'));
check('incomplete row (no date of birth): no link', code(link(S, 'methi_j')) === 'incomplete');

/* ---------- เปลี่ยน Username: a button of its own (ข้อ 1.2.1) ---------- */
const gI = link(S, 'prasert_j', { username: 'sneaky_name', role: 'Editor' }); raws.push(gI.token);
check('Generate One Time Link no longer changes a Username: one sent along is ignored', gI.ok && gI.username === 'prasert_j' && cell('prasert_j', 11) === 'prasert_j' && lastLog()[6] === '' && lastLog()[7] === '', [gI, lastLog()]);
const linksBefore = tokens().length, before = ['prasert_j'].map((k) => [cell(k, 10), cell(k, 12), cell(k, 13), cell(k, 14)]);
check('เปลี่ยน Username: a clash with someone else is refused', code(rename(S, 'prasert_j', 'thana_t')) === 'bad_username' && /ธนา/.test(rename(S, 'prasert_j', 'THANA_T').error.message));
check('เปลี่ยน Username: bad shapes are refused', ['', 'ab', 'a b c', '1abc', 'ก_ข', 'true', '=cmd', 'x'.repeat(31)].every((u) => code(rename(S, 'prasert_j', u)) === 'bad_username') && cell('prasert_j', 11) === 'prasert_j');
check('…and the same Username again is no change', code(rename(S, 'prasert_j', 'prasert_j')) === 'no_change');
const rn = rename(S, 'prasert_j', 'Prasert_New');
check('main admin changes a Username: written over the old one at once, lower case, no link', rn.ok && rn.username === 'prasert_new' && rn.old === 'prasert_j' && !('token' in rn) && cell('prasert_new', 11) === 'prasert_new' && rowOf(sim, 'prasert_j') === null && tokens().length === linksBefore, rn);
check('BACKLOG: CHANGE_USERNAME with the old and the new Username and who did it', lastLog()[1] === 'CHANGE_USERNAME' && lastLog()[2] === 'USERNAME_CHANGED' && lastLog()[5] === 'prasert_new' && lastLog()[6] === 'prasert_j' && lastLog()[7] === 'prasert_new' && lastLog()[10] === 'chan_t' && lastLog()[11] === '', lastLog());
check('…the link of that account that was not used yet stops working, and BACKLOG says why (ข้อ 1.2.1.4)', code(post('link.info', { token: gI.token })) === 'link_invalid' && log().some((r) => r[2] === 'LINK_REVOKED' && r[5] === 'prasert_j' && /เปลี่ยน Username/.test(r[13])), log().slice(-2));
check('…Role, Salt, hash and end date are left as they were (ข้อ 1.2.1.5)', JSON.stringify([cell('prasert_new', 10), cell('prasert_new', 12), cell('prasert_new', 13), cell('prasert_new', 14)]) === JSON.stringify(before[0]));

/* ---------- another administrator ---------- */
check('other admin: nothing on the main administrator (link, role)', code(link(W, 'chan_t')) === 'forbidden' && code(role(W, 'chan_t', { role: 'Viewer' })) === 'forbidden' && cell('chan_t', 10) === 'Admin');
check('other admin: nothing on another administrator (link, role)', code(link(W, 'anan_s')) === 'forbidden' && code(role(W, 'anan_s', { role: 'Viewer' })) === 'forbidden');
check('other admin: cannot make anyone an Admin', code(link(W, 'krit_s', { role: 'Admin' })) === 'forbidden' && cell('krit_s', 10) === '');
check('other admin: an account without a Username has to wait for the main administrator', code(link(W, 'วิทยา ทดสอบดี', { username: 'wittaya_t' })) === 'bad_username' && code(rename(W, 'วิทยา ทดสอบดี', 'wittaya_t')) === 'forbidden' && cell('วิทยา ทดสอบดี', 11) === '');
check('other admin: cannot change any Username, his own included (ข้อ 1.0.2)', code(rename(W, 'krit_s', 'krit_new')) === 'forbidden' && code(rename(W, 'weera_t', 'weera_new')) === 'forbidden' && code(rename(W, 'chan_t', 'chan_new')) === 'forbidden' && cell('krit_s', 11) === 'krit_s' && cell('weera_t', 11) === 'weera_t' && /เฉพาะ chan_t/.test(rename(W, 'krit_s', 'krit_new').error.message));
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
check('an account without a Username: no link for the main administrator either, until one is saved (ข้อ 1.2.1.3)', code(link(S, 'วิทยา ทดสอบดี', { role: 'Viewer' })) === 'bad_username' && /บันทึก Username ก่อน/.test(link(S, 'วิทยา ทดสอบดี', { role: 'Viewer' }).error.message));
check('main admin: may give a Username to an account that has none, and then make an Admin', rename(S, 'วิทยา ทดสอบดี', 'wittaya_t').ok && lastLog()[6] === '' && lastLog()[7] === 'wittaya_t' && /ครั้งแรก/.test(lastLog()[13]) && link(S, 'wittaya_t', { role: 'Admin' }).ok && cell('wittaya_t', 10) === 'Admin');

/* ---------- end date ---------- */
let T = login('thana_t', PW.thana, 3).session;
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d), today = iso(new Date()), yesterday = iso(new Date(Date.now() - 864e5));
check('end date today: still allowed', role(S, 'thana_t', { end: today }).ok && lastLog()[2] === 'END_DATE_CHANGED' && !!(T = login('thana_t', PW.thana, 3).session) && me(T).ok, lastLog());
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
check('the main administrator has no end date, whatever the cell says', !!(S = login('chan_t', PW.chan, 8).session) && me(S).ok && person(S, 'chan_t').end === '');
rowOf(sim, 'chan_t').cells[14] = '';

/* ---------- reset: the old password works until the new one is set, then old sessions stop ---------- */
const gP = link(S, 'phum_s'); raws.push(gP.token);
check('reset link made: the old password still works, and the device that is signed in stays in (ข้อ 1.9.1)', gP.action === 'RESET' && me(P).ok && ping(P).ok && !!(P = login('phum_s', PW.phum, 5).session) && me(P).ok);
const setP = use(gP.token, PW.phum2), afterMe = me(P), afterPing = ping(P);
check('new password set: the device signed in with the old one is out at once, on whatever it asks, and is told why (ข้อ 1.9)', setP.ok && code(afterMe) === 'auth' && code(afterPing) === 'auth' && /Password ของบัญชีนี้ถูกเปลี่ยนแล้ว/.test(afterMe.error.message) && afterPing.error.message === afterMe.error.message, [afterMe, afterPing]);
check('…the old password stops, the new one works', code(login('phum_s', PW.phum, 5)) === 'login_failed' && login('phum_s', PW.phum2, 5).ok && code(me(P)) === 'auth');
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
check('…other accounts are not affected', !!(S = login('chan_t', PW.chan, 8).session) && me(S).ok);
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

/* ---------- one hour per login (ข้อ 1.10) ---------- */
const K = login('krit_s', PW.krit, 1);
check('me and ping repeat the same end: a login is not extended by using it', K.ok && me(K.session).expiresAt === K.expiresAt && ping(K.session).expiresAt === K.expiresAt, K);
sim.advance(59 * 60000);
check('59 minutes after the login: still in', me(K.session).ok && ping(K.session).ok);
sim.advance(61000);
const late = [me(K.session), ping(K.session), list(K.session), post('session.deny', { session: K.session, rid: 'x' })];
check('one hour after the login: out on whatever it asks, with the agreed message (ข้อ 1.10.2)', late.every((r) => code(r) === 'auth' && r.error.message === 'หมดเวลาใช้งาน ให้เข้าสู่ระบบใหม่'), late);
check('…and the account is free: the next login is let in at once', !!login1('krit_s', PW.krit, 1).session);
S = login('chan_t', PW.chan, 8).session;

/* ---------- one device per account (ข้อ 1.12) ---------- */
const DENIED = 'บัญชีนี้กำลังถูกใช้งานที่เครื่องอื่น และเครื่องนั้นไม่อนุญาตให้เข้าใช้งานซ้อน', TAKEN = /^บัญชีของคุณถูกออกจากระบบ เพราะมีการ Login จากเครื่องอื่น หากไม่ใช่คุณ ให้ติดต่อ Admin เพื่อ Reset Password$/;
const thana = () => login1('thana_t', PW.thana, 3), wait = (b) => post('login.wait', { ticket: b.ticket });
let D1 = login('thana_t', PW.thana, 3).session;                 // device 1 is using the account
check('device 1 asks every 10 seconds and is told nothing while it is alone', ping(D1).ok && !('take' in ping(D1)));
let B = thana();                                                // device 2 logs in with the right password
check('the ticket of a waiting device holds no ID card number either', B.wait === true && /^[0-9a-f]{24}$/.test(inside(B.ticket).i) && !JSON.stringify(inside(B.ticket)).includes(String(idGov(3))), B.ticket && inside(B.ticket));
check('a login from another device while the account is in use: not let in, it has to wait (ข้อ 1.12.2)', B.ok && B.wait === true && !B.session && !B.user && typeof B.ticket === 'string' && B.pollMs > 0 && B.username === 'thana_t', B);
check('…asking again: still waiting, with the seconds that may be left', (() => { const w = wait(B); return w.ok && w.wait === true && !w.session && w.left > 0 && w.left <= 30; })());
const told = ping(D1);
check('1.12.1 the device in use is told on its next question, and has 10 seconds to refuse', told.ok && !!told.take && /^[0-9a-f]{16}$/.test(told.take.rid) && told.take.until - told.now === 10000, told);
check('…it is told the same on any other request, and stays in meanwhile', me(D1).take.rid === told.take.rid && me(D1).take.until === told.take.until && !B.ticket.includes(told.take.rid));
sim.advance(5000);
check('…5 seconds on: device 2 is still waiting', wait(B).wait === true && wait(B).left <= 8);
check('a refusal with the wrong request id does nothing, and says so', post('session.deny', { session: D1, rid: 'f'.repeat(16) }).denied === false && wait(B).wait === true && !!ping(D1).take);
const dn = post('session.deny', { session: D1, rid: told.take.rid }), w1 = wait(B);
check('1.12.5 refused: device 2 gets the agreed message, device 1 carries on and is no longer asked', dn.ok && dn.denied === true && code(w1) === 'login_denied' && w1.error.message === DENIED && ping(D1).ok && !ping(D1).take && me(D1).ok, [dn, w1]);
check('…the ticket of the device that was turned away is good for nothing afterwards', code(wait(B)) === 'login_gone' && me(D1).ok);
sim.advance(20000);
check('…and device 1 is still in 20 seconds later', ping(D1).ok && !ping(D1).take);
B = thana(); const told2 = ping(D1);
sim.advance(9000);
check('not refused, 9 seconds: nothing has happened yet', wait(B).wait === true && ping(D1).ok && ping(D1).take.until === told2.take.until);
sim.advance(4100);
const in2 = wait(B);
check('not refused in time: device 2 is let in, with an hour of its own', in2.ok && !!in2.session && in2.user.username === 'thana_t' && in2.expiresAt - in2.now === 3600000 && me(in2.session).ok, in2);
const out1 = [ping(D1), me(D1), list(D1)];
check('…and device 1 is out on whatever it asks, with the reason', out1.every((r) => code(r) === 'taken' && TAKEN.test(r.error.message)), out1);
check('a refusal that comes too late changes nothing', code(post('session.deny', { session: D1, rid: told2.take.rid })) === 'taken' && me(in2.session).ok);
// the back end decides by itself, without waiting for the new device to ask
D1 = in2.session; ping(D1); B = thana(); ping(D1); sim.advance(9000); wait(B); sim.advance(4100);
check('1.12.7 the back end decides: the old device is out when its time is up, before the new one has asked again', code(ping(D1)) === 'taken' && !!(D1 = wait(B).session));
// the device in use has the page closed
ping(D1); sim.advance(20000); B = thana();
check('1.12.3 the device in use last asked 20 seconds ago: the new one waits', B.wait === true);
sim.advance(9000);
check('…29 seconds without a word: still waiting', wait(B).wait === true);
sim.advance(1100);
const in3 = wait(B);
check('…30 seconds without a word: the new device is let in, and the old login is ended', !!in3.session && code(me(D1)) === 'taken', in3);
D1 = in3.session; ping(D1); sim.advance(31000);
const in4 = thana();
check('the device in use has not asked for more than 30 seconds: the new one is in at once', !!in4.session && !in4.wait && code(ping(D1)) === 'taken', in4);
// leaving, giving up, a third device
D1 = in4.session; ping(D1); B = thana();
check('the device in use signs out during the wait: the new one is in at once', post('logout', { session: D1 }).ok && !!(D1 = wait(B).session) && me(D1).ok);
ping(D1); B = thana(); ping(D1);
check('a third device while one is already waiting: told to try again in a moment', code(thana()) === 'login_busy' && /รอสักครู่/.test(thana().error.message) && wait(B).wait === true);
sim.advance(11000);
const kept = ping(D1);
check('the waiting device goes silent for more than 10 seconds: its request lapses, the device in use stays and is no longer asked', kept.ok && !kept.take && code(wait(B)) === 'login_gone' && me(D1).ok, kept);
check('signing out frees the account: the next login does not wait', post('logout', { session: D1 }).ok && !me(D1).ok && !!(D1 = thana().session));
check('logout with rubbish, or twice, breaks nothing', post('logout', {}).ok && post('logout', { session: 'a.b' }).ok && me(D1).ok);
// tickets
ping(D1); B = thana();
check('a made-up ticket, a session passed off as a ticket, a ticket passed off as a session: all refused', code(post('login.wait', { ticket: 'a.b' })) === 'login_gone' && code(post('login.wait', { ticket: D1 })) === 'login_gone' && code(post('login.wait', {})) === 'login_gone' && code(me(B.ticket)) === 'auth');
check('other accounts are not held up by this one', !!login1('krit_s', PW.krit, 1).session && wait(B).wait === true);
check('the waiting device calls it off: the device in use is no longer asked, and the ticket is spent', post('login.cancel', { ticket: B.ticket }).ok && !ping(D1).take && code(wait(B)) === 'login_gone' && post('login.cancel', { ticket: 'a.b' }).ok && post('login.cancel', {}).ok && me(D1).ok);
B = thana();
// the password changes while a device is waiting
const gX = link(S, 'thana_t'); raws.push(gX.token);
check('the password is changed while a device waits with the old one: it is not let in, and the device in use is out (ข้อ 1.9)', use(gX.token, 'Changed-While-Waiting-9').ok && !wait(B).ok && !wait(B).session && code(ping(D1)) === 'auth' && /Password ของบัญชีนี้ถูกเปลี่ยนแล้ว/.test(ping(D1).error.message) && code(thana()) === 'login_failed');
PW.thana = 'Changed-While-Waiting-9';
D1 = thana().session;
check('…the new password is let in at once, and the old devices stay out', !!D1 && me(D1).ok);
// what it costs, and what it keeps
const opens = sim.opens, reads = sim.propReads; for (let i = 0; i < 30; i++) ping(D1);
check('the 10-second question opens no sheet and reads no script property', sim.opens === opens && sim.propReads === reads, [sim.opens - opens, sim.propReads - reads]);
const devKeys = Object.keys(sim.props).filter((k) => k.startsWith('DEV_'));
check('what is kept about devices names no ID card number and no Username', devKeys.length >= 1 && devKeys.every((k) => /^DEV_[0-9a-f]{24}$/.test(k) && !PEOPLE.some((p) => p.n && (k.includes(String(idGov(p.n))) || sim.props[k].includes(String(idGov(p.n))) || (p.user && sim.props[k].includes(p.user))))), devKeys);
sim.cache.clear();
check('the script cache is emptied: the device in use is still the one in use (the state is kept in a property too)', ping(D1).ok && me(D1).ok && thana().wait === true);
sim.advance(11000); ping(D1);
// it is not known when the device in use last asked (the cache lost it): it is taken to have asked just now
[...sim.cache.keys()].filter((k) => k.startsWith('ds:')).forEach((k) => sim.cache.delete(k));
B = thana();
check('when the last question of the device in use is not known, the new device waits its 30 seconds rather than walking in', B.wait === true && (sim.advance(9000), wait(B).wait === true) && (sim.advance(9000), wait(B).wait === true) && (sim.advance(9000), wait(B).wait === true) && (sim.advance(3500), !!wait(B).session) && code(ping(D1)) === 'taken');
D1 = login('thana_t', PW.thana, 3).session;
const nDev = Object.keys(sim.props).filter((k) => k.startsWith('DEV_')).length;
check('signing out removes what was kept for that account', post('logout', { session: D1 }).ok && Object.keys(sim.props).filter((k) => k.startsWith('DEV_')).length === nDev - 1);
// logins that simply ran out, without a sign-out, are cleared away later
const stale = login('krit_s', PW.krit, 1).session, kStale = 'DEV_' + inside(stale).i;
sim.advance(61 * 60000); sim.cache.delete('sweep');
check('what was kept for a login that ran out long ago is thrown away at a later login', kStale in sim.props && !!login('thana_t', PW.thana, 3).session && !(kStale in sim.props));

/* ---------- backup (ข้อ 1.13) ---------- */
S = login('chan_t', PW.chan, 8).session;
const tabs = () => sim.tabs(BDB), names = () => tabs().map((t) => t.name), tab = (n) => tabs().find((t) => t.name === n);
const J = (v) => JSON.stringify(v), main = () => sim.sheet(DB, 'DATABASE LOGIN'), filled = (rows) => rows.filter((r) => (r || []).some((c) => c !== '' && c !== undefined)).length;
const same = (n) => !!tab(n) && J(tab(n).rows) === J(main().slice(0, tab(n).rows.length)) && filled(main().slice(tab(n).rows.length)) === 0;
const guarded = (t) => !!t.prot && t.prot.warningOnly === false && t.prot.domain === false && J(t.prot.editors) === J(['owner']);
const logsEqual = () => J(sim.sheet(BLOG)) === J(sim.sheet(LOG));
const logsEqualTail = () => J(sim.sheet(BLOG).slice(-40)) === J(sim.sheet(LOG).slice(-40));      // after rows were deleted from BACKLOG by hand, the ends still match
const events = (session) => list(session).backupEvents;
check('1.13.1 the backup of LOGIN DATABASE has a tab named after today, a copy of the whole DATABASE LOGIN tab', role(S, 'krit_s', { role: 'Viewer' }).ok && same(sim.today()), names());
check('1.13.1.1 that tab is exactly as large as the data: no empty rows or columns left over', tab(sim.today()).maxRows === tab(sim.today()).rows.length && tab(sim.today()).maxCols === 16 && filled(tab(sim.today()).rows.slice(-1)) === 1, [tab(sim.today()).maxRows, tab(sim.today()).maxCols]);
check('the LINK TOKEN tab is not backed up', !names().includes('LINK TOKEN') && !J(tabs().map((t) => t.rows)).includes('sha256:'));
check('1.13.2 the backup of BACKLOG has every row of BACKLOG, the ones written before the backup existed included', logsEqual() && sim.sheet(BLOG).length > 40, [sim.sheet(BLOG).length, sim.sheet(LOG).length]);
check('1.13.3 every tab of both backup files has Protect: the owner only, not a warning; the tab that was there before the system too', tabs().length >= 2 && names().includes('Sheet1') && tabs().every(guarded) && sim.tabs(BLOG).every(guarded), tabs().map((t) => [t.name, t.prot]));
check('…and the main files are left without Protect: the system only protects the backups', sim.tabs(DB).every((t) => !t.prot) && sim.tabs(LOG).every((t) => !t.prot));
const idBefore = tab(sim.today()).id, nTabs = tabs().length;
check('a second change on the same day replaces that day\'s tab: still one tab for the day, the newest copy, protected at once', role(S, 'krit_s', { role: 'Editor' }).ok && tabs().length === nTabs && same(sim.today()) && tab(sim.today()).id !== idBefore && guarded(tab(sim.today())) && logsEqual());
const gB = link(S, 'somchai_t', { role: 'Viewer' }); raws.push(gB.token);
check('a user sets a password with no administrator around: the backup has the new Salt and hash', use(gB.token, 'Backup-Check-Pass-10').ok && same(sim.today()) && J(tab(sim.today()).rows).includes(cell('somchai_t', 13)) && logsEqual());
// the next day
const day1 = sim.today(), snap = J(tab(day1).rows);
sim.advance(24 * 3600000); S = login('chan_t', PW.chan, 8).session;
check('the next day a change makes a new tab; yesterday\'s tab is left exactly as it was', role(S, 'krit_s', { role: 'Viewer' }).ok && sim.today() !== day1 && same(sim.today()) && J(tab(day1).rows) === snap && !same(day1) && tabs().every(guarded), names());
// 60 days of daily tabs, then the last tab of each month
const shift = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10), now0 = sim.today(), ym = (k) => { const d = new Date(Date.UTC(+now0.slice(0, 4), +now0.slice(5, 7) - 1 - k, 1)); return d.toISOString().slice(0, 7); };
const oldDays = [ym(5) + '-03', ym(5) + '-17', ym(5) + '-28', ym(4) + '-10', ym(4) + '-20', shift(now0, -61), shift(now0, -60), shift(now0, -59), shift(now0, -10)];
const others = ['notes', '2026-13-45', '2026-1-5', 'Copy of DATABASE LOGIN', '20260101'];
oldDays.concat(others).forEach((n) => sim.addTab(BDB, n));
const all = names().filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n) && !isNaN(Date.parse(n + 'T00:00:00Z')) && new Date(n + 'T00:00:00Z').toISOString().slice(0, 10) === n).sort(), cut = shift(now0, -60);
const expectKept = all.filter((n) => n >= cut || all.filter((m) => m.slice(0, 7) === n.slice(0, 7)).pop() === n);
const evBefore = events(S).length;
check('1.13.1.2 daily tabs older than 60 days are deleted at the next backup, except the last tab of each month', role(S, 'krit_s', { role: 'Editor' }).ok && J(names().filter((n) => all.includes(n)).sort()) === J(expectKept) && names().includes(ym(5) + '-28') && !names().includes(ym(5) + '-03') && !names().includes(ym(5) + '-17') && names().includes(ym(4) + '-20') && !names().includes(ym(4) + '-10') && names().includes(shift(now0, -60)) && names().includes(shift(now0, -59)) && names().includes(day1), [names(), expectKept]);
check('1.13.1.3 a tab whose name is not a date is never deleted', others.every((n) => names().includes(n)) && names().includes('Sheet1'));
check('1.13.3.3 tabs the system had not protected before are protected without any report', tabs().every(guarded) && events(S).length === evBefore, events(S));
// Protect is taken off by someone who can sign in as the owner of the backup files
tab(sim.today()).prot = null; sim.tabs(BLOG)[0].prot.warningOnly = true;
const nLog = log().length;
check('1.13.3.4 Protect is taken off one tab and turned into a warning on another: the next backup puts both back', role(S, 'krit_s', { role: 'Viewer' }).ok && tabs().every(guarded) && sim.tabs(BLOG).every(guarded));
const evRows = log().slice(nLog).filter((r) => r[1] === 'BACKUP');
check('1.13.7.1 BACKLOG has a row for each: BACKUP / PROTECT_RESTORED, no person, the file and the tab in the note', evRows.length === 2 && evRows.every((r) => r[2] === 'PROTECT_RESTORED' && r[3] === '' && r[4] === '' && r[5] === '' && r[10] === '' && /ไม่มี Protect sheet จึงตั้ง Protect ใหม่แล้ว/.test(r[13])) && evRows.some((r) => r[13].includes(sim.today()) && r[13].includes('BACKUP LOGIN DATABASE')) && evRows.some((r) => r[13].includes('Sheet1') && r[13].includes('BACKUP BACKLOG')) && logsEqual(), evRows);
const ev1 = events(S);
check('1.13.7.2 the Admin page gets the list: when, what, in words; nothing else', ev1.length === 2 && ev1.every((e) => J(Object.keys(e).sort()) === J(['at', 'event', 'text']) && e.event === 'PROTECT_RESTORED' && typeof e.at === 'number') && !J(ev1).includes(BDB) && !J(ev1).includes(BLOG), ev1);
const W2 = login('weera_t', PW.weera, 6).session;
check('…every administrator sees it, whoever was signed in when it happened; others never do', J(events(W2)) === J(ev1) && code(list(login('krit_s', PW.krit, 1).session)) === 'forbidden');
check('…only the main administrator can acknowledge', code(post('admin.backupAck', { session: W2 })) === 'forbidden' && /เฉพาะ chan_t/.test(post('admin.backupAck', { session: W2 }).error.message) && events(S).length === 2);
tab(sim.today()).prot = null;
check('1.13.7.4 unacknowledged events stop nothing: the system goes on saving; 1.13.7.5 a new event joins the same list', role(S, 'krit_s', { role: 'Editor' }).ok && cell('krit_s', 10) === 'Editor' && events(S).length === 3 && events(S).every((e, i, a) => !i || a[i - 1].at <= e.at) && !!login('krit_s', PW.krit, 1).session);
const ack = post('admin.backupAck', { session: S });
check('1.13.7.3 the main administrator acknowledges all of them at once; BACKLOG says who and when', ack.ok && ack.acknowledged === 3 && events(S).length === 0 && events(W2).length === 0 && lastLog()[1] === 'BACKUP' && lastLog()[2] === 'BACKUP_ACKNOWLEDGED' && lastLog()[10] === 'chan_t' && /3 เหตุการณ์/.test(lastLog()[13]) && isD(lastLog()[0]) && logsEqual(), [ack, lastLog()]);
check('…with nothing to acknowledge there is nothing to do', code(post('admin.backupAck', { session: S })) === 'no_change');
// a backup that cannot be made
sim.files[BDB].gone = true;
const f1 = role(S, 'krit_s', { role: 'Viewer' });
check('1.13.6 the backup of LOGIN DATABASE cannot be made: the change itself is saved all the same', f1.ok && cell('krit_s', 10) === 'Viewer' && log().some((r) => r[2] === 'ROLE_CHANGED' && r[5] === 'krit_s' && r[8] === 'Viewer'), f1);
check('…BACKLOG and the Admin page say so, in plain words without the file id', lastLog()[1] === 'BACKUP' && lastLog()[2] === 'BACKUP_FAILED' && /Backup ไม่สำเร็จ: ไฟล์ BACKUP LOGIN DATABASE/.test(lastLog()[13]) && !lastLog()[13].includes(BDB) && events(S).length === 1 && events(S)[0].event === 'BACKUP_FAILED' && logsEqual(), lastLog());
sim.files[BDB].gone = false;
check('…once the file is back, the next change brings the backup up to date', role(S, 'krit_s', { role: 'Editor' }).ok && same(sim.today()) && tabs().every(guarded) && events(S).length === 1);
sim.files[BLOG].readOnly = true;
const f2 = role(S, 'krit_s', { role: 'Viewer' }), behind = sim.sheet(LOG).length - sim.sheet(BLOG).length;
check('the backup of BACKLOG cannot be written: the change and its BACKLOG rows are saved, the failure is reported once', f2.ok && cell('krit_s', 10) === 'Viewer' && behind === 2 && lastLog()[2] === 'BACKUP_FAILED' && /BACKUP BACKLOG/.test(lastLog()[13]) && same(sim.today()) && events(S).length === 2, [f2, behind, lastLog()]);
sim.files[BLOG].readOnly = false;
check('…once it can be written again, the rows it missed are added at the next change', role(S, 'krit_s', { role: 'Editor' }).ok && logsEqual() && post('admin.backupAck', { session: S }).acknowledged === 2 && logsEqual());
// BACKLOG loses rows by hand: the backup keeps what it has and still gets every new row
const nBk = sim.sheet(BLOG).length; sim.sheet(LOG).splice(5, 6);
check('rows are deleted from BACKLOG by hand: the backup keeps them, and still gets the rows of the next change', role(S, 'krit_s', { role: 'Viewer' }).ok && sim.sheet(BLOG).length === nBk + 1 && sim.sheet(LOG).length === nBk - 6 + 1 && J(sim.sheet(BLOG).slice(-1)) === J(sim.sheet(LOG).slice(-1)) && events(S).length === 0, [sim.sheet(BLOG).length, sim.sheet(LOG).length, nBk]);
sim.tabs(BLOG)[0].maxRows = sim.sheet(BLOG).length;
check('the backup of BACKLOG has used every row of its sheet: rows are added to the sheet and the backup goes on', role(S, 'krit_s', { role: 'Editor' }).ok && sim.sheet(BLOG).length === nBk + 2 && sim.tabs(BLOG)[0].maxRows === nBk + 2 && events(S).length === 0);
// a formula in the main tab that looks at another tab
const fRow = rowOf(sim, 'krit_s').at; sim.tabs(DB)[0].formulas = { [fRow + ',16']: '=OtherTab!A1', [(fRow + 1) + ',16']: '=OtherTab!A2' };
rowOf(sim, 'krit_s').cells[15] = 'จากสูตร 1'; main()[fRow][15] = 'จากสูตร 2';
check('a cell with a formula that looks at another tab: the backup has the value the original shows, not a broken reference', role(S, 'krit_s', { role: 'Viewer' }).ok && same(sim.today()) && tab(sim.today()).rows[fRow - 1][15] === 'จากสูตร 1' && tab(sim.today()).rows[fRow][15] === 'จากสูตร 2' && !J(tab(sim.today()).rows).includes('#REF!'));
delete sim.tabs(DB)[0].formulas;
// many failures in a row: the list for the Admin page stays within what a script property can hold
sim.files[BDB].gone = true; const nBefore = log().filter((r) => r[2] === 'BACKUP_FAILED').length;
for (let i = 0; i < 60; i++) role(S, 'krit_s', { role: i % 2 ? 'Viewer' : 'Editor' });
sim.files[BDB].gone = false;
check('60 failed backups in a row: every one is in BACKLOG, the list for the Admin page keeps the newest and stays under 9 KB', log().filter((r) => r[2] === 'BACKUP_FAILED').length === nBefore + 60 && events(S).length >= 20 && events(S).length <= 50 && Buffer.byteLength(sim.props.BK_EVENTS, 'utf8') < 9000 && events(S).every((e, i, a) => !i || a[i - 1].at <= e.at), [events(S).length, Buffer.byteLength(sim.props.BK_EVENTS, 'utf8')]);
check('…and one acknowledgement clears them', post('admin.backupAck', { session: S }).ok && events(S).length === 0 && logsEqualTail());
check('the back end logged the failures for the owner, and nothing else', sim.logs.filter((l) => l.startsWith('console.error')).length === 62 && sim.logs.filter((l) => l.startsWith('console.error')).every((l) => /backup of BACKUP (LOGIN DATABASE|BACKLOG) failed/.test(l)), sim.logs.filter((l) => l.startsWith('console.error')));
sim.logs.splice(0, sim.logs.length, ...sim.logs.filter((l) => !l.startsWith('console.error')));

/* ---------- what is left in the sheets ---------- */
const everything = JSON.stringify([sim.sheet(DB, 'DATABASE LOGIN'), sim.sheet(DB, 'LINK TOKEN'), sim.sheet(LOG), sim.tabs(BDB).map((t) => t.rows), sim.tabs(BLOG).map((t) => t.rows), Object.keys(sim.props).filter((k) => k !== 'SECRET').map((k) => [k, sim.props[k]])]);
check('no password is anywhere in the sheets, the backup files or the script properties', !Object.values(PW).concat(['Text-Birth-Pass-08', 'Some-Password-07']).some((p) => everything.includes(p)));
check('no one-time token is anywhere in the sheets, the backup files or the script properties', raws.length >= 12 && raws.every((t) => t && !everything.includes(t)), raws.length);
check('nothing the back end wrote was taken for a formula or a number', !everything.includes('#NAME?') && sim.sheet(DB, 'DATABASE LOGIN').every((r) => text(r[12]) && text(r[13])) && tokens().every((r) => typeof r[0] === 'string' && typeof r[1] === 'string'));
check('BACKLOG rows all have 14 cells, a time, an action and an event', log().every((r) => r.length === 14 && isD(r[0]) && ['CREATE', 'RESET', 'CHANGE_ROLE', 'CHANGE_USERNAME', 'BACKUP'].includes(r[1]) && typeof r[2] === 'string'), log().find((r) => r.length !== 14));
check('the back end logged no unexpected error', !sim.logs.some((l) => l.startsWith('console.error')), sim.logs.filter((l) => l.startsWith('console.error')));
rowOf(sim, 'phum_s').cells[13] = 'pbkdf2-sha256$5000$zz';
check('a damaged hash cell: that account cannot log in, nothing breaks', code(login('phum_s', PW.phum2, 5)) === 'login_failed');

/* ---------- over HTTP, the way a browser reaches it ---------- */
const g = await (await fetch(sim.backendUrl)).json();
check('GET /exec answers through a redirect', g.ok && g.ready === true && g.service === 'eadmin602', g);
const p = await (await fetch(sim.backendUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ v: 1, op: 'info' }) })).json();
check('POST /exec as text/plain answers through a redirect', p.ok && p.sessionMinutes === 60, p);
sim.close();
console.log(bad.length ? bad.length + ' check(s) FAILED' : 'all checks passed');
console.log('errors:', JSON.stringify(bad));
process.exit(bad.length ? 1 : 0);
