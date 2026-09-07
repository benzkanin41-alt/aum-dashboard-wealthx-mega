import assert from "node:assert/strict";
import test from "node:test";
import { extractAuaActuals, extractIrPdfUrls, parseSettradeNuxtRows } from "../worker/sources.ts";

test("safe Settrade parser resolves Nuxt primitive aliases without eval", () => {
  const html = '<script>window.__NUXT__=(function(a,b,c,d,e){return {state:{mutualfund:{quotationChart:{quotations:[{date:c,navPerUnit:d,nav:e}]}}}}}(null,false,"2026-09-04T00:00:00.000Z",10.25,125000000))</script>';
  const rows = parseSettradeNuxtRows(html, "TEST", "https://example.test");
  assert.deepEqual(rows, [{ code: "TEST", navDate: "2026-09-04", nav: 10.25, netAsset: 125000000, aumMillionBaht: 125, source: "https://example.test" }]);
});

test("IR link extraction is deterministic and removes duplicates", () => {
  const html = 'x https:\\/\\/t0.ltmh.com\\/public\\/LTMH_AUA_5_000.pdf y https://t0.ltmh.com/public/LTMH_AUA_5_000.pdf';
  assert.deepEqual(extractIrPdfUrls(html), ["https://t0.ltmh.com/public/LTMH_AUA_5_000.pdf"]);
});

test("AUA extraction accepts reported actuals and rejects targets", () => {
  const actual = extractAuaActuals("WealthX AUA reached Baht 5,000 million on 20 July 2026.");
  assert.deepEqual(actual.map(({ referenceDate, amountMillionBaht }) => ({ referenceDate, amountMillionBaht })), [{ referenceDate: "2026-07-20", amountMillionBaht: 5000 }]);
  const filing = extractAuaActuals("As of July 20, 2026, the Assets Under Administration (AUA) of WealthX amounted to 5,000 million Baht. April 16, 2026 : AUA of 1,000 million Baht");
  assert.deepEqual(filing.map(({ referenceDate, amountMillionBaht }) => ({ referenceDate, amountMillionBaht })), [
    { referenceDate: "2026-04-16", amountMillionBaht: 1000 },
    { referenceDate: "2026-07-20", amountMillionBaht: 5000 }
  ]);
  assert.equal(extractAuaActuals("We target AUA reaching Baht 10,000 million on 31 December 2026.").length, 0);
});
