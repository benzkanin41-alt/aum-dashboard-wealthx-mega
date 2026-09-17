import { writeCacheSafely } from "../server-lib/dashboard-cache.js";
const base = process.env.SITES_BASE_URL || "https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site";
const response = await fetch(`${base}/api/dashboard`, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Canonical snapshot HTTP ${response.status}`);
const payload = await response.json();
await writeCacheSafely(payload);
console.log(JSON.stringify({ dataVersion: payload.dataVersion, modelVersion: payload.model?.id }));
