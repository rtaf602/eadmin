// ใช้ร่วมกันทั้งสามหน้า: การเรียกระบบหลังบ้าน การจำว่าเข้าสู่ระบบอยู่ การเฝ้าดูการ Login ที่ค้างอยู่ และตัวเลือกวันที่แบบ พ.ศ.
// หน้าเว็บนี้ไม่ตัดสินสิทธิ์เอง ทุกคำขอถูกตรวจซ้ำที่ระบบหลังบ้าน (backend/Code.gs)
window.App = (() => {
  'use strict';
  const BACKEND = String((window.EADMIN_CONFIG || {}).backendUrl || '').trim();
  const KEY = 'eadmin602:session', FLASH = 'eadmin602:flash', BEAT = 'eadmin602:beat', TAKE = 'eadmin602:take', SKEW = 'eadmin602:skew', REFUSE = 'eadmin602:refusing', TIMEOUT = 60000;
  const MON = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const MON_S = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const TEXT = {
    timeout: 'หมดเวลาใช้งาน ให้เข้าสู่ระบบใหม่',
    taken: 'บัญชีของคุณถูกออกจากระบบ เพราะมีการ Login จากเครื่องอื่น หากไม่ใช่คุณ ให้ติดต่อ Admin เพื่อ Reset Password',
    kept: 'คุณไม่อนุญาตการ Login จากเครื่องอื่น และใช้งานต่อได้ หากไม่ใช่คุณที่ Login ให้ติดต่อ Admin เพื่อ Reset Password',
  };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- the session: one for the whole browser (ข้อ 1.11) ----------
     It is kept where every tab of this browser reads it, so one browser holds one account: a login or a sign-out in
     one tab is the same in all of them. A private window or another browser profile keeps its own. */
  const mem = {};
  // where the browser refuses to keep anything, the login lives in this tab only and is gone when the page is left
  const kept = (() => { try { localStorage.setItem('eadmin602:try', '1'); localStorage.removeItem('eadmin602:try'); return true; } catch (e) { return false; } })();
  const box = {
    get(k) { if (!kept) return k in mem ? mem[k] : null; try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { if (!kept) { mem[k] = v; return; } try { localStorage.setItem(k, v); } catch (e) { /* not kept */ } },
    del(k) { if (!kept) { delete mem[k]; return; } try { localStorage.removeItem(k); } catch (e) { /* nothing kept */ } },
  };
  const json = (k) => { try { return JSON.parse(box.get(k) || 'null'); } catch (e) { return null; } };
  // How far this computer's clock is from the back end's. It is kept with the login, so that a page that has just been
  // opened judges "is the hour over" by the back end's clock too, not by a computer clock that may be wrong.
  let skew = Number(box.get(SKEW)) || 0;
  const now = () => Date.now() + skew;                                   // the back end's clock
  function setSkew(serverNow) { const v = serverNow - Date.now(); if (Math.abs(v - skew) > 500) box.set(SKEW, String(v)); skew = v; }
  const stored = () => { const s = json(KEY); return s && s.token && s.user ? s : null; };
  function session() { const s = stored(); return s && s.exp > now() ? s : null; }
  function signIn(r) { box.set(KEY, JSON.stringify({ token: r.session, exp: r.expiresAt, user: r.user })); box.del(TAKE); box.del(FLASH); box.set(BEAT, String(Date.now())); }
  function setUser(user, exp) { const s = stored(); if (!s) return; s.user = user; if (exp) s.exp = exp; box.set(KEY, JSON.stringify(s)); }
  // the message is kept a short while, so that every tab that falls back to the login page can show the reason
  function flash() { const f = json(FLASH); return f && Date.now() - f.t < 20000 ? String(f.m || '') : ''; }
  // tell the back end that this login is over, without waiting for the answer (the page is about to change)
  function parting(body) {
    if (!BACKEND) return;
    try { fetch(BACKEND, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ v: 1 }, body)), keepalive: true, redirect: 'follow' }).catch(() => {}); } catch (e) { /* the back end notices by itself a little later */ }
  }
  function farewell(token) { if (token) parting({ op: 'logout', session: token }); }
  const giveUp = (ticket) => { if (ticket) parting({ op: 'login.cancel', ticket }); };      // a device that was waiting for the account stops waiting
  // out of the system in this browser, every tab. tell: also free the account at the back end (not when it already knows)
  function leave(message, tell) {
    const s = stored();
    if (s && tell) farewell(s.token);
    box.del(KEY); box.del(TAKE);
    if (message) box.set(FLASH, JSON.stringify({ m: message, t: Date.now() })); else box.del(FLASH);
    location.replace('index.html');
  }
  const signOut = (message) => leave(message || '', true);

  /* ---------- one request to the back end ---------- */
  const OPEN = { 'info': 1, 'login': 1, 'login.wait': 1, 'login.cancel': 1, 'link.info': 1, 'link.use': 1 };      // sent without a session
  async function api(op, data) {
    if (!BACKEND) throw { code: 'no_backend', message: 'ยังไม่ได้ใส่ที่อยู่ระบบหลังบ้านในไฟล์ assets/config.js' };
    const s = session(), body = JSON.stringify(Object.assign({ v: 1, op }, s && !OPEN[op] ? { session: s.token } : {}, data || {}));
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
    let r;
    try {
      // text/plain keeps this a "simple" request: Apps Script web apps cannot answer a CORS preflight
      const res = await fetch(BACKEND, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow', signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      r = await res.json();
    } catch (e) { throw { code: 'offline', message: 'ติดต่อระบบไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง' }; }
    finally { clearTimeout(timer); }
    if (r && r.ok) {
      if (typeof r.now === 'number') setSkew(r.now);
      // another device wants this account (ข้อ 1.12.1): every answer to a signed-in request says so while it is waiting
      if (s && !OPEN[op] && op !== 'logout') { if (r.take) box.set(TAKE, JSON.stringify(r.take)); else box.del(TAKE); drawTake(); }
      return r;
    }
    const er = (r && r.error) || { code: 'upstream_error', message: 'ระบบตอบกลับผิดรูปแบบ ลองอีกครั้ง' };
    // the login is over (its hour ran out, the password changed, access ended, another device has the account):
    // back to the login page with the reason
    if ((er.code === 'auth' || er.code === 'expired' || er.code === 'taken') && !OPEN[op]) { leave(er.message, false); return new Promise(() => {}); }
    throw er;
  }

  /* ---------- watching a login that is open (ข้อ 1.10, 1.11, 1.12) ----------
     Every second: is the hour nearly over, or over; is it time to ask the back end again; is another device waiting.
     The tabs of one browser share the asking: whichever tab is due first asks, the others see the result. */
  let cfg = { pollMs: 10000, warnMs: 300000 }, onChange = null, mine = '', asking = false, asked = 0, verdict = false, verdictAt = 0, refusing = false, note = '', noteUntil = 0;
  function bar() {
    let el = $('app-bar');
    if (!el) {
      el = document.createElement('div'); el.id = 'app-bar';
      el.innerHTML = '<p class="note warn" id="app-warn" role="status" hidden></p>'
        + '<div class="note bad" id="app-take" role="alert" hidden><p id="app-take-t"></p><div class="actions"><button type="button" class="btn" id="app-deny">ไม่อนุญาต ฉันกำลังใช้งานอยู่</button></div></div>'
        + '<p class="note ok" id="app-note" role="status" hidden></p>';
      document.body.insertBefore(el, document.body.firstChild);
      $('app-deny').addEventListener('click', refuse);
    }
    return el;
  }
  function drawTake() {
    if (!onChange) return;
    bar();
    const t = session() ? json(TAKE) : null, left = t ? Math.ceil((t.until - now()) / 1000) : 0;
    $('app-take').hidden = !t;
    if (t) $('app-take-t').innerHTML = 'มีผู้ Login เข้าใช้งานบัญชีนี้จากเครื่องอื่น บัญชีของคุณจะถูกออกจากระบบอัตโนมัติใน <b id="app-take-left">' + Math.max(0, left) + '</b> วินาที หากไม่ใช่คุณ ให้กดไม่อนุญาต แล้วติดต่อ Admin';
    // a refusal is on its way, from this tab or from another tab of this browser
    const onItsWay = refusing || Date.now() - (Number(box.get(REFUSE)) || 0) < 8000;
    $('app-deny').disabled = onItsWay;
    $('app-note').hidden = !(note && Date.now() < noteUntil); $('app-note').textContent = note;
    // the 10 seconds are over and nobody refused: this device leaves, so the new one gets in. The back end has the
    // last word: it is asked once more first, and this device only leaves when the same request is still waiting and
    // its time is up there too (the other device may have given up, or asked anew).
    if (t && left <= 0 && !verdict && !onItsWay && Date.now() - verdictAt > 3000) {
      verdict = true; verdictAt = Date.now();
      api('ping').then((r) => { verdict = false; if (r.take && r.take.rid === t.rid && r.take.until <= r.now && Date.now() - (Number(box.get(REFUSE)) || 0) >= 8000) leave(TEXT.taken, true); }, () => { verdict = false; });
    }
  }
  async function refuse() {
    const t = json(TAKE); if (!t || refusing) return;
    refusing = true; box.set(REFUSE, String(Date.now())); drawTake();
    try {
      const r = await api('session.deny', { rid: t.rid });
      // denied false: that request was no longer the one waiting; if another is, the next answer brings its notice
      if (r.denied) { box.del(TAKE); note = TEXT.kept; noteUntil = Date.now() + 20000; }
    } catch (e) { /* asked again at the next turn */ }
    refusing = false; box.del(REFUSE); drawTake();
  }
  function tick() {
    const raw = stored();
    if (raw && !(raw.exp > now())) { leave(TEXT.timeout, false); return; }                          // ข้อ 1.10.2
    const s = raw, token = s ? s.token : '';
    if (token !== mine) { const was = mine; mine = token; if (onChange) onChange(s, was); }                       // another tab signed out, or signed in as someone else
    bar();
    if (!s) { ['app-warn', 'app-take', 'app-note'].forEach((id) => { $(id).hidden = true; }); return; }           // nobody is signed in: nothing to say
    const left = s.exp - now();
    $('app-warn').hidden = !(left <= cfg.warnMs);                                                    // ข้อ 1.10.1
    if (left <= cfg.warnMs) $('app-warn').textContent = 'ใกล้หมดเวลาใช้งาน ให้บันทึกงานก่อน เมื่อหมดเวลาต้องเข้าสู่ระบบใหม่ (เหลือ ' + mmss(left) + ')';
    drawTake();
    // ข้อ 1.12.4: ask the back end every 10 seconds. A tab in the background lets the one in front go first.
    const due = cfg.pollMs + (document.hidden ? 3000 : 0);
    if (!asking && BACKEND && Date.now() - (Number(box.get(BEAT)) || 0) >= due - 300) {
      box.set(BEAT, String(Date.now())); asking = true;
      // most turns only ask about devices; every sixth also reads the row again (Role, end date, password)
      api(++asked % 6 === 0 ? 'me' : 'ping').then((r) => { if (r.user) setUser(r.user, r.expiresAt); }, () => {}).then(() => { asking = false; });
    }
  }
  // call once on a page that needs a login. fn(session or null, token before) runs when the login of this browser changes.
  function watch(fn) {
    onChange = fn || (() => {});
    const s = session(); mine = s ? s.token : '';
    window.addEventListener('storage', (e) => { if (e.key === SKEW) skew = Number(e.newValue) || 0; if (e.key === null || e.key === KEY || e.key === TAKE || e.key === REFUSE) tick(); });
    if (BACKEND) api('info').then((i) => { cfg = { pollMs: (i.pollSeconds || 10) * 1000, warnMs: (i.warnMinutes || 5) * 60000 }; }, () => {});
    tick(); setInterval(tick, 1000);
  }

  /* ---------- dates: shown in the Buddhist era, sent as yyyy-mm-dd ---------- */
  const fmtD = (iso) => { if (!iso) return ''; const p = iso.split('-').map(Number); return p[2] + ' ' + MON_S[p[1] - 1] + ' ' + (p[0] + 543); };
  const fmtT = (ms) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
  const fmtDT = (ms) => { const p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; }); return fmtD(p.year + '-' + p.month + '-' + p.day) + ' ' + fmtT(ms) + ' น.'; };
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const beYear = () => +new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric' }).format(new Date()) + 543;
  function years(from, to) { const o = []; for (let y = from; from <= to ? y <= to : y >= to; y += from <= to ? 1 : -1) o.push(y); return o; }
  // three selects (วัน / เดือน / ปี พ.ศ.) inside the element with this id
  function buildDP(id, yearList) {
    const opt = (v, t) => '<option value="' + v + '">' + t + '</option>';
    let d = opt('', 'วัน'), m = opt('', 'เดือน'), y = opt('', 'ปี พ.ศ.');
    for (let i = 1; i <= 31; i++) d += opt(i, i);
    MON.forEach((n, i) => { m += opt(i + 1, n); });
    yearList.forEach((v) => { y += opt(v, v); });
    $(id).innerHTML = '<select id="' + id + '-d" aria-label="วัน">' + d + '</select><select id="' + id + '-m" aria-label="เดือน">' + m + '</select><select id="' + id + '-y" aria-label="ปี พ.ศ.">' + y + '</select>';
  }
  // { iso, partial }: iso is '' when nothing is chosen; partial when only some parts are, or the day does not exist
  function dp(id) {
    const d = +$(id + '-d').value, m = +$(id + '-m').value, y = +$(id + '-y').value;
    if (!d && !m && !y) return { iso: '', partial: false };
    if (!d || !m || !y) return { iso: '', partial: true };
    const ce = y - 543, t = new Date(Date.UTC(ce, m - 1, d));
    if (t.getUTCMonth() !== m - 1) return { iso: '', partial: true };
    return { iso: ce + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'), partial: false };
  }
  function setDP(id, iso) {
    const p = iso ? iso.split('-').map(Number) : [0, 0, 0], ysel = $(id + '-y'), be = p[0] ? String(p[0] + 543) : '';
    if (be && !Array.from(ysel.options).some((o) => o.value === be)) ysel.insertAdjacentHTML('beforeend', '<option value="' + be + '">' + be + '</option>');
    $(id + '-d').value = p[2] || ''; $(id + '-m').value = p[1] || ''; ysel.value = be;
  }
  function disableDP(id, off) { ['-d', '-m', '-y'].forEach((s) => { $(id + s).disabled = off; }); }

  return { $, esc, api, session, signIn, setUser, signOut, farewell, giveUp, flash, watch, now, fmtD, fmtT, fmtDT, mmss, beYear, years, buildDP, dp, setDP, disableDP, hasBackend: !!BACKEND };
})();
