import { advanceBootstrap, getBootstrapStatus } from "./bootstrap.ts";
import { getMetadata } from "./db.ts";
import { apiError, json, optionsResponse } from "./http.ts";
import { advanceRefresh, refreshStatus, startOrReuseRefresh, presentJob } from "./refresh.ts";
import { loadDashboardSnapshot, loadFundDetail, rebuildModelAndSnapshot } from "./snapshot.ts";
import type { Env, RefreshJobRow } from "./types.ts";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return optionsResponse();

    try {
      if (url.pathname === "/api/health") {
        const bootstrap = await getBootstrapStatus(env);
        return json({ ok: true, appId: "aum-dashboard", bootstrap, time: new Date().toISOString() });
      }

      if (url.pathname === "/api/admin/bootstrap" && request.method === "POST") {
        let status = await advanceBootstrap(env);
        if (status.complete && !(await loadDashboardSnapshot(env))) {
          await rebuildModelAndSnapshot(env, "bootstrap");
          status = await getBootstrapStatus(env);
        }
        return json({ ok: true, bootstrap: status });
      }

      if (url.pathname === "/api/dashboard/version" && request.method === "GET") {
        const snapshot = await env.DB.prepare("SELECT data_version, generated_at FROM dashboard_snapshots ORDER BY generated_at DESC LIMIT 1").first<{data_version:string; generated_at:string}>();
        const job = await env.DB.prepare("SELECT * FROM refresh_jobs ORDER BY requested_at DESC LIMIT 1").first<RefreshJobRow>();
        return json({ appId: "aum-dashboard", dataVersion: snapshot?.data_version || null, generatedAt: snapshot?.generated_at || null,
          job: job ? presentJob(job) : null, schedule: { time: "09:00", timezone: "Asia/Bangkok", scheduler: "GitHub Actions", delayPossible: true } });
      }

      if (url.pathname === "/api/dashboard" && request.method === "GET") {
        const snapshot = await loadDashboardSnapshot(env);
        if (!snapshot) return json({ ok: false, bootstrapping: true, bootstrap: await getBootstrapStatus(env) }, 503);
        return json(snapshot, 200, { etag: `"${snapshot.dataVersion}"` });
      }

      if (url.pathname.startsWith("/api/funds/") && request.method === "GET") {
        const code = decodeURIComponent(url.pathname.slice("/api/funds/".length));
        const detail = await loadFundDetail(env, code);
        return detail ? json(detail) : apiError("ไม่พบกองทุน", 404);
      }

      if (url.pathname === "/api/refresh" && request.method === "POST") {
        if ((await getMetadata(env, "bootstrap_complete")) !== "true") return apiError("ระบบกำลังเตรียมฐานข้อมูล", 409);
        const requestedBy = request.headers.get("cf-connecting-ip") ? "public-web" : "scheduler-or-local";
        const started = await startOrReuseRefresh(env, requestedBy);
        const job = started.job?.id ? await advanceRefresh(env, started.job.id) : started.job;
        const presented = job ? await refreshStatus(env, job.id) : null;
        return json({ ok: true, ...started, job: presented }, started.rateLimited ? 429 : 202,
          started.retryAfterSeconds ? { "retry-after": String(started.retryAfterSeconds) } : {});
      }

      if (url.pathname === "/api/refresh/status" && request.method === "GET") {
        const jobId = url.searchParams.get("job");
        if (url.searchParams.get("advance") === "1") await advanceRefresh(env, jobId);
        const status = await refreshStatus(env, jobId);
        return status ? json({ ok: true, job: status }) : json({ ok: true, job: null });
      }

      if (url.pathname.startsWith("/api/sources/") && url.pathname.endsWith("/document") && request.method === "GET") {
        const sourceId = decodeURIComponent(url.pathname.slice("/api/sources/".length, -"/document".length));
        const source = await env.DB.prepare("SELECT r2_key, url FROM aua_sources WHERE id=?").bind(sourceId)
          .first<{ r2_key: string | null; url: string }>();
        if (!source) return apiError("ไม่พบเอกสาร", 404);
        if (!source.r2_key) return Response.redirect(source.url, 302);
        const object = await env.FILES.get(source.r2_key);
        if (!object) return Response.redirect(source.url, 302);
        return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType || "application/pdf", "cache-control": "public, max-age=86400" } });
      }

      if (url.pathname === "/api/model/versions" && request.method === "GET") {
        const rows = await env.DB.prepare(`
          SELECT id, created_at AS createdAt, slope, intercept, pearson_r AS pearsonR, r_squared AS rSquared,
            pair_count AS pairCount, status, reason, anchor_reference_date AS anchorReferenceDate
          FROM model_versions ORDER BY created_at DESC LIMIT 50
        `).all();
        return json({ versions: rows.results });
      }

      if (url.pathname.startsWith("/api/")) return apiError("ไม่พบ API", 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return apiError(error instanceof Error ? error.message : String(error), 500);
    }
  }
};
