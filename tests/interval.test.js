import assert from "node:assert/strict";
import test from "node:test";
import { fitProjectionModel, projectAua, buildAggregateHistory, matchAuaToAum } from "../shared/model.js";
const pairs = [205,370,630,760,1060,1195,1450].map((y,i) => ({auaId:`a${i}`, referenceDate:`2026-0${i+1}-01`, aumDate:`2026-0${i+1}-01`, aumMillionBaht:100*(i+1), auaMillionBaht:y}));

test("95% predictive bounds are deterministic and include new-observation error", () => {
  const model = fitProjectionModel(pairs);
  assert.equal(model.status, "provisional");
  const point = {date:"2026-07-02", aumMillionBaht:700};
  const first = projectAua(model,point);
  assert.deepEqual(first, projectAua(model,point));
  assert.ok(first.lower < first.value && first.upper > first.value);
  // At delta-x=0 a slope-only interval collapses, but prediction must not.
  assert.ok(first.upper-first.lower > Math.sqrt(model.residualVariance)*4);
  const anchor = projectAua(model,{...point,date:"2026-07-01"});
  assert.equal(anchor.lower,1450); assert.equal(anchor.upper,1450);
  const extrapolated = projectAua(model,{...point,aumMillionBaht:2000});
  assert.equal(extrapolated.extrapolated,true);
  assert.ok(extrapolated.upper-extrapolated.lower > first.upper-first.lower);
  assert.ok(extrapolated.lower>=0);
});

test("OLS agrees with independent raw-sum formula; correction changes fit and fingerprint",()=>{
  const xs=pairs.map(p=>p.aumMillionBaht), ys=pairs.map(p=>p.auaMillionBaht), n=xs.length;
  const sum=a=>a.reduce((x,y)=>x+y,0);
  const covariance=n*sum(xs.map((x,i)=>x*ys[i]))-sum(xs)*sum(ys);
  const sx=n*sum(xs.map(x=>x*x))-sum(xs)**2;
  const sy=n*sum(ys.map(y=>y*y))-sum(ys)**2;
  const fit=fitProjectionModel(pairs);
  assert.ok(Math.abs(fit.slope-covariance/sx)<1e-12);
  assert.ok(Math.abs(fit.pearsonR-covariance/Math.sqrt(sx*sy))<1e-12);
  const revised=fitProjectionModel(pairs.map((p,i)=>i===3?{...p,aumMillionBaht:440}:p));
  assert.notEqual(fit.fingerprint,revised.fingerprint);
  assert.notEqual(fit.slope,revised.slope);
  assert.equal(fit.fingerprint,fitProjectionModel([...pairs].reverse()).fingerprint);
});

test("new fund missing from NAV is not zero and pre-inception NAV is excluded",()=>{
  const config={buckets:[{id:"wealthx_other",funds:[{code:"OLD",inceptionDate:"2026-01-01"},{code:"NEW",inceptionDate:"2026-09-16"}]}]};
  const history={OLD:{a:{navDate:"2026-09-15",aumMillionBaht:100},b:{navDate:"2026-09-16",aumMillionBaht:110}},NEW:{a:{navDate:"2026-09-15",aumMillionBaht:10}}};
  const aggregates=buildAggregateHistory(config,history,"wealthx_other");
  const latest=aggregates.at(-1);
  assert.equal(latest.complete,false);assert.equal(latest.aumMillionBaht,null);assert.equal(latest.expectedFundCount,2);
  assert.equal(aggregates.find(x=>x.date==="2026-09-15").aumMillionBaht,100);
  assert.equal(matchAuaToAum([{id:"x",referenceDate:"2026-09-16",status:"verified",amountMillionBaht:200}],aggregates).length,0);
  assert.equal(projectAua(fitProjectionModel(pairs),latest).value,null);
});

test("unmatched latest actual cannot silently anchor to an older actual",()=>{
  const model=fitProjectionModel(pairs,[{id:"new",date:"2026-09-17",amount:2000}]);
  assert.equal(model.status,"unavailable");
  assert.equal(projectAua(model,{date:"2026-09-17",aumMillionBaht:900}).value,null);
});

test("backtest training uses only announcements and NAV available at the cutoff",()=>{
  const cutoff="2026-06-01";
  const vintage=pairs.map(p=>({...p,announcedAt:p.referenceDate}));
  vintage[2].announcedAt="2026-08-01";
  const known=vintage.filter(p=>p.announcedAt<=cutoff&&p.aumDate<=cutoff);
  assert.equal(known.length,5);
  const fit=fitProjectionModel(known);
  assert.equal(fit.anchor.referenceDate,cutoff);
  assert.ok(!fit.pairs.some(p=>p.auaId==="a2"));
});
