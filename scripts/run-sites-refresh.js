const base = (process.env.SITES_BASE_URL || "https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site").replace(/\/$/, "");
const started = await requestJson(`${base}/api/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, [202, 429]);
if (!started.body.job?.id) throw new Error(`Refresh did not return a job: ${JSON.stringify(started.body)}`);
let job = started.body.job;
for (let attempt = 0; attempt < 100 && !["complete", "failed"].includes(job.status); attempt += 1) {
  await sleep(1200);
  const status = await requestJson(`${base}/api/refresh/status?job=${encodeURIComponent(job.id)}&advance=1`, {}, [200]);
  job = status.body.job;
  if (!job) throw new Error("Refresh job disappeared");
  console.log(JSON.stringify({ id: job.id, status: job.status, stage: job.stage, progress: job.progress }));
}
if (job.status !== "complete") throw new Error(job.error || `Refresh timed out in ${job.stage}`);
const dashboard = await requestJson(`${base}/api/dashboard`, {}, [200]);
console.log(JSON.stringify({ ok: true, jobId: job.id, dataVersion: dashboard.body.dataVersion, modelVersion: dashboard.body.model?.id, generatedAt: dashboard.body.generatedAt }));

async function requestJson(url, options, accepted) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${url} returned non-JSON HTTP ${response.status}`); }
  if (!accepted.includes(response.status)) throw new Error(body.error || `${url} HTTP ${response.status}`);
  return { response, body };
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
