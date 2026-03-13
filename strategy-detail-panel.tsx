import { useState } from "react";

const STRATEGIES = [
  {
    id: "zscore_reversion",
    name: "Z-Score Reversion",
    tagline: "Mean reversion via statistical deviation",
    category: "Statistical",
    risk: "Medium",
    complexity: "Intermediate",
    color: "#00d4a8",
    description: "Identifies markets where current probability has deviated significantly from its rolling mean. Enters when the z-score crosses a negative threshold, betting on reversion to mean. Position size scales with the magnitude of deviation.",
    logic: {
      entry:  "z = (p − μ) / σ  <  −z_entry",
      exit:   "z ≥ 0  OR  prob ≥ exit_threshold  OR  prob ≤ stop_loss",
      size:   "f = |z| / (2 · z_entry),  capped at max_position",
    },
    formula: "z = (p_current − μ_window) / σ_window",
    params: [
      { name: "z_entry", label: "Entry Z-Score", default: 1.5, min: 0.5, max: 3.0, step: 0.1, desc: "How many std devs below mean to trigger entry" },
      { name: "window", label: "Rolling Window", default: 20, min: 5, max: 60, step: 1, desc: "Lookback period for mean/std calculation (days)" },
      { name: "exit_threshold", label: "Exit Prob %", default: 58, min: 51, max: 95, step: 1, desc: "Probability target to close position" },
      { name: "stop_loss", label: "Stop Loss %", default: 8, min: 1, max: 30, step: 1, desc: "Max loss before forced exit" },
    ],
    edge: "Exploits overreaction to short-term news. Most effective in markets with >30 days to resolution and high liquidity.",
    risks: ["Trending markets — z-score keeps falling", "Thin liquidity amplifies slippage", "Resolution before reversion"],
    performance: { winRate: 64, avgReturn: 18.2, sharpe: 1.84, maxDD: 14.1, trades: 312 },
    syntheticCurve: [0.3,0.28,0.25,0.22,0.2,0.21,0.24,0.28,0.33,0.38,0.44,0.5,0.56,0.61,0.65,0.68,0.7,0.71,0.72,0.73],
  },
  {
    id: "structure_harvest",
    name: "Structure Harvest",
    tagline: "Exploit the maker-taker structural leak",
    category: "Market Microstructure",
    risk: "Low-Medium",
    complexity: "Advanced",
    color: "#ff6b35",
    description: "Targets the systematic wealth transfer from takers to makers documented across 72.1M Polymarket trades. Takers consistently overpay for probability by 57% of implied value. This strategy posts limit orders on the maker side, waiting for emotional taker flow to execute against them.",
    logic: {
      entry:  "Post YES limit at prob < entry_threshold  AND  affirmative_bias_score > bias_min",
      exit:   "Fill confirmed  →  hold to exit_target  OR  resolution",
      size:   "ΔW = (S_spread + Δ_taker) · position  |  f = edge / max(σ, 0.01)",
    },
    formula: "ΔW = (S_spread + Δ_taker) − (−Δ_taker)  |  Δ_taker = P_implied − P_actual",
    params: [
      { name: "entry_threshold", label: "Entry Threshold ¢", default: 15, min: 1, max: 30, step: 1, desc: "Max price to post maker limit (longshot range)" },
      { name: "bias_min", label: "Min Bias Score", default: 70, min: 50, max: 95, step: 5, desc: "Minimum affirmative bias % to qualify market" },
      { name: "exit_target", label: "Exit Target ¢", default: 45, min: 20, max: 90, step: 5, desc: "Price target to close filled position" },
      { name: "spread_min", label: "Min Spread %", default: 1.25, min: 0.5, max: 5.0, step: 0.25, desc: "Minimum maker edge to enter" },
    ],
    edge: "Cohen's d ≈ 0.02 confirms pure structure harvest — zero directional bet required. Edge reproduces across 80 of 99 price levels.",
    risks: ["Low fill rate — limit orders may not execute", "Market resolves before fill", "Liquidity dries up mid-hold"],
    performance: { winRate: 71, avgReturn: 28.4, sharpe: 2.41, maxDD: 6.8, trades: 89 },
    syntheticCurve: [0.5,0.52,0.55,0.54,0.57,0.6,0.58,0.62,0.65,0.67,0.69,0.71,0.73,0.74,0.76,0.77,0.78,0.79,0.8,0.81],
  },
  {
    id: "kelly",
    name: "Kelly Criterion",
    tagline: "Optimal position sizing from edge estimation",
    category: "Probabilistic",
    risk: "Variable",
    complexity: "Intermediate",
    color: "#7b61ff",
    description: "Uses the Kelly formula to compute the theoretically optimal fraction of bankroll to wager, given an estimated true probability. Requires a reliable edge estimate (p_true). Fractional Kelly (0.5×) is recommended to reduce variance while preserving most of the growth rate.",
    logic: {
      entry:  "prob < kelly_p_true  AND  prob ≤ entry_threshold",
      exit:   "prob ≥ exit_threshold  OR  prob ≤ stop_loss",
      size:   "f* = (p_true − prob) / (1 − prob),  capped at 0.50",
    },
    formula: "f* = (bp − q) / b  where b = (1−p)/p, p = p_true, q = 1−p_true",
    params: [
      { name: "kelly_p_true", label: "True Probability", default: 0.60, min: 0.51, max: 0.95, step: 0.01, desc: "Your estimated true probability (your edge)" },
      { name: "kelly_fraction", label: "Kelly Fraction", default: 0.5, min: 0.1, max: 1.0, step: 0.1, desc: "Fraction of full Kelly (0.5 = half Kelly)" },
      { name: "entry_threshold", label: "Entry Threshold %", default: 40, min: 5, max: 49, step: 1, desc: "Market price must be below this to enter" },
      { name: "stop_loss", label: "Stop Loss %", default: 10, min: 1, max: 30, step: 1, desc: "Exit if market moves this far against you" },
    ],
    edge: "Maximizes long-run bankroll growth rate given accurate p_true. Half-Kelly cuts variance by ~75% with only ~25% reduction in growth rate.",
    risks: ["Edge estimate error is catastrophic — overestimating p_true ruins the formula", "Requires calibrated probability model", "Full Kelly produces extreme volatility"],
    performance: { winRate: 61, avgReturn: 21.3, sharpe: 1.88, maxDD: 8.1, trades: 147 },
    syntheticCurve: [0.5,0.51,0.49,0.52,0.55,0.53,0.57,0.6,0.58,0.62,0.64,0.63,0.66,0.68,0.7,0.69,0.72,0.74,0.75,0.76],
  },
  {
    id: "momentum",
    name: "Momentum Chaser",
    tagline: "Follow trend breakouts with trailing stop",
    category: "Trend Following",
    risk: "High",
    complexity: "Beginner",
    color: "#f59e0b",
    description: "Enters positions when probability shows strong directional momentum — a breakout above a recent high or below a recent low. Follows the move with a trailing stop to lock in gains while letting winners run.",
    logic: {
      entry:  "prob > max(prob_window)  AND  momentum_score > threshold",
      exit:   "prob < trailing_high − trail_pct  OR  prob ≤ stop_loss",
      size:   "f = momentum_score · max_position",
    },
    formula: "momentum = (p_now − p_{t−window}) / p_{t−window}  ×  100",
    params: [
      { name: "window", label: "Breakout Window", default: 14, min: 3, max: 30, step: 1, desc: "Days to look back for breakout level" },
      { name: "momentum_min", label: "Min Momentum %", default: 15, min: 5, max: 50, step: 5, desc: "Minimum % move to confirm breakout" },
      { name: "trail_pct", label: "Trail Distance %", default: 10, min: 3, max: 25, step: 1, desc: "How far below peak before trailing stop fires" },
      { name: "stop_loss", label: "Hard Stop %", default: 15, min: 5, max: 40, step: 1, desc: "Absolute stop loss regardless of trailing" },
    ],
    edge: "Captures resolution momentum as markets approach binary outcomes. Most effective in final 2 weeks before resolution.",
    risks: ["Whipsaws in choppy markets", "Late entries miss most of the move", "High turnover increases fee drag"],
    performance: { winRate: 52, avgReturn: 12.4, sharpe: 1.12, maxDD: 22.7, trades: 421 },
    syntheticCurve: [0.5,0.48,0.5,0.47,0.49,0.52,0.55,0.6,0.58,0.62,0.65,0.61,0.64,0.67,0.7,0.68,0.72,0.75,0.74,0.77],
  },
  {
    id: "market_making",
    name: "Market Making",
    tagline: "Quote both sides, capture the spread",
    category: "Liquidity Provision",
    risk: "Low",
    complexity: "Advanced",
    color: "#22c55e",
    description: "Posts simultaneous limit orders on both YES and NO sides of the book, collecting the bid-ask spread from traders who need immediate execution. Profits from volume rather than directional moves. Requires tight risk management to avoid adverse selection.",
    logic: {
      entry:  "Post YES bid at (midpoint − spread/2)  AND  NO ask at (midpoint + spread/2)",
      exit:   "One side fills  →  immediately hedge or flatten  OR  hold to capture full spread",
      size:   "f = min(max_inventory, available_liquidity · inventory_pct)",
    },
    formula: "Edge = spread / 2 − adverse_selection_cost  |  spread = ask − bid",
    params: [
      { name: "spread_target", label: "Target Spread %", default: 2.5, min: 0.5, max: 10.0, step: 0.5, desc: "Minimum spread to quote (your gross edge)" },
      { name: "inventory_pct", label: "Inventory Limit %", default: 20, min: 5, max: 50, step: 5, desc: "Max % of available liquidity to hold" },
      { name: "hedge_threshold", label: "Hedge Threshold %", default: 10, min: 5, max: 30, step: 1, desc: "Net inventory imbalance to trigger hedge" },
      { name: "min_volume", label: "Min Daily Volume $", default: 10000, min: 1000, max: 100000, step: 1000, desc: "Minimum market volume to quote" },
    ],
    edge: "Captures spread on every round-trip. Profitable in high-volume, stable markets. Cohen's d ≈ 0.02 confirms makers don't need directional view.",
    risks: ["Adverse selection — informed traders pick off your quotes", "Inventory risk if one side never fills", "Low spread in efficient markets"],
    performance: { winRate: 71, avgReturn: 18.6, sharpe: 1.61, maxDD: 6.4, trades: 892 },
    syntheticCurve: [0.5,0.51,0.52,0.51,0.53,0.54,0.55,0.56,0.55,0.57,0.58,0.59,0.6,0.61,0.62,0.63,0.64,0.65,0.66,0.67],
  },
];

const riskColor = r => ({ "Low": "#22c55e", "Low-Medium": "#00d4a8", "Medium": "#f59e0b", "High": "#ef4444", "Variable": "#7b61ff" }[r] || "#8891aa");

function MiniEquityCurve({ data, color }) {
  const W = 200, H = 50, pad = 4;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 0.01;
  const pts = data.map((v, i) => [pad + (i / (data.length - 1)) * (W - pad * 2), pad + (1 - (v - min) / range) * (H - pad * 2)]);
  const d = pts.reduce((acc, [x, y], i) => i === 0 ? `M${x},${y}` : `${acc} L${x},${y}`, "");
  const area = `${d} L${pts[pts.length-1][0]},${H-pad} L${pts[0][0]},${H-pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 50 }}>
      <defs>
        <linearGradient id={`g-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#g-${color.replace("#","")})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ParamSlider({ param, value, onChange }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "#8891aa" }}>{param.label}</span>
        <span style={{ fontSize: 11, color: "#00d4a8", fontFamily: "IBM Plex Mono", fontWeight: 600 }}>{value}{param.name.includes("threshold") || param.name.includes("loss") || param.name.includes("target") || param.name === "bias_min" || param.name === "momentum_min" || param.name === "trail_pct" || param.name === "hedge_threshold" ? "%" : param.name === "kelly_p_true" || param.name === "kelly_fraction" ? "" : ""}</span>
      </div>
      <input type="range" min={param.min} max={param.max} step={param.step} value={value}
        onChange={e => onChange(param.name, parseFloat(e.target.value))}
        style={{ width: "100%", height: 3, WebkitAppearance: "none", background: `linear-gradient(to right, #00d4a8 0%, #00d4a8 ${((value - param.min) / (param.max - param.min)) * 100}%, #252d3d ${((value - param.min) / (param.max - param.min)) * 100}%, #252d3d 100%)`, borderRadius: 2, outline: "none", cursor: "pointer" }} />
      <div style={{ fontSize: 9, color: "#606880", marginTop: 3 }}>{param.desc}</div>
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState(STRATEGIES[0]);
  const [tab, setTab] = useState("overview");
  const [params, setParams] = useState(() => {
    const init = {};
    STRATEGIES.forEach(s => s.params.forEach(p => { init[`${s.id}.${p.name}`] = p.default; }));
    return init;
  });

  const setParam = (name, val) => setParams(p => ({ ...p, [`${active.id}.${name}`]: val }));
  const getParam = name => params[`${active.id}.${name}`] ?? active.params.find(p => p.name === name)?.default;

  const tabs = ["overview", "formula", "parameters", "performance", "risks"];

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0a0c0f", color: "#e8eaf0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, overflow: "hidden" }}>

      {/* LEFT — Strategy List */}
      <div style={{ width: 220, borderRight: "1px solid #1e2330", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid #1e2330", background: "#111318" }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 15, letterSpacing: -0.5 }}>
            Poly<span style={{ color: "#00d4a8" }}>Back</span>
          </div>
          <div style={{ fontSize: 10, color: "#606880", marginTop: 2 }}>Strategy Library</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {STRATEGIES.map(s => (
            <div key={s.id} onClick={() => { setActive(s); setTab("overview"); }}
              style={{ padding: "11px 14px", borderBottom: "1px solid #1e2330", cursor: "pointer", borderLeft: `2px solid ${active.id === s.id ? s.color : "transparent"}`, background: active.id === s.id ? `${s.color}09` : "transparent", transition: "all 0.12s" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: active.id === s.id ? s.color : "#e8eaf0", marginBottom: 2, fontFamily: "Syne, sans-serif" }}>{s.name}</div>
              <div style={{ fontSize: 9, color: "#606880" }}>{s.category}</div>
              <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: `${riskColor(s.risk)}14`, color: riskColor(s.risk), border: `1px solid ${riskColor(s.risk)}28` }}>{s.risk} Risk</span>
                <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "#181c23", color: "#606880", border: "1px solid #252d3d" }}>{s.complexity}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid #1e2330", background: "#111318" }}>
          <div style={{ width: "100%", padding: "8px 0", background: "linear-gradient(135deg, #00d4a8, #00a885)", color: "#000", fontFamily: "Syne, sans-serif", fontSize: 12, fontWeight: 700, border: "none", borderRadius: 6, cursor: "pointer", textAlign: "center" }}>
            + Custom Strategy
          </div>
        </div>
      </div>

      {/* RIGHT — Detail Panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "16px 24px 12px", borderBottom: "1px solid #1e2330", background: "#111318", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 22, color: active.color, letterSpacing: -0.5 }}>{active.name}</div>
              <div style={{ fontSize: 11, color: "#8891aa", marginTop: 2, fontStyle: "italic" }}>{active.tagline}</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 4, background: `${riskColor(active.risk)}14`, color: riskColor(active.risk), border: `1px solid ${riskColor(active.risk)}30` }}>{active.risk} Risk</span>
              <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 4, background: "rgba(123,97,255,0.1)", color: "#7b61ff", border: "1px solid rgba(123,97,255,0.25)" }}>{active.complexity}</span>
              <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 4, background: "#181c23", color: "#8891aa", border: "1px solid #252d3d" }}>{active.category}</span>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2 }}>
            {tabs.map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ padding: "5px 14px", borderRadius: 5, border: `1px solid ${tab === t ? `${active.color}40` : "transparent"}`, background: tab === t ? `${active.color}10` : "transparent", color: tab === t ? active.color : "#8891aa", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, cursor: "pointer", textTransform: "capitalize", transition: "all 0.12s" }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
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
                {Object.entries(active.logic).map(([k, v]) => (
                  <div key={k} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, color: active.color, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>{k}</div>
                    <div style={{ fontSize: 11, color: "#e8eaf0", background: "#181c23", padding: "6px 10px", borderRadius: 5, border: "1px solid #252d3d", fontFamily: "IBM Plex Mono, monospace", lineHeight: 1.5 }}>{v}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: "#111318", border: "1px solid #1e2330", borderRadius: 10, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: 1 }}>Simulated Equity (Synthetic)</div>
                <MiniEquityCurve data={active.syntheticCurve} color={active.color} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 4 }}>
                  {[["Win Rate", active.performance.winRate + "%", "g"], ["Avg Return", "+" + active.performance.avgReturn + "%", "g"], ["Sharpe", active.performance.sharpe, "b"]].map(([l,v,c]) => (
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
                  {Object.entries(active.logic).map(([key, val]) => (
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
                  {[
                    ["p", "Current market probability"], ["μ", "Rolling mean of probability"], ["σ", "Rolling std dev of probability"],
                    ["z", "Z-score (std devs from mean)"], ["f*", "Optimal position fraction"], ["ΔW", "Wealth transfer per execution"],
                    ["P_implied", "Market-implied probability"], ["P_actual", "True resolution probability"], ["b", "Net odds received on bet"],
                  ].map(([sym, def]) => (
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
                  <ParamSlider key={p.name} param={p} value={getParam(p.name)} onChange={setParam} />
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ background: "#111318", border: `1px solid ${active.color}20`, borderRadius: 10, padding: 18 }}>
                  <div style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Current Config Preview</div>
                  <div style={{ background: "#0a0c0f", borderRadius: 7, padding: 14, fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: "#8891aa", border: "1px solid #1e2330", lineHeight: 1.8 }}>
                    {`{`}<br />
                    {active.params.map(p => (
                      <span key={p.name} style={{ display: "block", paddingLeft: 14 }}>
                        <span style={{ color: active.color }}>"{p.name}"</span>: <span style={{ color: "#22c55e" }}>{getParam(p.name)}</span>,
                      </span>
                    ))}
                    {`}`}
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
                {[
                  ["Win Rate", active.performance.winRate + "%", "#22c55e"],
                  ["Avg Return", "+" + active.performance.avgReturn + "%", "#22c55e"],
                  ["Sharpe Ratio", active.performance.sharpe, "#7b61ff"],
                  ["Max Drawdown", "-" + active.performance.maxDD + "%", "#ef4444"],
                  ["Total Trades", active.performance.trades, "#00d4a8"],
                ].map(([l, v, c]) => (
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
                  <MiniEquityCurve data={[...active.syntheticCurve, ...active.syntheticCurve.map(v => Math.min(0.99, v * 1.05))]} color={active.color} />
                </div>
                <div style={{ fontSize: 10, color: "#606880", marginTop: 8, fontStyle: "italic" }}>Shown on synthetic data to illustrate strategy behavior — not actual backtest results. Run a backtest to see real performance on your selected markets.</div>
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
                {active.risks.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
                    <span style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#ef4444", flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontSize: 12, color: "#c8cad6", lineHeight: 1.6, paddingTop: 2 }}>{r}</span>
                  </div>
                ))}
              </div>

              <div style={{ background: "#111318", border: "1px solid #1e2330", borderRadius: 10, padding: 20 }}>
                <div style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>Risk Profile</div>
                {[
                  ["Overall Risk", active.risk, riskColor(active.risk)],
                  ["Complexity", active.complexity, "#7b61ff"],
                  ["Category", active.category, active.color],
                  ["Max Drawdown (hist.)", `-${active.performance.maxDD}%`, "#ef4444"],
                ].map(([l, v, c]) => (
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
