import { useState, useEffect, useRef } from "react";
import type { Market, ExchangeId, StrategyParams, OptimizeResult } from "../../types";
import { apiFetch } from "../../lib/apiFetch";

// ── Help content ─────────────────────────────────────────────────────────────

const HELP_SECTIONS = [
  {
    icon: "⚡",
    title: "What does the Optimizer do?",
    body: "It automatically hunts for the best strategy settings for a specific market. Instead of you manually dragging sliders, it tries hundreds of parameter combinations in parallel and keeps the ones that produced the highest Sharpe ratio.",
  },
  {
    icon: "🏪",
    title: "Market",
    body: "Pick any market from your queue (markets you've added on the Backtest tab). The optimizer downloads that market's full price history and runs everything against it. You can also paste a condition ID manually if you haven't queued the market.",
  },
  {
    icon: "🎯",
    title: "Strategy",
    body: "Choose which strategy you want to tune. Each strategy has different knobs — for example, Z-Score Reversion has window size and entry/exit thresholds, while Kelly Criterion has a fraction and dip parameters. Only pick a strategy you're planning to actually trade.",
  },
  {
    icon: "🔬",
    title: "Trials & Parallel Jobs",
    body: "Trials is how many parameter combinations to test. More trials = more thorough search, but slower. 200 is a good starting point. Jobs controls how many run in parallel — higher is faster if your machine has multiple cores. Diminishing returns above 8.",
  },
  {
    icon: "▶",
    title: "Running",
    body: "Click Run Optimizer and wait. A progress bar shows elapsed time. Typical runs take 5–30 seconds. If you get a timeout, try fewer trials or a shorter date range.",
  },
  {
    icon: "📊",
    title: "Reading the Results",
    body: "Sharpe ratio measures return relative to risk — anything above 1.0 is solid, above 2.0 is excellent. Return is the total % gain. Win Rate is the fraction of trades that were profitable. The Top Trials table shows the best runs ranked by Sharpe.",
  },
  {
    icon: "✓",
    title: "Apply to Backtest",
    body: "Click this button to copy the best-found parameters directly into the Backtest tab. You'll be taken there automatically. Then add your market to the queue and run a standard backtest to see the full equity curve and trade log.",
  },
  {
    icon: "⚠",
    title: "The Important Catch",
    body: "Optimizer results are in-sample — the parameters were found by searching the same data they're measured against. This can produce numbers that look great but fall apart on live markets. Always run a normal backtest on a different time window before committing real capital.",
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
        borderRadius: 12, width: "100%", maxWidth: 620,
        maxHeight: "85vh", overflow: "hidden",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
      }}>
        {/* Modal header */}
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", fontFamily: "IBM Plex Mono, monospace" }}>
              Optimizer — How it works
            </div>
            <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 2 }}>
              A quick guide to every panel feature
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
            ✕ Close
          </button>
        </div>

        {/* Scrollable content */}
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

          {/* Footer tip */}
          <div style={{
            textAlign: "center", fontSize: 9, color: "var(--muted)",
            paddingTop: 4, paddingBottom: 4,
          }}>
            Pro tip: start with Z-Score Reversion on prediction markets — it tends to find stable parameters quickly.
          </div>
        </div>

        {/* Footer button */}
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

// Strategies that have defined Optuna search spaces on the backend
const OPTIMIZABLE = [
  { id: "threshold",       label: "Threshold" },
  { id: "zscore_reversion",label: "Z-Score Reversion" },
  { id: "mean_reversion",  label: "Mean Reversion" },
  { id: "kelly",           label: "Kelly Criterion" },
  { id: "momentum",        label: "Momentum Chaser" },
  { id: "swing_reversion", label: "Swing Reversion" },
];

// Readable labels for param keys
const PARAM_LABELS: Record<string, string> = {
  entry_threshold:   "Entry",
  exit_threshold:    "Exit",
  stop_loss:         "Stop Loss",
  zscore_window:     "Z Window",
  zscore_entry:      "Entry Z",
  zscore_exit:       "Exit Z",
  zscore_stop:       "Stop Z",
  kelly_fraction:    "Kelly f",
  lookback_window:   "Lookback",
  reversion_threshold: "Rev σ",
  window:            "Window",
  momentum_min:      "Min Move",
  trail_pct:         "Trail %",
  slippage_bps:      "Slippage",
};

function fmtParam(key: string, val: number): string {
  if (key.includes("threshold") || key === "stop_loss" || key === "kelly_fraction")
    return `${(val * 100).toFixed(1)}%`;
  if (key.includes("zscore") && !key.includes("window")) return `${val.toFixed(2)}σ`;
  if (key === "trail_pct" || key === "momentum_min") return `${val.toFixed(1)}%`;
  if (key === "slippage_bps") return `${val.toFixed(0)} bps`;
  if (Number.isInteger(val)) return `${val}`;
  return val.toFixed(3);
}

function StatCard({ label, value, color = "var(--accent)" }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      background: "var(--surface2)", border: "1px solid var(--border2)",
      borderRadius: 8, padding: "12px 16px", flex: 1, minWidth: 110,
    }}>
      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "IBM Plex Mono, monospace", lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

interface OptimizerPanelProps {
  queuedMarkets: Market[];
  exchange: ExchangeId;
  capital: number;
  onApplyParams: (strategy: string, params: Partial<StrategyParams>) => void;
}

export default function OptimizerPanel({ queuedMarkets, exchange, capital, onApplyParams }: OptimizerPanelProps) {
  // Market selection
  const [selectedIdx, setSelectedIdx]     = useState(0);
  const [manualCid, setManualCid]         = useState("");
  const [manualTid, setManualTid]         = useState("");
  const [useManual, setUseManual]         = useState(false);

  // Strategy
  const [strategy, setStrategy]           = useState("zscore_reversion");

  // Config
  const [nTrials, setNTrials]             = useState(200);
  const [nJobs, setNJobs]                 = useState(8);
  const [optCapital, setOptCapital]       = useState(capital || 1000);
  const [slippage, setSlippage]           = useState(5);
  const [dateFrom, setDateFrom]           = useState("");
  const [dateTo, setDateTo]               = useState("");

  // Runtime state
  const [status, setStatus]               = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult]               = useState<OptimizeResult | null>(null);
  const [errorMsg, setErrorMsg]           = useState("");
  const [elapsed, setElapsed]             = useState(0);
  const timerRef                          = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showHelp, setShowHelp]           = useState(false);

  // Keep capital in sync with parent
  useEffect(() => { if (capital > 0) setOptCapital(capital); }, [capital]);

  // Reset market selection when queued markets change
  useEffect(() => { setSelectedIdx(0); }, [queuedMarkets.length]);

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  async function handleRun() {
    let condition_id: string;
    let token_id: string;

    if (useManual || !queuedMarkets.length) {
      condition_id = manualCid.trim();
      token_id     = manualTid.trim() || manualCid.trim();
      if (!condition_id) { setErrorMsg("Enter a condition ID to optimize."); return; }
    } else {
      const m = queuedMarkets[selectedIdx] ?? queuedMarkets[0];
      condition_id = m.condition_id ?? m.id;
      token_id     = m.token_id ?? m.id;
    }

    setStatus("running");
    setResult(null);
    setErrorMsg("");
    setElapsed(0);

    const start = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);

    try {
      const body: Record<string, unknown> = {
        condition_id,
        token_id,
        exchange,
        strategy,
        n_trials:        nTrials,
        n_jobs:          nJobs,
        initial_capital: optCapital,
        slippage_bps:    slippage,
        interval:        "max",
        ...(dateFrom ? { date_from: dateFrom } : {}),
        ...(dateTo   ? { date_to: dateTo }     : {}),
      };

      const resp = await apiFetch("/api/backtest/optimize", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail ?? `API ${resp.status}`);
      }

      const data: OptimizeResult = await resp.json();
      setResult(data);
      setStatus("done");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error");
      setStatus("error");
    } finally {
      stopTimer();
    }
  }

  function handleApply() {
    if (!result) return;
    onApplyParams(result.strategy, result.best_params as Partial<StrategyParams>);
  }

  const activeMarket = queuedMarkets[selectedIdx] ?? null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex", flex: 1, overflow: "hidden", flexDirection: "row",
      background: "var(--bg)", position: "relative", zIndex: 1,
    }}>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {/* ── Left config panel ───────────────────────────────────────────────── */}
      <div style={{
        width: 300, minWidth: 300, flexShrink: 0, borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>

        <div style={{
          padding: "14px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
              Strategy Optimizer
            </div>
            <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 3 }}>
              Optuna TPE · Bayesian search
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

          {/* Market selection */}
          <section>
            <SectionLabel>Market</SectionLabel>
            {queuedMarkets.length > 0 && !useManual ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <select
                  value={selectedIdx}
                  onChange={e => setSelectedIdx(parseInt(e.target.value))}
                  style={selectStyle}
                >
                  {queuedMarkets.map((m, i) => (
                    <option key={m.id} value={i}>
                      {m.title.length > 42 ? m.title.slice(0, 39) + "…" : m.title}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setUseManual(true)}
                  style={{ ...linkBtnStyle, textAlign: "left" }}
                >
                  Enter condition ID manually →
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <input
                  placeholder="Condition ID"
                  value={manualCid}
                  onChange={e => setManualCid(e.target.value)}
                  style={inputStyle}
                />
                <input
                  placeholder="Token ID (leave blank to use condition ID)"
                  value={manualTid}
                  onChange={e => setManualTid(e.target.value)}
                  style={inputStyle}
                />
                {queuedMarkets.length > 0 && (
                  <button onClick={() => { setUseManual(false); setManualCid(""); setManualTid(""); }} style={linkBtnStyle}>
                    ← Back to queued markets
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Strategy */}
          <section>
            <SectionLabel>Strategy</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {OPTIMIZABLE.map(s => {
                const active = strategy === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setStrategy(s.id)}
                    style={{
                      padding: "6px 10px", borderRadius: 5, cursor: "pointer",
                      fontFamily: "IBM Plex Mono, monospace", fontSize: 11,
                      textAlign: "left",
                      border: `1px solid ${active ? "rgba(0,212,168,0.4)" : "var(--border2)"}`,
                      background: active ? "rgba(0,212,168,0.08)" : "transparent",
                      color: active ? "var(--accent)" : "var(--muted2)",
                      fontWeight: active ? 700 : 400,
                      transition: "all 0.12s",
                    }}
                  >
                    {active ? "◉ " : "○ "}{s.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Trials */}
          <section>
            <SectionLabel>Search Budget</SectionLabel>
            <SliderRow
              label="Trials"
              value={nTrials}
              min={10} max={1000} step={10}
              fmt={v => `${v}`}
              onChange={setNTrials}
            />
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 9, color: "var(--muted2)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                Parallel Jobs
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {[1, 2, 4, 8, 16, 32].map(n => {
                  const active = nJobs === n;
                  return (
                    <button key={n} onClick={() => setNJobs(n)} style={{
                      flex: 1, padding: "4px 0", borderRadius: 4, cursor: "pointer",
                      fontFamily: "IBM Plex Mono, monospace", fontSize: 9,
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

          {/* Capital & slippage */}
          <section>
            <SectionLabel>Simulation</SectionLabel>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: "var(--muted2)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                Capital ($)
              </div>
              <input
                type="number"
                min={1}
                value={optCapital}
                onChange={e => setOptCapital(parseFloat(e.target.value) || 1000)}
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

          {/* Date range (optional) */}
          <section>
            <SectionLabel>Date Range (optional)</SectionLabel>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                style={{ ...inputStyle, flex: 1, fontSize: 10 }}
              />
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                style={{ ...inputStyle, flex: 1, fontSize: 10 }}
              />
            </div>
          </section>

        </div>

        {/* Run button */}
        <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
          <button
            onClick={handleRun}
            disabled={status === "running"}
            style={{
              width: "100%", padding: "10px", borderRadius: 6, cursor: status === "running" ? "not-allowed" : "pointer",
              fontFamily: "IBM Plex Mono, monospace", fontSize: 12, fontWeight: 700,
              background: status === "running" ? "rgba(0,212,168,0.08)" : "rgba(0,212,168,0.15)",
              border: "1px solid rgba(0,212,168,0.4)",
              color: status === "running" ? "var(--muted)" : "var(--accent)",
              transition: "all 0.15s",
            }}
          >
            {status === "running"
              ? `◌ Optimizing… ${elapsed}s`
              : "▶ Run Optimizer"}
          </button>
          {status === "running" && (
            <div style={{ marginTop: 6, fontSize: 9, color: "var(--muted)", textAlign: "center" }}>
              {nTrials} trials · {nJobs} threads · may take up to 60s
            </div>
          )}
        </div>
      </div>

      {/* ── Right results panel ──────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

        {status === "idle" && (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 28, opacity: 0.15 }}>⚡</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Configure a market and strategy, then click Run Optimizer.
            </div>
            {activeMarket && (
              <div style={{ fontSize: 10, color: "var(--muted2)", maxWidth: 400, textAlign: "center" }}>
                Ready: {activeMarket.title}
              </div>
            )}
          </div>
        )}

        {status === "running" && (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 11, color: "var(--accent)", fontFamily: "IBM Plex Mono, monospace" }}>
              Searching parameter space…
            </div>
            <div style={{
              width: 200, height: 4, background: "var(--border2)", borderRadius: 2, overflow: "hidden",
            }}>
              <div style={{
                height: "100%", background: "var(--accent)", borderRadius: 2,
                width: `${Math.min(100, (elapsed / 60) * 100)}%`,
                transition: "width 0.5s linear",
              }} />
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)" }}>
              {elapsed}s elapsed · Bayesian TPE sampling
            </div>
          </div>
        )}

        {status === "error" && (
          <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--no)", fontFamily: "IBM Plex Mono, monospace" }}>⚠ {errorMsg}</div>
            <button onClick={() => setStatus("idle")} style={linkBtnStyle}>Dismiss</button>
          </div>
        )}

        {status === "done" && result && (
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

            {/* Result header */}
            <div style={{
              padding: "12px 20px", borderBottom: "1px solid var(--border)",
              background: "var(--surface)", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
                  {OPTIMIZABLE.find(s => s.id === result.strategy)?.label ?? result.strategy}
                </div>
                <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 2 }}>
                  {result.n_trials_completed} trials · {result.n_trials_pruned} pruned · {result.elapsed_sec.toFixed(1)}s
                  {!result.optuna_available && " · [grid fallback — install optuna for TPE]"}
                </div>
              </div>
              <button
                onClick={handleApply}
                style={{
                  padding: "7px 16px", borderRadius: 6, cursor: "pointer",
                  fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 700,
                  background: "rgba(0,212,168,0.15)", border: "1px solid rgba(0,212,168,0.4)",
                  color: "var(--accent)", transition: "all 0.15s", flexShrink: 0,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,212,168,0.25)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,212,168,0.15)"; }}
              >
                ✓ Apply to Backtest
              </button>
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Stat cards */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <StatCard
                  label="Best Sharpe"
                  value={result.best_sharpe.toFixed(3)}
                  color={result.best_sharpe >= 1 ? "var(--yes)" : result.best_sharpe >= 0 ? "var(--accent)" : "var(--no)"}
                />
                <StatCard
                  label="Return"
                  value={`${result.best_return.toFixed(1)}%`}
                  color={result.best_return >= 0 ? "var(--yes)" : "var(--no)"}
                />
                <StatCard
                  label="Win Rate"
                  value={`${(result.best_win_rate * 100).toFixed(1)}%`}
                  color={result.best_win_rate >= 0.5 ? "var(--yes)" : "var(--muted2)"}
                />
                <StatCard
                  label="Trades"
                  value={`${result.best_total_trades}`}
                  color="var(--muted2)"
                />
              </div>

              {/* Best params */}
              <div>
                <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                  Optimal Parameters
                </div>
                <div style={{
                  background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: 8,
                  padding: "12px 14px", display: "flex", flexWrap: "wrap", gap: "8px 24px",
                }}>
                  {Object.entries(result.best_params).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 90 }}>
                      <div style={{ fontSize: 8, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {PARAM_LABELS[k] ?? k}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--accent)", fontFamily: "IBM Plex Mono, monospace", fontWeight: 600 }}>
                        {fmtParam(k, v)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top trials table */}
              {result.top_trials.length > 0 && (
                <div>
                  <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                    Top Trials
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "IBM Plex Mono, monospace" }}>
                      <thead>
                        <tr style={{ background: "var(--surface2)" }}>
                          {["#", "Sharpe", "Return", "Win%", "Trades", "Key Params"].map(h => (
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
                        {result.top_trials.map((t, i) => {
                          const isTop = i === 0;
                          const paramEntries = Object.entries(t.params).slice(0, 3);
                          return (
                            <tr key={t.trial_number} style={{
                              background: isTop ? "rgba(0,212,168,0.04)" : "transparent",
                              borderBottom: "1px solid var(--border)",
                            }}>
                              <td style={{ padding: "6px 10px", color: isTop ? "var(--accent)" : "var(--muted2)", fontWeight: isTop ? 700 : 400 }}>
                                {t.trial_number}
                              </td>
                              <td style={{ padding: "6px 10px", color: t.sharpe >= 0 ? "var(--yes)" : "var(--no)" }}>
                                {t.sharpe.toFixed(3)}
                              </td>
                              <td style={{ padding: "6px 10px", color: t.total_return >= 0 ? "var(--yes)" : "var(--no)" }}>
                                {t.total_return.toFixed(1)}%
                              </td>
                              <td style={{ padding: "6px 10px", color: "var(--muted2)" }}>
                                {(t.win_rate * 100).toFixed(0)}%
                              </td>
                              <td style={{ padding: "6px 10px", color: "var(--muted2)" }}>
                                {t.total_trades}
                              </td>
                              <td style={{ padding: "6px 10px", color: "var(--muted)", fontSize: 9 }}>
                                {paramEntries.map(([k, v]) =>
                                  `${PARAM_LABELS[k] ?? k}=${fmtParam(k, v)}`
                                ).join(" · ")}
                                {Object.keys(t.params).length > 3 && " …"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Overfitting disclaimer */}
              <div style={{
                padding: "10px 14px", borderRadius: 6, fontSize: 9, color: "var(--muted)",
                background: "rgba(255,107,53,0.06)", border: "1px solid rgba(255,107,53,0.15)",
                lineHeight: 1.6,
              }}>
                ⚠ Optimizer results are in-sample. Always run a backtest on held-out data before trading
                optimized parameters. Parameters tuned to history may not generalise forward.
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

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
      <div style={{ fontSize: 9, color: "var(--muted2)", width: 56, flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: "var(--accent)", cursor: "pointer" }}
      />
      <div style={{ fontSize: 10, color: "var(--accent)", fontFamily: "IBM Plex Mono, monospace", width: 52, textAlign: "right", flexShrink: 0 }}>
        {fmt(value)}
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)",
  borderRadius: 6, padding: "6px 10px", color: "var(--text)",
  fontFamily: "IBM Plex Mono, monospace", fontSize: 10, outline: "none", cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)",
  borderRadius: 6, padding: "6px 10px", color: "var(--text)",
  fontFamily: "IBM Plex Mono, monospace", fontSize: 11, outline: "none",
};

const linkBtnStyle: React.CSSProperties = {
  background: "transparent", border: "none", cursor: "pointer",
  color: "var(--accent)", fontFamily: "IBM Plex Mono, monospace", fontSize: 9,
  padding: 0, textDecoration: "underline", textDecorationStyle: "dotted",
};
