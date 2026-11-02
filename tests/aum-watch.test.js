import test from "node:test";
import assert from "node:assert/strict";
import { watchAum, eligibleFunds, verifyProjection, UNIVERSE, TARGET_DATE, ISSUE_TITLE, MARKER, COMPLETE, SITE } from "../scripts/watch-aum-20261102.js";

const response = (x, status = 200) => new Response(JSON.stringify(x), { status });
function harness({ ready = false, absent = false, stopped = false, comments = [], mutate, failClose = false } = {}) {
  const funds = Object.entries(UNIVERSE).flatMap(([bucketId, codes]) => codes.map(code => ({ code, bucketId, inceptionDate: "2025-01-01" })));
  funds.push({ code: "TLALLWEALTH-X", bucketId: "wealthx_other", launchStatus: "pending" });
  const snapshot = { appId: "aum-dashboard", dataVersion: "test-version", funds, model: { id: "test-model", algorithmVersion: "anchored-bootstrap-v1", pairCount: 8, slope: 1.5 },
    officialAua: [{ status: "verified", referenceDate: TARGET_DATE, amountMillionBaht: 8000 }], latestActual: { referenceDate: TARGET_DATE },
    charts: { comparison: [{ referenceDate: TARGET_DATE, aumDate: TARGET_DATE, seriesxAum: 30 }] },
    projection: { algorithmVersion: "anchored-bootstrap-v1", intervalMethod: "parametric-anchored-error-bootstrap-10000", intervalLevel: 0.95,
      lower: 8000, value: 8000, upper: 8000, aumDate: TARGET_DATE, aumMillionBaht: 30, anchorReferenceDate: TARGET_DATE, anchorAumDate: TARGET_DATE,
      anchorAuaMillionBaht: 8000, anchorAumMillionBaht: 30, inputFingerprint: "test-input" } };
  mutate?.(snapshot);
  const issue = { number: 1, title: ISSUE_TITLE, body: MARKER, html_url: "https://github.com/example/issues/1", state: stopped ? "closed" : "open" };
  const calls = [], logs = []; let refreshes = 0;
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url); const method = options.method || "GET"; const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ origin: u.origin, path: u.pathname, method, body });
    if (u.origin === "https://api.github.com") {
      assert.equal(options.headers.Authorization, "Bearer test-token");
      if (u.pathname.endsWith("/issues") && method === "GET") return response(absent ? [] : [issue]);
      if (u.pathname.endsWith("/issues") && method === "POST") return response(issue, 201);
      if (u.pathname.endsWith("/comments") && method === "GET") return response(comments);
      if (u.pathname.endsWith("/comments") && method === "POST") { comments.push({ body: body.body, user: { login: "github-actions[bot]" } }); return response({ id: comments.length }, 201); }
      if (method === "PATCH") { if (failClose) return response({}, 503); issue.state = body.state; return response(issue); }
      throw Error("Unexpected GitHub call");
    }
    assert.equal(u.origin, SITE); assert(!options.headers?.Authorization, "GitHub token must never reach Sites");assert.equal(method, "GET");
    if (u.pathname === "/api/dashboard") return response(snapshot);
    if (u.pathname === "/api/dashboard/version") return response({ appId: "aum-dashboard", dataVersion: snapshot.dataVersion, job: { status: "complete" } });
    if (u.pathname.startsWith("/api/funds/")) { const code = decodeURIComponent(u.pathname.slice(11)); assert.notEqual(code, "TLALLWEALTH-X"); return response({ code, history: [{ date: ready ? TARGET_DATE : "2026-10-30", aumMillionBaht: 1, sourceUrl: "https://nav.talisam.co.th/" }] }); }
    throw Error("Unexpected canonical call");
  };
  return { snapshot, calls, comments, logs, refreshes: () => refreshes,
    run: options => watchAum({ token: "test-token", fetchImpl, refreshImpl: async args => { refreshes++;assert.equal(args.base, SITE);assert.equal(args.mode, "manual"); }, log: x => logs.push(x), ...options }) };
}

test("AUM watcher freezes all 72 active classes and excludes pending IPO", () => {
  const h = harness();assert.equal(eligibleFunds(h.snapshot).length, 72);
  assert.deepEqual(Object.values(UNIVERSE).map(a => a.length), [30,33,9]);
  h.snapshot.funds.pop();assert.equal(eligibleFunds(h.snapshot).length,72);
  h.snapshot.funds.pop();assert.throws(() => eligibleFunds(h.snapshot), /universe changed/);
});
test("incomplete and carried NAV never notify completion or invent projection", async () => {
  const h = harness();const r = await h.run();assert.equal(r.status,"waiting_for_target_date");assert.equal(r.covered,0);assert.equal(r.expected,72);
  assert.equal(h.refreshes(),1);assert.equal(h.comments.length,0);
});
test("financially read-only cloud verification cannot start updater", async () => {
  const h = harness();const r = await h.run({mode:"verify"});assert.equal(r.status,"waiting_for_target_date");assert.equal(h.refreshes(),0);assert.equal(h.comments.length,0);
});
test("notification-channel test is clearly labeled and idempotent", async () => {
  const h = harness();await h.run({mode:"verify",notifyTest:true});await h.run({mode:"verify",notifyTest:true});
  assert.equal(h.comments.length,1);assert.match(h.comments[0].body,/ไม่ใช่การยืนยันว่า AUM ครบ/);assert.equal(h.refreshes(),0);
});
test("all exact dates plus verified projection notify once then stop canonical work", async () => {
  const h = harness({ready:true});const first = await h.run();assert.equal(first.status,"complete");assert.equal(first.covered,72);assert.equal(first.value,8000);
  assert.equal(h.comments.filter(c=>c.body.includes(COMPLETE)).length,1);
  const start=h.calls.length;const second=await h.run();assert.equal(second.status,"already_complete_or_stopped");assert.equal(h.refreshes(),1);
  assert(h.calls.slice(start).every(c=>c.origin==="https://api.github.com"));
});
test("an owner-closed issue stops without site requests or updater",async()=>{
  const h=harness({stopped:true});assert.equal((await h.run()).status,"already_complete_or_stopped");assert.equal(h.refreshes(),0);assert(h.calls.every(c=>c.origin==="https://api.github.com"));
});
test("projection must use exact target-date SeriesX sum and unchanged formula",()=>{
  const h=harness({ready:true});const points=new Map(UNIVERSE.wealthx_other.map(c=>[c,{aumMillionBaht:1}]));assert.equal(verifyProjection(h.snapshot,points).seriesxTargetAum,30);
  h.snapshot.projection.value=8001;assert.throws(()=>verifyProjection(h.snapshot,points));h.snapshot.projection.value=8000;
  h.snapshot.charts.comparison[0].aumDate="2026-10-30";assert.throws(()=>verifyProjection(h.snapshot,points));
});
test("source or scope failures remain unconfirmed and repeated errors notify once",async()=>{
  const h=harness({mutate:s=>s.funds.shift()});const a=await h.run();assert.equal(a.status,"needs_attention");await h.run();assert.equal(h.comments.length,1);assert.equal(h.refreshes(),0);
});
test("completion marker survives interrupted issue-close without duplicate financial work",async()=>{
  const h=harness({ready:true,failClose:true});assert.equal((await h.run()).status,"complete_notification_recorded_cleanup_pending");assert.equal(h.comments.length,1);assert(h.comments[0].body.includes(COMPLETE));
});
test("missing notification issue is created only once with no financial credentials",async()=>{
  const h=harness({absent:true});await h.run({mode:"verify"});const created=h.calls.find(c=>c.method==="POST"&&c.path.endsWith("/issues"));assert(created);assert(!created.body.body.includes("test-token"));
});
