import assert from "node:assert/strict";
import test from "node:test";
import { testEnv, seedModelFixture } from "./db-fixture.js";
import { rebuildModelAndSnapshot } from "../worker/snapshot.ts";
import { syncFundCatalog } from "../worker/catalog.ts";
import { startOrReuseRefresh, advanceRefresh } from "../worker/refresh.ts";
import { advanceOfficialScan, newOfficialScan } from "../worker/official.ts";

test("D1-compatible persistence: duplicate, daily AUM, corrected AUM, actual revision and new actual",async()=>{
  const env=testEnv("model-revisions");
  try {
    await seedModelFixture(env);
    const original=await rebuildModelAndSnapshot(env,"test");
    const duplicate=await rebuildModelAndSnapshot(env,"test");
    assert.equal(original.model.id,duplicate.model.id);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM projections").first()).n,1);
    await env.DB.prepare("INSERT INTO aum_points(fund_id,as_of_date,aum_million_baht,inserted_at) VALUES ('TEST','2026-07-03',800,'2026-07-03')").run();
    const nextDay=await rebuildModelAndSnapshot(env,"test");
    assert.equal(original.model.id,nextDay.model.id);
    assert.notEqual(original.projection.value,nextDay.projection.value);
    await env.DB.prepare("UPDATE aum_points SET aum_million_baht=810 WHERE as_of_date='2026-07-03'").run();
    const correctedDaily=await rebuildModelAndSnapshot(env,"test");
    assert.equal(original.model.id,correctedDaily.model.id);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM projections").first()).n,3);
    await env.DB.prepare("UPDATE aum_points SET aum_million_baht=440 WHERE as_of_date='2026-04-01'").run();
    const correctedTraining=await rebuildModelAndSnapshot(env,"test");
    assert.notEqual(original.model.id,correctedTraining.model.id);
    assert.notEqual(original.model.slope,correctedTraining.model.slope);
    await env.DB.prepare("INSERT INTO aua_observations SELECT 'revision',reference_date,amount_million_baht+50,announced_at,discovered_at,status,label,observation_key,2,id,created_at,updated_at FROM aua_observations WHERE id='actual-3'").run();
    const revision=await rebuildModelAndSnapshot(env,"test");
    assert.notEqual(correctedTraining.model.id,revision.model.id);
    assert.equal(revision.model.pairCount,7);
    await env.DB.prepare("INSERT INTO aua_observations(id,reference_date,amount_million_baht,announced_at,discovered_at,status,label,observation_key,revision,created_at,updated_at) VALUES ('new','2026-07-03',1650,'2026-07-04','2026-07-04','verified','Test','2026-07-03:1650',1,'2026-07-04','2026-07-04')").run();
    const added=await rebuildModelAndSnapshot(env,"test");
    assert.equal(added.model.pairCount,8);
    assert.notEqual(added.model.id,revision.model.id);
    assert.notEqual(added.model.pearsonR,revision.model.pearsonR);
    assert.equal(added.projection.lower,1650);assert.equal(added.projection.upper,1650);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM model_versions").first()).n,4);
  } finally { env.close(); }
});

test("catalog upsert adds exactly one new class and retains all three groups",async()=>{
  const env=testEnv("catalog");try{
    const first=await syncFundCatalog(env);const second=await syncFundCatalog(env);assert.equal(first,second);
    const fund=await env.DB.prepare("SELECT * FROM funds WHERE code='ONE-HUMANOID-X-UH'").first();
    assert.equal(fund.inception_date,"2026-09-16");assert.equal(fund.bucket_id,"wealthx_other");
    const groups=await env.DB.prepare("SELECT bucket_id,COUNT(*) AS n FROM funds GROUP BY bucket_id ORDER BY bucket_id").all();
    assert.deepEqual(groups.results.map(r=>[r.bucket_id,r.n]),[["mega30",33],["other_funds",9],["wealthx_other",26]]);
  }finally{env.close();}
});

test("concurrent refresh requests share one job; 5 minute throttle and interrupted-step resume",async()=>{
  const env=testEnv("jobs");try{
    const [a,b]=await Promise.all([startOrReuseRefresh(env,"test-a"),startOrReuseRefresh(env,"test-b")]);
    assert.equal(a.job.id,b.job.id);
    await env.DB.prepare("UPDATE refresh_jobs SET stage='aua',cursor=0,result_json=? WHERE id=?").bind(JSON.stringify({auaScan:{...newOfficialScan(),setDone:true,irDone:true}}),a.job.id).run();
    const resumed=await advanceRefresh(env,a.job.id);assert.equal(resumed.stage,"model");
    await env.DB.prepare("UPDATE refresh_jobs SET status='complete' WHERE id=?").bind(a.job.id).run();
    await env.DB.prepare("DELETE FROM metadata WHERE key='refresh_lock'").run();
    assert.equal((await startOrReuseRefresh(env,"retry")).rateLimited,true);
  }finally{env.close();}
});

test("SET outage is incomplete and IR discovers all documents beyond eight, with durable checkpoints",async()=>{
  const env=testEnv("source-outage");const previous=globalThis.fetch;
  try {
    const links=Array.from({length:12},(_,i)=>`https://t0.ltmh.com/public/document${i}.pdf`);
    globalThis.fetch=async(url)=>String(url).includes("set.or.th") ? new Response("Unavailable",{status:503}) : new Response(links.join(" "));
    let scan=newOfficialScan();await advanceOfficialScan(env,scan);
    assert.match(scan.setError,/503/);
    scan=JSON.parse(JSON.stringify(scan));await advanceOfficialScan(env,scan);
    assert.equal(scan.queue.length,12);
    assert.equal((await env.DB.prepare("SELECT status FROM source_status WHERE source_id='set-ltmh-news'").first()).status,"incomplete");
  }finally{globalThis.fetch=previous;env.close();}
});
