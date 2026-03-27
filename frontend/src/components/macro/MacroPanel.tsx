import { useState, useEffect, useCallback } from "react";
import CorrelationHeatmap from "./CorrelationHeatmap";
import ParallelCoords from "./ParallelCoords";
import SurfacePlot from "./SurfacePlot";
import CorrelationNetwork from "./CorrelationNetwork";
import CubeHeatmap from "./CubeHeatmap";
import UmapScatter from "./UmapScatter";
import MacroSunburst from "./MacroSunburst";
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

const SERIES_ORDER = ["T10Y2Y", "DFEDTARU", "CPIAUCSL", "UNRATE", "PAYEMS", "DTWEXBGS", "GDP"];

const SERIES_SHORT: Record<string, string> = {
  T10Y2Y:   "10Y-2Y Spread",
  DFEDTARU: "Fed Target Rate",
  CPIAUCSL: "CPI Index",
  UNRATE:   "Unemployment",
  PAYEMS:   "Nonfarm Payrolls",
  DTWEXBGS: "Dollar Index",
  GDP:      "Real GDP",
};

// ── Main component ────────────────────────────────────────────────────────────

export default function MacroPanel() {
  const [ctx, setCtx]           = useState<MacroContext | null>(null);
  const [dash, setDash]         = useState<FredDashboard | null>(null);
  const [budget, setBudget]     = useState<BudgetInfo | null>(null);
  const [radar, setRadar]       = useState<RadarSpoke[]>([]);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [ctxRes, dashRes, budRes, radarRes] = await Promise.all([
        apiFetch("/api/fred/macro-context").then(r => r.ok ? r.json() : null),
        apiFetch("/api/fred/dashboard").then(r => r.ok ? r.json() : null),
        apiFetch("/api/fred/budget").then(r => r.ok ? r.json() : null),
        apiFetch("/api/fred/radar").then(r => r.ok ? r.json() : null),
      ]);
      if (ctxRes)           setCtx(ctxRes);
      if (dashRes)          setDash(dashRes);
      if (budRes)           setBudget(budRes);
      if (radarRes?.spokes) setRadar(radarRes.spokes);
    } catch (e) {
      setError("Failed to load macro data");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async (seriesId: string) => {
    if (budget && budget.remaining <= 0) return;
    setRefreshing(seriesId);
    try {
      await apiFetch(`/api/fred/${seriesId}/refresh`, { method: "POST" });
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
        {budget && (
          <span style={{
            fontSize: 9, color: budget.warning ? "#ef4444" : "var(--muted)",
            marginLeft: "auto",
          }}>
            FRED pulls: {budget.used}/{budget.budget}
          </span>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 10, color: "#ef4444" }}>{error}</div>
      )}

      {/* ── Radar chart — regime fingerprint ──────────────────────────── */}
      {radar.length > 0 && (
        <div style={{
          background: "var(--surface2)", border: "1px solid var(--border2)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
            Regime Fingerprint
          </div>
          <div style={{ fontSize: 8, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
            0 = benign · 100 = maximum stress &nbsp;·&nbsp; dashed = recent avg
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radar} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
              <PolarGrid stroke="var(--border2)" />
              <PolarAngleAxis
                dataKey="indicator"
                tick={{ fill: "var(--muted2)", fontSize: 10, fontFamily: "IBM Plex Mono, monospace" }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                tick={{ fill: "var(--muted)", fontSize: 8 }}
                tickCount={3}
                stroke="var(--border)"
              />
              <Radar
                name="Current"
                dataKey="current"
                stroke="#00d4a8"
                fill="#00d4a8"
                fillOpacity={0.25}
                strokeWidth={2}
                dot={{ r: 3, fill: "#00d4a8", strokeWidth: 0 }}
              />
              <Radar
                name="Recent avg"
                dataKey="avg"
                stroke="#94a3b8"
                fill="none"
                strokeDasharray="4 3"
                strokeWidth={1.5}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface2)", border: "1px solid var(--border2)",
                  borderRadius: 6, fontSize: 10, fontFamily: "IBM Plex Mono, monospace",
                  color: "var(--text)",
                }}
                formatter={(value: number, name: string, props: any) => {
                  const raw = props.payload?.raw;
                  return [
                    `${value?.toFixed(0)}/100${raw != null ? ` (${raw})` : ""}`,
                    name,
                  ];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 9, fontFamily: "IBM Plex Mono, monospace", color: "var(--muted2)", paddingTop: 8 }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

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
                  disabled={isRefreshing || (budget?.remaining ?? 1) <= 0}
                  title={budget?.remaining === 0 ? "FRED budget exhausted" : `Refresh ${sid} (burns 2 pulls)`}
                  style={{
                    fontSize: 8, padding: "2px 6px", borderRadius: 3, cursor: "pointer",
                    border: "1px solid var(--border2)", background: "var(--surface)",
                    color: isRefreshing ? "var(--accent)" : "var(--muted)",
                    opacity: (budget?.remaining ?? 1) <= 0 ? 0.4 : 1,
                    fontFamily: "IBM Plex Mono, monospace",
                  }}
                >
                  {isRefreshing ? "…" : "↻"}
                </button>
              </div>
            );
          })}
        </div>
        {budget && budget.remaining <= 5 && (
          <div style={{ fontSize: 8, color: "#ef4444", marginTop: 10 }}>
            ⚠ {budget.remaining} FRED pulls remaining — refreshes will fail when exhausted
          </div>
        )}
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
