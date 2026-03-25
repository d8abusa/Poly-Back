import type { StrategyParams } from "../../types";

interface ParamSlidersProps {
  strategy: string;
  params: StrategyParams;
  onChange: (params: StrategyParams) => void;
  exchange?: string;
}

interface ParamDef {
  key: keyof StrategyParams;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  nullable?: boolean;   // stop_loss can be disabled (null)
}

// ── Prediction-market param sets (probabilities 0–1, displayed as ¢) ──────────
const PARAMS: Record<string, ParamDef[]> = {
  threshold: [
    { key: "entry_threshold", label: "Entry",     min: 0.05, max: 0.50, step: 0.01, fmt: v => `${(v*100).toFixed(0)}¢` },
    { key: "exit_threshold",  label: "Exit",      min: 0.50, max: 0.95, step: 0.01, fmt: v => `${(v*100).toFixed(0)}¢` },
    { key: "stop_loss",       label: "Stop Loss", min: 0.05, max: 0.45, step: 0.01, fmt: v => `${(v*100).toFixed(0)}¢`, nullable: true },
  ],
  momentum: [
    { key: "window",          label: "Window",    min: 3,    max: 60,   step: 1,    fmt: v => `${v} bars` },
    { key: "momentum_min",    label: "Min Move",  min: 0.5,  max: 30,   step: 0.5,  fmt: v => `${v.toFixed(1)}%` },
    { key: "trail_pct",       label: "Trail Stop",min: 1,    max: 30,   step: 0.5,  fmt: v => `${v.toFixed(1)}%` },
    { key: "stop_loss",       label: "Stop Loss", min: 0.05, max: 0.45, step: 0.01, fmt: v => `${(v*100).toFixed(0)}¢`, nullable: true },
  ],
  zscore_reversion: [
    { key: "zscore_window", label: "Window",      min: 5,    max: 100,  step: 1,    fmt: v => `${v} ticks` },
    { key: "zscore_entry",  label: "Entry Z",     min: 0.5,  max: 4.0,  step: 0.1,  fmt: v => `${v.toFixed(1)}σ` },
    { key: "zscore_exit",   label: "Exit Z",      min: -2.0, max: 2.0,  step: 0.1,  fmt: v => `${v.toFixed(1)}σ` },
    { key: "zscore_stop",   label: "Stop Z",      min: 1.0,  max: 6.0,  step: 0.1,  fmt: v => `${v.toFixed(1)}σ` },
    { key: "stop_loss",     label: "Prob Stop",   min: 0.05, max: 0.45, step: 0.01, fmt: v => `${(v*100).toFixed(0)}¢`, nullable: true },
  ],
  kelly: [
    { key: "kelly_fraction",  label: "Kelly f",   min: 0.1,  max: 1.0,  step: 0.05, fmt: v => `${(v*100).toFixed(0)}%` },
    { key: "entry_threshold", label: "Entry",     min: 0.05, max: 0.50, step: 0.01, fmt: v => `${(v*100).toFixed(0)}¢` },
    { key: "exit_threshold",  label: "Exit",      min: 0.50, max: 0.95, step: 0.01, fmt: v => `${(v*100).toFixed(0)}¢` },
    { key: "stop_loss",       label: "Stop Loss", min: 0.05, max: 0.45, step: 0.01, fmt: v => `${(v*100).toFixed(0)}¢`, nullable: true },
  ],
  market_making: [
    { key: "mm_spread", label: "Spread",      min: 0.01, max: 0.20, step: 0.005, fmt: v => `${(v*100).toFixed(1)}¢` },
    { key: "stop_loss", label: "Stop Loss",   min: 0.05, max: 0.45, step: 0.01,  fmt: v => `${(v*100).toFixed(0)}¢`, nullable: true },
  ],
  xgboost: [
    { key: "xgb_n_estimators",  label: "Boost Rounds", min: 10,   max: 1000, step: 10,   fmt: v => `${v}` },
    { key: "xgb_learning_rate", label: "η Rate",        min: 0.01, max: 0.50, step: 0.01, fmt: v => v.toFixed(2) },
    { key: "xgb_max_depth",     label: "Tree Depth",    min: 1,    max: 8,    step: 1,    fmt: v => `${v}` },
    { key: "xgb_train_frac",    label: "Train Window",  min: 0.10, max: 0.70, step: 0.05, fmt: v => `${(v*100).toFixed(0)}%` },
    { key: "xgb_confidence",    label: "Confidence",    min: 0.50, max: 0.90, step: 0.01, fmt: v => `${(v*100).toFixed(0)}%` },
  ],
};

// ── Stock param sets (prices in $, thresholds as % change) ────────────────────
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const PARAMS_STOCK: Record<string, ParamDef[]> = {
  // Momentum: breakout window, min move %, trailing stop %, hard stop
  momentum: [
    { key: "window",       label: "Window",     min: 3,   max: 60,  step: 1,   fmt: v => `${v} bars` },
    { key: "momentum_min", label: "Min Move",   min: 0.5, max: 30,  step: 0.5, fmt: v => `${v.toFixed(1)}%` },
    { key: "trail_pct",    label: "Trail Stop", min: 1,   max: 30,  step: 0.5, fmt: v => `${v.toFixed(1)}%` },
    { key: "stop_loss",    label: "Hard Stop",  min: 0.01, max: 0.20, step: 0.01, fmt: pct, nullable: true },
  ],
  // Threshold: entry = % dip from rolling high, exit = % gain from entry price
  threshold: [
    { key: "entry_threshold", label: "Buy Dip",      min: 0.02, max: 0.30, step: 0.01, fmt: pct },
    { key: "exit_threshold",  label: "Take Profit",  min: 0.02, max: 0.30, step: 0.01, fmt: pct },
    { key: "stop_loss",       label: "Stop Loss",    min: 0.01, max: 0.20, step: 0.01, fmt: pct, nullable: true },
  ],
  // Z-score uses z-scores (unitless), stop_loss guard as % loss
  zscore_reversion: [
    { key: "zscore_window", label: "Window",      min: 5,    max: 100,  step: 1,   fmt: v => `${v} days` },
    { key: "zscore_entry",  label: "Entry Z",     min: 0.5,  max: 4.0,  step: 0.1, fmt: v => `${v.toFixed(1)}σ` },
    { key: "zscore_exit",   label: "Exit Z",      min: -2.0, max: 2.0,  step: 0.1, fmt: v => `${v.toFixed(1)}σ` },
    { key: "zscore_stop",   label: "Stop Z",      min: 1.0,  max: 6.0,  step: 0.1, fmt: v => `${v.toFixed(1)}σ` },
    { key: "stop_loss",     label: "Loss Stop",   min: 0.01, max: 0.20, step: 0.01, fmt: pct, nullable: true },
  ],
  mean_reversion: [
    { key: "zscore_window", label: "Window",      min: 5,    max: 100,  step: 1,   fmt: v => `${v} days` },
    { key: "zscore_entry",  label: "Entry Z",     min: 0.5,  max: 4.0,  step: 0.1, fmt: v => `${v.toFixed(1)}σ` },
    { key: "stop_loss",     label: "Loss Stop",   min: 0.01, max: 0.20, step: 0.01, fmt: pct, nullable: true },
  ],
  // Kelly: fractional sizing, entry/exit as % change
  kelly: [
    { key: "kelly_fraction",  label: "Kelly f",      min: 0.1,  max: 1.0,  step: 0.05, fmt: v => `${(v*100).toFixed(0)}%` },
    { key: "entry_threshold", label: "Buy Dip",      min: 0.02, max: 0.30, step: 0.01, fmt: pct },
    { key: "exit_threshold",  label: "Take Profit",  min: 0.02, max: 0.30, step: 0.01, fmt: pct },
    { key: "stop_loss",       label: "Stop Loss",    min: 0.01, max: 0.20, step: 0.01, fmt: pct, nullable: true },
  ],
  // Market making: spread as % of price
  market_making: [
    { key: "mm_spread", label: "Spread %",  min: 0.005, max: 0.10, step: 0.005, fmt: pct },
    { key: "stop_loss", label: "Stop Loss", min: 0.01,  max: 0.20, step: 0.01,  fmt: pct, nullable: true },
  ],
  // Short momentum: only stop loss (entry/exit driven by price direction)
  short_momentum: [
    { key: "stop_loss", label: "Max Loss %", min: 0.01, max: 0.25, step: 0.01, fmt: pct, nullable: true },
  ],
  // Short z-score: short overbought spikes
  short_zscore: [
    { key: "zscore_window", label: "Window",      min: 5,    max: 100,  step: 1,   fmt: v => `${v} days` },
    { key: "zscore_entry",  label: "Entry Z",     min: 0.5,  max: 4.0,  step: 0.1, fmt: v => `${v.toFixed(1)}σ` },
    { key: "zscore_exit",   label: "Exit Z",      min: -2.0, max: 2.0,  step: 0.1, fmt: v => `${v.toFixed(1)}σ` },
    { key: "stop_loss",     label: "Loss Stop %", min: 0.01, max: 0.25, step: 0.01, fmt: pct, nullable: true },
  ],
  // XGBoost: model params unchanged
  xgboost: [
    { key: "xgb_n_estimators",  label: "Boost Rounds", min: 10,   max: 1000, step: 10,   fmt: v => `${v}` },
    { key: "xgb_learning_rate", label: "η Rate",        min: 0.01, max: 0.50, step: 0.01, fmt: v => v.toFixed(2) },
    { key: "xgb_max_depth",     label: "Tree Depth",    min: 1,    max: 8,    step: 1,    fmt: v => `${v}` },
    { key: "xgb_train_frac",    label: "Train Window",  min: 0.10, max: 0.70, step: 0.05, fmt: v => `${(v*100).toFixed(0)}%` },
    { key: "xgb_confidence",    label: "Confidence",    min: 0.50, max: 0.90, step: 0.01, fmt: v => `${(v*100).toFixed(0)}%` },
  ],
};

// Wizard has no user-tunable params — it runs all strategies with current settings
const WIZARD_NOTE = null;
// Register empty entries so the lookup doesn't fall through to the wrong set
(PARAMS as Record<string, ParamDef[] | null>)["wizard"] = WIZARD_NOTE;
(PARAMS_STOCK as Record<string, ParamDef[] | null>)["wizard"] = WIZARD_NOTE;

export const DEFAULT_PARAMS: StrategyParams = {
  entry_threshold:   0.30,
  exit_threshold:    0.70,
  stop_loss:         null,
  zscore_window:     20,
  zscore_entry:      1.5,
  zscore_exit:       0.0,
  zscore_stop:       3.0,
  kelly_fraction:    0.5,
  mm_spread:         0.04,
  xgb_n_estimators:  330,
  xgb_learning_rate: 0.1,
  xgb_max_depth:     3,
  xgb_train_frac:    0.30,
  xgb_confidence:    0.55,
  window:            14,
  momentum_min:      5.0,
  trail_pct:         10.0,
};

export default function ParamSliders({ strategy, params, onChange, exchange }: ParamSlidersProps) {
  const isStock = exchange === "yahoo";
  const paramMap = isStock ? PARAMS_STOCK : PARAMS;
  const defs = paramMap[strategy] ?? PARAMS[strategy];
  // wizard and other no-param strategies show a note instead of sliders
  if (!defs) {
    if (strategy === "wizard") return (
      <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", fontSize: 9, color: "var(--muted)" }}>
        No parameters — Wizard runs all long strategies with current settings and returns the winner.
      </div>
    );
    return null;
  }

  const set = (key: keyof StrategyParams, value: number | null) =>
    onChange({ ...params, [key]: value });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
        Parameters
      </div>

      {defs.map(def => {
        const rawVal = params[def.key];
        const isNull = rawVal === null;
        const numVal = isNull ? (def.min + def.max) / 2 : (rawVal as number);

        return (
          <div key={def.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>

            {/* Nullable toggle */}
            {def.nullable && (
              <button
                onClick={() => set(def.key, isNull ? parseFloat(((def.min + def.max) / 2).toFixed(2)) : null)}
                style={{
                  width: 28, height: 14, borderRadius: 7, border: "none", cursor: "pointer", flexShrink: 0,
                  background: isNull ? "var(--border2)" : "var(--accent)",
                  position: "relative", transition: "background 0.15s",
                }}
              >
                <span style={{
                  position: "absolute", top: 2, width: 10, height: 10, borderRadius: "50%",
                  background: "#fff", transition: "left 0.15s",
                  left: isNull ? 2 : 16,
                }} />
              </button>
            )}

            {/* Label */}
            <div style={{
              fontSize: 9, color: isNull ? "var(--muted)" : "var(--muted2)",
              width: 62, flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.05em",
            }}>
              {def.label}
            </div>

            {/* Slider */}
            <input
              type="range"
              min={def.min}
              max={def.max}
              step={def.step}
              value={numVal}
              disabled={isNull}
              onChange={e => set(def.key, parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: "var(--accent)", opacity: isNull ? 0.3 : 1, cursor: isNull ? "not-allowed" : "pointer" }}
            />

            {/* Value */}
            <div style={{
              fontSize: 10, color: isNull ? "var(--muted)" : "var(--accent)",
              fontFamily: "IBM Plex Mono, monospace", width: 44, textAlign: "right", flexShrink: 0,
            }}>
              {isNull ? "off" : def.fmt(numVal)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
