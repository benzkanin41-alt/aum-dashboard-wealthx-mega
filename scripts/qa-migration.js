import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { DATA_ROOT, cachePath } from "../server-lib/local-paths.js";
import { chromium } from "playwright";

const base = 'http://127.0.0.1:12014';
const remote = 'https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site';
const health = await fetch(`${base}/api/health`).then(r => r.json());
assert.equal(health.appId, 'aum-dashboard');
assert.equal(path.resolve(health.dataRoot), path.resolve(DATA_ROOT));
const online = await fetch(`${remote}/api/dashboard`).then(r => r.json());
const local = await fetch(`${base}/api/dashboard`).then(r => r.json());
assert.equal(local.offline, false);
assert.equal(local.dataVersion, online.dataVersion);
assert.deepEqual(local.buckets, online.buckets);
assert.deepEqual(local.projection, online.projection);
assert.equal(JSON.parse(await readFile(cachePath('dashboard-cache.json'), 'utf8')).dataVersion, online.dataVersion);

// Use an isolated server with an unreachable upstream; do not disable the user's network.
const offline = spawn(process.execPath, ['server.js'], { cwd: process.cwd(), windowsHide: true, env: { ...process.env, PORT: '12015', SITES_BASE_URL: 'http://127.0.0.1:1' }, stdio: 'ignore' });
try {
  let cached;
  for (let i=0;i<40;i++) {
    try { cached = await fetch('http://127.0.0.1:12015/api/dashboard').then(r=>r.json()); break; } catch { await new Promise(r=>setTimeout(r,250)); }
  }
  assert.equal(cached?.offline, true);
  assert.equal(cached.dataVersion, online.dataVersion);
} finally { offline.kill(); await new Promise(r=>offline.once('exit',r)); }

const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  await page.goto(base);
  await page.getByRole('heading', { name:'WealthX AUM & AUA', exact:true }).waitFor();
  await page.getByTestId('refresh-button').waitFor();
  assert.ok((await page.locator('body').innerText()).includes(online.dataVersion));
  await page.screenshot({path:path.join(DATA_ROOT,'migration-local.png'),fullPage:true});
} finally { await browser.close(); }
const evidence = { checkedAt:new Date().toISOString(), localOnlineMatch:true, offlineCache:true, rootIsE:true, coldShortcut:process.env.COLD_SHORTCUT_VERIFIED==='1', dataVersion:online.dataVersion, modelVersion:online.model.id };
assert.equal(evidence.coldShortcut,true,'Run this after a verified cold shortcut launch.');
await writeFile(path.join(DATA_ROOT,'migration-acceptance.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence));
