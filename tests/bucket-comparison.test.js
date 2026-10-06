import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  COMPARISON_METHOD,
  buildPublishedComparison,
  loadPublishedBaseline
} from "../shared/bucket-comparison.js";
import { round2, sha256 } from "../shared/model.js";
import { rebuildModelAndSnapshot } from "../worker/snapshot.ts";

const BUCKET_ID = "wealthx_other";
const SCOPE = sha256(["FUND-A", "FUND-B"]);
const BASELINE = Object.freeze({
  snapshotId: "snapshot-original",
  dataVersion: "version-original",
  publishedAt: "2026-10-04T02:04:00.000Z",
  asOfDate: "2026-10-02",
  totalMillionBaht: 4394.47,
  fundSetFingerprint: SCOPE
});

function memoryArchive(t, { workerSchema = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  if (workerSchema) {
    const migrations = new URL("../drizzle/", import.meta.url);
    for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) {
      sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
    }
  } else sqlite.exec(`
    CREATE TABLE dashboard_snapshots (
      id TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL,
      data_version TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX dashboard_snapshots_generated_idx ON dashboard_snapshots(generated_at);
  `);
  sqlite.exec(`
    CREATE TRIGGER snapshots_no_update BEFORE UPDATE ON dashboard_snapshots
      BEGIN SELECT RAISE(ABORT, 'dashboard snapshots are append-only'); END;
    CREATE TRIGGER snapshots_no_delete BEFORE DELETE ON dashboard_snapshots
      BEGIN SELECT RAISE(ABORT, 'dashboard snapshots are append-only'); END;
  `);
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bound = (args = []) => ({
        bind(...values) { return bound(values); },
        async first(column) {
          const row = statement.get(...args);
          return row ? (column ? row[column] : { ...row }) : null;
        },
        async all() {
          return { success: true, results: statement.all(...args).map(row => ({ ...row })) };
        },
        async run() {
          const result = statement.run(...args);
          return { success: true, meta: { changes: Number(result.changes) } };
        }
      });
      return bound();
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
  return {
    db,
    append(id, publishedAt, bucket, options = {}) {
      const dataVersion = options.dataVersion ?? `version-${id}`;
      const payload = {
        appId: "aum-dashboard",
        schemaVersion: 3,
        generatedAt: publishedAt,
        dataVersion,
        buckets: [bucket, ...(options.otherBuckets ?? [])],
        funds: options.funds ?? [
          { code: "FUND-A", bucketId: BUCKET_ID },
          { code: "FUND-B", bucketId: BUCKET_ID }
        ],
        ...(options.extraPayload ?? {})
      };
      sqlite.prepare("INSERT INTO dashboard_snapshots VALUES (?, ?, ?, ?)")
        .run(id, publishedAt, dataVersion, JSON.stringify(payload, null, 2));
      return {
        snapshotId: id,
        dataVersion,
        publishedAt,
        asOfDate: bucket.latestDate,
        totalMillionBaht: bucket.totalMillionBaht,
        fundSetFingerprint: bucket.fundSetFingerprint
      };
    },
    rows() {
      return sqlite.prepare("SELECT * FROM dashboard_snapshots ORDER BY id")
        .all().map(row => ({ ...row }));
    }
  };
}

function bucket(totalMillionBaht = 4458.33, latestDate = "2026-10-05", extra = {}) {
  return { id: BUCKET_ID, latestDate, totalMillionBaht, fundSetFingerprint: SCOPE, ...extra };
}

function history(revised = 4458.06, current = 4458.33) {
  return [
    { date: "2026-10-01", aumMillionBaht: 4393.38, complete: true },
    { date: "2026-10-02", aumMillionBaht: revised, complete: revised != null },
    { date: "2026-10-05", aumMillionBaht: current, complete: current != null }
  ];
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function assertAvailable(comparison, baseline, change) {
  assert.equal(comparison.method, "published-asof-baseline-v1");
  assert.equal(comparison.status, "available");
  assert.deepEqual(comparison.baseline, baseline);
  assert.equal(comparison.changeMillionBaht, change);
  for (const key of ["reason", "revisedBaselineMillionBaht", "backfillChangeMillionBaht", "likeForDateChangeMillionBaht"]) {
    assert(Object.hasOwn(comparison, key), `Missing comparison field: ${key}`);
  }
}

function assertUnavailable(comparison) {
  assert.equal(comparison.method, "published-asof-baseline-v1");
  assert.equal(comparison.status, "unavailable");
  assert.equal(comparison.changeMillionBaht, null);
  assert.equal(typeof comparison.reason, "string");
  assert(comparison.reason.length > 0, "An unavailable comparison must explain why");
}

test("published comparison method has a stable versioned identifier", () => {
  assert.equal(COMPARISON_METHOD, "published-asof-baseline-v1");
});

test("4394.47 -> 4458.06 -> 4458.33 exposes 63.86 = 63.59 + 0.27", () => {
  const comparison = buildPublishedComparison(bucket(), history(), BASELINE);
  assertAvailable(comparison, BASELINE, 63.86);
  assert.equal(comparison.revisedBaselineMillionBaht, 4458.06);
  assert.equal(comparison.backfillChangeMillionBaht, 63.59);
  assert.equal(comparison.likeForDateChangeMillionBaht, 0.27);
  assert.equal(round2(comparison.backfillChangeMillionBaht + comparison.likeForDateChangeMillionBaht), 63.86);
});

test("comparison leaves the original bucket delta, history and model metadata untouched", () => {
  const original = deepFreeze(bucket(4458.33, "2026-10-05", {
    previousDate: "2026-10-02",
    previousTotalMillionBaht: 4458.06,
    changeMillionBaht: 0.27,
    changePct: 0.27 / 4458.06,
    history: [{ date: "2026-10-02", value: 4458.06 }],
    modelVersion: "anchored-model-unchanged"
  }));
  const aggregate = deepFreeze(history());
  const before = structuredClone({ original, aggregate, baseline: BASELINE });
  const comparison = buildPublishedComparison(original, aggregate, BASELINE);
  assertAvailable(comparison, BASELINE, 63.86);
  assert.deepEqual({ original, aggregate, baseline: BASELINE }, before);
  assert.equal(original.changeMillionBaht, 0.27);
});

test("no backfill produces a zero correction and the full like-for-date movement", () => {
  const comparison = buildPublishedComparison(bucket(), history(4394.47), BASELINE);
  assertAvailable(comparison, BASELINE, 63.86);
  assert.equal(comparison.backfillChangeMillionBaht, 0);
  assert.equal(comparison.likeForDateChangeMillionBaht, 63.86);
});

test("all comparison amounts use the existing round2 behavior", () => {
  const baseline = { ...BASELINE, totalMillionBaht: 10.123 };
  const comparison = buildPublishedComparison(bucket(11.239), history(10.456, 11.239), baseline);
  assertAvailable(comparison, baseline, round2(11.239 - 10.123));
  assert.equal(comparison.revisedBaselineMillionBaht, round2(10.456));
  assert.equal(comparison.backfillChangeMillionBaht, round2(10.456 - 10.123));
  assert.equal(comparison.likeForDateChangeMillionBaht, round2(11.239 - 10.456));
});

test("negative changes and negative historical corrections retain their signs", () => {
  const baseline = { ...BASELINE, totalMillionBaht: 100 };
  const comparison = buildPublishedComparison(bucket(95), history(97, 95), baseline);
  assertAvailable(comparison, baseline, -5);
  assert.equal(comparison.revisedBaselineMillionBaht, 97);
  assert.equal(comparison.backfillChangeMillionBaht, -3);
  assert.equal(comparison.likeForDateChangeMillionBaht, -2);
});

test("zero current totals, zero published baselines and zero reconstructed totals are valid", () => {
  const zeroBaseline = { ...BASELINE, totalMillionBaht: 0 };
  const zero = buildPublishedComparison(bucket(0), history(0, 0), zeroBaseline);
  assertAvailable(zero, zeroBaseline, 0);
  assert.equal(zero.revisedBaselineMillionBaht, 0);
  assert.equal(zero.backfillChangeMillionBaht, 0);
  assert.equal(zero.likeForDateChangeMillionBaht, 0);
  const positive = buildPublishedComparison(bucket(1.25), history(0, 1.25), zeroBaseline);
  assertAvailable(positive, zeroBaseline, 1.25);
  const negative = buildPublishedComparison(bucket(0), history(2, 0), { ...BASELINE, totalMillionBaht: 2 });
  assert.equal(negative.changeMillionBaht, -2);
});

test("missing current totals or published baselines never become a numeric delta", async t => {
  const cases = [
    ["null current total", bucket(null), BASELINE],
    ["undefined current total", bucket(undefined, "2026-10-05", { totalMillionBaht: undefined }), BASELINE],
    ["null baseline", bucket(), null],
    ["null baseline total", bucket(), { ...BASELINE, totalMillionBaht: null }],
    ["undefined baseline total", bucket(), { ...BASELINE, totalMillionBaht: undefined }]
  ];
  for (const [name, current, baseline] of cases) {
    await t.test(name, () => assertUnavailable(buildPublishedComparison(current, history(), baseline)));
  }
});

test("fund scope changes invalidate a comparison even when the totals happen to match", () => {
  const current = bucket(4394.47, "2026-10-05", { fundSetFingerprint: sha256(["FUND-A", "FUND-C"]) });
  assertUnavailable(buildPublishedComparison(current, history(), BASELINE));
});

test("a current-date or future-date baseline is never accepted as the prior comparison", async t => {
  for (const date of ["2026-10-05", "2026-10-06"]) {
    await t.test(date, () => {
      assertUnavailable(buildPublishedComparison(bucket(), history(), { ...BASELINE, asOfDate: date }));
    });
  }
});

test("missing reconstructed history keeps the published delta but not an invented decomposition", async t => {
  const cases = [
    ["no historical points", []],
    ["only an earlier point", [{ date: "2026-10-01", aumMillionBaht: 4400, complete: true }]],
    ["only current and future points", [
      { date: "2026-10-05", aumMillionBaht: 4458.33, complete: true },
      { date: "2026-10-06", aumMillionBaht: 4460, complete: true }
    ]],
    ["null total with a usable-looking partial total", [
      { date: "2026-10-02", aumMillionBaht: null, partialMillionBaht: 4458.06, complete: false }
    ]]
  ];
  for (const [name, aggregate] of cases) {
    await t.test(name, () => {
      const comparison = buildPublishedComparison(bucket(), aggregate, BASELINE);
      assertAvailable(comparison, BASELINE, 63.86);
      assert.equal(comparison.revisedBaselineMillionBaht, null);
      assert.equal(comparison.backfillChangeMillionBaht, null);
      assert.equal(comparison.likeForDateChangeMillionBaht, null);
    });
  }
});

test("an empty archive or an unrelated bucket has no published baseline", async t => {
  const archive = memoryArchive(t);
  assert.equal(await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05"), null);
  archive.append("unrelated", "2026-10-04T02:04:00.000Z", bucket(800, "2026-10-02", { id: "mega30" }));
  assert.equal(await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05"), null);
});

test("baseline selection uses publication order, not insertion order or the greatest historical date", async t => {
  const archive = memoryArchive(t);
  const expected = archive.append("latest-publication", "2026-10-05T01:30:00.000Z", bucket(4394.47, "2026-10-02"));
  archive.append("last-inserted", "2026-10-04T02:04:00.000Z", bucket(4410, "2026-10-03"));
  archive.append("older-publication", "2026-10-03T02:04:00.000Z", bucket(4390, "2026-10-01"));
  assert.deepEqual(await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05"), expected);
});

test("current-date and future-date archive rows without a baseline are excluded", async t => {
  const archive = memoryArchive(t);
  const expected = archive.append("preceding", "2026-10-04T02:04:00.000Z", bucket(4394.47, "2026-10-02"));
  archive.append("same-date", "2026-10-06T02:00:00.000Z", bucket(4458.33));
  archive.append("future-date", "2026-10-06T02:01:00.000Z", bucket(4460, "2026-10-06"));
  assert.deepEqual(await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05"), expected);
});

test("an archive containing only current or future as-of dates returns no baseline", async t => {
  const archive = memoryArchive(t);
  archive.append("current-null-baseline", "2026-10-06T02:00:00.000Z", bucket(4458.33, "2026-10-05", {
    comparison: { method: COMPARISON_METHOD, baseline: null }
  }));
  archive.append("future", "2026-10-06T02:01:00.000Z", bucket(4460, "2026-10-06"));
  assert.equal(await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05"), null);
});

test("invalid embedded current-date or future-date baselines cannot bypass archive date filtering", async t => {
  for (const date of ["2026-10-05", "2026-10-06"]) {
    await t.test(date, async subtest => {
      const archive = memoryArchive(subtest);
      const expected = archive.append("preceding", "2026-10-04T02:04:00.000Z", bucket(4394.47, "2026-10-02"));
      archive.append("invalid-embedded-baseline", "2026-10-06T02:05:00.000Z", bucket(4458.33, "2026-10-05", {
        comparison: { method: COMPARISON_METHOD, baseline: { ...expected, asOfDate: date } }
      }));
      assert.deepEqual(await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05"), expected);
    });
  }
});

test("same-date refreshes and corrections preserve the first immutable published baseline", async t => {
  const archive = memoryArchive(t);
  const original = archive.append("original", "2026-10-04T02:04:00.000Z", bucket(4394.47, "2026-10-02"));
  const firstBaseline = await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05");
  assert.deepEqual(firstBaseline, original);
  const firstComparison = buildPublishedComparison(bucket(), history(), firstBaseline);
  archive.append("first-current", "2026-10-06T02:05:00.000Z", bucket(4458.33, "2026-10-05", {
    comparison: firstComparison
  }));
  const repeatedBaseline = await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05");
  assert.deepEqual(repeatedBaseline, original);
  const duplicate = buildPublishedComparison(bucket(), history(), repeatedBaseline);
  assert.deepEqual(duplicate, firstComparison);
  const correction = buildPublishedComparison(bucket(4460.13), history(4459.06, 4460.13), repeatedBaseline);
  assertAvailable(correction, original, 65.66);
  assert.equal(correction.backfillChangeMillionBaht, 64.59);
  assert.equal(correction.likeForDateChangeMillionBaht, 1.07);
  archive.append("current-correction", "2026-10-06T02:07:00.000Z", bucket(4460.13, "2026-10-05", {
    comparison: correction
  }));
  assert.deepEqual(await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05"), original);
});

test("an intervening older-date publication cannot replace an existing same-date comparison baseline", async t => {
  const archive = memoryArchive(t);
  const original = archive.append("original", "2026-10-04T02:04:00.000Z", bucket(4394.47, "2026-10-02"));
  archive.append("first-current", "2026-10-06T02:05:00.000Z", bucket(4458.33, "2026-10-05", {
    comparison: buildPublishedComparison(bucket(), history(), original)
  }));
  archive.append("later-historical-backfill", "2026-10-06T02:06:00.000Z", bucket(4458.06, "2026-10-02"));
  assert.deepEqual(await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05"), original);
});

test("a new as-of date uses the last published preceding bucket total, not its embedded baseline", async t => {
  const archive = memoryArchive(t);
  archive.append("original", "2026-10-04T02:04:00.000Z", bucket(4394.47, "2026-10-02"));
  const comparison = buildPublishedComparison(bucket(4460.13), history(4459.06, 4460.13), BASELINE);
  const expected = archive.append("corrected-previous-day", "2026-10-06T02:07:00.000Z", bucket(4460.13, "2026-10-05", {
    comparison
  }));
  archive.append("current-date-legacy", "2026-10-07T02:04:00.000Z", bucket(4470, "2026-10-06"));
  archive.append("future", "2026-10-07T02:05:00.000Z", bucket(4480, "2026-10-07"));
  const baseline = await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-06");
  assert.deepEqual(baseline, expected);
  const nextComparison = buildPublishedComparison(bucket(4470, "2026-10-06"), [
    { date: "2026-10-05", aumMillionBaht: 4460.13, complete: true },
    { date: "2026-10-06", aumMillionBaht: 4470, complete: true }
  ], baseline);
  assertAvailable(nextComparison, expected, 9.87);
  assert.equal(nextComparison.backfillChangeMillionBaht, 0);
});

test("scope mismatch remains unavailable across repeated same-date refreshes", async t => {
  const archive = memoryArchive(t);
  const original = archive.append("old-scope", "2026-10-04T02:04:00.000Z", bucket(4394.47, "2026-10-02"));
  const current = bucket(4458.33, "2026-10-05", { fundSetFingerprint: sha256(["FUND-A", "FUND-B", "FUND-C"]) });
  const unavailable = buildPublishedComparison(current, history(), original);
  assertUnavailable(unavailable);
  archive.append("new-scope-current", "2026-10-06T02:05:00.000Z", { ...current, comparison: unavailable });
  const baseline = await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05");
  assert.deepEqual(baseline, original);
  assertUnavailable(buildPublishedComparison(current, history(), baseline));
});

test("legacy scope fingerprints are based only on sorted codes in the requested bucket", async t => {
  const archive = memoryArchive(t);
  const legacyBucket = bucket(4394.47, "2026-10-02");
  delete legacyBucket.fundSetFingerprint;
  archive.append("legacy-original", "2026-10-04T02:04:00.000Z", legacyBucket, {
    funds: [
      { code: "FUND-B", bucketId: BUCKET_ID },
      { code: "UNRELATED", bucketId: "mega30" },
      { code: "FUND-A", bucketId: BUCKET_ID }
    ]
  });
  const first = await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05");
  assert(first);
  assert.equal(first.fundSetFingerprint, SCOPE);
  archive.append("legacy-reordered", "2026-10-04T02:05:00.000Z", legacyBucket, {
    funds: [
      { code: "FUND-A", bucketId: BUCKET_ID },
      { code: "ANOTHER-UNRELATED", bucketId: "other_funds" },
      { code: "FUND-B", bucketId: BUCKET_ID }
    ]
  });
  const reordered = await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05");
  assert.equal(reordered.snapshotId, "legacy-reordered");
  assert.equal(reordered.fundSetFingerprint, first.fundSetFingerprint);
  archive.append("legacy-changed-scope", "2026-10-04T02:06:00.000Z", legacyBucket, {
    funds: [{ code: "FUND-A", bucketId: BUCKET_ID }, { code: "FUND-C", bucketId: BUCKET_ID }]
  });
  const changed = await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05");
  assert.notEqual(changed.fundSetFingerprint, first.fundSetFingerprint);
  assertUnavailable(buildPublishedComparison(bucket(4458.33, "2026-10-05", {
    fundSetFingerprint: first.fundSetFingerprint
  }), history(), changed));
});

test("a published zero baseline is not skipped by the archive loader", async t => {
  const archive = memoryArchive(t);
  const expected = archive.append("zero", "2026-10-04T02:04:00.000Z", bucket(0, "2026-10-02"));
  const baseline = await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05");
  assert.deepEqual(baseline, expected);
  assertAvailable(buildPublishedComparison(bucket(1.25), history(0, 1.25), baseline), expected, 1.25);
});

test("baseline lookup and comparison preserve every archived payload byte and row", async t => {
  const archive = memoryArchive(t);
  archive.append("original", "2026-10-04T02:04:00.000Z", bucket(4394.47, "2026-10-02", {
    changeMillionBaht: 1.09,
    history: [{ date: "2026-10-01", value: 4393.38 }, { date: "2026-10-02", value: 4394.47 }]
  }), {
    extraPayload: {
      officialAua: [{ referenceDate: "2026-07-20", amountMillionBaht: 5000 }],
      model: { id: "model-preserved", slope: 1.78, pearsonR: 0.98 },
      projection: { value: 8332.87, lower: 6487.93, upper: 10143.52 },
      charts: { timeline: [{ date: "2026-10-02", seriesxAum: 4394.47 }] }
    }
  });
  const originalRows = archive.rows();
  const originalPayloadHash = sha256(originalRows[0].payload_json);
  const baseline = await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05");
  const comparison = buildPublishedComparison(deepFreeze(bucket()), deepFreeze(history()), deepFreeze(baseline));
  assertAvailable(comparison, baseline, 63.86);
  assert.deepEqual(archive.rows(), originalRows);
  archive.append("new", "2026-10-06T02:05:00.000Z", bucket(4458.33, "2026-10-05", { comparison }));
  const rowsAfterAppend = archive.rows();
  await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-05");
  await loadPublishedBaseline(archive.db, BUCKET_ID, "2026-10-06");
  assert.deepEqual(archive.rows(), rowsAfterAppend);
  const retained = archive.rows().find(row => row.id === "original");
  assert.deepEqual(retained, originalRows[0]);
  assert.equal(sha256(retained.payload_json), originalPayloadHash);
});

const SERIES_CODES = ["FUND-A", "FUND-B", "FUND-C", "FUND-D"];

async function workerFixture(t) {
  const archive = memoryArchive(t, { workerSchema: true });
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-06T02:00:00.000Z") });
  const objects = new Map();
  const env = {
    DB: archive.db,
    FILES: { async put(key, value, options) { objects.set(key, { value, options }); } }
  };
  for (const [code, bucketId] of [
    ...SERIES_CODES.map(code => [code, BUCKET_ID]), ["MEGA-TEST", "mega30"], ["OTHER-TEST", "other_funds"]
  ]) {
    await env.DB.prepare(`
      INSERT INTO funds (id, code, bucket_id, bucket_name, data_source, inception_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'test', '2026-06-01', ?, ?)
    `).bind(code, code, bucketId, bucketId, new Date().toISOString(), new Date().toISOString()).run();
  }
  const putAum = async (code, date, amount) => {
    await env.DB.prepare(`
      INSERT INTO aum_points (fund_id, as_of_date, aum_million_baht, inserted_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(fund_id, as_of_date) DO UPDATE SET
        aum_million_baht=excluded.aum_million_baht, revised_at=excluded.inserted_at
    `).bind(code, date, amount, new Date().toISOString()).run();
  };
  for (const [i, amount] of [205, 370, 630, 760].entries()) {
    const date = `2026-0${i + 6}-01`;
    for (const code of SERIES_CODES) await putAum(code, date, (i + 1) * 25);
    await env.DB.prepare(`
      INSERT INTO aua_observations (id, reference_date, amount_million_baht, announced_at, discovered_at,
        status, label, observation_key, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'verified', 'In-memory actual', ?, 1, ?, ?)
    `).bind(`actual-${i}`, date, amount, date, date, `${date}:${amount}`, date, date).run();
  }
  for (const [code, amount] of [["FUND-A", 99.38], ["FUND-B", 1000], ["FUND-C", 1000], ["FUND-D", 2294],
    ["MEGA-TEST", 50], ["OTHER-TEST", 10]]) await putAum(code, "2026-10-01", amount);
  await putAum("FUND-A", "2026-10-02", 100.47);
  return {
    ...archive,
    putAum,
    async rebuild() {
      t.mock.timers.tick(1000);
      const before = archive.rows();
      const oldIds = new Set(before.map(row => row.id));
      const snapshot = await rebuildModelAndSnapshot(env, "bucket-comparison-regression");
      const after = archive.rows();
      assert.equal(after.length, before.length + 1);
      assert.deepEqual(after.filter(row => oldIds.has(row.id)), before, "Every prior snapshot byte must be retained");
      assert.equal(objects.size, 0, "Snapshot rebuild must not use external document storage");
      assertSnapshotArithmetic(snapshot);
      return snapshot;
    },
    async models() {
      return (await env.DB.prepare("SELECT * FROM model_versions ORDER BY id").all()).results;
    },
    async projections() {
      return (await env.DB.prepare("SELECT * FROM projections ORDER BY id").all()).results;
    }
  };
}

function seriesBucket(snapshot) {
  return snapshot.buckets.find(card => card.id === BUCKET_ID);
}

function publishedBaseline(archive, snapshot) {
  const row = archive.rows().find(row => row.generated_at === snapshot.generatedAt && row.data_version === snapshot.dataVersion);
  assert(row);
  const card = seriesBucket(snapshot);
  return { snapshotId: row.id, dataVersion: row.data_version, publishedAt: row.generated_at,
    asOfDate: card.latestDate, totalMillionBaht: card.totalMillionBaht, fundSetFingerprint: card.fundSetFingerprint };
}

function assertSnapshotArithmetic(snapshot) {
  for (const card of snapshot.buckets) {
    const latest = card.history.at(-1);
    const previous = card.history.at(-2);
    assert.equal(card.totalMillionBaht, latest?.value ?? null);
    assert.equal(card.previousTotalMillionBaht, previous?.value ?? null);
    const originalDelta = latest?.value != null && previous?.value != null ? round2(latest.value - previous.value) : null;
    assert.equal(card.changeMillionBaht, originalDelta, "The original bucket delta formula must remain unchanged");
    assert.equal(card.changePct, latest?.value != null && previous?.value ? (latest.value - previous.value) / previous.value : null);
    const usableFunds = snapshot.funds.filter(fund => fund.bucketId === card.id && fund.latestDate &&
      fund.latestDate <= card.latestDate && fund.aumMillionBaht != null &&
      (Date.parse(card.latestDate) - Date.parse(fund.latestDate)) / 86400000 <= 7);
    assert.equal(card.sameDateFundCount, usableFunds.filter(fund => fund.latestDate === card.latestDate).length);
    assert.equal(card.carriedForwardFundCount, usableFunds.filter(fund => fund.latestDate < card.latestDate).length);
    assert.equal(card.sameDateFundCount + card.carriedForwardFundCount, card.coveredFundCount);
    const comparison = card.comparison;
    if (comparison.status === "available" && comparison.revisedBaselineMillionBaht != null) {
      assert.equal(round2(comparison.backfillChangeMillionBaht + comparison.likeForDateChangeMillionBaht), comparison.changeMillionBaht);
    }
  }
}

function withoutPublicationComparison(snapshot) {
  const { generatedAt, dataVersion, buckets, ...rest } = snapshot;
  return { ...rest, buckets: buckets.map(({ comparison, ...card }) => card) };
}

test("worker: late 2 October NAV, new 5 October NAV and repeated corrections preserve published comparisons and training", async t => {
  const fixture = await workerFixture(t);
  const initial = await fixture.rebuild();
  const frozenBaseline = publishedBaseline(fixture, initial);
  const trainingRows = await fixture.models();
  const trainingTimeline = initial.charts.timeline.filter(point => point.date <= "2026-09-01");
  assert.equal(trainingRows.length, 1);
  assert.equal(initial.model.pairCount, 4);
  assert.equal(seriesBucket(initial).totalMillionBaht, 4394.47);
  assert.equal(seriesBucket(initial).changeMillionBaht, 1.09);
  assert.equal(seriesBucket(initial).sameDateFundCount, 1);
  assert.equal(seriesBucket(initial).carriedForwardFundCount, 3);
  await fixture.putAum("FUND-A", "2026-10-05", 100.74);
  const newDate = await fixture.rebuild();
  assert.equal(seriesBucket(newDate).totalMillionBaht, 4394.74);
  assertAvailable(seriesBucket(newDate).comparison, frozenBaseline, 0.27);
  const originalNewDateProjections = await fixture.projections();
  for (const [code, amount] of [["FUND-B", 1021.39], ["FUND-C", 1008.93], ["FUND-D", 2327.27]]) {
    await fixture.putAum(code, "2026-10-02", amount);
  }
  const backfilled = await fixture.rebuild();
  const backfilledCard = seriesBucket(backfilled);
  assert.equal(backfilledCard.totalMillionBaht, 4458.33);
  assert.equal(backfilledCard.previousTotalMillionBaht, 4458.06);
  assert.equal(backfilledCard.changeMillionBaht, 0.27);
  assertAvailable(backfilledCard.comparison, frozenBaseline, 63.86);
  assert.equal(backfilledCard.comparison.backfillChangeMillionBaht, 63.59);
  assert.equal(backfilledCard.comparison.likeForDateChangeMillionBaht, 0.27);
  assert.equal(backfilledCard.sameDateFundCount, 1);
  assert.equal(backfilledCard.carriedForwardFundCount, 3);
  assert.equal(backfilledCard.coverageComplete, true);
  const duplicate = await fixture.rebuild();
  assert.equal(duplicate.dataVersion, backfilled.dataVersion);
  assert.deepEqual(duplicate.projection, backfilled.projection);
  assert.deepEqual(seriesBucket(duplicate).comparison, backfilledCard.comparison);
  await fixture.putAum("FUND-A", "2026-10-05", 100.94);
  const currentCorrection = await fixture.rebuild();
  assert.equal(seriesBucket(currentCorrection).changeMillionBaht, 0.47);
  assertAvailable(seriesBucket(currentCorrection).comparison, frozenBaseline, 64.06);
  await fixture.putAum("FUND-B", "2026-10-02", 1022.39);
  const historicalCorrection = await fixture.rebuild();
  assertAvailable(seriesBucket(historicalCorrection).comparison, frozenBaseline, 65.06);
  assert.equal(seriesBucket(historicalCorrection).comparison.backfillChangeMillionBaht, 64.59);
  assert.equal(seriesBucket(historicalCorrection).comparison.likeForDateChangeMillionBaht, 0.47);
  assert.equal(seriesBucket(historicalCorrection).changeMillionBaht, 0.47);
  for (const snapshot of [newDate, backfilled, duplicate, currentCorrection, historicalCorrection]) {
    assert.deepEqual(snapshot.model, initial.model);
    assert.deepEqual(snapshot.charts.comparison, initial.charts.comparison);
    assert.deepEqual(snapshot.charts.timeline.filter(point => point.date <= "2026-09-01"), trainingTimeline);
    assert.equal(snapshot.projection.intervalLevel, initial.projection.intervalLevel);
    assert.equal(snapshot.projection.intervalMethod, initial.projection.intervalMethod);
    assert.equal(snapshot.projection.algorithmVersion, initial.projection.algorithmVersion);
    assert.equal(snapshot.projection.value, round2(snapshot.projection.anchorAuaMillionBaht + snapshot.model.slope *
      (seriesBucket(snapshot).totalMillionBaht - snapshot.projection.anchorAumMillionBaht)));
    assert(snapshot.projection.lower <= snapshot.projection.value && snapshot.projection.value <= snapshot.projection.upper);
  }
  assert.deepEqual(await fixture.models(), trainingRows);
  const retainedProjections = await fixture.projections();
  assert.deepEqual(retainedProjections.filter(row => originalNewDateProjections.some(original => original.id === row.id)), originalNewDateProjections);
});

test("worker: comparison-only publication metadata changes dataVersion without changing AUM, model or interval", async t => {
  const fixture = await workerFixture(t);
  const before = await fixture.rebuild();
  assertUnavailable(seriesBucket(before).comparison);
  const aumBefore = (await fixture.db.prepare("SELECT * FROM aum_points ORDER BY fund_id, as_of_date").all()).results;
  const modelsBefore = await fixture.models();
  const projectionsBefore = await fixture.projections();
  t.mock.timers.tick(1000);
  const expected = fixture.append("legacy-preceding-publication", new Date().toISOString(), {
    ...seriesBucket(before), latestDate: "2026-10-01", totalMillionBaht: 4393.38
  }, { funds: before.funds, otherBuckets: before.buckets.filter(card => card.id !== BUCKET_ID) });
  const after = await fixture.rebuild();
  assertAvailable(seriesBucket(after).comparison, expected, 1.09);
  assert.notEqual(after.dataVersion, before.dataVersion);
  assert.deepEqual(withoutPublicationComparison(after), withoutPublicationComparison(before));
  assert.deepEqual((await fixture.db.prepare("SELECT * FROM aum_points ORDER BY fund_id, as_of_date").all()).results, aumBefore);
  assert.deepEqual(await fixture.models(), modelsBefore);
  assert.deepEqual(await fixture.projections(), projectionsBefore);
  assert.equal(await fixture.db.prepare("SELECT value FROM metadata WHERE key='current_data_version'").first("value"), after.dataVersion);
  const repeated = await fixture.rebuild();
  assert.equal(repeated.dataVersion, after.dataVersion);
  assert.deepEqual(seriesBucket(repeated).comparison.baseline, expected);
});

test("worker: non-SeriesX daily AUM updates leave training parameters and the entire SeriesX interval unchanged", async t => {
  const fixture = await workerFixture(t);
  const before = await fixture.rebuild();
  const modelsBefore = await fixture.models();
  const projectionsBefore = await fixture.projections();
  await fixture.putAum("MEGA-TEST", "2026-10-05", 55);
  await fixture.putAum("OTHER-TEST", "2026-10-05", 12);
  const after = await fixture.rebuild();
  assert.notEqual(after.dataVersion, before.dataVersion);
  assert.deepEqual(after.model, before.model);
  assert.deepEqual(after.projection, before.projection);
  assert.deepEqual(after.charts, before.charts);
  assert.deepEqual(seriesBucket(after), seriesBucket(before));
  assert.deepEqual(await fixture.models(), modelsBefore);
  assert.deepEqual(await fixture.projections(), projectionsBefore);
  assert.equal(after.buckets.find(card => card.id === "mega30").comparison.changeMillionBaht, 5);
  assert.equal(after.buckets.find(card => card.id === "other_funds").comparison.changeMillionBaht, 2);
});

test("worker: expired carried NAV is missing coverage, not same-date data or a zero total", async t => {
  const fixture = await workerFixture(t);
  const before = await fixture.rebuild();
  t.mock.timers.tick(4 * 86400000);
  await fixture.putAum("FUND-A", "2026-10-09", 101);
  const after = await fixture.rebuild();
  const card = seriesBucket(after);
  assert.equal(card.fundCount, 4);
  assert.equal(card.coveredFundCount, 1);
  assert.equal(card.sameDateFundCount, 1);
  assert.equal(card.carriedForwardFundCount, 0);
  assert.equal(card.coverageComplete, false);
  assert.equal(card.partialMillionBaht, 101);
  assert.equal(card.totalMillionBaht, null);
  assert.equal(card.changeMillionBaht, null);
  assertUnavailable(card.comparison);
  assert.deepEqual(card.comparison.baseline, publishedBaseline(fixture, before));
  assert.equal(after.projection.value, null);
  assert.equal(after.projection.lower, null);
  assert.equal(after.projection.upper, null);
  assert.deepEqual(after.model, before.model);
});
