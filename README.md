# ระบบ Login และให้สิทธิ์ผู้ใช้งาน ฝูง.602

ส่วนเข้าสู่ระบบของ "สถานภาพอากาศยาน ฝูง.602": ผู้ใช้ Login ด้วยบัญชีของตัวเอง และ Admin ให้สิทธิ์ผ่านหน้าเว็บ

| ที่อยู่ | คืออะไร |
|---|---|
| `docs/index.html` | หน้าเข้าสู่ระบบ |
| `docs/admin.html` | หน้า Admin: สร้าง Password ครั้งแรก, Reset Password, เปลี่ยน Role, กำหนดวันสิ้นสุดการใช้งาน |
| `docs/set-password.html` | หน้าที่ผู้ใช้ตั้ง Password ของตัวเองจาก One Time Link |
| `docs/assets/config.js` | ที่อยู่ระบบหลังบ้าน (ใส่ตอนติดตั้ง) |
| `backend/Code.gs` | ระบบหลังบ้านบน Google Apps Script อ่านและเขียน Google Sheet ในนามเจ้าของสคริปต์ |
| `test/` | ชุดทดสอบที่รันกับตัวจำลองของ Google |

หน้าเว็บอยู่บน GitHub Pages (โฟลเดอร์ `docs/`) ข้อมูลอยู่ใน Google Sheet สองไฟล์: LOGIN DATABASE และ BACKLOG

**ขั้นตอนติดตั้งอยู่ใน [`SETUP_TH.md`](SETUP_TH.md)**

## ข้อควรรู้

1. **เว็บบน GitHub Pages เป็นสาธารณะ** ทุกคนที่มีลิงก์เปิดหน้าเว็บได้ สิ่งที่กันคนนอกคือการ Login ซึ่งตรวจที่ระบบหลังบ้าน
2. ไฟล์ใน repo นี้ไม่มีลิงก์ Google Sheet ชื่อคน Username หรือรหัสผ่าน ค่าเหล่านี้กรอกในหน้า Apps Script ตอนติดตั้ง และ **ห้ามนำขึ้น repo**
3. Google Sheet ทั้งสองไฟล์ต้องตั้ง Share เป็น Restricted
4. ระบบหลังบ้านทดสอบกับตัวจำลองของ Google แล้ว แต่ยังไม่เคยรันบน Google จริง ให้ทดลองตามคู่มือก่อนใช้งานจริง

## สำหรับผู้พัฒนา

ต้องมี Node 18 ขึ้นไป หน้าเว็บไม่มีขั้นตอน build

    npm install && npx playwright install chromium
    npm test                        # รันทุกชุด
    node test/run_all.mjs auth_api  # เฉพาะระบบหลังบ้าน (ไม่ใช้เบราว์เซอร์)

รายละเอียดทั้งหมดอยู่ใน `CLAUDE.md`
