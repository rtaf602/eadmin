// ใช้ร่วมกันทั้งสามหน้า: การเรียกระบบหลังบ้าน การจำว่าเข้าสู่ระบบอยู่ และตัวเลือกวันที่แบบ พ.ศ.
// หน้าเว็บนี้ไม่ตัดสินสิทธิ์เอง ทุกคำขอถูกตรวจซ้ำที่ระบบหลังบ้าน (backend/Code.gs)
window.App = (() => {
  'use strict';
  const BACKEND = String((window.EADMIN_CONFIG || {}).backendUrl || '').trim();
  const KEY = 'eadmin602:session', FLASH = 'eadmin602:flash', TIMEOUT = 60000;
  const MON = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const MON_S = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- the session: kept for this browser tab only, gone when the tab is closed ---------- */
  let mem = null, skew = 0;
  const box = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* kept in memory only */ } }, del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* nothing kept */ } } };
  const now = () => Date.now() + skew;                                   // the back end's clock
  function session() {
    if (!mem) { try { mem = JSON.parse(box.get(KEY) || 'null'); } catch (e) { mem = null; } }
    if (mem && !(mem.exp > now())) { mem = null; box.del(KEY); }
    return mem;
  }
  function signIn(r) { mem = { token: r.session, exp: r.expiresAt, user: r.user }; box.set(KEY, JSON.stringify(mem)); }
  function setUser(user, exp) { if (!mem) return; mem.user = user; if (exp) mem.exp = exp; box.set(KEY, JSON.stringify(mem)); }
  function signOut(message) { mem = null; box.del(KEY); if (message) box.set(FLASH, message); location.replace('index.html'); }
  function flash() { const m = box.get(FLASH); if (m) box.del(FLASH); return m || ''; }

  /* ---------- one request to the back end ---------- */
  async function api(op, data) {
    if (!BACKEND) throw { code: 'no_backend', message: 'ยังไม่ได้ใส่ที่อยู่ระบบหลังบ้านในไฟล์ assets/config.js' };
    const s = session(), body = JSON.stringify(Object.assign({ v: 1, op }, s && op !== 'login' ? { session: s.token } : {}, data || {}));
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
    let r;
    try {
      // text/plain keeps this a "simple" request: Apps Script web apps cannot answer a CORS preflight
      const res = await fetch(BACKEND, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow', signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      r = await res.json();
    } catch (e) { throw { code: 'offline', message: 'ติดต่อระบบไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง' }; }
    finally { clearTimeout(timer); }
    if (r && r.ok) { if (typeof r.now === 'number') skew = r.now - Date.now(); return r; }
    const er = (r && r.error) || { code: 'upstream_error', message: 'ระบบตอบกลับผิดรูปแบบ ลองอีกครั้ง' };
    // the session ended, or access ran out: back to the login page with the reason
    if ((er.code === 'auth' || er.code === 'expired') && op !== 'login') { signOut(er.message); return new Promise(() => {}); }
    throw er;
  }

  /* ---------- dates: shown in the Buddhist era, sent as yyyy-mm-dd ---------- */
  const fmtD = (iso) => { if (!iso) return ''; const p = iso.split('-').map(Number); return p[2] + ' ' + MON_S[p[1] - 1] + ' ' + (p[0] + 543); };
  const fmtT = (ms) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
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

  return { $, esc, api, session, signIn, setUser, signOut, flash, now, fmtD, fmtT, mmss, beYear, years, buildDP, dp, setDP, disableDP, hasBackend: !!BACKEND };
})();
