import fs from "node:fs/promises";
import { CACHE_DIR, cachePath } from "./local-paths.js";
const currentPath = cachePath("dashboard-cache.json");
const previousPath = `${currentPath}.previous`;
let queue = Promise.resolve();

export function validateDashboard(payload) {
  if (!payload || payload.appId !== "aum-dashboard" || !payload.dataVersion || !Array.isArray(payload.buckets) || !Array.isArray(payload.funds)) throw new Error("ข้อมูล cache ไม่ใช่ dashboard รุ่นที่รองรับ");
}

export async function readBestCache() {
  for (const file of [currentPath, previousPath]) {
    try { const value=JSON.parse(await fs.readFile(file,"utf8")); validateDashboard(value); return value; } catch {}
  }
  return null;
}

export function writeCacheSafely(payload) {
  validateDashboard(payload);
  const operation = queue.catch(()=>{}).then(async()=>{
    const current = await readBestCache();
    if (current?.dataVersion === payload.dataVersion || (current?.generatedAt && current.generatedAt > payload.generatedAt)) return;
    await fs.mkdir(CACHE_DIR,{recursive:true});
    const temporary = `${currentPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const handle=await fs.open(temporary,"wx");
    try { await handle.writeFile(JSON.stringify(payload)+"\n","utf8"); await handle.sync(); } finally { await handle.close(); }
    // Copy the validated last-good value before a single rename replaces current.
    if (current) await fs.writeFile(previousPath,JSON.stringify(current)+"\n","utf8");
    try { await fs.rename(temporary,currentPath); }
    catch(error) { await fs.rm(temporary,{force:true}); throw error; }
  });
  queue=operation;
  return operation;
}
