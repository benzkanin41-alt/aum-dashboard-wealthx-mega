import { access, cp, mkdir, rm } from "node:fs/promises";

const root = new URL("../dist/", import.meta.url);
const workerCandidates = [new URL("ltmh_wealthx_aum_aua/", root), new URL("client/ltmh_wealthx_aum_aua/", root)];
const workerSource = await firstExisting(workerCandidates);
if (!workerSource) throw new Error("Cloudflare Worker build output was not found");
const server = new URL("server/", root);
await rm(server, { recursive: true, force: true });
await mkdir(server, { recursive: true });
await cp(workerSource, server, { recursive: true });
await rm(workerSource, { recursive: true, force: true });

const nestedClient = new URL("client/client/", root);
if (await exists(nestedClient)) {
  const temporary = new URL("_client/", root);
  await rm(temporary, { recursive: true, force: true });
  await cp(nestedClient, temporary, { recursive: true });
  await rm(new URL("client/", root), { recursive: true, force: true });
  await cp(temporary, new URL("client/", root), { recursive: true });
  await rm(temporary, { recursive: true, force: true });
}

if (!(await exists(new URL("server/index.js", root)))) throw new Error("dist/server/index.js is missing");
if (!(await exists(new URL("client/index.html", root)))) throw new Error("dist/client/index.html is missing");
if (!(await exists(new URL(".openai/hosting.json", root)))) throw new Error("dist/.openai/hosting.json is missing");
console.log("Sites artifact ready: dist/server/index.js + dist/client + dist/.openai");

async function firstExisting(urls) {
  for (const url of urls) if (await exists(url)) return url;
  return null;
}

async function exists(url) {
  try { await access(url); return true; } catch { return false; }
}
