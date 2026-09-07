# LTMH WealthX AUM & AUA Dashboard

Dashboard กลางสำหรับติดตาม AUM รายกองทุน, AUA ทางการของ WealthX และ
projection ที่ผูกกับ WealthX SeriesX โดยตรง ข้อมูลออนไลน์เก็บใน Sites D1
และหลักฐานเอกสาร AUA เก็บใน Sites R2

หน้าเว็บใหม่: <https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site>

หน้า GitHub Pages เดิมเป็น snapshot เก่าและไม่มีการ deploy รุ่นนี้ทับ:
<https://benzkanin41-alt.github.io/aum-dashboard-wealthx-mega/>

## Local Run

```powershell
npm start
```

แล้วเปิด `http://localhost:12014`

Local server ใช้ UI เดียวกับ Sites และ proxy API ไปฐานข้อมูลกลาง เมื่อออนไลน์ไม่ได้
จะเปิด cache ล่าสุดใน `data/dashboard-cache.json` พร้อมระบุสถานะ offline

## Local Auto Run / Auto Refresh

เครื่องนี้มี helper scripts สำหรับเปิด dashboard:

- `scripts/start-local-server.ps1` เปิด server ตาม registry ID `aum-dashboard`
- `scripts/open-local-dashboard.ps1` ตรวจ readiness ด้วย `appId` แล้วเปิด browser
- shortcut: `C:\Users\USER\Desktop\DASHBOARD\Dashboard LTHM wealthx AUM.lnk`

ปุ่ม Update ของ Local เรียกงาน refresh ชุดเดียวกับเว็บออนไลน์ จึงได้ `dataVersion`
และ `modelVersion` เดียวกัน

## Static Export

```powershell
npm run import:talis:history
npm run export:share
```

ไฟล์ static HTML จะถูกสร้างที่ `outputs/aum_dashboard_share.html`

## Scheduled Refresh

GitHub Actions `.github/workflows/pages.yml` เรียก Sites API วันละครั้ง โดยไม่ deploy
ไฟล์ไป GitHub Pages เดิม

- Manual refresh: กด `Run workflow`
- Auto refresh: ทุกวันเวลา 09:00 Asia/Bangkok (`02:00 UTC`); เวลาเริ่มจริงอาจช้าตามคิว GitHub

## Validation

```powershell
npm test
npm run typecheck
npm run build
```

กฎข้อมูลอยู่ที่ `docs/data-contract.md` และกฎ/ชุดทดสอบโมเดลอยู่ที่
`docs/model-validation.md`

## Notes

- Projection ใช้เฉพาะ bucket `wealthx_other` (WealthX SeriesX) ไม่รวม
  `mega30` และ `other_funds`
- Projection เป็นค่าประมาณจากข้อมูลย้อนหลัง ไม่ใช่ข้อมูลที่บริษัทรับรอง
