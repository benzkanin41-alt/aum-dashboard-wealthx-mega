const base = (process.env.SITES_BASE_URL || "https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site").replace(/\/$/, "");
let status = null;
for (let attempt = 0; attempt < 100; attempt += 1) {
  const response = await fetch(`${base}/api/admin/bootstrap`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Bootstrap HTTP ${response.status}`);
  status = payload.bootstrap;
  console.log(JSON.stringify(status));
  if (status.complete) break;
}
if (!status?.complete) throw new Error("Bootstrap did not complete within 100 chunks");
const dashboardResponse = await fetch(`${base}/api/dashboard`);
const dashboard = await dashboardResponse.json();
if (!dashboardResponse.ok || dashboard.appId !== "aum-dashboard") throw new Error("Dashboard snapshot was not created after bootstrap");
console.log(JSON.stringify({ ok: true, dataVersion: dashboard.dataVersion, modelVersion: dashboard.model?.id }));
