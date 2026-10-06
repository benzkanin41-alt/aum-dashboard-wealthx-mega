import assert from "node:assert/strict";
import test from "node:test";
import { runSitesRefresh } from "../scripts/run-sites-refresh.js";
import { buildCronJob, configureCronJob, JOB_TITLE, DISPATCH_URL } from "../scripts/configure-cron-job.js";

const iso = time => new Date(time).toISOString();
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
function completedJob(start, completed, dataVersion = "version-new") {
  return { id: `fixture-${dataVersion}`, status: "complete", stage: "complete", requestedAt: iso(start), startedAt: iso(start),
    completedAt: iso(completed), error: null, result: { dataVersion } };
}
function metadata(job) {
  return { appId: "aum-dashboard", dataVersion: job.result?.dataVersion || "version-old",
    generatedAt: job.completedAt || "2026-10-06T01:59:00.000Z", job };
}
function dashboard(job) { return { ...metadata(job), model: { id: "fixture-model" } }; }
function clientHarness(handler, { start = "2026-10-06T02:00:30Z", deadlineMs } = {}) {
  let clock = Date.parse(start);
  const calls = [];
  const reports = [];
  const waits = [];
  return {
    calls, reports, waits, time: () => clock,
    run: mode => runSitesRefresh({ mode: mode || "daily", base: "https://isolated.invalid", now: () => clock, deadlineMs,
      sleepImpl: async ms => { assert.ok(ms > 0); waits.push(ms); clock += ms; },
      reportResult: async result => reports.push(result), onProgress: () => {},
      fetchImpl: async (url, options) => {
        const target = new URL(url);
        assert.equal(target.origin, "https://isolated.invalid");
        const call = { pathname: target.pathname, job: target.searchParams.get("job"), advance: target.searchParams.get("advance"),
          method: options.method || "GET", time: clock };
        calls.push(call);
        return handler(call, clock);
      }
    })
  };
}

test("daily cooldown completion before 09:00 cannot count as today's success", async () => {
  const old = completedJob(Date.parse("2026-10-06T01:59:00Z"), Date.parse("2026-10-06T01:59:45Z"), "version-old");
  let canonical = old;
  let postCount = 0;
  let newStarts = 0;
  let newJob;
  const harness = clientHarness((call, clock) => {
    if (call.pathname === "/api/dashboard/version") return response(metadata(canonical));
    if (call.pathname === "/api/refresh") {
      postCount += 1;
      if (postCount === 1) return response({ job: old, retryAfterSeconds: 210 }, 429, { "retry-after": "210" });
      assert.ok(clock >= Date.parse(old.requestedAt) + 300000);
      newStarts += 1;
      newJob = { ...completedJob(clock, clock), status: "running", stage: "aum", completedAt: null, result: {} };
      return response({ job: newJob }, 202);
    }
    if (call.pathname === "/api/refresh/status") {
      assert.equal(call.job, newJob.id);
      canonical = { ...newJob, status: "complete", stage: "complete", completedAt: iso(clock), result: { dataVersion: "version-new" } };
      return response({ job: canonical });
    }
    if (call.pathname === "/api/dashboard") return response(dashboard(canonical));
    throw new Error("Unexpected isolated request");
  });
  const result = await harness.run();
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.dataVersion, "version-new");
  assert.ok(Date.parse(result.startedAt) >= Date.parse(result.targetAt));
  assert.equal(newStarts, 1);
  assert.equal(postCount, 2);
  assert.equal(harness.reports.length, 1);
});

test("today's completed matching canonical snapshot deduplicates without a POST", async () => {
  const job = completedJob(Date.parse("2026-10-06T02:00:00Z"), Date.parse("2026-10-06T02:05:00Z"));
  const harness = clientHarness(call => {
    assert.equal(call.pathname, "/api/dashboard/version");
    return response(metadata(job));
  }, { start: "2026-10-06T02:06:00Z" });
  const result = await harness.run();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "already-refreshed-after-0900");
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.waits.length, 0);
});

test("daily request before target retains the existing skip behavior", async () => {
  const job = completedJob(Date.parse("2026-10-05T02:00:00Z"), Date.parse("2026-10-05T02:05:00Z"));
  const harness = clientHarness(() => response(metadata(job)), { start: "2026-10-06T01:59:59Z" });
  const result = await harness.run();
  assert.equal(result.reason, "before-0900-bangkok");
  assert.equal(harness.calls.some(call => call.method === "POST"), false);
});

test("running canonical job resumes by ID and tolerates bounded transient GET failures", async () => {
  let job = { ...completedJob(Date.parse("2026-10-06T02:00:00Z"), Date.parse("2026-10-06T02:00:00Z")),
    status: "running", stage: "aum", completedAt: null, result: {} };
  let polls = 0;
  const harness = clientHarness((call, clock) => {
    if (call.pathname === "/api/dashboard/version") return response(metadata(job));
    if (call.pathname === "/api/refresh/status") {
      assert.equal(call.job, job.id);
      assert.equal(call.advance, "1");
      polls += 1;
      if (polls === 1) throw new TypeError("Synthetic transport failure");
      if (polls === 2) return response({ error: "Synthetic unavailable source" }, 503);
      job = { ...job, status: "complete", stage: "complete", completedAt: iso(clock), result: { dataVersion: "version-new" } };
      return response({ job });
    }
    if (call.pathname === "/api/dashboard") return response(dashboard(job));
    throw new Error("A resumed job must not request another job");
  });
  const result = await harness.run();
  assert.equal(result.ok, true);
  assert.equal(polls, 3);
  assert.equal(harness.calls.some(call => call.method === "POST"), false);
});

test("another caller's completed post-target refresh suppresses the cooldown retry", async () => {
  const old = completedJob(Date.parse("2026-10-06T01:59:00Z"), Date.parse("2026-10-06T01:59:45Z"), "version-old");
  let posts = 0;
  const harness = clientHarness((call, clock) => {
    if (call.pathname === "/api/dashboard/version") {
      return response(metadata(clock >= Date.parse("2026-10-06T02:01:00Z")
        ? completedJob(Date.parse("2026-10-06T02:00:40Z"), clock) : old));
    }
    if (call.pathname === "/api/refresh") { posts += 1; return response({ job: old }, 429, { "retry-after": "210" }); }
    throw new Error("Cooldown dedupe must not request more work");
  });
  const result = await harness.run();
  assert.equal(result.skipped, true);
  assert.equal(result.dataVersion, "version-new");
  assert.equal(posts, 1);
});

test("daily cooldown respects an HTTP-date Retry-After", async () => {
  const old = completedJob(Date.parse("2026-10-06T01:50:00Z"), Date.parse("2026-10-06T01:51:00Z"), "version-old");
  const retryTime = Date.parse("2026-10-06T02:01:00Z");
  let canonical = old;
  let posts = 0;
  const harness = clientHarness((call, clock) => {
    if (call.pathname === "/api/dashboard/version") return response(metadata(canonical));
    if (call.pathname === "/api/refresh") {
      posts += 1;
      if (posts === 1) return response({ job: old }, 429, { "retry-after": new Date(retryTime).toUTCString() });
      assert.ok(clock >= retryTime);
      canonical = completedJob(clock, clock);
      return response({ job: canonical }, 202);
    }
    if (call.pathname === "/api/dashboard") return response(dashboard(canonical));
    throw new Error("Unexpected isolated request");
  });
  assert.equal((await harness.run()).ok, true);
  assert.equal(posts, 2);
});

test("missing Retry-After falls back to the canonical five-minute cooldown", async () => {
  const old = completedJob(Date.parse("2026-10-06T01:59:00Z"), Date.parse("2026-10-06T01:59:45Z"), "version-old");
  let canonical = old;
  let posts = 0;
  const harness = clientHarness((call, clock) => {
    if (call.pathname === "/api/dashboard/version") return response(metadata(canonical));
    if (call.pathname === "/api/refresh") {
      posts += 1;
      if (posts === 1) return response({ job: old }, 429);
      assert.ok(clock >= Date.parse(old.requestedAt) + 300000);
      canonical = completedJob(clock, clock);
      return response({ job: canonical }, 202);
    }
    if (call.pathname === "/api/dashboard") return response(dashboard(canonical));
    throw new Error("Unexpected isolated request");
  });
  assert.equal((await harness.run()).ok, true);
  assert.equal(posts, 2);
});

test("deadline during cooldown reports incomplete, never a successful daily refresh", async () => {
  const old = completedJob(Date.parse("2026-10-06T01:59:00Z"), Date.parse("2026-10-06T01:59:45Z"), "version-old");
  const harness = clientHarness(call => call.pathname === "/api/dashboard/version"
    ? response(metadata(old)) : response({ job: old }, 429, { "retry-after": "3600" }), { deadlineMs: 1800 });
  await assert.rejects(harness.run(), /deadline.*incomplete/);
  assert.equal(harness.reports.length, 0);
  assert.equal(harness.calls.filter(call => call.method === "POST").length, 1);
  assert.equal(harness.time(), Date.parse("2026-10-06T02:00:30Z") + 1800);
});

test("bounded GET retries do not start a job when canonical metadata is unavailable", async () => {
  const harness = clientHarness(() => { throw new TypeError("Synthetic network outage"); });
  await assert.rejects(harness.run(), /GET failed after bounded retries/);
  assert.equal(harness.calls.length, 4);
  assert.equal(harness.calls.every(call => call.method === "GET"), true);
  assert.equal(harness.reports.length, 0);
});

test("running job reaching deadline stays incomplete without another POST", async () => {
  const job = { ...completedJob(Date.parse("2026-10-06T02:00:00Z"), Date.parse("2026-10-06T02:00:00Z")),
    status: "running", stage: "aum", completedAt: null, result: {} };
  const harness = clientHarness(call => call.pathname === "/api/dashboard/version"
    ? response(metadata(job)) : response({ job }), { deadlineMs: 2500 });
  await assert.rejects(harness.run(), /deadline.*incomplete/);
  assert.equal(harness.calls.some(call => call.method === "POST"), false);
  assert.equal(harness.reports.length, 0);
  assert.equal(harness.time(), Date.parse("2026-10-06T02:00:30Z") + 2500);
});

test("completed post-target job with mismatched canonical version cannot count as success", async () => {
  const job = completedJob(Date.parse("2026-10-06T02:00:00Z"), Date.parse("2026-10-06T02:00:10Z"));
  const harness = clientHarness(call => call.pathname === "/api/dashboard/version"
    ? response({ ...metadata(job), dataVersion: "different-version" }) : response({ job }, 429, { "retry-after": "10" }), { deadlineMs: 2500 });
  await assert.rejects(harness.run(), /deadline.*incomplete/);
  assert.equal(harness.reports.length, 0);
  assert.equal(harness.calls.filter(call => call.method === "POST").length, 1);
});

test("ambiguous POST outcome is not blindly retried", async () => {
  const old = completedJob(Date.parse("2026-10-05T02:00:00Z"), Date.parse("2026-10-05T02:05:00Z"), "version-old");
  const harness = clientHarness(call => {
    if (call.method === "POST") throw new TypeError("Synthetic connection loss after request");
    return response(metadata(old));
  });
  await assert.rejects(harness.run(), /outcome is unknown/);
  assert.equal(harness.calls.filter(call => call.method === "POST").length, 1);
  assert.equal(harness.reports.length, 0);
});

test("manual mode still accepts a completed cooldown job without the daily guard", async () => {
  const old = completedJob(Date.parse("2026-10-06T01:59:00Z"), Date.parse("2026-10-06T01:59:45Z"), "version-old");
  const harness = clientHarness(call => call.method === "POST" ? response({ job: old }, 429) : response(dashboard(old)));
  const result = await harness.run("manual");
  assert.equal(result.ok, true);
  assert.equal(result.targetAt, null);
  assert.deepEqual(harness.calls.map(call => call.pathname), ["/api/refresh", "/api/dashboard"]);
});

function configureHarness({ args, change = () => {}, missing = false, failure = null } = {}) {
  const token = "github_pat_synthetic_fixture";
  const actual = { ...buildCronJob(token), jobId: 12, nextExecution: Date.parse("2026-10-07T02:00:00Z") / 1000 };
  change(actual);
  const calls = [];
  const logs = [];
  let reads = 0;
  let writes = 0;
  return {
    calls, logs, counts: () => ({ reads, writes }),
    run: () => configureCronJob({ args: args || ["--credentials", "synthetic-credentials.json", "--verify"],
      now: () => Date.parse("2026-10-06T03:00:00Z"), log: value => logs.push(value),
      readFile: async () => { reads += 1; return JSON.stringify({ githubActionsToken: token, cronJobApiKey: "synthetic-provider-key" }); },
      writeFile: async () => { writes += 1; throw new Error("An isolated verification must never write a receipt"); },
      fetchImpl: async (url, options) => {
        const target = new URL(url);
        assert.equal(options.method, "GET");
        calls.push({ path: target.pathname, method: options.method });
        if (target.hostname === "api.github.com") {
          if (target.pathname.endsWith("/actions/workflows/pages.yml")) return response({ state: "active" });
          if (target.pathname.includes("/contents/")) return response({ content: Buffer.from("REFRESH_MODE: daily").toString("base64") });
          return response({ full_name: "benzkanin41-alt/aum-dashboard-wealthx-mega", private: false });
        }
        assert.equal(target.hostname, "api.cron-job.org");
        if (failure) return response({ error: token }, failure);
        if (target.pathname === "/jobs") return response({ someFailed: false, jobs: missing ? [] : [{ jobId: 12, title: JOB_TITLE, url: DISPATCH_URL }] });
        assert.equal(target.pathname, "/jobs/12");
        return response({ jobDetails: actual });
      }
    })
  };
}

test("explicit verify performs GET-only saved-job readback without receipts or secret output", async () => {
  const harness = configureHarness();
  const result = await harness.run();
  assert.equal(result.verified, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.nextExecutionBangkok, "09:00");
  assert.equal(result.deliveryTested, false);
  assert.equal(harness.counts().writes, 0);
  assert.equal(harness.calls.every(call => call.method === "GET"), true);
  assert.equal(harness.calls.at(-1).path, "/jobs/12");
  const output = JSON.stringify(harness.logs);
  assert.equal(output.includes("github_pat"), false);
  assert.equal(output.includes("synthetic-provider-key"), false);
  assert.equal(output.includes("Authorization"), false);
});

test("default preflight preserves its existing planning output and does not fetch detail", async () => {
  const harness = configureHarness({ args: ["--credentials", "synthetic-credentials.json"] });
  const result = await harness.run();
  assert.equal(result.dryRun, true);
  assert.equal(result.action, "update");
  assert.equal(result.credentialsValidated, true);
  assert.equal(harness.calls.some(call => call.path === "/jobs/12"), false);
  assert.equal(harness.counts().writes, 0);
});

test("verify rejects disabled, wrong schedules, headers, auth, body and next execution safely", async () => {
  const changes = [
    job => { job.enabled = false; },
    job => { job.schedule.hours = [8]; },
    job => { job.schedule.timezone = "UTC"; },
    job => { job.extendedData.headers.Authorization = "Bearer synthetic-secret-mismatch"; },
    job => { job.extendedData.headers.Cookie = "synthetic-secret-mismatch"; },
    job => { job.extendedData.headers.authorization = job.extendedData.headers.Authorization; },
    job => { job.auth.enable = true; job.auth.password = "synthetic-secret-mismatch"; },
    job => { job.title = "synthetic-secret-mismatch"; },
    job => { job.extendedData.body = "synthetic-secret-mismatch"; },
    job => { job.nextExecution = Date.parse("2026-10-08T02:00:00Z") / 1000; },
    job => { job.nextExecution = Date.parse("2026-10-06T02:00:00Z") / 1000; }
  ];
  for (const change of changes) {
    const harness = configureHarness({ change });
    await assert.rejects(harness.run(), error => {
      assert.equal(error.message.includes("synthetic-secret-mismatch"), false);
      assert.equal(error.message.includes("github_pat"), false);
      assert.equal(error.message.includes("Authorization"), false);
      return true;
    });
    assert.equal(harness.counts().writes, 0);
    assert.equal(harness.logs.length, 0);
  }
});

test("verify never creates a missing saved job", async () => {
  const harness = configureHarness({ missing: true });
  await assert.rejects(harness.run(), /No uniquely matching/);
  assert.equal(harness.counts().writes, 0);
  assert.equal(harness.calls.some(call => call.method !== "GET"), false);
});

test("verify and apply conflict fails before credential reads, network or writes", async () => {
  const harness = configureHarness({ args: ["--verify", "--apply", "--credentials", "synthetic-credentials.json"] });
  await assert.rejects(harness.run(), /cannot be combined/);
  assert.deepEqual(harness.counts(), { reads: 0, writes: 0 });
  assert.equal(harness.calls.length, 0);
});

test("verify provider rejection never includes echoed credentials or response bodies", async () => {
  const harness = configureHarness({ failure: 403 });
  await assert.rejects(harness.run(), error => {
    assert.match(error.message, /HTTP 403/);
    assert.equal(error.message.includes("github_pat"), false);
    assert.equal(error.message.includes("synthetic-provider-key"), false);
    return true;
  });
  assert.equal(harness.counts().writes, 0);
  assert.equal(harness.logs.length, 0);
});
