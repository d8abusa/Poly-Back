import { BatchBacktestResult, BacktestResult } from "../../types";
import EquityChart from "../charts/EquityChart";
import PnLDistribution from "../charts/PnLDistribution";

interface BacktestResultsProps {
  results: BatchBacktestResult;
}

function SingleResult({ result }: { result: BacktestResult }) {
  if (!result.success) {
    return (
      <div style={{
        background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
        borderRadius: 8, padding: "12px 14px", marginBottom: 10,
      }}>
        <div style={{ fontSize: 10, color: "#ef4444", marginBottom: 4 }}>
          {result.condition_id}
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
              <span>{(t.price * 100).toFixed(1)}¢</span>
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
    <div style={{ padding: "12px 14px", flex: 1, overflowY: "auto" }}>
      {/* Batch summary header */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1,
        background: "var(--border)", borderRadius: 8, overflow: "hidden", marginBottom: 14,
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

      {/* Per-market results */}
      {results.results.map((r, i) => <SingleResult key={i} result={r} />)}
    </div>
  );
}
