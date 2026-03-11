import { useState, useEffect } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StrategyParam {
  name: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  desc: string;
}

interface StrategyPerformance {
  win_rate: number;
  avg_return: number;
  sharpe: number;
  max_dd: number;
  trades: number;
}

interface Strategy {
  id: string;
  name: string;
  tagline: string;
  category: string;
  risk: string;
  complexity: string;
  color: string;
  description: string;
  logic: Record<string, string>;
  formula: string;
  params: StrategyParam[];
  edge: string;
  risks: string[];
  performance: StrategyPerformance;
  synthetic_curve: number[];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MiniEquityCurve({ data, color }: { data?: number[]; color: string }) {
  if (!data || data.length < 2) return (
    <div style={{ height: 50, display: "flex", alignItems: "center", justifyContent: "center", color: "#606880", fontSize: 10 }}>
      No curve data
    </div>
  );
  const W = 200, H = 50, pad = 4;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 0.01;
  const pts = data.map((v, i) => [
    pad + (i / (data.length - 1)) * (W - pad * 2),
    pad + (1 - (v - min) / range) * (H - pad * 2),
  ]);
  const d = pts.reduce((acc, [x, y], i) => i === 0 ? `M${x},${y}` : `${acc} L${x},${y}`, "");
  const area = `${d} L${pts[pts.length - 1][0]},${H - pad} L${pts[0][0]},${H - pad} Z`;
  const gid = `g-${color.replace("#", "")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 50 }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ParamSlider({
  param,
  value,
  onChange,
  color,
}: {
  param: StrategyParam;
  value: number;
  onChange: (name: string, val: number) => void;
  color: string;
}) {
  const pct = ((value - param.min) / (param.max - param.min)) * 100;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "#8891aa" }}>{param.label}</span>
        <span style={{ fontSize: 11, color, fontFamily: "IBM Plex Mono, monospace", fontWeight: 600 }}>{value}</span>
      </div>
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={param.step}
        value={value}
        onChange={e => onChange(param.name, parseFloat(e.target.value))}
        style={{
          width: "100%",
          height: 3,
          WebkitAppearance: "none",
          background: `linear-gradient(to right, ${color} 0%, ${color} ${pct}%, #252d3d ${pct}%, #252d3d 100%)`,
          borderRadius: 2,
          outline: "none",
          cursor: "pointer",
        }}
      />
      <div style={{ fontSize: 9, color: "#606880", marginTop: 3 }}>{param.desc}</div>
    </div>
  );
}

// ── Risk colour helper ────────────────────────────────────────────────────────

function riskColor(r: string): string {
  return (
    { Low: "#22c55e", "Low-Medium": "#00d4a8", Medium: "#f59e0b", High: "#ef4444", Variable: "#7b61ff" }[r] ??
    "#8891aa"
  );
}

// ── Tab types ─────────────────────────────────────────────────────────────────

type Tab = "overview" | "formula" | "parameters" | "performance" | "risks";
const TABS: Tab[] = ["overview", "formula", "parameters", "performance", "risks"];

// ── Main component ────────────────────────────────────────────────────────────

export default function StrategyDetailPanel() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [active, setActive] = useState<Strategy | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [params, setParams] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch strategy list
  useEffect(() => {
    fetch("/api/strategies")
      .then(r => r.json())
      .then(data => {
        const list: Strategy[] = data.strategies;
        setStrategies(list);
        setActive(list[0] ?? null);
        // Seed params with defaults
        const init: Record<string, number> = {};
        list.forEach(s => s.params.forEach(p => { init[`${s.id}.${p.name}`] = p.default; }));
        setParams(init);
        setLoading(false);
      })
      .catch(err => {
        setError(String(err));
        setLoading(false);
      });
  }, []);

  const setParam = (name: string, val: number) =>
    setParams(p => ({ ...p, [`${active!.id}.${name}`]: val }));

  const getParam = (name: string): number =>
    params[`${active!.id}.${name}`] ?? active!.params.find(p => p.name === name)?.default ?? 0;

  const selectStrategy = (s: Strategy) => { setActive(s); setTab("overview"); };

  // ── Loading / error states ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0a0c0f", color: "#606880", fontFamily: "IBM Plex Mono, monospace", fontSize: 13 }}>
        Loading strategies…
      </div>
    );
  }

  if (error || !active) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0a0c0f", color: "#ef4444", fontFamily: "IBM Plex Mono, monospace", fontSize: 13 }}>
        {error ?? "No strategies found."}
      </div>
    );
  }

  // ── Layout ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flex: 1, height: "100%", background: "#0a0c0f", color: "#e8eaf0", fontFamily: "IBM Plex Mono, monospace", fontSize: 13, overflow: "hidden" }}>

      {/* ── LEFT: strategy list ── */}
      <div style={{ width: 220, borderRight: "1px solid #1e2330", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid #1e2330", background: "#111318" }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 15, letterSpacing: -0.5 }}>
            Poly<span style={{ color: "#00d4a8" }}>Back</span>
          </div>
          <div style={{ fontSize: 10, color: "#606880", marginTop: 2 }}>Strategy Library</div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {strategies.map(s => (
            <div
              key={s.id}
              onClick={() => selectStrategy(s)}
              style={{
                padding: "11px 14px",
                borderBottom: "1px solid #1e2330",
                cursor: "pointer",
                borderLeft: `2px solid ${active.id === s.id ? s.color : "transparent"}`,
                background: active.id === s.id ? `${s.color}09` : "transparent",
                transition: "all 0.12s",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: active.id === s.id ? s.color : "#e8eaf0", marginBottom: 2, fontFamily: "Syne, sans-serif" }}>{s.name}</div>
              <div style={{ fontSize: 9, color: "#606880" }}>{s.category}</div>
              <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: `${riskColor(s.risk)}14`, color: riskColor(s.risk), border: `1px solid ${riskColor(s.risk)}28` }}>
                  {s.risk} Risk
                </span>
                <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "#181c23", color: "#606880", border: "1px solid #252d3d" }}>
                  {s.complexity}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: "10px 14px", borderTop: "1px solid #1e2330", background: "#111318" }}>
          <div style={{ width: "100%", padding: "8px 0", background: "linear-gradient(135deg, #00d4a8, #00a885)", color: "#000", fontFamily: "Syne, sans-serif", fontSize: 12, fontWeight: 700, borderRadius: 6, textAlign: "center", cursor: "pointer" }}>
            + Custom Strategy
          </div>
        </div>
      </div>

      {/* ── RIGHT: detail panel ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "16px 24px 12px", borderBottom: "1px solid #1e2330", background: "#111318", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 22, color: active.color, letterSpacing: -0.5 }}>{active.name}</div>
              <div style={{ fontSize: 11, color: "#8891aa", marginTop: 2, fontStyle: "italic" }}>{active.tagline}</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 4, background: `${riskColor(active.risk)}14`, color: riskColor(active.risk), border: `1px solid ${riskColor(active.risk)}30` }}>
                {active.risk} Risk
              </span>
              <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 4, background: "rgba(123,97,255,0.1)", color: "#7b61ff", border: "1px solid rgba(123,97,255,0.25)" }}>
                {active.complexity}
              </span>
              <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 4, background: "#181c23", color: "#8891aa", border: "1px solid #252d3d" }}>
                {active.category}
              </span>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2 }}>
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "5px 14px",
                  borderRadius: 5,
                  border: `1px solid ${tab === t ? `${active.color}40` : "transparent"}`,
                  background: tab === t ? `${active.color}10` : "transparent",
                  color: tab === t ? active.color : "#8891aa",
                  fontFamily: "IBM Plex Mono, monospace",
                  fontSize: 11,
                  cursor: "pointer",
                  textTransform: "capitalize",
                  transition: "all 0.12s",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>

          {/* OVERVIEW */}
          {tab === "overview" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ gridColumn: "1 / -1", background: "#111318", border: "1px solid #1e2330", borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>How it works</div>
                <div style={{ fontSize: 12, color: "#c8cad6", lineHeight: 1.7 }}>{active.description}</div>
              </div>

              <div style={{ background: "#111318", border: `1px solid ${active.color}25`, borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Signal Logic</div>
                {Object.entries(active.logic ?? {}).map(([k, v]) => (
                  <div key={k} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, color: active.color, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>{k}</div>
                    <div style={{ fontSize: 11, color: "#e8eaf0", background: "#181c23", padding: "6px 10px", borderRadius: 5, border: "1px solid #252d3d", fontFamily: "IBM Plex Mono, monospace", lineHeight: 1.5 }}>{v}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: "#111318", border: "1px solid #1e2330", borderRadius: 10, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: 1 }}>Simulated Equity (Synthetic)</div>
                <MiniEquityCurve data={active.synthetic_curve} color={active.color} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 4 }}>
                  {([
                    ["Win Rate",   `${active.performance?.win_rate ?? "—"}%`,          "g"],
                    ["Avg Return", `+${active.performance?.avg_return ?? "—"}%`,        "g"],
                    ["Sharpe",     String(active.performance?.sharpe ?? "—"),            "b"],
                  ] as [string, string, string][]).map(([l, v, c]) => (
                    <div key={l} style={{ background: "#181c23", borderRadius: 6, padding: "8px 10px", border: "1px solid #252d3d" }}>
                      <div style={{ fontSize: 9, color: "#606880", marginBottom: 2 }}>{l}</div>
                      <div style={{ fontSize: 14, fontFamily: "Syne, sans-serif", fontWeight: 700, color: c === "g" ? "#22c55e" : c === "b" ? "#7b61ff" : "#00d4a8" }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ gridColumn: "1 / -1", background: `${active.color}08`, border: `1px solid ${active.color}20`, borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 10, color: active.color, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Edge Source</div>
                <div style={{ fontSize: 11, color: "#c8cad6", lineHeight: 1.6 }}>{active.edge}</div>
              </div>
            </div>
          )}

          {/* FORMULA */}
          {tab === "formula" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: "#111318", border: `1px solid ${active.color}30`, borderRadius: 10, padding: 22 }}>
                <div style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>Core Formula</div>
                <div style={{ fontSize: 16, color: active.color, fontFamily: "IBM Plex Mono, monospace", fontWeight: 500, background: "#0a0c0f", padding: "14px 18px", borderRadius: 8, border: `1px solid ${active.color}20`, lineHeight: 1.6 }}>
                  {active.formula}
                </div>
              </div>

              <div style={{ background: "#111318", border: "1px solid #1e2330", borderRadius: 10, padding: 22 }}>
                <div style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>Signal Breakdown</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {Object.entries(active.logic ?? {}).map(([key, val]) => (
                    <div key={key} style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 14, alignItems: "start" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: active.color, textTransform: "uppercase", letterSpacing: 0.8, paddingTop: 8 }}>{key}</div>
                      <div style={{ fontSize: 12, color: "#e8eaf0", background: "#181c23", padding: "8px 12px", borderRadius: 6, border: "1px solid #252d3d", fontFamily: "IBM Plex Mono, monospace", lineHeight: 1.6 }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: "#111318", border: "1px solid #252d3d", borderRadius: 10, padding: 22 }}>
                <div style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>Variable Reference</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {([
                    ["p",          "Current market probability"],
                    ["μ",          "Rolling mean of probability"],
                    ["σ",          "Rolling std dev of probability"],
                    ["z",          "Z-score (std devs from mean)"],
                    ["f*",         "Optimal position fraction"],
                    ["ΔW",         "Wealth transfer per execution"],
                    ["P_implied",  "Market-implied probability"],
                    ["P_actual",   "True resolution probability"],
                    ["b",          "Net odds received on bet"],
                  ] as [string, string][]).map(([sym, def]) => (
                    <div key={sym} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: "1px solid #1e2330" }}>
                      <span style={{ fontSize: 13, color: active.color, fontFamily: "IBM Plex Mono, monospace", fontWeight: 600, minWidth: 28 }}>{sym}</span>
                      <span style={{ fontSize: 10, color: "#8891aa" }}>{def}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* PARAMETERS */}
          {tab === "parameters" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "#111318", border: "1px solid #1e2330", borderRadius: 10, padding: 20 }}>
                <div style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Parameter Tuning</div>
                {active.params.map(p => (
                  <ParamSlider key={p.name} param={p} value={getParam(p.name)} onChange={setParam} color={active.color} />
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ background: "#111318", border: `1px solid ${active.color}20`, borderRadius: 10, padding: 18 }}>
                  <div style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Current Config Preview</div>
                  <div style={{ background: "#0a0c0f", borderRadius: 7, padding: 14, fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: "#8891aa", border: "1px solid #1e2330", lineHeight: 1.8 }}>
                    {"{"}<br />
                    {active.params.map(p => (
                      <span key={p.name} style={{ display: "block", paddingLeft: 14 }}>
                        <span style={{ color: active.color }}>"{p.name}"</span>: <span style={{ color: "#22c55e" }}>{getParam(p.name)}</span>,
                      </span>
                    ))}
                    {"}"}
                  </div>
                </div>

                <div style={{ background: "#111318", border: "1px solid #252d3d", borderRadius: 10, padding: 18 }}>
                  <div style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Defaults</div>
                  {active.params.map(p => (
                    <div key={p.name} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #1e2330", fontSize: 10 }}>
                      <span style={{ color: "#8891aa" }}>{p.label}</span>
                      <span style={{ color: "#606880" }}>default: <span style={{ color: "#e8eaf0" }}>{p.default}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* PERFORMANCE */}
          {tab === "performance" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 1, background: "#1e2330", borderRadius: 10, overflow: "hidden", border: "1px solid #1e2330" }}>
                {([
                  ["Win Rate",    `${active.performance?.win_rate ?? "—"}%`,    "#22c55e"],
                  ["Avg Return",  `+${active.performance?.avg_return ?? "—"}%`, "#22c55e"],
                  ["Sharpe Ratio", String(active.performance?.sharpe ?? "—"),    "#7b61ff"],
                  ["Max Drawdown", `-${active.performance?.max_dd ?? "—"}%`,    "#ef4444"],
                  ["Total Trades", String(active.performance?.trades ?? "—"),   "#00d4a8"],
                ] as [string, string, string][]).map(([l, v, c]) => (
                  <div key={l} style={{ background: "#111318", padding: "16px 18px" }}>
                    <div style={{ fontSize: 9, color: "#606880", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>{l}</div>
                    <div style={{ fontSize: 22, fontFamily: "Syne, sans-serif", fontWeight: 800, color: c }}>{v}</div>
                    <div style={{ fontSize: 9, color: "#606880", marginTop: 2 }}>historical avg</div>
                  </div>
                ))}
              </div>

              <div style={{ background: "#111318", border: "1px solid #1e2330", borderRadius: 10, padding: 20 }}>
                <div style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>Simulated Equity Curve (Synthetic Data)</div>
                <div style={{ height: 120 }}>
                  <MiniEquityCurve data={active.synthetic_curve ? [...active.synthetic_curve, ...active.synthetic_curve.map(v => Math.min(0.99, v * 1.05))] : undefined} color={active.color} />
                </div>
                <div style={{ fontSize: 10, color: "#606880", marginTop: 8, fontStyle: "italic" }}>
                  Shown on synthetic data to illustrate strategy behavior — not actual backtest results. Run a backtest to see real performance on your selected markets.
                </div>
              </div>

              <div style={{ background: `${active.color}07`, border: `1px solid ${active.color}20`, borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 10, color: active.color, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Edge Source</div>
                <div style={{ fontSize: 12, color: "#c8cad6", lineHeight: 1.7 }}>{active.edge}</div>
              </div>
            </div>
          )}

          {/* RISKS */}
          {tab === "risks" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: 20 }}>
                <div style={{ fontSize: 10, color: "#ef4444", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>Known Risk Factors</div>
                {(active.risks ?? []).map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
                    <span style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#ef4444", flexShrink: 0 }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: 12, color: "#c8cad6", lineHeight: 1.6, paddingTop: 2 }}>{r}</span>
                  </div>
                ))}
              </div>

              <div style={{ background: "#111318", border: "1px solid #1e2330", borderRadius: 10, padding: 20 }}>
                <div style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>Risk Profile</div>
                {([
                  ["Overall Risk",       active.risk,                    riskColor(active.risk)],
                  ["Complexity",         active.complexity,              "#7b61ff"],
                  ["Category",           active.category,               active.color],
                  ["Max Drawdown (hist.)", `-${active.performance?.max_dd ?? "—"}%`, "#ef4444"],
                ] as [string, string, string][]).map(([l, v, c]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #1e2330" }}>
                    <span style={{ fontSize: 11, color: "#8891aa" }}>{l}</span>
                    <span style={{ fontSize: 11, color: c, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>

              <div style={{ background: "rgba(0,212,168,0.05)", border: "1px solid rgba(0,212,168,0.2)", borderRadius: 10, padding: 18 }}>
                <div style={{ fontSize: 10, color: "#00d4a8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Mitigation</div>
                <div style={{ fontSize: 12, color: "#c8cad6", lineHeight: 1.7 }}>
                  Always validate strategy performance via backtest on resolved markets before committing capital. Use the stop loss and max position parameters to limit downside. Start with reduced position sizes until you have confidence in the edge estimate.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer CTA */}
        <div style={{ padding: "12px 24px", borderTop: "1px solid #1e2330", background: "#111318", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: "#606880" }}>Ready to test this strategy?</div>
            <div style={{ fontSize: 11, color: "#8891aa" }}>Select markets in the backtest console and run {active.name}</div>
          </div>
          <button style={{ padding: "8px 20px", borderRadius: 7, background: `linear-gradient(135deg, ${active.color}, ${active.color}bb)`, color: "#000", fontFamily: "Syne, sans-serif", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer" }}>
            Use This Strategy →
          </button>
        </div>
      </div>
    </div>
  );
}
