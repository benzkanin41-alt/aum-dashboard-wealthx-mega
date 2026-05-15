import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fetchTalisPublicNav, mergeTalisRowsIntoHistory } from "./talis-public.js";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const FUNDS_PATH = path.join(ROOT, "config", "funds.json");
const HISTORY_PATH = path.join(DATA_DIR, "nav-history.json");
const MAP_PATH = path.join(DATA_DIR, "project-map.json");
const STATUS_PATH = path.join(DATA_DIR, "refresh-status.json");

loadLocalEnv();

let refreshState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  message: "idle",
  errors: [],
  progress: { done: 0, total: 0 }
};

export function getRefreshState() {
  return refreshState;
}

export async function loadDashboardData() {
  const [fundConfig, history, status, baseline] = await Promise.all([
    readJson(FUNDS_PATH, { buckets: [] }),
    readJson(HISTORY_PATH, {}),
    readJson(STATUS_PATH, {}),
    readJson(path.join(DATA_DIR, "manual-baseline.json"), {})
  ]);
  return buildDashboardPayload(fundConfig, history, status, baseline);
}

export async function refreshAll({ full = false } = {}) {
  if (refreshState.running) return refreshState;

  refreshState = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    message: "starting",
    errors: [],
    progress: { done: 0, total: 0 }
  };

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const apiKey = process.env.SEC_API_KEY || process.env.SEC_PRIMARY_KEY;
    if (!apiKey) throw new Error("SEC_API_KEY is missing. Set it before refresh.");

    const config = await readJson(FUNDS_PATH, { buckets: [] });
    const projectMap = await readJson(MAP_PATH, {});
    const history = await readJson(HISTORY_PATH, {});
    const funds = flattenFunds(config);

    try {
      const rows = await fetchTalisPublicNav();
      const fallback = mergeTalisRowsIntoHistory({ config, history, rows });
      refreshState.message = `imported ${fallback.imported} Talis public rows`;
      await writeJson(HISTORY_PATH, history);
    } catch (error) {
      refreshState.errors.push(`Talis public fallback: ${error.message}`);
    }

    const days = Number(process.env.HISTORY_DAYS || (full ? 370 : 14));
    const dates = businessDatesBack(days);

    refreshState.progress.total = funds.length * dates.length;
    refreshState.message = `refreshing ${funds.length} funds`;

    for (const fund of funds) {
      const mapKey = `${fund.identifierType}:${fund.identifier}`;
      let projId = fund.identifierType === "proj_id" ? fund.identifier : projectMap[mapKey]?.projId;

      if (!projId && fund.identifierType === "fund_class_name") {
        projId = await resolveProjectId(fund, apiKey);
        if (projId) {
          projectMap[mapKey] = { projId, resolvedAt: new Date().toISOString() };
          await writeJson(MAP_PATH, projectMap);
        }
      }

      if (!projId) {
        refreshState.errors.push(`${fund.code}: cannot resolve project id`);
        refreshState.progress.done += dates.length;
        continue;
      }

      history[fund.code] ||= {};
      for (const date of dates) {
        if (history[fund.code][date] && !full) {
          refreshState.progress.done += 1;
          continue;
        }

        try {
          const row = await fetchDailyNav(projId, date, apiKey);
          if (row) {
            history[fund.code][date] = normalizeNavRow(row, fund, projId, date);
          }
        } catch (error) {
          if (isAuthError(error)) throw error;
          if (!String(error.message).includes("404")) {
            refreshState.errors.push(`${fund.code} ${date}: ${error.message}`);
          }
        } finally {
          refreshState.progress.done += 1;
        }
      }
      await writeJson(HISTORY_PATH, history);
    }

    refreshState.message = "completed";
  } catch (error) {
    refreshState.message = "failed";
    refreshState.errors.push(error.message);
  } finally {
    refreshState.running = false;
    refreshState.finishedAt = new Date().toISOString();
    await writeJson(STATUS_PATH, refreshState);
  }

  return refreshState;
}

export function scheduleDailyRefresh() {
  const scheduleNext = () => {
    const now = new Date();
    const next = nextBangkokNine(now);
    const delay = Math.max(1000, next.getTime() - now.getTime());
    setTimeout(async () => {
      await refreshAll({ full: false });
      scheduleNext();
    }, delay);
    return next;
  };
  return scheduleNext();
}

function buildDashboardPayload(config, history, status, baseline) {
  const buckets = config.buckets.map((bucket) => {
    const funds = bucket.funds.map((fund) => {
      const points = Object.values(history[fund.code] || {})
        .filter((point) => point && point.navDate)
        .sort((a, b) => a.navDate.localeCompare(b.navDate));
      const latest = points.at(-1) || null;
      const previous = points.length > 1 ? points.at(-2) : null;
      return {
        ...fund,
        latest,
        previous,
        points,
        changeMillionBaht: latest && previous ? latest.aumMillionBaht - previous.aumMillionBaht : null,
        changePct: latest && previous && previous.aumMillionBaht ? ((latest.aumMillionBaht / previous.aumMillionBaht) - 1) * 100 : null
      };
    });

    const dates = [...new Set(funds.flatMap((fund) => fund.points.map((point) => point.navDate)))].sort();
    const series = dates.map((date) => {
      const total = funds.reduce((sum, fund) => {
        const point = latestPointOnOrBefore(fund.points, date);
        return sum + Number(point?.aumMillionBaht || 0);
      }, 0);
      return { date, totalMillionBaht: round2(total) };
    }).filter((point) => point.totalMillionBaht > 0);

    const latestTotal = sumFundAum(funds, "latest");
    const previousTotal = sumFundAum(funds, "previous");
    return {
      ...bucket,
      funds,
      series,
      latestTotal,
      previousTotal,
      changeMillionBaht: latestTotal !== null && previousTotal !== null ? round2(latestTotal - previousTotal) : null,
      changePct: latestTotal !== null && previousTotal ? round2(((latestTotal / previousTotal) - 1) * 100) : null
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    status,
    baseline,
    buckets
  };
}

function latestPointOnOrBefore(points, date) {
  let found = null;
  for (const point of points) {
    if (point.navDate <= date) found = point;
    else break;
  }
  return found;
}

function sumFundAum(funds, key) {
  const values = funds.map((fund) => fund[key]?.aumMillionBaht).filter((value) => value !== null && value !== undefined);
  if (!values.length) return null;
  return round2(values.reduce((sum, value) => sum + Number(value || 0), 0));
}

function flattenFunds(config) {
  return config.buckets.flatMap((bucket) => bucket.funds.map((fund) => ({ ...fund, bucketId: bucket.id })));
}

async function resolveProjectId(fund, apiKey) {
  const base = process.env.SEC_API_BASE || "https://api.sec.or.th";
  const attempts = [
    { fund_class_name: fund.identifier },
    { fund_abbr_name: fund.identifier },
    { class_abbr_name: fund.identifier },
    { keyword: fund.identifier }
  ];

  for (const body of attempts) {
    const result = await postJson(`${base}/FundFactsheet/fund/class_fund`, body, apiKey);
    const rows = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : [];
    const exact = rows.find((row) => {
      const values = Object.values(row).map((value) => String(value).toUpperCase());
      return values.includes(fund.identifier.toUpperCase()) || values.includes(fund.code.toUpperCase());
    }) || rows[0];
    const projId = exact?.proj_id || exact?.project_id || exact?.fund_project_id;
    if (projId) return projId;
  }
  return null;
}

async function fetchDailyNav(projId, date, apiKey) {
  const base = process.env.SEC_API_BASE || "https://api.sec.or.th";
  const url = `${base}/FundDailyInfo/${encodeURIComponent(projId)}/dailynav/${date}`;
  const result = await getJson(url, apiKey);
  if (Array.isArray(result)) return result[0] || null;
  if (Array.isArray(result?.data)) return result.data[0] || null;
  if (result?.statusCode === 404) return null;
  return result;
}

function normalizeNavRow(row, fund, projId, requestedDate) {
  const navDate = row.nav_date || row.navDate || row.date || requestedDate;
  const netAsset = numberFrom(row.net_asset ?? row.netAsset ?? row.total_net_asset ?? row.aum);
  const nav = numberFrom(row.last_val ?? row.nav ?? row.nav_value ?? row.value);
  return {
    code: fund.code,
    group: fund.group,
    projId,
    navDate: toDateOnly(navDate),
    aumMillionBaht: netAsset !== null ? round2(netAsset / 1_000_000) : null,
    nav,
    raw: row
  };
}

async function getJson(url, apiKey) {
  const response = await fetch(url, { headers: authHeaders(apiKey) });
  return parseApiResponse(response, url);
}

async function postJson(url, body, apiKey) {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(apiKey), "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseApiResponse(response, url);
}

async function parseApiResponse(response, url) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = typeof payload === "object" ? (payload.message || payload.error || JSON.stringify(payload)) : payload;
    const error = new Error(`${response.status} ${response.statusText}: ${message || url}`);
    error.status = response.status;
    throw error;
  }
  if (payload?.statusCode && payload.statusCode >= 400) {
    const error = new Error(`${payload.statusCode}: ${payload.message || "API error"}`);
    error.status = payload.statusCode;
    throw error;
  }
  return payload;
}

function authHeaders(apiKey) {
  return {
    "accept": "application/json",
    "Ocp-Apim-Subscription-Key": apiKey,
    "x-api-key": apiKey,
    "X-API-Key": apiKey,
    "subscription-key": apiKey
  };
}

function isAuthError(error) {
  return error.status === 401 || error.status === 403 || /subscription key|unauthorized|forbidden/i.test(error.message);
}

function businessDatesBack(days) {
  const dates = [];
  const now = bangkokDateParts(new Date());
  const cursor = new Date(Date.UTC(now.year, now.month - 1, now.day));
  for (let i = 0; i < days; i += 1) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

function nextBangkokNine(now) {
  const parts = bangkokDateParts(now);
  const targetUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 2, 0, 0));
  if (targetUtc <= now) targetUtc.setUTCDate(targetUtc.getUTCDate() + 1);
  return targetUtc;
}

function bangkokDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function toDateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function numberFrom(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}

function round2(number) {
  return Math.round(Number(number) * 100) / 100;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadLocalEnv() {
  const file = path.join(ROOT, ".env.local");
  try {
    const content = fsSync.readFileSync(file, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
    }
  } catch {
    // .env.local is optional because the key can be supplied as an environment variable.
  }
}
