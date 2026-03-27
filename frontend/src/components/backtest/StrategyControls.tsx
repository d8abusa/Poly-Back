import { useState, useEffect } from "react";
import ExecutionModeToggle from "../execution/ExecutionModeToggle";
import ParamSliders from "./ParamSliders";
import FormulaTooltip from "./FormulaTooltip";
import type { ExecutionMode, StrategyMeta, StrategyParams } from "../../types";
import { apiFetch } from "../../lib/apiFetch";

interface StrategyControlsProps {
  activeStrategy: string;
  onStrategyChange: (strategy: string) => void;
  strategyParams: StrategyParams;
  onParamsChange: (p: StrategyParams) => void;
  executionMode: ExecutionMode;
  onExecutionModeChange: (mode: ExecutionMode) => void;
  exchange?: string;
  capital: number;
  onCapitalChange: (v: number) => void;
}

// Strategies the backtest engine actually executes
const LIVE_STRATEGIES = new Set(["threshold", "momentum", "zscore_reversion", "kelly", "market_making", "xgboost", "short_momentum", "short_zscore", "wizard"]);

interface StrategyFull extends StrategyMeta {
  tagline?: string;
  category?: string;
  risk?: string;
  complexity?: string;
  color?: string;
  status?: "live" | "soon";
  formula?: string;
  logic?: { entry?: string; exit?: string; size?: string };
}

// Fallback if API is unreachable
const FALLBACK: StrategyFull[] = [
  { id: "threshold", label: "Threshold",       tagline: "Buy low, sell high on probability levels", category: "Mean Reversion",  risk: "Low",    complexity: "Beginner",     color: "#00d4a8" },
  { id: "momentum",  label: "Momentum Chaser", tagline: "Follow trend breakouts with trailing stop", category: "Trend Following", risk: "High",   complexity: "Beginner",     color: "#f59e0b" },
];

export default function StrategyControls({
  activeStrategy,
  onStrategyChange,
  strategyParams,
  onParamsChange,
  executionMode,
  onExecutionModeChange,
  exchange,
  capital,
  onCapitalChange,
}: StrategyControlsProps) {
  const [strategies, setStrategies] = useState<StrategyFull[]>(FALLBACK);
  const [hoveredStrategy, setHoveredStrategy] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/strategies")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.strategies?.length) return;
        // Map backend shape → StrategyFull (backend uses `name` not `label`)
        const mapped: StrategyFull[] = data.strategies.map((s: any) => ({
          id:         s.id,
          label:      s.name ?? s.label ?? s.id,
          tagline:    s.tagline,
          category:   s.category,
          risk:       s.risk,
          complexity: s.complexity,
          color:      s.color,
          status:     s.status ?? "live",
          formula:    s.formula,
          logic:      s.logic,
        }));
        setStrategies(mapped);
        // If current selection no longer exists, default to first live one
        if (!mapped.find(s => s.id === activeStrategy)) {
          const first = mapped.find(s => LIVE_STRATEGIES.has(s.id));
          if (first) onStrategyChange(first.id);
        }
      })
      .catch(() => {}); // keep fallback
  }, []);

  const RISK_COLOR: Record<string, string> = {
    "Low":          "#22c55e",
    "Low-Medium":   "#84cc16",
    "Medium":       "#f59e0b",
    "High":         "#ef4444",
    "Variable":     "#7b61ff",
  };

  return (
    <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
        Strategy <span style={{ opacity: 0.6 }}>(⚙️ hover for formula)</span>
      </div>

      {/* ── Carousel ── */}
      <div className="strategy-carousel" style={{
        display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6,
        scrollbarWidth: "thin",
        scrollbarColor: "var(--border2) transparent",
      }}>
        {strategies.map(s => {
          const active   = activeStrategy === s.id;
          const isLive   = s.status ? s.status === "live" : LIVE_STRATEGIES.has(s.id);
          const isHovered = hoveredStrategy === s.id;
          const accentColor = s.color ?? "var(--accent)";

          return (
            <button
              key={s.id}
              onClick={() => isLive && onStrategyChange(s.id)}
              onMouseEnter={() => setHoveredStrategy(s.id)}
              onMouseLeave={() => setHoveredStrategy(null)}
              title={s.tagline}
              style={{
                flexShrink: 0,
                width: 148,
                padding: "9px 11px",
                borderRadius: 6,
                border: `1px solid ${active ? accentColor + "66" : isHovered ? accentColor + "99" : "var(--border2)"}`,
                background: active ? accentColor + "12" : isHovered ? accentColor + "08" : "var(--surface2)",
                boxShadow: isHovered ? `0 0 0 1px ${accentColor}55, 0 4px 12px rgba(0,0,0,0.2)` : "none",
                color: active ? accentColor : "var(--muted2)",
                fontFamily: "IBM Plex Mono, monospace",
                cursor: isLive ? "pointer" : "default",
                textAlign: "left",
                opacity: isLive ? 1 : 0.5,
                transition: "all 0.12s",
                position: "relative",
              }}
            >
              {/* Name */}
              <div style={{ fontSize: 11, fontWeight: active ? 700 : 500, marginBottom: 3, lineHeight: 1.2 }}>
                {s.label}
              </div>

              {/* Tagline */}
              {s.tagline && (
                <div style={{
                  fontSize: 9, color: active ? accentColor + "bb" : "var(--muted)",
                  lineHeight: 1.4, marginBottom: 6,
                  overflow: "hidden", display: "-webkit-box",
                  WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                }}>
                  {s.tagline}
                </div>
              )}

              {/* Formula available indicator */}
              {(s.formula || (s.logic && (s.logic.entry || s.logic.exit))) && isHovered && (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  marginBottom: 6,
                  fontSize: 9,
                  color: accentColor,
                  animation: "pulse 2s infinite",
                }}>
                  <span>≔</span>
                  <span>Formula available</span>
                </div>
              )}

              {/* Meta row */}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                {s.category && (
                  <span style={{
                    fontSize: 8, padding: "1px 5px", borderRadius: 2,
                    border: `1px solid ${accentColor}33`,
                    color: active ? accentColor : "var(--muted)",
                  }}>
                    {s.category}
                  </span>
                )}
                {s.risk && (
                  <span style={{
                    fontSize: 8, color: RISK_COLOR[s.risk] ?? "var(--muted)",
                  }}>
                    {s.risk} risk
                  </span>
                )}
              </div>

              {/* Soon badge */}
              {!isLive && (
                <span style={{
                  position: "absolute", top: 6, right: 7,
                  fontSize: 7, letterSpacing: "0.1em",
                  color: "var(--muted)", border: "1px solid var(--border2)",
                  padding: "1px 4px", borderRadius: 2,
                }}>
                  SOON
                </span>
              )}

              {/* Active indicator dot */}
              {active && (
                <span style={{
                  position: "absolute", top: 7, right: 8,
                  width: 5, height: 5, borderRadius: "50%",
                  background: accentColor,
                }} />
              )}
            </button>
          );
        })}
      </div>

      <ParamSliders strategy={activeStrategy} params={strategyParams} onChange={onParamsChange} exchange={exchange} />
      <ExecutionModeToggle mode={executionMode} onChange={onExecutionModeChange} exchange={exchange} />

      {/* Capital input */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
          Capital
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--muted2)", fontFamily: "IBM Plex Mono, monospace" }}>$</span>
          <input
            type="number"
            min={0}
            step={100}
            value={capital === 0 ? "" : capital}
            placeholder="0"
            onChange={e => {
              const v = parseFloat(e.target.value);
              onCapitalChange(isNaN(v) || v < 0 ? 0 : v);
            }}
            style={{
              flex: 1, background: "var(--surface2)",
              border: `1px solid ${capital === 0 ? "rgba(239,68,68,0.4)" : "var(--border2)"}`,
              borderRadius: 5, padding: "5px 8px",
              color: capital === 0 ? "#ef4444" : "var(--text)",
              fontFamily: "IBM Plex Mono, monospace", fontSize: 11, outline: "none",
            }}
          />
        </div>
        <div style={{ fontSize: 8, color: "var(--muted)", marginTop: 4, lineHeight: 1.4 }}>
          Used for backtest sizing and order staging
        </div>
      </div>

      {/* Tooltip rendering */}
      {hoveredStrategy && (() => {
        const s = strategies.find(x => x.id === hoveredStrategy);
        if (s?.formula || (s?.logic && (s.logic.entry || s.logic.exit))) {
          return <FormulaTooltip key={hoveredStrategy} hoveredStrategy={s.id} formula={s.formula} logic={s.logic as any} accentColor={s.color ?? "#00d4a8"} />;
        }
        return null;
      })()}
    </div>
  );
}

