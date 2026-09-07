import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  SERIESX_BUCKET_ID,
  buildAggregateHistory,
  fitProjectionModel,
  matchAuaToAum,
  projectAua,
  round2
} from "../shared/model.js";

const root = new URL("../", import.meta.url);
const config = JSON.parse(await readFile(new URL("config/funds.json", root), "utf8"));
const history = JSON.parse(await readFile(new URL("data/nav-history.json", root), "utf8"));
const observations = JSON.parse(await readFile(new URL("data/official-aua.json", root), "utf8"));

test("strict SeriesX history reproduces the audited milestone matches", () => {
  const aggregates = buildAggregateHistory(config, history, SERIESX_BUCKET_ID);
  const pairs = matchAuaToAum(observations, aggregates);
  const actual = Object.fromEntries(pairs.map((pair) => [pair.referenceDate, [pair.aumDate, pair.aumMillionBaht]]));
  assert.deepEqual(actual, {
    "2025-12-31": ["2025-12-30", 20.55],
    "2026-03-31": ["2026-03-31", 521.54],
    "2026-04-16": ["2026-04-16", 622.1],
    "2026-05-27": ["2026-05-27", 1288.08],
    "2026-06-18": ["2026-06-18", 1909.54],
    "2026-06-30": ["2026-06-30", 2098.14],
    "2026-07-20": ["2026-07-20", 2523.5]
  });
});

test("anchored projection uses OLS slope and latest official reference date", () => {
  const aggregates = buildAggregateHistory(config, history, SERIESX_BUCKET_ID);
  const model = fitProjectionModel(matchAuaToAum(observations, aggregates));
  const latest = aggregates.at(-1);
  const projection = projectAua(model, latest);
  assert.equal(model.pairCount, 7);
  assert.equal(round2(model.slope), 1.78);
  assert.equal(round2(model.pearsonR), 0.98);
  assert.equal(model.anchor.referenceDate, "2026-07-20");
  assert.equal(latest.date, "2026-09-04");
  assert.equal(latest.aumMillionBaht, 3898.59);
  assert.equal(projection.value, 7449.53);
});

test("new AUM changes projection without changing model version", () => {
  const pairs = [
    { auaId: "a", referenceDate: "2026-01-01", aumDate: "2026-01-01", aumMillionBaht: 100, auaMillionBaht: 200 },
    { auaId: "b", referenceDate: "2026-02-01", aumDate: "2026-02-01", aumMillionBaht: 200, auaMillionBaht: 400 },
    { auaId: "c", referenceDate: "2026-03-01", aumDate: "2026-03-01", aumMillionBaht: 300, auaMillionBaht: 600 },
    { auaId: "d", referenceDate: "2026-04-01", aumDate: "2026-04-01", aumMillionBaht: 400, auaMillionBaht: 800 }
  ];
  const model = fitProjectionModel(pairs);
  const first = projectAua(model, { date: "2026-04-02", aumMillionBaht: 450 });
  const second = projectAua(model, { date: "2026-04-03", aumMillionBaht: 500 });
  assert.equal(model.fingerprint, fitProjectionModel(pairs).fingerprint);
  assert.equal(first.value, 900);
  assert.equal(second.value, 1000);
});

test("new or corrected official AUA changes the training fingerprint", () => {
  const base = [
    { auaId: "a", referenceDate: "2026-01-01", aumDate: "2026-01-01", aumMillionBaht: 100, auaMillionBaht: 200 },
    { auaId: "b", referenceDate: "2026-02-01", aumDate: "2026-02-01", aumMillionBaht: 200, auaMillionBaht: 400 },
    { auaId: "c", referenceDate: "2026-03-01", aumDate: "2026-03-01", aumMillionBaht: 300, auaMillionBaht: 600 },
    { auaId: "d", referenceDate: "2026-04-01", aumDate: "2026-04-01", aumMillionBaht: 400, auaMillionBaht: 800 }
  ];
  const original = fitProjectionModel(base);
  const duplicate = fitProjectionModel(structuredClone(base));
  const corrected = fitProjectionModel(base.map((pair) => pair.auaId === "c" ? { ...pair, auaMillionBaht: 650 } : pair));
  const added = fitProjectionModel([...base, { auaId: "e", referenceDate: "2026-05-01", aumDate: "2026-05-01", aumMillionBaht: 500, auaMillionBaht: 1000 }]);
  assert.equal(duplicate.fingerprint, original.fingerprint);
  assert.notEqual(corrected.fingerprint, original.fingerprint);
  assert.notEqual(added.fingerprint, original.fingerprint);
});

test("model refuses too few pairs and future AUM is never matched", () => {
  const model = fitProjectionModel([
    { auaId: "a", referenceDate: "2026-01-01", aumDate: "2026-01-01", aumMillionBaht: 100, auaMillionBaht: 200 }
  ]);
  assert.equal(model.status, "unavailable");
  const matched = matchAuaToAum([
    { id: "a", referenceDate: "2026-01-01", amountMillionBaht: 200, status: "verified" }
  ], [
    { date: "2026-01-02", aumMillionBaht: 100, complete: true }
  ]);
  assert.equal(matched.length, 0);
});
