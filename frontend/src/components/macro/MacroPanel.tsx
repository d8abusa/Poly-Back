import { useState, useEffect, useCallback, useRef } from "react";
import CorrelationHeatmap from "./CorrelationHeatmap";
import ParallelCoords from "./ParallelCoords";
import SurfacePlot from "./SurfacePlot";
import CorrelationNetwork from "./CorrelationNetwork";
import CubeHeatmap from "./CubeHeatmap";
import UmapScatter from "./UmapScatter";
import MacroSunburst from "./MacroSunburst";
import FedSentimentPanel from "./FedSentimentPanel";
import PolicyOutcomePanel from "./PolicyOutcomePanel";
import FraserHeatmap3D from "./FraserHeatmap3D";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, Legend,
} from "recharts";
import { apiFetch } from "../../lib/apiFetch";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MacroRegime {
  recession_risk:   string;
  fed_stance:       string;
  inflation_level:  string;
  inflation_trend:  string;
  labor_market:     string;
  dollar_trend:     string;
}

interface MacroValues {
  yield_spread: number | null;
  fed_rate:     number | null;
  cpi_yoy:      number | null;
  unemployment: number | null;
}

interface MacroModifiers {
  zscore_multiplier: number;
  kelly_caution:     number;
}

interface MacroContext {
  regime:              MacroRegime;
  values:              MacroValues;
  strategy_modifiers:  MacroModifiers;
  xgb_features:        number[];
  meta:                { has_data: boolean; data_quality: string };
}

interface DashboardSeries {
  name:         string;
  units:        string;
  freq:         string;
  latest:       { date: string; value: number } | null;
  prev:         { date: string; value: number } | null;
  change:       number | null;
  cached:       boolean;
  stale:        boolean;
  last_pulled:  string | null;
}

interface FredDashboard {
  [key: string]: DashboardSeries | { pull_count: number; pull_budget: number };
}

interface BudgetInfo {
  used:      number;
  budget:    number;
  remaining: number;
  warning:   boolean;
}

interface RadarSpoke {
  indicator: string;
  series_id: string;
  current:   number | null;
  avg:       number | null;
  raw:       number | null;
}

interface RadarFrame {
  month:  string;
  spokes: RadarSpoke[];
}

interface RadarHistory {
  frames: RadarFrame[];
  spokes: string[];
  n_obs:  number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const REGIME_COLOR: Record<string, string> = {
  // Recession risk
  low:    "#22c55e",
  medium: "#f59e0b",
  high:   "#ef4444",
  // Fed stance
  easing:     "#22c55e",
  neutral:    "#94a3b8",
  tightening: "#ef4444",
  // Inflation
  below_target: "#22c55e",
  at_target:    "#94a3b8",
  above_target: "#ef4444",
  // Inflation trend
  falling:  "#22c55e",
  stable:   "#94a3b8",
  rising:   "#ef4444",
  // Labor
  strong:    "#22c55e",
  weakening: "#f59e0b",
  weak:      "#ef4444",
  // Dollar
  weakening2:      "#22c55e",  // weak dollar = easier financial conditions
  strengthening:   "#ef4444",
  // Generic
  unknown: "#475569",
};

function regimeColor(val: string): string {
  return REGIME_COLOR[val] ?? REGIME_COLOR["unknown"];
}

function regimeLabel(val: string): string {
  return val.replace(/_/g, " ");
}

// Temperature gauge bar: 0=cold(green) 1=hot(red)
function TempBar({ heat, width = 80 }: { heat: number; width?: number | string }) {
  const pct = Math.max(0, Math.min(1, heat));
  const color = pct < 0.35 ? "#22c55e" : pct < 0.65 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{
      width, height: 4, background: "var(--border2)", borderRadius: 2, overflow: "hidden",
    }}>
      <div style={{
        width: `${pct * 100}%`, height: "100%", background: color,
        borderRadius: 2, transition: "width 0.4s ease",
      }} />
    </div>
  );
}

// Map regime → heat value for the temp bar
function regimeHeat(key: string, val: string): number {
  const map: Record<string, Record<string, number>> = {
    recession_risk:  { low: 0.1, medium: 0.55, high: 0.9, unknown: 0.5 },
    fed_stance:      { easing: 0.1, neutral: 0.5, tightening: 0.9, unknown: 0.5 },
    inflation_level: { below_target: 0.1, at_target: 0.5, above_target: 0.9, unknown: 0.5 },
    inflation_trend: { falling: 0.1, stable: 0.5, rising: 0.9, unknown: 0.5 },
    labor_market:    { strong: 0.1, weakening: 0.55, weak: 0.9, unknown: 0.5 },
    dollar_trend:    { weakening: 0.1, neutral: 0.5, strengthening: 0.9, unknown: 0.5 },
  };
  return map[key]?.[val] ?? 0.5;
}

const SERIES_ORDER = ["T10Y2Y", "T10Y3M", "DFEDTARU", "FEDFUNDS", "CPIAUCSL", "UNRATE", "PAYEMS", "DTWEXBGS", "GDP", "USEPUINDXD"];

const SERIES_SHORT: Record<string, string> = {
  T10Y2Y:     "10Y-2Y Spread",
  T10Y3M:     "10Y-3M Spread",
  DFEDTARU:   "Fed Target Rate",
  FEDFUNDS:   "Fed Funds (actual)",
  CPIAUCSL:   "CPI Index",
  UNRATE:     "Unemployment",
  PAYEMS:     "Nonfarm Payrolls",
  DTWEXBGS:   "Dollar Index",
  GDP:        "Real GDP",
  USEPUINDXD: "Policy Uncertainty",
};

// ── Main component ────────────────────────────────────────────────────────────

export default function MacroPanel() {
  const [ctx, setCtx]           = useState<MacroContext | null>(null);
  const [dash, setDash]         = useState<FredDashboard | null>(null);
  const [budget, setBudget]     = useState<BudgetInfo | null>(null);
  const [radar, setRadar]       = useState<RadarSpoke[]>([]);
  const [radarHistory, setRadarHistory]   = useState<RadarHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [frameIdx, setFrameIdx]           = useState(0);
  const [playing, setPlaying]             = useState(false);
  const playRef                 = useRef<ReturnType<typeof setInterval> | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [showRadarInfo, setShowRadarInfo] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [ctxRes, dashRes, budRes, radarRes, histRes] = await Promise.all([
        apiFetch("/api/fred/macro-context").then(r => r.ok ? r.json() : null),
        apiFetch("/api/fred/dashboard").then(r => r.ok ? r.json() : null),
        apiFetch("/api/fred/budget").then(r => r.ok ? r.json() : null),
        apiFetch("/api/fred/radar").then(r => r.ok ? r.json() : null),
        apiFetch("/api/fred/radar-history").then(r => r.ok ? r.json() : null),
      ]);
      if (ctxRes)           setCtx(ctxRes);
      if (dashRes)          setDash(dashRes);
      if (budRes)           setBudget(budRes);
      if (radarRes?.spokes) setRadar(radarRes.spokes);
      if (histRes?.frames?.length) {
        setRadarHistory(histRes);
        setFrameIdx(histRes.frames.length - 1);
      }
      setHistoryLoading(false);
    } catch (e) {
      setError("Failed to load macro data");
    }
  }, []);

  // Play/pause interval
  useEffect(() => {
    if (playing && radarHistory) {
      playRef.current = setInterval(() => {
        setFrameIdx(i => {
          if (i >= radarHistory.frames.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        });
      }, 600);
    } else {
      if (playRef.current) clearInterval(playRef.current);
    }
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, [playing, radarHistory]);

  useEffect(() => { load(); }, [load]);

  // Daily series need deep history for the time dial — pull 500 obs (~2 years)
  const DAILY_SERIES = new Set(["T10Y2Y", "T10Y3M", "DFEDTARU", "DTWEXBGS", "VIXCLS", "BAMLH0A0HYM2", "USEPUINDXD"]);

  const handleRefresh = async (seriesId: string) => {
    setRefreshing(seriesId);
    const limit = DAILY_SERIES.has(seriesId) ? 500 : 60;
    try {
      await apiFetch(`/api/fred/${seriesId}/refresh?limit=${limit}`, { method: "POST" });
      await load();
    } catch {
      // ignore — load() will show stale data
    } finally {
      setRefreshing(null);
    }
  };

  const regime  = ctx?.regime;
  const values  = ctx?.values;
  const mods    = ctx?.strategy_modifiers;
  const quality = ctx?.meta.data_quality ?? "none";

  const REGIME_ROWS: { key: keyof MacroRegime; label: string }[] = [
    { key: "recession_risk",  label: "Recession Risk" },
    { key: "fed_stance",      label: "Fed Stance" },
    { key: "inflation_level", label: "Inflation" },
    { key: "inflation_trend", label: "Infl. Trend" },
    { key: "labor_market",    label: "Labor Market" },
    { key: "dollar_trend",    label: "Dollar" },
  ];

  return (
    <div style={{
      flex: 1, overflow: "auto", padding: "20px 24px",
      fontFamily: "IBM Plex Mono, monospace", color: "var(--text)",
      display: "flex", flexDirection: "column", gap: 20,
    }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>
          Macro Regime
        </span>
        <span style={{
          fontSize: 9, color: quality === "full" ? "#22c55e" : quality === "partial" ? "#f59e0b" : "#ef4444",
          border: `1px solid currentColor`, borderRadius: 2, padding: "1px 5px", opacity: 0.8,
        }}>
          {quality} data
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {budget && (
            <span style={{ fontSize: 9, color: "var(--muted)" }}>
              FRED pulls: {budget.used} (unlimited)
            </span>
          )}
          <button
            onClick={async () => {
              setRefreshing("__all__");
              const allSeries = [...DAILY_SERIES, "CPIAUCSL", "UNRATE", "PAYEMS", "FEDFUNDS", "GDP"];
              for (const sid of allSeries) {
                const limit = DAILY_SERIES.has(sid) ? 500 : 60;
                await apiFetch(`/api/fred/${sid}/refresh?limit=${limit}`, { method: "POST" }).catch(() => {});
              }
              await load();
              setRefreshing(null);
            }}
            disabled={refreshing !== null}
            title="Refresh all FRED series with deep history (daily=500obs, monthly=60obs)"
            style={{
              fontSize: 8, padding: "3px 8px", borderRadius: 3, cursor: "pointer",
              border: "1px solid var(--border2)", background: "var(--surface)",
              color: refreshing === "__all__" ? "var(--accent)" : "var(--muted)",
              fontFamily: "IBM Plex Mono, monospace", opacity: refreshing !== null ? 0.5 : 1,
            }}
          >
            {refreshing === "__all__" ? "refreshing…" : "↻ refresh all"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 10, color: "#ef4444" }}>{error}</div>
      )}

      {/* ── Radar chart — regime fingerprint with time dial ──────────── */}
      {radar.length > 0 && (() => {
        const hasHistory = radarHistory && radarHistory.frames.length > 1;
        const activeFrame = hasHistory ? radarHistory!.frames[frameIdx] : null;
        // Carry forward the last known value for each spoke so no axis ever
        // drops off the polygon during animation.  For each indicator, scan
        // backwards through all frames up to and including the current one and
        // use the most recent non-null current value.
        const displayData = (() => {
          const raw = activeFrame ? activeFrame.spokes : radar;
          if (!activeFrame || !radarHistory) return raw.map(sp => ({ ...sp, stale: false }));
          // Build last-known-value map by scanning frames 0..frameIdx
          const lastKnown: Record<string, number> = {};
          for (let fi = 0; fi <= frameIdx; fi++) {
            for (const sp of radarHistory.frames[fi].spokes) {
              if (sp.current != null) lastKnown[sp.indicator] = sp.current;
            }
          }
          return raw.map(sp => ({
            ...sp,
            current: sp.current ?? lastKnown[sp.indicator] ?? 0,
            stale: sp.current == null,   // true = carried forward, not a fresh reading
          }));
        })();

        // Custom dot: filled circle for live data, hollow ring for carried-forward
        const StrokeDot = (props: any) => {
          const { cx, cy, payload } = props;
          if (cx == null || cy == null) return null;
          return payload?.stale
            ? <circle cx={cx} cy={cy} r={4} fill="var(--surface2)" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="2 1" />
            : <circle cx={cx} cy={cy} r={3} fill={accentColor} stroke="none" />;
        };
        const isLive = !hasHistory || frameIdx === radarHistory!.frames.length - 1;
        const currentMonth = activeFrame?.month ?? null;
        const accentColor = isLive ? "#00d4a8" : "#f59e0b";

        return (
          <div style={{ background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
                  Regime Fingerprint
                </span>
                <button
                  onClick={() => setShowRadarInfo(v => !v)}
                  title="What does this chart show?"
                  style={{
                    width: 16, height: 16, borderRadius: "50%", border: "1px solid",
                    borderColor: showRadarInfo ? "#3b82f6" : "var(--border2)",
                    background: showRadarInfo ? "rgba(59,130,246,0.15)" : "transparent",
                    color: showRadarInfo ? "#3b82f6" : "var(--muted)",
                    fontSize: 9, fontWeight: 700, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "IBM Plex Mono, monospace", flexShrink: 0,
                    transition: "all 0.12s",
                  }}
                >i</button>
              </div>
              {currentMonth && (
                <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "IBM Plex Mono, monospace", color: accentColor }}>
                  {currentMonth}
                  {isLive && <span style={{ fontSize: 7, color: "var(--muted)", marginLeft: 4 }}>LIVE</span>}
                </span>
              )}
            </div>
            <div style={{ fontSize: 8, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
              0 = benign · 100 = maximum stress
              {!hasHistory && " · dashed = recent avg"}
              {hasHistory && " · ○ = prior value carried (no new data) · scrub or play to trace policy impact"}
            </div>

            {/* ── Info panel ── */}
            {showRadarInfo && (
              <div style={{
                marginBottom: 14, padding: "10px 12px",
                background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)",
                borderRadius: 6,
              }}>
                <div style={{ fontSize: 8, color: "#93c5fd", marginBottom: 8, fontFamily: "IBM Plex Mono, monospace", lineHeight: 1.6 }}>
                  Each axis is a FRED macro indicator scored 0–100 where <strong>100 = maximum historical stress</strong>.
                  The polygon shape is your macro regime fingerprint — a wider, fuller shape means more broad-based stress.
                  Scrub the timeline to replay how the regime evolved month by month.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
                  {[
                    { name: "Yield Spread",       detail: "10Y minus 2Y Treasury. Inverted curve (negative) = recession signal. High score = curve inverted." },
                    { name: "10Y-3M Spread",       detail: "10Y minus 3-month Treasury. Stronger recession predictor than 10Y-2Y. High score = inverted." },
                    { name: "Fed Rate",            detail: "Federal funds target rate. High score = tight monetary policy, borrowing expensive." },
                    { name: "CPI YoY",             detail: "Consumer price inflation year-over-year. High score = elevated inflation, above 4–5% range." },
                    { name: "Unemployment",        detail: "U-3 unemployment rate. High score = weak labor market, above 7–8%." },
                    { name: "Dollar Index",        detail: "Trade-weighted USD. High score = strong dollar, which tightens global financial conditions." },
                    { name: "VIX",                 detail: "CBOE equity volatility index (fear gauge). High score = market stress, above 30–35." },
                    { name: "HY Spread",           detail: "High-yield bond spread over Treasuries. High score = credit stress, investors demanding large risk premium." },
                    { name: "Policy Uncertainty",  detail: "Economic policy uncertainty index. High score = businesses and markets confused by unpredictable policy." },
                  ].map(({ name, detail }) => (
                    <div key={name} style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 4 }}>
                      <span style={{ fontSize: 8, fontWeight: 700, color: "var(--text)", fontFamily: "IBM Plex Mono, monospace" }}>{name}</span>
                      <span style={{ fontSize: 7, color: "var(--muted)", lineHeight: 1.5 }}>{detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={displayData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                <PolarGrid stroke="var(--border2)" />
                <PolarAngleAxis
                  dataKey="indicator"
                  tick={{ fill: "var(--muted2)", fontSize: 10, fontFamily: "IBM Plex Mono, monospace" }}
                />
                <PolarRadiusAxis
                  angle={90} domain={[0, 100]}
                  tick={{ fill: "var(--muted)", fontSize: 8 }}
                  tickCount={3} stroke="var(--border)"
                />
                <Radar
                  name={currentMonth ?? "Current"}
                  dataKey="current"
                  stroke={accentColor} fill={accentColor}
                  fillOpacity={0.25} strokeWidth={2}
                  dot={<StrokeDot />}
                  isAnimationActive={true} animationDuration={300}
                />
                {!hasHistory && (
                  <Radar name="Recent avg" dataKey="avg"
                    stroke="#94a3b8" fill="none"
                    strokeDasharray="4 3" strokeWidth={1.5}
                  />
                )}
                <Tooltip
                  contentStyle={{ background: "var(--surface2)", border: "1px solid var(--border2)",
                    borderRadius: 6, fontSize: 10, fontFamily: "IBM Plex Mono, monospace", color: "var(--text)" }}
                  formatter={(value: number, name: string, props: any) => {
                    const raw = props.payload?.raw;
                    return [`${value?.toFixed(0)}/100${raw != null ? ` (${raw})` : ""}`, name];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 9, fontFamily: "IBM Plex Mono, monospace", color: "var(--muted2)", paddingTop: 8 }} />
              </RadarChart>
            </ResponsiveContainer>

            {hasHistory ? (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                <input
                  type="range" min={0} max={radarHistory!.frames.length - 1} value={frameIdx}
                  onChange={e => { setPlaying(false); setFrameIdx(Number(e.target.value)); }}
                  style={{ width: "100%", accentColor: "#00d4a8", cursor: "pointer" }}
                />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => { setPlaying(false); setFrameIdx(0); }} title="Rewind"
                      style={{ background: "none", border: "1px solid var(--border2)", borderRadius: 3,
                        color: "var(--muted)", cursor: "pointer", fontSize: 11, padding: "1px 7px", fontFamily: "IBM Plex Mono, monospace" }}>⏮</button>
                    <button onClick={() => setPlaying(p => !p)} title={playing ? "Pause" : "Play"}
                      style={{ background: "none", border: "1px solid var(--border2)", borderRadius: 3,
                        color: playing ? "#00d4a8" : "var(--muted)", cursor: "pointer", fontSize: 11, padding: "1px 7px", fontFamily: "IBM Plex Mono, monospace" }}>
                      {playing ? "⏸" : "▶"}
                    </button>
                    <button onClick={() => { setPlaying(false); setFrameIdx(radarHistory!.frames.length - 1); }} title="Jump to current"
                      style={{ background: "none", border: "1px solid var(--border2)", borderRadius: 3,
                        color: isLive ? "#00d4a8" : "var(--muted)", cursor: "pointer", fontSize: 11, padding: "1px 7px", fontFamily: "IBM Plex Mono, monospace" }}>⏭</button>
                  </div>
                  <span style={{ fontSize: 8, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace" }}>
                    {frameIdx + 1} / {radarHistory!.frames.length} months
                  </span>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 8, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace" }}>
                {historyLoading
                  ? "Loading history…"
                  : "Time dial unavailable — refresh FRED series to build cache"}
              </div>
            )}
          </div>
        );
      })()}

      {/* Regime gauges + strategy modifiers side by side */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>

        {/* Regime gauges */}
        <div style={{
          flex: "1 1 280px", background: "var(--surface2)",
          border: "1px solid var(--border2)", borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Regime Signals
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {REGIME_ROWS.map(({ key, label }) => {
              const val = regime?.[key] ?? "unknown";
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 90, fontSize: 9, color: "var(--muted)", flexShrink: 0 }}>
                    {label}
                  </span>
                  <TempBar heat={regimeHeat(key, val)} width={72} />
                  <span style={{
                    fontSize: 9, fontWeight: 600,
                    color: regimeColor(val),
                    textTransform: "uppercase", letterSpacing: "0.06em",
                  }}>
                    {regimeLabel(val)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right column: raw values + strategy modifiers */}
        <div style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Raw values */}
          <div style={{
            background: "var(--surface2)", border: "1px solid var(--border2)",
            borderRadius: 8, padding: "14px 16px",
          }}>
            <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
              Key Values
            </div>
            {[
              { label: "Yield Spread (10Y-2Y)", val: values?.yield_spread, suffix: "%" },
              { label: "Fed Rate",              val: values?.fed_rate,     suffix: "%" },
              { label: "CPI YoY",               val: values?.cpi_yoy,      suffix: "%" },
              { label: "Unemployment",          val: values?.unemployment, suffix: "%" },
            ].map(({ label, val, suffix }) => (
              <div key={label} style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: 6,
              }}>
                <span style={{ fontSize: 9, color: "var(--muted)" }}>{label}</span>
                <span style={{ fontSize: 10, color: val != null ? "var(--text)" : "var(--muted)", fontWeight: 600 }}>
                  {val != null ? `${val.toFixed(2)}${suffix}` : "—"}
                </span>
              </div>
            ))}
          </div>

          {/* Strategy modifiers */}
          <div style={{
            background: "var(--surface2)", border: "1px solid var(--border2)",
            borderRadius: 8, padding: "14px 16px",
          }}>
            <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
              Strategy Modifiers
            </div>

            {/* Z-Score multiplier */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 9, color: "var(--muted)" }}>Z-Score entry mult.</span>
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: (mods?.zscore_multiplier ?? 1) > 1.2 ? "#ef4444" : (mods?.zscore_multiplier ?? 1) > 1.05 ? "#f59e0b" : "#22c55e",
                }}>
                  ×{(mods?.zscore_multiplier ?? 1).toFixed(2)}
                </span>
              </div>
              <TempBar heat={Math.max(0, ((mods?.zscore_multiplier ?? 1) - 1.0) / 0.5)} width="100%" />
              <div style={{ fontSize: 8, color: "var(--muted)", marginTop: 3 }}>
                Widens Z-entry threshold in uncertain regimes
              </div>
            </div>

            {/* Kelly caution */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 9, color: "var(--muted)" }}>Kelly caution</span>
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: (mods?.kelly_caution ?? 1) < 0.75 ? "#ef4444" : (mods?.kelly_caution ?? 1) < 0.9 ? "#f59e0b" : "#22c55e",
                }}>
                  {((mods?.kelly_caution ?? 1) * 100).toFixed(0)}%
                </span>
              </div>
              <TempBar heat={1 - (mods?.kelly_caution ?? 1)} width="100%" />
              <div style={{ fontSize: 8, color: "var(--muted)", marginTop: 3 }}>
                Reduces Kelly fraction in risky regimes
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FRED series table */}
      <div style={{
        background: "var(--surface2)", border: "1px solid var(--border2)",
        borderRadius: 8, padding: "14px 16px",
      }}>
        <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
          Cached Series
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 80px 80px 80px", gap: 8, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
            {["Series", "Latest", "Prev", "Change", ""].map(h => (
              <span key={h} style={{ fontSize: 8, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>{h}</span>
            ))}
          </div>
          {SERIES_ORDER.map(sid => {
            const s = dash?.[sid] as DashboardSeries | undefined;
            if (!s) return null;
            const changeColor = (s.change ?? 0) > 0 ? "var(--yes)" : (s.change ?? 0) < 0 ? "var(--no)" : "var(--muted)";
            const isRefreshing = refreshing === sid;
            return (
              <div key={sid} style={{
                display: "grid", gridTemplateColumns: "1fr 90px 80px 80px 80px",
                gap: 8, alignItems: "center", padding: "3px 0",
                borderBottom: "1px solid rgba(255,255,255,0.03)",
              }}>
                <div>
                  <div style={{ fontSize: 9, color: s.stale ? "#f59e0b" : "var(--text)" }}>
                    {SERIES_SHORT[sid] ?? sid}
                    {s.stale && <span style={{ fontSize: 7, color: "#f59e0b", marginLeft: 4 }}>STALE</span>}
                  </div>
                  <div style={{ fontSize: 7, color: "var(--muted)", marginTop: 1 }}>{s.freq}</div>
                </div>
                <span style={{ fontSize: 9, color: "var(--muted2)" }}>
                  {s.latest ? `${s.latest.value.toFixed(2)}` : "—"}
                  {s.latest && <span style={{ fontSize: 7, color: "var(--muted)", marginLeft: 3 }}>{s.latest.date?.slice(0, 7)}</span>}
                </span>
                <span style={{ fontSize: 9, color: "var(--muted)" }}>
                  {s.prev ? s.prev.value.toFixed(2) : "—"}
                </span>
                <span style={{ fontSize: 9, color: changeColor, fontWeight: 600 }}>
                  {s.change != null ? `${s.change > 0 ? "+" : ""}${s.change.toFixed(3)}` : "—"}
                </span>
                <button
                  onClick={() => handleRefresh(sid)}
                  disabled={isRefreshing}
                  title={`Refresh ${sid} from FRED API`}
                  style={{
                    fontSize: 8, padding: "2px 6px", borderRadius: 3, cursor: "pointer",
                    border: "1px solid var(--border2)", background: "var(--surface)",
                    color: isRefreshing ? "var(--accent)" : "var(--muted)",
                    fontFamily: "IBM Plex Mono, monospace",
                  }}
                >
                  {isRefreshing ? "…" : "↻"}
                </button>
              </div>
            );
          })}
        </div>
        {}
      </div>

      {/* XGBoost features */}
      {ctx?.xgb_features && ctx.xgb_features.length > 0 && (
        <div style={{
          background: "var(--surface2)", border: "1px solid var(--border2)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
            XGBoost Feature Vector
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["Spread", "Rate", "CPI", "Unemp", "Dollar"].map((label, i) => {
              const v = ctx.xgb_features[i] ?? 0;
              return (
                <div key={label} style={{
                  background: "var(--surface)", border: "1px solid var(--border2)",
                  borderRadius: 4, padding: "6px 10px", minWidth: 70, textAlign: "center",
                }}>
                  <div style={{ fontSize: 7, color: "var(--muted)", marginBottom: 3 }}>{label}</div>
                  <div style={{
                    fontSize: 11, fontWeight: 700,
                    color: v > 0.1 ? "#ef4444" : v < -0.1 ? "#22c55e" : "var(--muted2)",
                  }}>
                    {v >= 0 ? "+" : ""}{v.toFixed(3)}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 8, color: "var(--muted)", marginTop: 8 }}>
            Scaled ~[-1, +1] · injected into XGBoost strategy alongside price features
          </div>
        </div>
      )}

      {/* ── Fed Sentiment + Policy Outcomes (FRASER NLP) ─────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FedSentimentPanel />
        <PolicyOutcomePanel />
      </div>

      {/* ── 3D FRASER Surface — Fed tone × CPI × Unemployment ─────────── */}
      <FraserHeatmap3D />

      {/* ── Row 1: Correlation heatmap + Network ─────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <CorrelationHeatmap />
        <CorrelationNetwork />
      </div>

      {/* ── Row 2: Parallel coords + Surface ─────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <ParallelCoords />
        <SurfacePlot />
      </div>

      {/* ── 3D cube heatmap — full width (needs horizontal space) ─────── */}
      <CubeHeatmap />

      {/* ── Row 3: UMAP scatter + Sunburst ───────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <UmapScatter />
        <MacroSunburst />
      </div>

    </div>
  );
}
