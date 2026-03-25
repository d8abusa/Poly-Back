import type { BatchBacktestResult, BacktestResult, WizardRanking } from "../../types";
import EquityChart from "../charts/EquityChart";
import PnLDistribution from "../charts/PnLDistribution";

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

function SingleResult({ result }: { result: BacktestResult }) {
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
    </div>
  );
}

export default function BacktestResults({ results }: BacktestResultsProps) {
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
      {results.results.map((r, i) => <SingleResult key={i} result={r} />)}
    </div>
  );
}
