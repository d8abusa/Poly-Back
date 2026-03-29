import { useState, useEffect, useRef } from "react";
import type { Market, ExchangeId, StrategyParams, BatchWizardResult, MarketWizardResult, StrategyOOSResult } from "../../types";
import { apiFetch } from "../../lib/apiFetch";

// ── Help content ──────────────────────────────────────────────────────────────

const HELP_SECTIONS = [
  {
    icon: "🧙",
    title: "What is Batch Optimize-then-Wizard?",
    body: "It runs a full strategy search across every market in your queue simultaneously. For each market it tries every selected strategy, finds the best parameters via Optuna, then ranks strategies by how well those parameters actually work on data the optimizer never saw.",
  },
  {
    icon: "🔄",
    title: "Walk-forward Validation",
    body: "The key feature. History is split into TRAIN (older data) and VALIDATION (most recent N days). Optuna only sees the training window. The best params are then evaluated on the validation window — completely unseen data. This is the closest thing to a live test without actually trading.",
  },
  {
    icon: "📅",
    title: "Validation Days",
    body: "How many calendar days to hold out for out-of-sample testing. 90 days is a good default — enough data to be statistically meaningful, not so much that the training window is too short. Increase to 180+ for long-running markets, decrease to 30 for short-lived ones.",
  },
  {
    icon: "🎯",
    title: "Strategies",
    body: "Select which strategies to evaluate. All 6 are enabled by default. Deselecting strategies speeds up the run significantly — each unchecked strategy reduces run time by roughly 1/(N strategies). For a first pass, try just Z-Score Reversion and Kelly.",
  },
  {
    icon: "🔬",
    title: "Trials & Jobs",
    body: "Trials controls how hard Optuna searches per strategy per market. 50 is a good default for batch runs — higher gives better params but multiplies total run time by N markets × M strategies. Jobs controls parallelism within each optimizer call.",
  },
  {
    icon: "📊",
    title: "Reading the Results",
    body: "Each market card shows its best strategy by OOS (out-of-sample) Sharpe. Expand a card to see all strategies ranked. Train Sharpe is the optimized in-sample score — it will always look better. OOS Sharpe is the honest number. If OOS Sharpe is close to Train Sharpe, the params generalise well.",
  },
  {
    icon: "🌡",
    title: "Overfit Score",
    body: "Train Sharpe minus OOS Sharpe. Green (< 0.5): well-generalised. Yellow (0.5–1.5): moderate overfit — use with caution. Red (> 1.5): severely overfit — the optimizer memorized noise. A high overfit score means those params are unlikely to hold forward.",
    warn: true,
  },
  {
    icon: "✓",
    title: "Apply Button",
    body: "Click Apply on any strategy row to copy those params to the Backtest tab and switch the active strategy. You'll be taken to Backtest automatically. Run a standard backtest to see the full equity curve with those parameters.",
  },
  {
    icon: "⏱",
    title: "Performance Note",
    body: "Expect 30 seconds to 5 minutes depending on queue size, number of strategies, and trials. 3 markets × 6 strategies × 50 trials ≈ 60–90 seconds on a modern CPU. Start with fewer strategies and fewer trials to get a quick read before committing to a full run.",
    warn: true,
  },
];

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.72)", display: "flex",
        alignItems: "center", justifyContent: "center",
        padding: "20px",
        animation: "fadeIn 0.15s ease",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border2)",
        borderRadius: 12, width: "100%", maxWidth: 640,
        maxHeight: "85vh", overflow: "hidden",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
      }}>
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", fontFamily: "IBM Plex Mono, monospace" }}>
              Batch Wizard — How it works
            </div>
            <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 2 }}>
              Walk-forward optimization across your entire queue
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "1px solid var(--border2)",
              borderRadius: 6, cursor: "pointer", color: "var(--muted2)",
              fontFamily: "IBM Plex Mono, monospace", fontSize: 12,
              padding: "4px 10px", transition: "all 0.12s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--muted2)"; }}
          >
            x Close
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          {HELP_SECTIONS.map((s, i) => (
            <div
              key={i}
              style={{
                display: "flex", gap: 14, padding: "12px 14px", borderRadius: 8,
                background: s.warn ? "rgba(255,107,53,0.06)" : "var(--surface2)",
                border: `1px solid ${s.warn ? "rgba(255,107,53,0.2)" : "var(--border)"}`,
              }}
            >
              <div style={{ fontSize: 20, flexShrink: 0, lineHeight: 1, paddingTop: 1 }}>
                {s.icon}
              </div>
              <div>
                <div style={{
                  fontSize: 11, fontWeight: 700, marginBottom: 5,
                  color: s.warn ? "#f97316" : "var(--text)",
                  fontFamily: "IBM Plex Mono, monospace",
                }}>
                  {s.title}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted2)", lineHeight: 1.65 }}>
                  {s.body}
                </div>
              </div>
            </div>
          ))}

          <div style={{
            textAlign: "center", fontSize: 9, color: "var(--muted)",
            paddingTop: 4, paddingBottom: 4,
          }}>
            Pro tip: sort results by OOS Sharpe and focus on markets where overfit score is below 0.5.
          </div>
        </div>

        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <button
            onClick={onClose}
            style={{
              width: "100%", padding: "9px", borderRadius: 6, cursor: "pointer",
              fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 700,
              background: "rgba(0,212,168,0.12)", border: "1px solid rgba(0,212,168,0.35)",
              color: "var(--accent)", transition: "all 0.15s",
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Strategy definitions ───────────────────────────────────────────────────────

const ALL_STRATEGIES = [
  { id: "threshold",        label: "Threshold" },
  { id: "zscore_reversion", label: "Z-Score Reversion" },
  { id: "mean_reversion",   label: "Mean Reversion" },
  { id: "kelly",            label: "Kelly Criterion" },
  { id: "momentum",         label: "Momentum Chaser" },
  { id: "swing_reversion",  label: "Swing Reversion" },
];

const STRATEGY_LABELS: Record<string, string> = Object.fromEntries(
  ALL_STRATEGIES.map(s => [s.id, s.label])
);

// ── Helper components ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
      {children}
    </div>
  );
}

function SliderRow({
  label, value, min, max, step, fmt, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ fontSize: 9, color: "var(--muted2)", width: 72, flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: "var(--accent)", cursor: "pointer" }}
      />
      <div style={{ fontSize: 10, color: "var(--accent)", fontFamily: "IBM Plex Mono, monospace", width: 56, textAlign: "right", flexShrink: 0 }}>
        {fmt(value)}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)",
  borderRadius: 6, padding: "6px 10px", color: "var(--text)",
  fontFamily: "IBM Plex Mono, monospace", fontSize: 11, outline: "none",
  boxSizing: "border-box",
};

// ── Overfit color ──────────────────────────────────────────────────────────────

function overfitColor(score: number): string {
  if (score < 0.5)  return "var(--yes)";
  if (score < 1.5)  return "#f59e0b";
  return "var(--no)";
}

// ── Market result card ─────────────────────────────────────────────────────────

interface MarketCardProps {
  result: MarketWizardResult;
  onApply: (strategy: string, params: Partial<StrategyParams>) => void;
}

function MarketCard({ result, onApply }: MarketCardProps) {
  const [expanded, setExpanded] = useState(false);

  const bestResult = result.strategy_results[0] ?? null;

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border2)",
      borderRadius: 10, overflow: "hidden",
    }}>
      {/* Card header */}
      <div
        style={{
          padding: "12px 16px", cursor: "pointer",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
          borderBottom: expanded ? "1px solid var(--border)" : "none",
        }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: "var(--text)",
            fontFamily: "IBM Plex Mono, monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {result.market_title.length > 60
              ? result.market_title.slice(0, 57) + "..."
              : result.market_title}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 9, color: "var(--muted)" }}>
              {result.train_points} train pts · {result.val_points} val pts · {result.train_days}d train
            </span>
            {result.error && (
              <span style={{ fontSize: 9, color: "var(--no)" }}>
                {result.error}
              </span>
            )}
          </div>
        </div>

        {/* Right side summary */}
        {!result.error && bestResult && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{
              padding: "3px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700,
              background: "rgba(0,212,168,0.1)", border: "1px solid rgba(0,212,168,0.3)",
              color: "var(--accent)", fontFamily: "IBM Plex Mono, monospace",
              whiteSpace: "nowrap",
            }}>
              {STRATEGY_LABELS[bestResult.strategy] ?? bestResult.strategy}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{
                fontSize: 14, fontWeight: 700, fontFamily: "IBM Plex Mono, monospace",
                color: bestResult.oos_sharpe >= 1 ? "var(--yes)" : bestResult.oos_sharpe >= 0 ? "var(--accent)" : "var(--no)",
              }}>
                {bestResult.oos_sharpe.toFixed(3)}
              </div>
              <div style={{ fontSize: 8, color: "var(--muted)" }}>OOS Sharpe</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{
                fontSize: 13, fontWeight: 600, fontFamily: "IBM Plex Mono, monospace",
                color: bestResult.oos_return >= 0 ? "var(--yes)" : "var(--no)",
              }}>
                {bestResult.oos_return >= 0 ? "+" : ""}{bestResult.oos_return.toFixed(1)}%
              </div>
              <div style={{ fontSize: 8, color: "var(--muted)" }}>OOS Return</div>
            </div>
            <div style={{
              fontSize: 10, color: "var(--muted2)", transition: "transform 0.15s",
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            }}>
              v
            </div>
          </div>
        )}
        {result.error && (
          <div style={{ fontSize: 9, color: "var(--muted2)" }}>{expanded ? "^" : "v"}</div>
        )}
      </div>

      {/* Expanded strategy table */}
      {expanded && !result.error && result.strategy_results.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{
            width: "100%", borderCollapse: "collapse",
            fontSize: 10, fontFamily: "IBM Plex Mono, monospace",
          }}>
            <thead>
              <tr style={{ background: "var(--surface2)" }}>
                {["Strategy", "Train Sharpe", "OOS Sharpe", "Overfit", "OOS Return", "Win%", "Trades", ""].map(h => (
                  <th key={h} style={{
                    padding: "6px 10px", textAlign: "left",
                    color: "var(--muted)", fontWeight: 500, fontSize: 9,
                    textTransform: "uppercase", letterSpacing: 1,
                    borderBottom: "1px solid var(--border2)",
                    whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.strategy_results.map((sr, i) => {
                const isBest = i === 0;
                return (
                  <tr
                    key={sr.strategy}
                    style={{
                      background: isBest ? "rgba(0,212,168,0.04)" : "transparent",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <td style={{
                      padding: "7px 10px",
                      color: isBest ? "var(--accent)" : "var(--text)",
                      fontWeight: isBest ? 700 : 400,
                      whiteSpace: "nowrap",
                    }}>
                      {isBest && <span style={{ marginRight: 4 }}>*</span>}
                      {STRATEGY_LABELS[sr.strategy] ?? sr.strategy}
                    </td>
                    <td style={{
                      padding: "7px 10px",
                      color: sr.train_sharpe >= 1 ? "var(--yes)" : sr.train_sharpe >= 0 ? "var(--muted2)" : "var(--no)",
                    }}>
                      {sr.train_sharpe.toFixed(3)}
                    </td>
                    <td style={{
                      padding: "7px 10px", fontWeight: 600,
                      color: sr.oos_sharpe >= 1 ? "var(--yes)" : sr.oos_sharpe >= 0 ? "var(--accent)" : "var(--no)",
                    }}>
                      {sr.oos_sharpe.toFixed(3)}
                    </td>
                    <td style={{ padding: "7px 10px", color: overfitColor(sr.overfit_score), fontWeight: 600 }}>
                      {sr.overfit_score >= 0 ? "+" : ""}{sr.overfit_score.toFixed(2)}
                    </td>
                    <td style={{
                      padding: "7px 10px",
                      color: sr.oos_return >= 0 ? "var(--yes)" : "var(--no)",
                    }}>
                      {sr.oos_return >= 0 ? "+" : ""}{sr.oos_return.toFixed(1)}%
                    </td>
                    <td style={{ padding: "7px 10px", color: "var(--muted2)" }}>
                      {(sr.oos_win_rate * 100).toFixed(0)}%
                    </td>
                    <td style={{ padding: "7px 10px", color: "var(--muted2)" }}>
                      {sr.oos_trades}
                    </td>
                    <td style={{ padding: "7px 10px" }}>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onApply(sr.strategy, sr.best_params as Partial<StrategyParams>);
                        }}
                        style={{
                          padding: "4px 10px", borderRadius: 4, cursor: "pointer",
                          fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700,
                          background: "rgba(0,212,168,0.12)", border: "1px solid rgba(0,212,168,0.35)",
                          color: "var(--accent)", transition: "all 0.12s", whiteSpace: "nowrap",
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,212,168,0.22)"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,212,168,0.12)"; }}
                      >
                        Apply
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {expanded && result.error && (
        <div style={{ padding: "12px 16px", fontSize: 10, color: "var(--no)" }}>
          {result.error}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface BatchWizardPanelProps {
  queuedMarkets: Market[];
  exchange: ExchangeId;
  capital: number;
  onApplyParams: (strategy: string, params: Partial<StrategyParams>) => void;
}

export default function BatchWizardPanel({ queuedMarkets, exchange, capital, onApplyParams }: BatchWizardPanelProps) {
  // Market selection — all checked by default
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // Strategy selection — all enabled by default
  const [selectedStrategies, setSelectedStrategies] = useState<Set<string>>(
    new Set(ALL_STRATEGIES.map(s => s.id))
  );

  // Config
  const [validationDays, setValidationDays] = useState(90);
  const [nTrials, setNTrials] = useState(50);
  const [nJobs, setNJobs] = useState(2);
  const [wizCapital, setWizCapital] = useState(capital || 1000);
  const [slippage, setSlippage] = useState(5);

  // Runtime
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<BatchWizardResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Keep capital in sync with parent
  useEffect(() => { if (capital > 0) setWizCapital(capital); }, [capital]);

  // Sync checked IDs when queuedMarkets changes — default to all checked
  useEffect(() => {
    setCheckedIds(new Set(queuedMarkets.map(m => m.id)));
  }, [queuedMarkets.length]);

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  function toggleMarket(id: string) {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleStrategy(id: string) {
    setSelectedStrategies(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size === 1) return prev; // keep at least one
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const activeMarkets = queuedMarkets.filter(m => checkedIds.has(m.id));
  const runLabel = status === "running"
    ? `Analyzing... ${elapsed}s`
    : `Run Batch Wizard (${activeMarkets.length} markets x ${selectedStrategies.size} strategies)`;

  async function handleRun() {
    if (!activeMarkets.length) {
      setErrorMsg("Select at least one market from the queue.");
      setStatus("error");
      return;
    }

    setStatus("running");
    setResult(null);
    setErrorMsg("");
    setElapsed(0);

    const start = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);

    try {
      const body = {
        markets: activeMarkets.map(m => ({
          condition_id: m.condition_id ?? m.id,
          token_id:     m.token_id ?? m.id,
          title:        m.title,
        })),
        exchange,
        strategies:      Array.from(selectedStrategies),
        n_trials:        nTrials,
        n_jobs:          nJobs,
        initial_capital: wizCapital,
        slippage_bps:    slippage,
        interval:        "max",
        validation_days: validationDays,
      };

      const resp = await apiFetch("/api/backtest/batch-wizard", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? `API ${resp.status}`);
      }

      const data: BatchWizardResult = await resp.json();
      setResult(data);
      setStatus("done");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error");
      setStatus("error");
    } finally {
      stopTimer();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex", flex: 1, overflow: "hidden", flexDirection: "row",
      background: "var(--bg)", position: "relative", zIndex: 1,
    }}>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {/* ── Left config panel ─────────────────────────────────────────────── */}
      <div style={{
        width: 320, minWidth: 320, flexShrink: 0, borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Panel header */}
        <div style={{
          padding: "14px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
              Batch Optimize-then-Wizard
            </div>
            <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 3 }}>
              Walk-forward validation · all markets · all strategies
            </div>
          </div>
          <button
            onClick={() => setShowHelp(true)}
            title="How does this work?"
            style={{
              width: 24, height: 24, borderRadius: "50%", cursor: "pointer",
              background: "transparent", border: "1px solid var(--border2)",
              color: "var(--muted2)", fontFamily: "IBM Plex Mono, monospace",
              fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center",
              justifyContent: "center", transition: "all 0.12s", flexShrink: 0,
            }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "rgba(0,212,168,0.5)"; el.style.color = "var(--accent)"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "var(--border2)"; el.style.color = "var(--muted2)"; }}
          >
            ?
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Market list */}
          <section>
            <SectionLabel>Markets ({checkedIds.size} / {queuedMarkets.length} selected)</SectionLabel>
            {queuedMarkets.length === 0 ? (
              <div style={{
                padding: "12px", borderRadius: 6, fontSize: 10, color: "var(--muted)",
                background: "var(--surface2)", border: "1px solid var(--border2)",
                textAlign: "center",
              }}>
                No markets in queue — add markets on the Backtest tab first.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {queuedMarkets.map(m => {
                  const checked = checkedIds.has(m.id);
                  return (
                    <label
                      key={m.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 8px", borderRadius: 5, cursor: "pointer",
                        background: checked ? "rgba(0,212,168,0.04)" : "transparent",
                        border: `1px solid ${checked ? "rgba(0,212,168,0.2)" : "var(--border2)"}`,
                        transition: "all 0.1s",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMarket(m.id)}
                        style={{ accentColor: "var(--accent)", cursor: "pointer", flexShrink: 0 }}
                      />
                      <span style={{
                        fontSize: 10, color: checked ? "var(--text)" : "var(--muted2)",
                        fontFamily: "IBM Plex Mono, monospace", overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {m.title.length > 38 ? m.title.slice(0, 35) + "..." : m.title}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </section>

          {/* Strategy chips */}
          <section>
            <SectionLabel>Strategies ({selectedStrategies.size} active)</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {ALL_STRATEGIES.map(s => {
                const active = selectedStrategies.has(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleStrategy(s.id)}
                    style={{
                      padding: "5px 10px", borderRadius: 5, cursor: "pointer",
                      fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                      textAlign: "left",
                      border: `1px solid ${active ? "rgba(0,212,168,0.4)" : "var(--border2)"}`,
                      background: active ? "rgba(0,212,168,0.08)" : "transparent",
                      color: active ? "var(--accent)" : "var(--muted2)",
                      fontWeight: active ? 700 : 400,
                      transition: "all 0.12s",
                    }}
                  >
                    {active ? "[x] " : "[ ] "}{s.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Validation window */}
          <section>
            <SectionLabel>Walk-forward Validation</SectionLabel>
            <SliderRow
              label="Val Days"
              value={validationDays}
              min={14} max={365} step={7}
              fmt={v => `${v}d`}
              onChange={setValidationDays}
            />
            <div style={{ marginTop: 4, fontSize: 9, color: "var(--muted)", lineHeight: 1.5 }}>
              Most recent {validationDays} days held out for OOS evaluation.
              Optimizer only sees data before this window.
            </div>
          </section>

          {/* Search budget */}
          <section>
            <SectionLabel>Search Budget</SectionLabel>
            <SliderRow
              label="Trials"
              value={nTrials}
              min={10} max={200} step={10}
              fmt={v => `${v}`}
              onChange={setNTrials}
            />
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 9, color: "var(--muted2)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                Parallel Jobs
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {[1, 2, 4].map(n => {
                  const active = nJobs === n;
                  return (
                    <button key={n} onClick={() => setNJobs(n)} style={{
                      flex: 1, padding: "5px 0", borderRadius: 4, cursor: "pointer",
                      fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                      border: `1px solid ${active ? "rgba(123,97,255,0.5)" : "var(--border2)"}`,
                      background: active ? "rgba(123,97,255,0.12)" : "transparent",
                      color: active ? "#a855f7" : "var(--muted2)",
                      fontWeight: active ? 700 : 400,
                    }}>
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Simulation params */}
          <section>
            <SectionLabel>Simulation</SectionLabel>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: "var(--muted2)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                Capital ($)
              </div>
              <input
                type="number"
                min={1}
                value={wizCapital}
                onChange={e => setWizCapital(parseFloat(e.target.value) || 1000)}
                style={inputStyle}
              />
            </div>
            <SliderRow
              label="Slippage"
              value={slippage}
              min={0} max={50} step={1}
              fmt={v => `${v} bps`}
              onChange={setSlippage}
            />
          </section>

        </div>

        {/* Run button */}
        <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
          <button
            onClick={handleRun}
            disabled={status === "running"}
            style={{
              width: "100%", padding: "10px", borderRadius: 6,
              cursor: status === "running" ? "not-allowed" : "pointer",
              fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 700,
              background: status === "running" ? "rgba(0,212,168,0.08)" : "rgba(0,212,168,0.15)",
              border: "1px solid rgba(0,212,168,0.4)",
              color: status === "running" ? "var(--muted)" : "var(--accent)",
              transition: "all 0.15s",
            }}
          >
            {status === "running" ? `Analyzing... ${elapsed}s` : runLabel}
          </button>
          {status === "running" && (
            <div style={{ marginTop: 6, fontSize: 9, color: "var(--muted)", textAlign: "center" }}>
              {activeMarkets.length} markets x {selectedStrategies.size} strategies x {nTrials} trials
              · may take several minutes
            </div>
          )}
        </div>
      </div>

      {/* ── Right results panel ────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

        {status === "idle" && (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 32, opacity: 0.12 }}>🧙</div>
            <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace" }}>
              Configure markets and strategies, then click Run.
            </div>
            <div style={{ fontSize: 10, color: "var(--muted2)", maxWidth: 420, textAlign: "center", lineHeight: 1.6 }}>
              The Batch Wizard optimizes each strategy on training data, then evaluates it
              on a held-out validation window — giving you honest out-of-sample results.
            </div>
            {queuedMarkets.length === 0 && (
              <div style={{
                padding: "8px 16px", borderRadius: 6, fontSize: 10, color: "var(--no)",
                background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
              }}>
                No markets in queue. Add markets on the Backtest tab first.
              </div>
            )}
          </div>
        )}

        {status === "running" && (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 18 }}>
            <div style={{ fontSize: 11, color: "var(--accent)", fontFamily: "IBM Plex Mono, monospace" }}>
              Running walk-forward optimization...
            </div>
            <div style={{
              width: 240, height: 4, background: "var(--border2)", borderRadius: 2, overflow: "hidden",
            }}>
              <div style={{
                height: "100%", background: "var(--accent)", borderRadius: 2,
                width: `${Math.min(95, (elapsed / 300) * 100)}%`,
                transition: "width 0.5s linear",
              }} />
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)" }}>
              {elapsed}s elapsed
            </div>
            <div style={{
              fontSize: 9, color: "var(--muted2)", maxWidth: 340, textAlign: "center",
              lineHeight: 1.6, padding: "8px 16px", borderRadius: 6,
              background: "rgba(255,107,53,0.04)", border: "1px solid rgba(255,107,53,0.12)",
            }}>
              This may take several minutes. Do not close or navigate away.
            </div>
          </div>
        )}

        {status === "error" && (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--no)", fontFamily: "IBM Plex Mono, monospace" }}>
              Error: {errorMsg}
            </div>
            <button
              onClick={() => setStatus("idle")}
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                color: "var(--accent)", fontFamily: "IBM Plex Mono, monospace", fontSize: 9,
                padding: 0, textDecoration: "underline", textDecorationStyle: "dotted",
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {status === "done" && result && (
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {/* Summary header */}
            <div style={{
              padding: "12px 20px", borderBottom: "1px solid var(--border)",
              background: "var(--surface)", flexShrink: 0,
              display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
            }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700, fontFamily: "IBM Plex Mono, monospace" }}>
                  Batch Wizard Results
                </div>
                <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 2 }}>
                  {result.total} markets &middot; {selectedStrategies.size} strategies &middot; {result.validation_days}-day validation &middot; {result.elapsed_sec.toFixed(1)}s
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
                <div style={{
                  padding: "5px 12px", borderRadius: 6, fontSize: 9, fontWeight: 700,
                  background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)",
                  color: "var(--yes)", fontFamily: "IBM Plex Mono, monospace",
                }}>
                  {result.succeeded} succeeded
                </div>
                {result.failed > 0 && (
                  <div style={{
                    padding: "5px 12px", borderRadius: 6, fontSize: 9, fontWeight: 700,
                    background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
                    color: "var(--no)", fontFamily: "IBM Plex Mono, monospace",
                  }}>
                    {result.failed} failed
                  </div>
                )}
              </div>
            </div>

            {/* Overfit legend */}
            <div style={{
              padding: "6px 20px", borderBottom: "1px solid var(--border)",
              background: "var(--surface2)", flexShrink: 0,
              display: "flex", gap: 16, alignItems: "center",
              fontSize: 9, fontFamily: "IBM Plex Mono, monospace",
            }}>
              <span style={{ color: "var(--muted)" }}>Overfit score:</span>
              <span style={{ color: "var(--yes)" }}>&lt; 0.5 low</span>
              <span style={{ color: "#f59e0b" }}>0.5–1.5 moderate</span>
              <span style={{ color: "var(--no)" }}>&gt; 1.5 severe</span>
            </div>

            {/* Market cards */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
              {result.results.map(r => (
                <MarketCard
                  key={r.condition_id}
                  result={r}
                  onApply={onApplyParams}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
