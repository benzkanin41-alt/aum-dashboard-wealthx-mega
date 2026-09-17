import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { DATA_ROOT } from "../server-lib/local-paths.js";

const report = { checkedAt: new Date().toISOString(), dataRoot: DATA_ROOT };
const manifest = JSON.parse(await fs.readFile(path.join(DATA_ROOT,"migration-manifest.json"),"utf8"));
for (const item of manifest.entries) {
  assert.equal(await fs.access(item.source).then(()=>true,()=>false),false,`Source recreated: ${item.source}`);
  const bytes = await fs.readFile(item.rollback);
  assert.equal(bytes.length,item.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex").toUpperCase(),item.sha256);
  await fs.access(item.destination);
}
report.migratedFiles = manifest.entries.length;
report.sourceFilesAbsent = true;
report.rollbackHashesMatch = true;
const listener = net.createServer();
await new Promise(resolve=>listener.listen(0,"127.0.0.1",resolve));
const port = listener.address().port;
await new Promise(resolve=>listener.close(resolve));
const child = spawn(process.execPath,["server.js"],{cwd:process.cwd(),windowsHide:true,stdio:"ignore",env:{...process.env,PORT:String(port),SITES_BASE_URL:"http://127.0.0.1:1"}});
let browser;
try {
  let ready=false;
  for(let i=0;i<30;i++) {try {const health=await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();ready=health.appId==="aum-dashboard";if(ready)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  assert(ready,"Isolated offline server did not start");
  const payload=await (await fetch(`http://127.0.0.1:${port}/api/dashboard`)).json();
  assert.equal(payload.offline,true);assert.equal(payload.appId,"aum-dashboard");
  const version=await (await fetch(`http://127.0.0.1:${port}/api/dashboard/version`)).json();
  assert.equal(version.offline,true);assert.equal(version.dataVersion,payload.dataVersion);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator(".system-banner.warning").waitFor();
  await page.screenshot({path:path.join(DATA_ROOT,"tests","offline-final.png")});
  report.offline = {ok:true,dataVersion:payload.dataVersion,cachedAt:payload.cachedAt,banner:await page.locator(".system-banner.warning").innerText()};
} finally {if(browser)await browser.close();child.kill();await new Promise(resolve=>child.once("exit",resolve));}
const badRoot=path.join(DATA_ROOT,"tests",`missing-drive-${crypto.randomUUID()}`);
const failed=spawnSync(process.execPath,["server.js"],{cwd:process.cwd(),windowsHide:true,encoding:"utf8",env:{...process.env,AUM_DATA_ROOT:badRoot},timeout:5000});
assert.notEqual(failed.status,0);assert.match(failed.stderr,/data drive is unavailable/);
assert.equal(await fs.access(badRoot).then(()=>true,()=>false),false);
report.missingDriveFailsWithoutFallback = true;
report.ok=true;
await fs.writeFile(path.join(DATA_ROOT,"tests","storage-final.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
