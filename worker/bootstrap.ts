import { getMetadata } from "./db.ts";
import type { Env } from "./types.ts";

export async function getBootstrapStatus(env: Env) {
  const complete = await getMetadata(env, "bootstrap_complete") === "true";
  return { complete, phase: complete ? "complete" : "restore_required", cursor: 0, total: 0,
    builtAt: await getMetadata(env, "bootstrap_completed_at") };
}

export async function advanceBootstrap(env: Env) {
  const status = await getBootstrapStatus(env);
  if (!status.complete) throw new Error("ฐานข้อมูลกลางต้องกู้คืนจากสำเนาที่ตรวจสอบแล้ว ไม่รองรับการ bootstrap ผ่านเว็บสาธารณะ");
  return status;
}
