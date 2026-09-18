import assert from "node:assert/strict";
import test from "node:test";
import { dailyRefreshDecision } from "../scripts/scheduler-policy.js";
import { buildCronJob, selectExistingJob, verifyJob, JOB_TITLE, DISPATCH_URL } from "../scripts/configure-cron-job.js";

const now = new Date("2026-09-18T03:00:00Z");
function metadata() {
  return { appId: "aum-dashboard", dataVersion: "version-a", generatedAt: "2026-09-18T02:04:00Z",
    job: { status: "complete", stage: "complete", startedAt: "2026-09-18T02:00:00Z", completedAt: "2026-09-18T02:05:00Z",
      error: null, result: { dataVersion: "version-a" } } };
}

test("daily target is 09:00 Bangkok; a completed matching refresh suppresses fallback", () => {
  assert.deepEqual(dailyRefreshDecision(metadata(), now), {
    skip: true, reason: "already-refreshed-after-0900", targetAt: "2026-09-18T02:00:00.000Z"
  });
});
test("daily request before 09:00 waits for today's target, including the UTC date boundary", () => {
  for (const time of ["2026-09-17T17:00:00Z", "2026-09-18T01:59:59Z"]) {
    assert.deepEqual(dailyRefreshDecision(metadata(), new Date(time)), {
      skip: true, reason: "before-0900-bangkok", targetAt: "2026-09-18T02:00:00.000Z"
    });
  }
});
test("yesterday's completion and an early refresh do not suppress today's run", () => {
  for (const start of ["2026-09-17T02:00:00Z", "2026-09-18T01:59:59Z"]) {
    const data = metadata(); data.job.startedAt = start;
    assert.equal(dailyRefreshDecision(data, now).skip, false);
  }
});
test("running, failed, absent or inconsistent jobs never count as completed refreshes", () => {
  const changes = [
    data => { data.job = null; },
    data => { data.job.status = "running"; },
    data => { data.job.status = "failed"; },
    data => { data.job.stage = "model"; },
    data => { data.job.error = "source error"; },
    data => { data.job.result.dataVersion = "other"; },
    data => { data.dataVersion = ""; },
    data => { data.job.completedAt = null; },
    data => { data.job.startedAt = "not-a-date"; },
    data => { data.generatedAt = "2026-09-18T01:00:00Z"; },
    data => { data.job.completedAt = "2026-09-18T02:03:00Z"; },
    data => { data.job.completedAt = "2026-09-18T04:00:00Z"; }
  ];
  for (const change of changes) {
    const data = metadata(); change(data);
    assert.equal(dailyRefreshDecision(data, now).skip, false);
  }
});
test("wrong app and invalid clock fail closed without starting a refresh", () => {
  assert.throws(() => dailyRefreshDecision({ appId: "another-dashboard" }, now));
  assert.throws(() => dailyRefreshDecision(metadata(), new Date("invalid")));
});

test("free cron-job dispatch is daily at 09:00 Bangkok with a narrow fine-grained credential", () => {
  const job = buildCronJob("github_pat_synthetic_fixture");
  assert.equal(job.url, DISPATCH_URL);
  assert.equal(job.requestMethod, 1);
  assert.equal(job.requestTimeout, 30);
  assert.deepEqual(job.schedule, { timezone: "Asia/Bangkok", expiresAt: 0, hours: [9], minutes: [0], mdays: [-1], months: [-1], wdays: [-1] });
  assert.deepEqual(JSON.parse(job.extendedData.body), { ref: "main", inputs: { mode: "daily" } });
  assert.throws(() => buildCronJob("gho_broad_login_token"));
  assert.throws(() => buildCronJob(""));
});
test("cron setup will not duplicate matching jobs or alter other jobs", () => {
  const existing = { jobId: 12, title: JOB_TITLE, url: DISPATCH_URL };
  assert.equal(selectExistingJob([{ title: "Another dashboard", url: "https://example.test" }]), null);
  assert.deepEqual(selectExistingJob([existing]), existing);
  assert.throws(() => selectExistingJob([existing, { ...existing, jobId: 13 }]));
  assert.throws(() => selectExistingJob([{ ...existing, title: "Different integration" }]));
  assert.throws(() => selectExistingJob([{ ...existing, url: "https://example.test" }]));
});
test("cron readback checks schedule and auth without printing a secret on mismatch", () => {
  const expected = buildCronJob("github_pat_synthetic_fixture");
  verifyJob(structuredClone(expected), expected);
  const changed = structuredClone(expected);
  changed.extendedData.headers.Authorization = "Bearer secret_fixture_never_print";
  assert.throws(() => verifyJob(changed, expected), error => !error.message.includes("secret_fixture") && !error.message.includes("github_pat"));
  const early = structuredClone(expected); early.schedule.hours = [8];
  assert.throws(() => verifyJob(early, expected));
});
