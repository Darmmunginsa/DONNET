# ติดตั้งระบบใหม่ด้วย Gmail ส่วนตัว

## 1. สร้างไฟล์สำหรับติดตั้ง

ในโฟลเดอร์ d-on-net-next รัน `npm run check` แล้วใช้ไฟล์ใน dist/ ไม่ต้องอัปโหลด preview server หรือไฟล์ข้อมูลทดลอง

## 2. สร้าง Apps Script

1. เข้าบัญชี Gmail ที่จะเป็นเจ้าของระบบ เปิด https://script.google.com แล้วสร้าง New project ตั้งชื่อ D On Net
2. สร้างไฟล์ script ชื่อ Domain และ Server วางเนื้อหาจาก dist/Domain.gs และ dist/Server.gs
3. สร้างไฟล์ HTML ชื่อ Index, Styles, Client วางเนื้อหาจากไฟล์ชื่อเดียวกันใน dist/
4. Project Settings → เปิด Show appsscript.json manifest file แล้วแทนเนื้อหาด้วย dist/appsscript.json
5. ตรวจ Services มี Google Sheets API (v4, ชื่อ Sheets) ตาม manifest ถ้าใช้ Google Cloud project ของตนเอง ต้องเปิด Sheets API ใน Cloud project นั้นด้วย
6. Project Settings → Script properties เพิ่ม `ADMIN_EMAIL` เป็น Gmail ของผู้ดูแลระบบ ไม่ต้องใส่รหัสผ่าน
7. เลือกฟังก์ชัน `setup_` ใน editor แล้ว Run ด้วยบัญชีเจ้าของ ตรวจสิทธิ์ที่ Google ขอด้วยตนเอง
8. เมื่อสำเร็จ ดู Execution log จะได้ลิงก์ Spreadsheet และโฟลเดอร์ไฟล์ ระบบบันทึก `SPREADSHEET_ID` กับ `ATTACHMENT_FOLDER_ID` ให้เอง

setup\_ ปฏิเสธการรันซ้ำเมื่อมี SPREADSHEET_ID เพื่อไม่สร้างทับ ห้ามลบ property นี้เพื่อแก้ปัญหาโดยไม่ตรวจไฟล์ที่สร้างไว้ก่อน หาก setup หยุดกลางทาง ให้ตรวจ log และไฟล์ที่สร้างไว้ แล้วซ่อมแท็บ/แถวผู้ดูแลแทนการรันซ้ำแบบไม่ตรวจ

**อย่าแชร์ Spreadsheet หรือโฟลเดอร์ไฟล์ให้พนักงานเป็น editor** เพราะสิทธิ์ในเว็บไม่ได้ควบคุมการแก้ Sheet โดยตรง ใช้เว็บแอปเป็นทางเข้าระบบ และเก็บ Sheet/Drive ไว้กับผู้ดูแล

## 3. Deploy เว็บแอป

1. Deploy → New deployment → Web app
2. Execute as: Me (เจ้าของระบบ)
3. Who has access: Anyone with Google account (`ANYONE` ใน manifest)
4. Deploy แล้วเปิด URL ที่ลงท้าย /exec
5. กรอก ADMIN_EMAIL ขอรหัสจากอีเมล แล้วใส่รหัส 8 หลัก
6. ตั้งค่าบริษัท และเพิ่มผู้ใช้จริงกับบทบาท ผู้ดูแลต้องเพิ่มผู้อนุมัติอีกคน เพราะไม่ให้อนุมัติใบเสนอราคาของตนเอง
7. เริ่มเพิ่มลูกค้า ผู้ขาย และสินค้า

OTP ทำให้ผู้ใช้ Gmail ที่ได้รับอนุญาตใช้งานได้โดยไม่ต้องแชร์ฐานข้อมูลให้เขา การเข้าถึงหน้า Google และการยืนยันอีเมลในแอปเป็นคนละชั้น ระบบไม่ใช้ Session.getActiveUser เป็นตัวตนของผู้ใช้ในโหมด execute as owner

ระบบส่งอีเมลเฉพาะเมื่อผู้ใช้กดขอรหัส จำกัด 1 ครั้ง/นาที/อีเมล สูงสุด 80 ครั้ง/วันทั้งแอป และตรวจ MailApp quota ด้วย ถ้า quota บัญชีต่ำกว่าหรือมีงานอื่นใช้ร่วมกัน อาจส่งได้น้อยกว่า 80 ครั้ง รหัสผิด 5 ครั้งต้องขอใหม่ หากใช้หลายคนมากควรเปลี่ยนไปใช้ Google OAuth ที่ตรวจ token ฝั่ง server ก่อนใช้งานจริง

## 4. ทดสอบก่อนใช้จริง

- ใช้ Gmail ต่างบัญชีอย่างน้อยฝ่ายขาย ผู้อนุมัติ และช่าง
- ตรวจว่าคนที่ไม่อยู่ในรายชื่อไม่ได้รับ OTP และอ่านข้อมูลไม่ได้
- ฝ่ายขายสร้างใบเสนอราคา → ผู้อนุมัติอนุมัติ → ฝ่ายขายส่งจัดซื้อและมอบหมายช่าง
- จัดซื้อกรอกราคา เลือกผู้ขาย ออก PO บันทึกจ่าย/ขนส่ง รับของ แล้วตรวจหน้า SalePro
- ช่างต้องเห็นเฉพาะงานตนเอง ไม่เห็นใบเสนอราคา ยอดเงินลูกค้า หรือรายชื่อผู้ใช้ทั้งหมด
- ทดสอบแนบ PDF/ภาพและดาวน์โหลดด้วยบัญชีที่มี/ไม่มีสิทธิ์
- เปิดสองหน้าต่างแก้รายการเดียวกัน ต้องแจ้งข้อมูลเปลี่ยนแล้ว ไม่เขียนทับเงียบ ๆ
- ตรวจตัวอย่างงานพิมพ์และยอดเงินกับรูปแบบเอกสารที่บริษัทต้องการ ก่อนนำออกใช้งาน

นี่เป็น installation acceptance test ที่ยังต้องทำกับบัญชีจริง การทดสอบในเครื่องไม่ได้แทนขั้นตอนนี้

## 5. เก็บโค้ดใน GitHub

สร้าง private repository ใหม่ เช่น d-on-net-next ในบัญชีของพี่ และนำ **เฉพาะโฟลเดอร์ d-on-net-next** ไปเป็น root ของ repo นั้น โดยคงโครงสร้าง .github/workflows/check.yml ที่ root

ไม่ต้องย้ายโฟลเดอร์เก่าทั้งสาม ไม่ต้องอัปโหลดข้อมูลธุรกิจ .preview-\*, token หรือไฟล์ .clasp.json ระบบมี .gitignore ให้แล้ว GitHub Actions จะรัน npm run check ทุก push/PR

repository สำหรับ source คือ https://github.com/Darmmunginsa/DONNET การ deploy ในรุ่นนี้เป็นแบบวางไฟล์จาก dist/ ใน Apps Script; ทุกครั้งที่แก้ต้อง build และสร้าง deployment version ใหม่

## 6. ดูแลระบบ

- สำรอง Spreadsheet และโฟลเดอร์ไฟล์ก่อนเปลี่ยนรุ่น
- อย่าเปลี่ยนหัวตาราง แทรก/ลบคอลัมน์ หรือแก้ข้อมูลธุรกิจใน Sheet ระหว่างมีคนใช้งานเว็บ
- ทุกคำสั่งอ่านตารางแล้วเขียนตารางที่เปลี่ยนในหนึ่ง Sheets batch ภายใต้ ScriptLock เหมาะสำหรับทีมเล็กในรุ่นแรก ต้องวัดขนาดงานจริงก่อนขยาย
- ห้ามใช้ Apps Script สองโปรเจกต์เขียน Spreadsheet เดียวกัน เพราะ ScriptLock ไม่ข้ามโปรเจกต์
- ไฟล์อัปโหลดและการบันทึก Sheet ไม่ใช่ transaction เดียวกัน ถ้าเครือข่ายขาดช่วงอัปโหลด อาจมีไฟล์ส่วนตัวที่ยังไม่ถูกเชื่อมใน Drive ให้ผู้ดูแลตรวจ orphan ก่อนจัดเก็บ ห้ามลบอัตโนมัติเมื่อผล commit ยังไม่ชัดเจน
- ประวัติ Requests ใช้กันรายการซ้ำ อย่าล้างโดยไม่กำหนดช่วง retention และช่วง retry ที่รองรับ

## เอกสารอ้างอิง

- [Apps Script web apps](https://developers.google.com/apps-script/guides/web)
- [รูปแบบสิทธิ์ manifest](https://developers.google.com/apps-script/manifest/web-app-api-executable)
- [Session และข้อจำกัดการอ่านอีเมลผู้ใช้](https://developers.google.com/apps-script/reference/base/session)
- [Google Sheets atomic batch](https://developers.google.com/workspace/sheets/api/guides/batch)
- [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)

## 7. การแจ้งเตือน สำรอง และปรับรุ่น 0.2

OTP และอีเมลธุรกิจใช้ MailApp quota บัญชีเดียวกัน ข้อความในหัวข้อ OTP เรื่องส่งเฉพาะเมื่อขอรหัสหมายถึง OTP; เมื่อเปิด emailEnabled รุ่นนี้ส่งอีเมลธุรกิจผ่านคิวด้วย

1. ตั้ง Script property WEB_APP_URL เป็น URL /exec เพื่อใส่ลิงก์ในอีเมล
2. Run installTriggers_ ด้วยบัญชีเจ้าของ ติดตั้ง runScheduledTasks_ ทุก 15 นาที ไม่สร้าง trigger ซ้ำ
3. ตั้งค่าระบบ → ตั้งค่าการทำงาน เปิดอีเมลและ/หรือสำรองรายวัน
4. ทดสอบอีเมลกับผู้รับทดสอบ รายการ uncertain ต้องตรวจกล่องส่งแล้วก่อนกดลองใหม่
5. ทดสอบสำรองตอนนี้ ตรวจ BackupLog เป็น complete และตรวจโฟลเดอร์ Backups ของเจ้าของ คัดลอกตารางก่อน แล้วสำรองไฟล์ตาม manifest ครั้งละไม่เกิน 10 รายการต่อรอบ

ปรับรุ่นจาก 0.1: ติดตั้ง source ใหม่ Run upgrade_ ก่อน deploy version ใหม่ ฟังก์ชันเพิ่มเฉพาะตาราง/คอลัมน์ท้ายชุด และปฏิเสธหัวตารางที่ไม่ตรง ห้าม Run setup_ ทับฐานเดิม

กู้คืน: หยุด trigger และหยุดผู้ใช้เข้าเว็บชั่วคราว ทำสำเนาไฟล์ Database จากชุดสำรอง ตั้ง SPREADSHEET_ID ไปยังสำเนาที่ตรวจแล้ว หากไฟล์ต้นฉบับใน Drive ยังอยู่จะอ้าง fileId เดิมได้ หากหายต้องแทน Attachments.fileId ด้วย ID ของไฟล์สำรองที่ชื่อขึ้นต้น ID เดิมจาก manifest ตรวจดาวน์โหลดทุกไฟล์ก่อนเปิดใช้ ห้ามใช้สอง Apps Script เขียนฐานเดียวกัน และควรซ้อมกู้คืนกับสำเนาฐานก่อนใช้จริง
