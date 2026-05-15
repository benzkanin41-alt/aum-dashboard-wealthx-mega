# AUM Dashboard

Dashboard สำหรับ track AUM แยก 2 หมวด:

1. WealthX SeriesX
2. MEGA30+TLUSHD

## Local Run

```powershell
npm start
```

แล้วเปิด `http://localhost:4173`

ไฟล์ `.env.local` ใช้เก็บ SEC API key สำหรับเครื่องนี้ และถูกใส่ไว้ใน `.gitignore`

## Local Auto Run / Auto Refresh

เครื่องนี้มี helper scripts สำหรับให้ dashboard local เปิดเองและ refresh history ทุกวัน:

- `scripts/start-local-server.ps1` เปิด `http://localhost:4173` ถ้ายังไม่มี server ฟังอยู่
- `scripts/refresh-local-history.ps1` ดึง Talis public NAV history ย้อนหลัง 1 ปี และเปิด server หากยังไม่รัน

ตั้งไว้บนเครื่องนี้แล้ว:

- Windows Startup shortcut: เปิด local server เมื่อ login
- Windows Scheduled Task: `AUM Dashboard Daily History Refresh` ทุกวันเวลา 09:00

## Static Export

```powershell
npm run import:talis:history
npm run export:share
```

ไฟล์ static HTML จะถูกสร้างที่ `outputs/aum_dashboard_share.html`

## GitHub Pages

Workflow `.github/workflows/pages.yml` จะ refresh ข้อมูลจาก Talis public NAV และ deploy dashboard ไป GitHub Pages

- Manual refresh: กด `Run workflow`
- Auto refresh: ทุกวันเวลา 09:00 Asia/Bangkok (`02:00 UTC`)

## Notes

- SEC Open API ให้ AUM/NAV ระดับกองทุน/ชนิดหน่วยลงทุน ไม่ใช่ AUA ที่ลูกค้าถือผ่าน WealthX โดยตรง
- หากต้องการ true WealthX AUA ต้องมี data feed ภายใน WealthX หรือ export จาก back office
- ระบบนี้จึงแยก `WealthX SeriesX` ออกจาก `MEGA30+TLUSHD` ตั้งแต่ config เพื่อกันการนับซ้ำ
