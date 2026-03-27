import { useState } from "react";
import type { BatchBacktestResult, BacktestResult, WizardRanking, RegimeSplit, Market, ExecutionMode } from "../../types";
import EquityChart from "../charts/EquityChart";
import PnLDistribution from "../charts/PnLDistribution";
import { apiFetch } from "../../lib/apiFetch";

function exportCsv(results: BatchBacktestResult) {
  const rows: string[] = [
    "ticker,strategy_run,date,action,price,shares,value,pnl,return_pct,sharpe,max_drawdown,win_rate,total_trades",
  ];
  for (const r of results.results) {
    if (!r.success) continue;
    const ticker = r.condition_id;
    for (const t of r.trades) {
      rows.push(
        [
          ticker,
          r.total_return.toFixed(4),
          t.date,
          t.action,
          t.price.toFixed(4),
          t.shares.toFixed(4),
          t.value.toFixed(4),
          t.pnl != null ? t.pnl.toFixed(4) : "",
          r.total_return.toFixed(4),
          r.sharpe_ratio.toFixed(4),
          r.max_drawdown.toFixed(4),
          r.win_rate.toFixed(4),
          r.total_trades,
        ].join(",")
      );
    }
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `backtest_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface BacktestResultsProps {
  results: BatchBacktestResult;
  capital: number;
  executionMode: ExecutionMode;
  exchange: string;
  strategy: string;
  queuedMarkets: Market[];
  onStaged: () => void;
}

function WizardLeaderboard({ rankings }: { rankings: WizardRanking[] }) {
  const best = rankings[0];
  const maxReturn = Math.max(...rankings.map(r => Math.abs(r.total_return)), 0.01);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 9, color: "#a855f7", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        <span>✦ Wizard Rankings</span>
        <span style={{ color: "var(--muted)", fontWeight: 400 }}>— winner highlighted</span>
      </div>
      {rankings.map((r, i) => {
        const isWinner = i === 0;
        const retColor = r.total_return >= 0 ? "#22c55e" : "#ef4444";
        const barW = Math.abs(r.total_return) / maxReturn * 100;
        return (
          <div key={r.strategy} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
            marginBottom: 3, borderRadius: 5,
            background: isWinner ? "rgba(168,85,247,0.1)" : "var(--surface2)",
            border: `1px solid ${isWinner ? "rgba(168,85,247,0.4)" : "var(--border)"}`,
          }}>
            <div style={{ width: 14, fontSize: 9, color: isWinner ? "#a855f7" : "var(--muted)", fontWeight: 700, flexShrink: 0 }}>
              {isWinner ? "★" : `${i + 1}`}
            </div>
            <div style={{ width: 110, fontSize: 10, color: isWinner ? "#e9d5ff" : "var(--muted2)", fontWeight: isWinner ? 600 : 400, flexShrink: 0 }}>
              {r.name}
            </div>
            {/* Return bar */}
            <div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${barW}%`, background: retColor, borderRadius: 3, transition: "width 0.3s" }} />
            </div>
            <div style={{ width: 52, fontSize: 10, color: retColor, fontWeight: 700, textAlign: "right", fontFamily: "IBM Plex Mono, monospace", flexShrink: 0 }}>
              {r.total_return >= 0 ? "+" : ""}{r.total_return.toFixed(1)}%
            </div>
            <div style={{ width: 38, fontSize: 9, color: "var(--muted)", textAlign: "right", flexShrink: 0 }}>
              {r.sharpe_ratio.toFixed(2)}σ
            </div>
            <div style={{ width: 32, fontSize: 9, color: "var(--muted)", textAlign: "right", flexShrink: 0 }}>
              {r.total_trades}T
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TREND_COLOR: Record<string, string> = {
  bull:     "#22c55e",
  bear:     "#ef4444",
  sideways: "#f59e0b",
  unknown:  "var(--muted)",
};

function RegimeTable({ splits }: { splits: RegimeSplit[] }) {
  // Collect unique strategy names
  const strategies = splits[0]?.rankings.map(r => ({ id: r.strategy, name: r.name })) ?? [];

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 9, color: "#a855f7", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
        ✦ Regime Analysis — winner per window
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9, fontFamily: "IBM Plex Mono, monospace" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", color: "var(--muted)", padding: "3px 6px", borderBottom: "1px solid var(--border)" }}>Strategy</th>
              {splits.map(s => (
                <th key={s.window} style={{ textAlign: "center", color: TREND_COLOR[s.trend], padding: "3px 6px", borderBottom: "1px solid var(--border)" }}>
                  W{s.window}<br /><span style={{ fontSize: 8, color: "var(--muted)" }}>{s.trend}</span>
                </th>
              ))}
              <th style={{ textAlign: "center", color: "var(--muted)", padding: "3px 6px", borderBottom: "1px solid var(--border)" }}>Wins</th>
            </tr>
          </thead>
          <tbody>
            {strategies.map(({ id, name }) => {
              const wins = splits.filter(s => s.rankings[0]?.strategy === id).length;
              return (
                <tr key={id}>
                  <td style={{ padding: "3px 6px", color: wins > 0 ? "var(--text)" : "var(--muted)", borderBottom: "1px solid var(--border)" }}>{name}</td>
                  {splits.map(s => {
                    const rank = s.rankings.findIndex(r => r.strategy === id);
                    const r    = s.rankings[rank];
                    const isWin = rank === 0;
                    return (
                      <td key={s.window} style={{ textAlign: "center", padding: "3px 6px", borderBottom: "1px solid var(--border)",
                        color: isWin ? "#a855f7" : "var(--muted)", fontWeight: isWin ? 700 : 400 }}>
                        {r ? `${r.total_return >= 0 ? "+" : ""}${r.total_return.toFixed(1)}%` : "—"}
                      </td>
                    );
                  })}
                  <td style={{ textAlign: "center", padding: "3px 6px", borderBottom: "1px solid var(--border)",
                    color: wins > 0 ? "#a855f7" : "var(--muted)", fontWeight: wins > 0 ? 700 : 400 }}>
                    {wins}/{splits.length}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface SingleResultProps {
  result: BacktestResult;
  capital: number;
  executionMode: ExecutionMode;
  exchange: string;
  strategy: string;
  marketTitle: string;
  onStaged: () => void;
}

function SingleResult({ result, capital, executionMode, exchange, strategy, marketTitle, onStaged }: SingleResultProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [staging, setStaging]       = useState(false);

  const lastPrice = result.equity_curve.length > 0
    ? result.equity_curve[result.equity_curve.length - 1].price
    : 0;
  const canStage = result.success && result.total_return > 0 && lastPrice > 0
    && capital > 0 && executionMode !== "alert_only";

  async function doStage() {
    setStaging(true);
    try {
      const resp = await apiFetch("/api/signals/from-backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market_id:      result.condition_id,
          market_title:   marketTitle,
          strategy,
          exchange,
          capital,
          execution_mode: executionMode,
          total_return:   result.total_return,
          sharpe_ratio:   result.sharpe_ratio,
          max_drawdown:   result.max_drawdown,
          win_rate:       result.win_rate,
          total_trades:   result.total_trades,
          last_price:     lastPrice,
          exit_threshold: null,
          stop_loss:      null,
        }),
      });
      if (!resp.ok) throw new Error(`${resp.status}`);
      setShowDialog(false);
      onStaged();
    } catch {
      alert("Failed to stage order — check backend logs");
    } finally {
      setStaging(false);
    }
  }

  if (!result.success) {
    return (
      <div style={{
        background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
        borderRadius: 8, padding: "12px 14px", marginBottom: 10,
      }}>
        <div style={{ fontSize: 10, color: "#ef4444", marginBottom: 4, fontFamily: "IBM Plex Mono, monospace" }}>
          {result.condition_id.slice(0, 16)}…
        </div>
        <div style={{ fontSize: 11, color: "var(--muted2)" }}>{result.error}</div>
      </div>
    );
  }

  const ret = result.total_return;
  const retColor = ret >= 0 ? "var(--yes)" : "var(--no)";

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 8, padding: "12px 14px", marginBottom: 10,
    }}>
      {/* Market ID */}
      <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 8, fontFamily: "IBM Plex Mono, monospace" }}>
        {result.condition_id.slice(0, 16)}…
      </div>

      {/* Wizard leaderboard */}
      {result.wizard_rankings && <WizardLeaderboard rankings={result.wizard_rankings} />}
      {/* Regime split table */}
      {result.regime_splits && result.regime_splits.length > 0 && (
        <RegimeTable splits={result.regime_splits} />
      )}

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 1, background: "var(--border)", borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
        {([
          ["Return",    `${ret >= 0 ? "+" : ""}${ret.toFixed(1)}%`,    retColor],
          ["Sharpe",    result.sharpe_ratio.toFixed(2),                  "#7b61ff"],
          ["Max DD",    `-${result.max_drawdown.toFixed(1)}%`,           "#ef4444"],
          ["Win Rate",  `${result.win_rate.toFixed(0)}%`,               "#22c55e"],
          ["Trades",    String(result.total_trades),                     "#00d4a8"],
        ] as [string, string, string][]).map(([l, v, c]) => (
          <div key={l} style={{ background: "var(--surface2)", padding: "8px 10px" }}>
            <div style={{ fontSize: 8, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{l}</div>
            <div style={{ fontSize: 13, fontFamily: "Syne, sans-serif", fontWeight: 700, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Stage Order button */}
      {canStage && (
        <div style={{ marginBottom: 10 }}>
          <button
            onClick={() => executionMode === "auto" ? doStage() : setShowDialog(true)}
            disabled={staging}
            style={{
              width: "100%", padding: "7px 0", borderRadius: 6, cursor: "pointer",
              fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700,
              border: `1px solid ${executionMode === "auto" ? "rgba(239,68,68,0.4)" : "rgba(0,212,168,0.35)"}`,
              background: executionMode === "auto" ? "rgba(239,68,68,0.1)" : "rgba(0,212,168,0.08)",
              color: executionMode === "auto" ? "#ef4444" : "var(--accent)",
              opacity: staging ? 0.5 : 1,
            }}
          >
            {staging ? "Staging…" : executionMode === "auto" ? "⚡ Auto-Stage Order" : "↗ Stage Order"}
          </button>
        </div>
      )}

      {/* Equity curve + PnL distribution side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 4 }}>Equity curve</div>
          <EquityChart data={result.equity_curve} color={ret >= 0 ? "#22c55e" : "#ef4444"} height={60} />
        </div>
        <div>
          <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 4 }}>PnL distribution</div>
          <PnLDistribution trades={result.trades} />
        </div>
      </div>

      {/* Trade log (last 5 entries) */}
      {result.trades.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 4 }}>
            Recent trades ({result.trades.length} total)
          </div>
          {result.trades.slice(-5).map((t, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", fontSize: 9,
              padding: "3px 0", borderBottom: "1px solid var(--border)", color: "var(--muted2)",
            }}>
              <span style={{ color: t.action.startsWith("BUY") ? "#22c55e" : "#ef4444" }}>
                {t.action}
              </span>
              <span>{t.date}</span>
              <span>{t.price > 1 ? `$${t.price.toFixed(2)}` : `${(t.price * 100).toFixed(1)}¢`}</span>
              {t.pnl !== null && (
                <span style={{ color: t.pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                  {t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(2)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Confirm dialog */}
      {showDialog && (
        <>
          <div
            onClick={() => setShowDialog(false)}
            style={{ position: "fixed", inset: 0, zIndex: 49, background: "rgba(0,0,0,0.5)" }}
          />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: 10,
            padding: "20px 22px", width: 340, zIndex: 50, boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          }}>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
              Stage Order
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 14 }}>
              This will create a pending signal in the Signals tab for review before execution.
            </div>
            {([
              ["Market",   marketTitle.length > 32 ? marketTitle.slice(0, 32) + "…" : marketTitle],
              ["Strategy", strategy],
              ["Entry",    lastPrice > 1 ? `$${lastPrice.toFixed(2)}` : `${(lastPrice * 100).toFixed(2)}¢`],
              ["Capital",  `$${capital.toLocaleString()}`],
              ["Units",    (capital / lastPrice).toFixed(lastPrice > 1 ? 4 : 0)],
              ["Backtest", `+${result.total_return.toFixed(1)}% · Sharpe ${result.sharpe_ratio.toFixed(2)}`],
            ] as [string, string][]).map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--muted)" }}>{l}</span>
                <span style={{ color: "var(--text)", fontFamily: "IBM Plex Mono, monospace" }}>{v}</span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={() => setShowDialog(false)}
                style={{ flex: 1, padding: "7px 0", borderRadius: 5, cursor: "pointer", border: "1px solid var(--border2)", background: "var(--surface2)", color: "var(--muted2)", fontFamily: "IBM Plex Mono, monospace", fontSize: 10 }}
              >
                Cancel
              </button>
              <button
                onClick={doStage}
                disabled={staging}
                style={{ flex: 2, padding: "7px 0", borderRadius: 5, cursor: "pointer", border: "1px solid rgba(0,212,168,0.35)", background: "rgba(0,212,168,0.1)", color: "var(--accent)", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700 }}
              >
                {staging ? "Staging…" : "Confirm Stage"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function BacktestResults({ results, capital, executionMode, exchange, strategy, queuedMarkets, onStaged }: BacktestResultsProps) {
  return (
    <div style={{ padding: "12px 14px", flex: 1, minHeight: 0, overflowY: "auto" }}>
      {/* Batch summary header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1,
          background: "var(--border)", borderRadius: 8, overflow: "hidden", flex: 1,
        }}>
        {([
          ["Total",     String(results.total),                                              "#e8eaf0"],
          ["Succeeded", String(results.succeeded),                                          "#22c55e"],
          ["Failed",    String(results.failed),                                             results.failed ? "#ef4444" : "#606880"],
          ["Fetch",     `${results.fetch_duration_ms.toFixed(0)}ms`,                        "#7b61ff"],
        ] as [string, string, string][]).map(([l, v, c]) => (
          <div key={l} style={{ background: "var(--surface)", padding: "10px 14px" }}>
            <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{l}</div>
            <div style={{ fontSize: 16, fontFamily: "Syne, sans-serif", fontWeight: 700, color: c }}>{v}</div>
          </div>
        ))}
        </div>

        {/* Export button */}
        <button
          onClick={() => exportCsv(results)}
          title="Export all trades to CSV"
          style={{
            padding: "8px 12px", borderRadius: 6, cursor: "pointer",
            fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 600,
            border: "1px solid rgba(34,197,94,0.3)",
            background: "rgba(34,197,94,0.08)", color: "#22c55e",
            whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          ↓ CSV
        </button>
      </div>

      {/* Per-market results */}
      {results.results.map((r, i) => {
        const market = queuedMarkets.find(m => (m.condition_id ?? m.id) === r.condition_id);
        return (
          <SingleResult
            key={i}
            result={r}
            capital={capital}
            executionMode={executionMode}
            exchange={exchange}
            strategy={strategy}
            marketTitle={market?.title ?? r.condition_id}
            onStaged={onStaged}
          />
        );
      })}
    </div>
  );
}
