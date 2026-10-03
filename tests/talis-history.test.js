import assert from "node:assert/strict";
import test from "node:test";
import { testEnv, seedModelFixture } from "./db-fixture.js";
import { backfillTalisHistory } from "../worker/talis-history.ts";
import { rebuildModelAndSnapshot } from "../worker/snapshot.ts";

const latest = [{ code: "TLCHINASTAR50-X", talisFundCode: "40081" }];
const points = [["24/09/2026", 9.9996, 14171770.97], ["28/09/2026", 9.7220, 13778392.55], ["29/09/2026", 9.8101, 13986709.45], ["30/09/2026", 9.5551, 13668178.06]];
const html = rows => rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("");
async function fixture(env) {
  await seedModelFixture(env);
  await env.DB.prepare("INSERT INTO funds(id,code,bucket_id,bucket_name,data_source,inception_date,created_at,updated_at) VALUES ('TLCHINASTAR50-X','TLCHINASTAR50-X','wealthx_other','WealthX SeriesX','talis','2026-09-24','2026-10-03','2026-10-03')").run();
  await env.DB.prepare("INSERT INTO aum_points(fund_id,as_of_date,aum_million_baht,nav_per_unit,source_url,inserted_at) VALUES ('TLCHINASTAR50-X','2026-09-30',13.67,9.5551,'latest-source','2026-10-03')").run();
  for (const date of ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30"]) {
    await env.DB.prepare("INSERT INTO aum_points(fund_id,as_of_date,aum_million_baht,inserted_at) VALUES ('TEST',?,800,'2026-10-03')").bind(date).run();
  }
}

test("additive Talis repair restores the gap without changing model, old history or latest projection", async () => {
  const env = testEnv("talis-gap");
  const original = globalThis.fetch;
  const objects = new Map();
  env.FILES.put = async (key, value) => objects.set(key, value);
  try {
    await fixture(env);
    const oldRows = (await env.DB.prepare("SELECT * FROM aum_points ORDER BY fund_id,as_of_date").all()).results;
    const before = await rebuildModelAndSnapshot(env, "test");
    assert.equal(before.charts.timeline.find(row => row.date === "2026-09-24").seriesxAum, null);
    let requests = 0;
    globalThis.fetch = async () => { requests++; return new Response(html(points)); };
    const first = await backfillTalisHistory(env, latest);
    assert.equal(first[0].imported, 3);
    assert.equal((await backfillTalisHistory(env, latest))[0].reused, true);
    assert.equal(requests, 1);
    const after = await rebuildModelAndSnapshot(env, "test");
    assert.deepEqual(after.model, before.model);
    assert.deepEqual(after.projection, before.projection);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM model_versions").first()).n, 1);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM projections").first()).n, 1);
    for (const row of oldRows) assert.deepEqual(await env.DB.prepare("SELECT * FROM aum_points WHERE fund_id=? AND as_of_date=?").bind(row.fund_id, row.as_of_date).first(), row);
    for (const [date, amount] of [["2026-09-24", 814.17], ["2026-09-25", 814.17], ["2026-09-28", 813.78], ["2026-09-29", 813.99]]) {
      const row = after.charts.timeline.find(row => row.date === date);
      assert.equal(row.seriesxAum, amount);
      assert(row.lower <= row.projectedAua && row.projectedAua <= row.upper);
      const expected = after.projection.anchorAuaMillionBaht + after.model.slope * (amount - after.projection.anchorAumMillionBaht);
      assert(Math.abs(row.projectedAua - expected) < 0.01);
    }
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM aum_points WHERE fund_id='TLCHINASTAR50-X' AND as_of_date='2026-09-25'").first()).n, 0);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='history_backfill'").first()).n, 3);
    assert([...objects.keys()].some(key => key.endsWith("/before.json")));
    assert([...objects.keys()].some(key => key.endsWith("/source.html")));
  } finally { globalThis.fetch = original; env.close(); }
});

test("partial, unavailable or mismatched Talis source is retriable and inserts no rows", async () => {
  const env = testEnv("talis-gap-retry");
  const original = globalThis.fetch;
  try {
    await fixture(env);
    for (const response of [new Response("Unavailable", { status: 503 }), new Response(html(points.slice(1))), new Response(html([...points, points[0]]))]) {
      globalThis.fetch = async () => response;
      assert((await backfillTalisHistory(env, latest))[0].error);
      assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM aum_points WHERE fund_id='TLCHINASTAR50-X'").first()).n, 1);
      assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM metadata WHERE key LIKE 'talis_history_backfill:%'").first()).n, 0);
    }
    let requested = false;
    globalThis.fetch = async () => { requested = true; return new Response(html(points)); };
    assert((await backfillTalisHistory(env, [{ ...latest[0], talisFundCode: "wrong" }]))[0].error);
    assert.equal(requested, false);
    await env.DB.prepare("UPDATE funds SET inception_date='2026-09-25' WHERE id='TLCHINASTAR50-X'").run();
    assert((await backfillTalisHistory(env, latest))[0].error);
    await env.DB.prepare("UPDATE funds SET inception_date='2026-09-24' WHERE id='TLCHINASTAR50-X'").run();
    assert.equal((await backfillTalisHistory(env, latest))[0].imported, 3);
  } finally { globalThis.fetch = original; env.close(); }
});

test("repair inserts only missing rows and survives an interrupted atomic batch", async () => {
  const env = testEnv("talis-gap-atomic");
  const original = globalThis.fetch;
  try {
    await fixture(env);
    await env.DB.prepare("INSERT INTO aum_points(fund_id,as_of_date,aum_million_baht,nav_per_unit,source_url,inserted_at) VALUES ('TLCHINASTAR50-X','2026-09-24',14.17,9.9996,'already-verified','2026-10-03')").run();
    const existing = await env.DB.prepare("SELECT * FROM aum_points WHERE fund_id='TLCHINASTAR50-X' AND as_of_date='2026-09-24'").first();
    globalThis.fetch = async () => new Response(html(points));
    const batch = env.DB.batch;
    env.DB.batch = statements => batch([...statements, { async run() { throw new Error("Simulated batch interruption"); } }]);
    assert((await backfillTalisHistory(env, latest))[0].error);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM aum_points WHERE fund_id='TLCHINASTAR50-X'").first()).n, 2);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='history_backfill'").first()).n, 0);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM metadata WHERE key LIKE 'talis_history_backfill:%'").first()).n, 0);
    env.DB.batch = batch;
    assert.equal((await backfillTalisHistory(env, latest))[0].imported, 2);
    assert.deepEqual(await env.DB.prepare("SELECT * FROM aum_points WHERE fund_id='TLCHINASTAR50-X' AND as_of_date='2026-09-24'").first(), existing);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='history_backfill'").first()).n, 2);
  } finally { globalThis.fetch = original; env.close(); }
});

test("conflicting existing history fails closed without overwriting or completing the repair", async () => {
  const env = testEnv("talis-gap-conflict");
  const original = globalThis.fetch;
  try {
    await fixture(env);
    await env.DB.prepare("INSERT INTO aum_points(fund_id,as_of_date,aum_million_baht,nav_per_unit,inserted_at) VALUES ('TLCHINASTAR50-X','2026-09-24',99,9.9996,'2026-10-03')").run();
    globalThis.fetch = async () => new Response(html(points));
    assert.match((await backfillTalisHistory(env, latest))[0].error, /conflicts/);
    assert.equal((await env.DB.prepare("SELECT aum_million_baht AS value FROM aum_points WHERE fund_id='TLCHINASTAR50-X' AND as_of_date='2026-09-24'").first()).value, 99);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM aum_points WHERE fund_id='TLCHINASTAR50-X'").first()).n, 2);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM metadata WHERE key LIKE 'talis_history_backfill:%'").first()).n, 0);
  } finally { globalThis.fetch = original; env.close(); }
});

test("a failed success-status write rolls back the repair and a retry restores status atomically", async () => {
  const env = testEnv("talis-gap-status");
  const original = globalThis.fetch;
  const prepare = env.DB.prepare;
  try {
    await fixture(env);
    globalThis.fetch = async () => new Response(html(points));
    env.DB.prepare = sql => {
      if (sql.includes("INSERT INTO source_status") && sql.includes("VALUES (?,?,'ok'")) {
        return { bind() { return this; }, async run() { throw new Error("Simulated status write failure"); } };
      }
      return prepare(sql);
    };
    assert.match((await backfillTalisHistory(env, latest))[0].error, /status write failure/);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM aum_points WHERE fund_id='TLCHINASTAR50-X'").first()).n, 1);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='history_backfill'").first()).n, 0);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM metadata WHERE key LIKE 'talis_history_backfill:%'").first()).n, 0);
    assert.equal((await env.DB.prepare("SELECT status FROM source_status WHERE source_id='talis-history:TLCHINASTAR50-X'").first()).status, "incomplete");
    env.DB.prepare = prepare;
    assert.equal((await backfillTalisHistory(env, latest))[0].imported, 3);
    assert.equal((await env.DB.prepare("SELECT status FROM source_status WHERE source_id='talis-history:TLCHINASTAR50-X'").first()).status, "ok");
    assert.equal((await backfillTalisHistory(env, latest))[0].reused, true);
  } finally { env.DB.prepare = prepare; globalThis.fetch = original; env.close(); }
});
