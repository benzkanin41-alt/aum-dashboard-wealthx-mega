import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Clock3,
  Database,
  ExternalLink,
  Info,
  Moon,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  WifiOff
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis
} from "recharts";
import type { AuaObservation, Bucket, DashboardData, Fund, RefreshJob } from "./types";
import { registerDashboardTools } from "./webmcp";

const money = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactMoney = new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 });
type TimelineRange = "1Y" | "6M" | "3M" | "1M";
const timelineRanges: TimelineRange[] = ["1Y", "6M", "3M", "1M"];

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<RefreshJob | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      return localStorage.getItem("ltmh-aum-theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });

  const loadDashboard = useCallback(async (): Promise<DashboardData> => {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const payload: any = await response.json();
    if (!response.ok) throw new Error(payload.error || (payload.bootstrapping ? "ระบบกำลังเตรียมฐานข้อมูล" : "โหลดข้อมูลไม่สำเร็จ"));
    if (payload.appId !== "aum-dashboard") throw new Error("ปลายทางไม่ใช่ LTMH WealthX dashboard");
    setData(payload);
    setError(null);
    return payload;
  }, []);

  useEffect(() => {
    void loadDashboard().catch((caught) => setError(messageOf(caught))).finally(() => setLoading(false));
  }, [loadDashboard]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ltmh-aum-theme", theme);
  }, [theme]);

  const runRefresh = useCallback(async () => {
    setError(null);
    let response = await fetch("/api/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    let payload: any = await response.json();
    if (!response.ok && response.status !== 429) throw new Error(payload.error || "เริ่มอัปเดตไม่สำเร็จ");
    if (!payload.job) throw new Error("ไม่พบสถานะการอัปเดต");
    let current: RefreshJob = payload.job;
    setJob(current);
    while (!["complete", "failed"].includes(current.status)) {
      await sleep(700);
      response = await fetch(`/api/refresh/status?job=${encodeURIComponent(current.id)}&advance=1`, { cache: "no-store" });
      payload = await response.json();
      if (!response.ok || !payload.job) throw new Error(payload.error || "อ่านสถานะการอัปเดตไม่สำเร็จ");
      current = payload.job;
      setJob(current);
    }
    if (current.status === "failed") throw new Error(current.error || "อัปเดตไม่สำเร็จ");
    const refreshed = await loadDashboard();
    window.setTimeout(() => setJob(null), 2500);
    return { status: "complete", dataVersion: refreshed.dataVersion, modelVersion: refreshed.model.id };
  }, [loadDashboard]);

  useEffect(() => registerDashboardTools(runRefresh), [runRefresh]);

  const handleRefresh = () => {
    if (job?.status === "running") return;
    void runRefresh().catch((caught) => {
      setError(messageOf(caught));
      setJob((current) => current ? { ...current, status: "failed", error: messageOf(caught) } : null);
    });
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">LX</div>
          <div>
            <p className="eyebrow">LTMH INVESTOR DASHBOARD</p>
            <h1>WealthX AUM &amp; AUA</h1>
          </div>
        </div>
        <div className="header-actions">
          <button data-testid="theme-toggle" className="icon-button" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? "เปลี่ยนเป็น Light mode" : "เปลี่ยนเป็น Dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button data-testid="refresh-button" className="primary-button" type="button" onClick={handleRefresh} disabled={job?.status === "running"}>
            <RefreshCw size={17} className={job?.status === "running" ? "spin" : ""} />
            <span>{job?.status === "running" ? "กำลังอัปเดต" : "Update"}</span>
          </button>
        </div>
      </header>

      {data?.offline && (
        <div className="system-banner warning"><WifiOff size={17} /><span>ออฟไลน์: แสดงสำเนาล่าสุดที่เก็บเมื่อ {formatDateTime(data.cachedAt)}</span></div>
      )}
      {error && <div className="system-banner error"><AlertTriangle size={17} /><span>{error}</span></div>}
      {job && <RefreshProgress job={job} />}

      {data ? (
        <main>
          <section className="status-strip" aria-label="สถานะข้อมูล">
            <span><Database size={15} /> รุ่นข้อมูล <strong>{data.dataVersion}</strong></span>
            <span><Clock3 size={15} /> ตรวจล่าสุด {formatDateTime(data.generatedAt)}</span>
            <span><ShieldCheck size={15} /> ฐานข้อมูลกลาง {data.canonicalStore}</span>
          </section>

          <section className="kpi-grid" aria-label="ภาพรวม">
            {data.buckets.map((bucket) => <BucketCard key={bucket.id} bucket={bucket} />)}
            <ActualAuaCard actual={data.latestActual} />
            <ProjectionCard data={data} />
          </section>

          <section className="analysis-band">
            <div className="section-heading">
              <div>
                <p className="eyebrow">AUA MONITOR</p>
                <h2>Actual, AUM และ Projection</h2>
              </div>
              <ModelBadge data={data} />
            </div>
            <AumHistoryPanel data={data} />
            <div className="chart-grid">
              <OfficialAuaPanel rows={data.charts.officialAua} />
              <ComparisonPanel data={data} />
            </div>
            <TimelinePanel data={data} />
            <div className="model-footnote">
              <Info size={16} />
              <span>{data.cautions.join(" • ")}</span>
            </div>
          </section>

          <FundTable data={data} />
          <SourcePanel data={data} />
        </main>
      ) : (
        <EmptyState onRetry={() => void loadDashboard().catch((caught) => setError(messageOf(caught)))} />
      )}
      <footer>ข้อมูลเพื่อการติดตามและวิเคราะห์ ไม่ใช่คำแนะนำการลงทุน</footer>
    </div>
  );
}

function BucketCard({ bucket }: { bucket: Bucket }) {
  const positive = (bucket.changeMillionBaht || 0) >= 0;
  return (
    <article className="metric-card" style={{ "--accent": bucket.color } as React.CSSProperties}>
      <div className="metric-card-head">
        <div><p className="metric-label">{bucket.name}</p><p className="metric-meta">{bucket.coveredFundCount}/{bucket.fundCount} กอง</p></div>
        <BarChart3 size={19} />
      </div>
      <p className="metric-value">{formatMoney(bucket.totalMillionBaht)} <small>ลบ.</small></p>
      <div className="metric-footer">
        <span className={positive ? "positive" : "negative"}>{positive ? "▲" : "▼"} {formatMoney(Math.abs(bucket.changeMillionBaht || 0))} ลบ.</span>
        <span>{formatDate(bucket.latestDate)}</span>
      </div>
    </article>
  );
}

function ActualAuaCard({ actual }: { actual: AuaObservation | null }) {
  return (
    <article className="metric-card actual-card">
      <div className="metric-card-head"><div><p className="metric-label">AUA ทางการล่าสุด</p><p className="metric-meta">Actual ที่ตรวจสอบแล้ว</p></div><CircleCheck size={19} /></div>
      <p className="metric-value">{formatMoney(actual?.amountMillionBaht)} <small>ลบ.</small></p>
      <div className="date-pairs">
        <span>อ้างอิง <strong>{formatDate(actual?.referenceDate)}</strong></span>
        <span>ประกาศ <strong>{formatDate(actual?.announcedAt)}</strong></span>
      </div>
    </article>
  );
}

function ProjectionCard({ data }: { data: DashboardData }) {
  return (
    <article className="metric-card projection-card">
      <div className="metric-card-head"><div><p className="metric-label">AUA Projection</p><p className="metric-meta">Anchored OLS • {data.model.id}</p></div><Database size={19} /></div>
      <p className="metric-value">{formatMoney(data.projection.value)} <small>ลบ.</small></p>
      <div className="date-pairs"><span>AUM ณ <strong>{formatDate(data.projection.asOfDate)}</strong></span><span className="provisional">{data.model.status === "ready" ? "พร้อมใช้" : "เบื้องต้น"}</span></div>
    </article>
  );
}

function ModelBadge({ data }: { data: DashboardData }) {
  return (
    <div className="model-badge">
      <span>r <strong>{formatRatio(data.model.pearsonR)}</strong></span>
      <span>R² <strong>{formatRatio(data.model.rSquared)}</strong></span>
      <span>b <strong>{formatRatio(data.model.slope)}</strong></span>
      <span>n <strong>{data.model.pairCount}</strong></span>
    </div>
  );
}

function ChartPanel({ title, subtitle, wide, controls, meta, chartId, activeRange, visiblePoints, children }: {
  title: string;
  subtitle: string;
  wide?: boolean;
  controls?: React.ReactNode;
  meta?: React.ReactNode;
  chartId: string;
  activeRange: TimelineRange;
  visiblePoints: number;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`chart-panel${wide ? " chart-wide" : ""}`}
      data-chart-id={chartId}
      data-active-range={activeRange}
      data-visible-points={visiblePoints}
    >
      <div className="chart-header">
        <div className="chart-title"><h3>{title}</h3><span>{subtitle}</span></div>
        {controls}
      </div>
      <div className="chart-canvas">{children}</div>
      {meta && <div className="chart-meta">{meta}</div>}
    </section>
  );
}

function AumHistoryPanel({ data }: { data: DashboardData }) {
  const initialBucket = data.buckets.find((bucket) => bucket.id === "wealthx_other")?.id || data.buckets[0]?.id || "";
  const [bucketId, setBucketId] = useState(initialBucket);
  const [range, setRange] = useState<TimelineRange>("1Y");
  const bucket = data.buckets.find((item) => item.id === bucketId) || data.buckets[0];
  const rows = useMemo(() => filterTimeline(bucket?.history || [], (row) => row.date, range), [bucket, range]);

  return (
    <ChartPanel
      title="ประวัติ AUM รายกลุ่ม"
      subtitle="สลับกลุ่มและช่วงเวลาได้อิสระ"
      chartId="aum-history"
      activeRange={range}
      visiblePoints={rows.length}
      wide
      controls={<div className="chart-controls"><BucketSelector buckets={data.buckets} value={bucket?.id || ""} onChange={setBucketId} /><RangeSelector value={range} onChange={setRange} label="ช่วงเวลากราฟ AUM" chartId="aum-history" /></div>}
      meta={<><span>{bucket?.name || "AUM"}</span><span>Timeline: {range}</span><span>{timelineCoverage(rows, (row) => row.date)}</span><span>{rows.length} จุดข้อมูล</span></>}
    >
      <AumHistoryChart rows={rows} color={bucket?.color || "#59a5ff"} />
    </ChartPanel>
  );
}

function OfficialAuaPanel({ rows }: { rows: AuaObservation[] }) {
  const [range, setRange] = useState<TimelineRange>("1Y");
  const filtered = useMemo(() => filterTimeline(rows, (row) => row.referenceDate, range), [range, rows]);
  return (
    <ChartPanel
      title="AUA ทางการ"
      subtitle="อ้างอิงตามวันที่ของตัวเลข ไม่ใช่วันที่เผยแพร่"
      chartId="official-aua"
      activeRange={range}
      visiblePoints={filtered.length}
      controls={<RangeSelector value={range} onChange={setRange} label="ช่วงเวลากราฟ AUA ทางการ" chartId="official-aua" />}
      meta={<><span>Timeline: {range}</span><span>{timelineCoverage(filtered, (row) => row.referenceDate)}</span><span>{filtered.length} จุดข้อมูล</span></>}
    >
      <OfficialAuaChart rows={filtered} />
    </ChartPanel>
  );
}

function ComparisonPanel({ data }: { data: DashboardData }) {
  const [range, setRange] = useState<TimelineRange>("1Y");
  const rows = useMemo(() => filterTimeline(data.charts.comparison, (row) => row.referenceDate, range), [data.charts.comparison, range]);
  return (
    <ChartPanel
      title="AUA เทียบ AUM SeriesX"
      subtitle={`โมเดลปัจจุบัน OLS ${data.model.pairCount} คู่ข้อมูล`}
      chartId="aua-aum-comparison"
      activeRange={range}
      visiblePoints={rows.length}
      controls={<RangeSelector value={range} onChange={setRange} label="ช่วงเวลากราฟ AUA เทียบ AUM" chartId="aua-aum-comparison" />}
      meta={<><span>Timeline: {range}</span><span>{timelineCoverage(rows, (row) => row.referenceDate)}</span><span>{rows.length} จาก {data.model.pairCount} คู่ข้อมูล</span></>}
    >
      <ComparisonChart data={data} rows={rows} />
    </ChartPanel>
  );
}

function TimelinePanel({ data }: { data: DashboardData }) {
  const [range, setRange] = useState<TimelineRange>("1Y");
  const rows = useMemo(() => filterTimeline(data.charts.timeline, (row) => row.date, range), [data.charts.timeline, range]);
  return (
    <ChartPanel
      title="เส้นเวลา AUA / AUM / Projection"
      subtitle={`Projection ถึง ${formatDate(data.projection.asOfDate)} เท่านั้น`}
      chartId="aua-aum-projection"
      activeRange={range}
      visiblePoints={rows.length}
      wide
      controls={<RangeSelector value={range} onChange={setRange} label="ช่วงเวลากราฟ AUA AUM และ Projection" chartId="aua-aum-projection" />}
      meta={<><span>Timeline: {range}</span><span>{timelineCoverage(rows, (row) => row.date)}</span><span>{rows.length} จุดข้อมูล</span><span>{data.model.id}</span></>}
    >
      <TimelineChart rows={rows} />
    </ChartPanel>
  );
}

function BucketSelector({ buckets, value, onChange }: { buckets: Bucket[]; value: string; onChange: (value: string) => void }) {
  const bucketOrder: Record<string, number> = { wealthx_other: 0, mega30: 1, other_funds: 2 };
  const orderedBuckets = [...buckets].sort((left, right) => (bucketOrder[left.id] ?? 99) - (bucketOrder[right.id] ?? 99));
  return (
    <div className="chart-bucket-tabs" role="group" aria-label="เลือกกลุ่ม AUM">
      {orderedBuckets.map((bucket) => <button type="button" key={bucket.id} data-bucket-id={bucket.id} className={value === bucket.id ? "active" : ""} aria-pressed={value === bucket.id} onClick={() => onChange(bucket.id)}>{bucket.name}</button>)}
    </div>
  );
}

function RangeSelector({ value, onChange, label, chartId }: { value: TimelineRange; onChange: (value: TimelineRange) => void; label: string; chartId: string }) {
  return (
    <div className="chart-ranges" role="group" aria-label={label}>
      {timelineRanges.map((range) => <button type="button" key={range} data-range={range} data-range-chart={chartId} className={value === range ? "active" : ""} aria-pressed={value === range} onClick={() => onChange(range)}>{range}</button>)}
    </div>
  );
}

function AumHistoryChart({ rows, color }: { rows: Bucket["history"]; color: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={42} stroke="var(--muted)" fontSize={11} />
        <YAxis tickFormatter={(value) => compactMoney.format(value)} stroke="var(--muted)" fontSize={11} width={50} domain={["auto", "auto"]} />
        <Tooltip content={<AumTooltip />} />
        <Line type="monotone" dataKey="value" name="AUM" stroke={color} strokeWidth={2.6} dot={false} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function OfficialAuaChart({ rows }: { rows: AuaObservation[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="referenceDate" tickFormatter={shortDate} minTickGap={28} stroke="var(--muted)" fontSize={11} />
        <YAxis tickFormatter={(value) => compactMoney.format(value)} stroke="var(--muted)" fontSize={11} width={48} />
        <Tooltip content={<MoneyTooltip labelKey="referenceDate" valueKey="amountMillionBaht" valueLabel="AUA Actual" />} />
        <Line type="monotone" dataKey="amountMillionBaht" stroke="#f8c15c" strokeWidth={2.5} dot={{ r: 4, fill: "#f8c15c", strokeWidth: 0 }} activeDot={{ r: 6 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ComparisonChart({ data, rows }: { data: DashboardData; rows: DashboardData["charts"]["comparison"] }) {
  const xs = rows.map((row) => row.seriesxAum);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const segment: readonly [{ x: number; y: number }, { x: number; y: number }] | undefined = rows.length < 2 || min === max || data.model.slope === null || data.model.intercept === null ? undefined : [
    { x: min, y: data.model.intercept + data.model.slope * min },
    { x: max, y: data.model.intercept + data.model.slope * max }
  ];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 12, right: 18, bottom: 14, left: 2 }}>
        <CartesianGrid stroke="var(--chart-grid)" />
        <XAxis type="number" dataKey="seriesxAum" name="AUM SeriesX" tickFormatter={(value) => compactMoney.format(value)} stroke="var(--muted)" fontSize={11} />
        <YAxis type="number" dataKey="actualAua" name="AUA Actual" tickFormatter={(value) => compactMoney.format(value)} stroke="var(--muted)" fontSize={11} width={48} />
        <ZAxis range={[70, 70]} />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<ScatterTooltip />} />
        {segment && <ReferenceLine segment={segment} stroke="#59a5ff" strokeDasharray="6 5" strokeWidth={2} />}
        <Scatter data={rows} fill="#f8c15c" shape={<ScatterDot />} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function TimelineChart({ rows }: { rows: DashboardData["charts"]["timeline"] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 12, right: 18, bottom: 8, left: 2 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={42} stroke="var(--muted)" fontSize={11} />
        <YAxis tickFormatter={(value) => compactMoney.format(value)} stroke="var(--muted)" fontSize={11} width={50} />
        <Tooltip content={<TimelineTooltip />} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Line type="monotone" dataKey="seriesxAum" name="AUM SeriesX" stroke="#37d09f" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="projectedAua" name="AUA Projection" stroke="#59a5ff" strokeWidth={2.4} strokeDasharray="7 5" dot={false} connectNulls />
        <Line type="linear" dataKey="actualAua" name="AUA Actual" stroke="#f8c15c" strokeWidth={2.5} dot={{ r: 4, fill: "#f8c15c" }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

function FundTable({ data }: { data: DashboardData }) {
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState("all");
  const [sort, setSort] = useState("aum-desc");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, any>>({});
  const funds = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = data.funds.filter((fund) => (bucket === "all" || fund.bucketId === bucket) && (!normalized || `${fund.code} ${fund.group || ""}`.toLowerCase().includes(normalized)));
    return filtered.sort((a, b) => {
      if (sort === "name") return a.code.localeCompare(b.code);
      if (sort === "change-desc") return (b.changeMillionBaht || 0) - (a.changeMillionBaht || 0);
      if (sort === "date-desc") return (b.latestDate || "").localeCompare(a.latestDate || "");
      return (b.aumMillionBaht || 0) - (a.aumMillionBaht || 0);
    });
  }, [bucket, data.funds, query, sort]);

  const toggle = async (fund: Fund) => {
    if (expanded === fund.code) return setExpanded(null);
    setExpanded(fund.code);
    if (!details[fund.code]) {
      const response = await fetch(`/api/funds/${encodeURIComponent(fund.code)}`);
      const payload = response.ok ? await response.json() : null;
      if (payload) setDetails((current) => ({ ...current, [fund.code]: payload }));
    }
  };

  return (
    <section className="fund-section">
      <div className="section-heading"><div><p className="eyebrow">FUND LEDGER</p><h2>AUM รายกองทุน</h2></div><span className="row-count">{funds.length} กอง</span></div>
      <div className="table-toolbar">
        <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อกองทุน" /></label>
        <div className="segmented" role="group" aria-label="เลือกกลุ่มกองทุน">
          <button type="button" className={bucket === "all" ? "active" : ""} onClick={() => setBucket("all")}>ทั้งหมด</button>
          {data.buckets.map((item) => <button type="button" key={item.id} className={bucket === item.id ? "active" : ""} onClick={() => setBucket(item.id)}>{item.name}</button>)}
        </div>
        <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="เรียงข้อมูล">
          <option value="aum-desc">AUM มากไปน้อย</option>
          <option value="change-desc">เปลี่ยนแปลงมากไปน้อย</option>
          <option value="date-desc">วันที่ล่าสุด</option>
          <option value="name">ชื่อกองทุน</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>กองทุน</th><th>กลุ่ม</th><th className="numeric">AUM (ลบ.)</th><th className="numeric">เปลี่ยนแปลง</th><th>วันที่ NAV</th><th><span className="sr-only">รายละเอียด</span></th></tr></thead>
          <tbody>
            {funds.map((fund) => (
              <FundRows key={fund.code} fund={fund} open={expanded === fund.code} detail={details[fund.code]} onToggle={() => void toggle(fund)} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FundRows({ fund, open, detail, onToggle }: { fund: Fund; open: boolean; detail: any; onToggle: () => void }) {
  const positive = (fund.changeMillionBaht || 0) >= 0;
  return <>
    <tr className="fund-row" onClick={onToggle}>
      <td><strong>{fund.code}</strong><span>{fund.group}</span></td>
      <td><span className={`bucket-dot bucket-${fund.bucketId}`} />{fund.bucketName}</td>
      <td className="numeric"><strong>{formatMoney(fund.aumMillionBaht)}</strong></td>
      <td className={`numeric ${positive ? "positive" : "negative"}`}>{positive ? "+" : ""}{formatMoney(fund.changeMillionBaht)}</td>
      <td>{formatDate(fund.latestDate)}</td>
      <td><button className="row-button" type="button" aria-label={`รายละเอียด ${fund.code}`}>{open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button></td>
    </tr>
    {open && <tr className="detail-row"><td colSpan={6}><div className="fund-detail">
      <div><p>แหล่งข้อมูล <strong>{fund.dataSource.toUpperCase()}</strong></p><p>เริ่มมีข้อมูล <strong>{formatDate(fund.inceptionDate)}</strong></p>{fund.sourceUrl && <a href={fund.sourceUrl} target="_blank" rel="noreferrer">เปิดข้อมูลต้นทาง <ExternalLink size={14} /></a>}</div>
      <div className="mini-chart">{detail ? <ResponsiveContainer width="100%" height="100%"><LineChart data={detail.history}><XAxis dataKey="date" hide /><YAxis hide domain={["dataMin", "dataMax"]} /><Tooltip content={<MoneyTooltip labelKey="date" valueKey="aumMillionBaht" valueLabel="AUM" />} /><Line dataKey="aumMillionBaht" stroke="#59a5ff" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer> : <span>กำลังโหลด...</span>}</div>
    </div></td></tr>}
  </>;
}

function SourcePanel({ data }: { data: DashboardData }) {
  return (
    <section className="source-band">
      <div className="section-heading"><div><p className="eyebrow">PROVENANCE</p><h2>แหล่งข้อมูลและหลักฐาน</h2></div></div>
      <div className="source-grid">
        <div className="source-list">
          <h3>AUA ทางการ</h3>
          {data.officialAua.slice().reverse().map((item) => <div className="source-row" key={item.id}><div><strong>{formatMoney(item.amountMillionBaht)} ลบ.</strong><span>อ้างอิง {formatDate(item.referenceDate)} • ประกาศ {formatDate(item.announcedAt)}</span></div>{item.sources[0] && <a href={item.sources[0].url} target="_blank" rel="noreferrer" title="เปิดเอกสาร"><ExternalLink size={16} /></a>}</div>)}
        </div>
        <div className="source-list">
          <h3>สถานะการตรวจ</h3>
          {data.sourceStatus.length ? data.sourceStatus.map((source) => <div className="source-row" key={source.id}><div><strong>{source.name}</strong><span>{source.message || source.status} • {formatDateTime(source.checkedAt)}</span></div><span className={`status-pill ${source.status}`}>{source.status === "ok" ? "ครบ" : source.status === "incomplete" ? "ไม่ครบ" : "ผิดพลาด"}</span></div>) : <p className="empty-copy">สถานะแหล่งข้อมูลจะปรากฏหลัง Update รอบแรก</p>}
        </div>
      </div>
    </section>
  );
}

function RefreshProgress({ job }: { job: RefreshJob }) {
  return <div className={`refresh-progress ${job.status}`}><div className="refresh-copy"><RefreshCw size={16} className={job.status === "running" ? "spin" : ""} /><span>{job.status === "failed" ? job.error : job.status === "complete" ? "อัปเดตข้อมูลเสร็จแล้ว" : job.stageLabel}</span><strong>{Math.round(job.progress * 100)}%</strong></div><div className="progress-track"><span style={{ width: `${Math.max(2, job.progress * 100)}%` }} /></div></div>;
}

function LoadingScreen() { return <div className="loading-screen"><div className="brand-mark">LX</div><RefreshCw className="spin" size={20} /><span>กำลังโหลดฐานข้อมูลกลาง</span></div>; }
function EmptyState({ onRetry }: { onRetry: () => void }) { return <main className="empty-state"><Database size={32} /><h2>ยังไม่มี snapshot พร้อมใช้งาน</h2><button className="primary-button" type="button" onClick={onRetry}><RefreshCw size={17} />ลองอีกครั้ง</button></main>; }

function AumTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return <div className="chart-tooltip"><strong>{formatDate(row.date)}</strong><span>AUM: {formatMoney(row.value)} ลบ.</span><span>{row.fundCount} กองที่มีข้อมูล</span></div>;
}

function MoneyTooltip({ active, payload, labelKey, valueKey, valueLabel }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return <div className="chart-tooltip"><strong>{formatDate(row[labelKey])}</strong><span>{valueLabel}: {formatMoney(row[valueKey])} ลบ.</span></div>;
}

function ScatterTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return <div className="chart-tooltip"><strong>{formatDate(row.referenceDate)}</strong><span>AUM SeriesX: {formatMoney(row.seriesxAum)} ลบ.</span><span>AUA Actual: {formatMoney(row.actualAua)} ลบ.</span></div>;
}

function ScatterDot({ cx, cy }: { cx?: number; cy?: number }) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return <circle cx={cx} cy={cy} r={5} fill="#f8c15c" stroke="var(--surface)" strokeWidth={2} />;
}

function TimelineTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{formatDate(label)}</strong>{payload.filter((item: any) => item.value !== null).map((item: any) => <span key={item.dataKey} style={{ color: item.color }}>{item.name}: {formatMoney(item.value)} ลบ.</span>)}</div>;
}

function filterTimeline<T>(rows: T[], dateOf: (row: T) => string | null | undefined, range: TimelineRange) {
  const validRows = rows.filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(dateOf(row) || ""));
  if (!validRows.length) return [];
  const endDate = validRows.reduce((latest, row) => {
    const date = dateOf(row) || "";
    return date > latest ? date : latest;
  }, "");
  const daysByRange: Record<TimelineRange, number> = { "1Y": 365, "6M": 183, "3M": 92, "1M": 31 };
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const startDate = new Date(endMs - daysByRange[range] * 86_400_000).toISOString().slice(0, 10);
  return validRows.filter((row) => {
    const date = dateOf(row) || "";
    return date >= startDate && date <= endDate;
  });
}

function timelineCoverage<T>(rows: T[], dateOf: (row: T) => string | null | undefined) {
  if (!rows.length) return "ไม่มีข้อมูลในช่วงนี้";
  const dates = rows.map((row) => dateOf(row) || "").filter(Boolean).sort();
  return `ข้อมูล ${formatDate(dates[0])} ถึง ${formatDate(dates[dates.length - 1])}`;
}

function formatMoney(value: number | null | undefined) { return value === null || value === undefined || !Number.isFinite(value) ? "–" : money.format(value); }
function formatRatio(value: number | null | undefined) { return value === null || value === undefined || !Number.isFinite(value) ? "–" : value.toFixed(3); }
function shortDate(value: string) { return value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(2, 4)}` : ""; }
function formatDate(value: string | null | undefined) { if (!value) return "ไม่ระบุ"; const date = new Date(`${value.slice(0, 10)}T00:00:00+07:00`); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit" }).format(date); }
function formatDateTime(value: string | null | undefined) { if (!value) return "ไม่ระบุ"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date); }
function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }
function sleep(ms: number) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }
