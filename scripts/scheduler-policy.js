export function dailyRefreshDecision(metadata, now = new Date()) {
  if (metadata?.appId !== "aum-dashboard") throw new Error("Unexpected canonical application");
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("Invalid scheduler clock");
  const bangkokDate = new Date(nowMs + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const targetAt = `${bangkokDate}T02:00:00.000Z`;
  const targetMs = Date.parse(targetAt);
  if (nowMs < targetMs) return { skip: true, reason: "before-0900-bangkok", targetAt };

  // Only a completed canonical refresh counts. A timestamp or runner success alone does not.
  const job = metadata.job;
  const started = Date.parse(job?.startedAt);
  const completed = Date.parse(job?.completedAt);
  const generated = Date.parse(metadata.generatedAt);
  const alreadyComplete = job?.status === "complete" && job.stage === "complete" && !job.error
    && typeof metadata.dataVersion === "string" && metadata.dataVersion.length > 0
    && job.result?.dataVersion === metadata.dataVersion
    && started >= targetMs && started <= generated && generated <= completed && completed <= nowMs;
  return { skip: alreadyComplete, reason: alreadyComplete ? "already-refreshed-after-0900" : "refresh-required", targetAt };
}
