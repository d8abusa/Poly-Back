import { HistoryRun } from "../../types";
import EquityChart from "../charts/EquityChart";

interface RunCardProps {
  run: HistoryRun;
  onLoad: (run: HistoryRun) => void;
  onDelete: (runId: string) => void;
}

export default function RunCard({ run, onLoad, onDelete }: RunCardProps) {
  const ok = run.batch.results.filter(r => r.success);
  const avgReturn =
    ok.length > 0
      ? ok.reduce((s, r) => s + r.total_return, 0) / ok.length
      : 0;

  // Sparkline: concatenated equity values across all successful results
  const sparkData = ok.flatMap(r => r.equity_curve);

  const ts = new Date(run.runAt).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div style={{
      padding: "10px 14px", borderBottom: "1px solid var(--border)",
      background: "var(--surface)", transition: "background 0.12s",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--muted2)", fontWeight: 600, marginBottom: 2 }}>
            {run.strategy.toUpperCase()} · {run.batch.total} market{run.batch.total !== 1 ? "s" : ""}
          </div>
          <div style={{ fontSize: 9, color: "var(--muted)" }}>{ts}</div>
        </div>
        <div style={{
          fontSize: 13, fontFamily: "Syne, sans-serif", fontWeight: 700,
          color: avgReturn >= 0 ? "var(--yes)" : "var(--no)",
        }}>
          {avgReturn >= 0 ? "+" : ""}{avgReturn.toFixed(1)}%
        </div>
      </div>

      {/* Sparkline */}
      {sparkData.length >= 2 && (
        <div style={{ marginBottom: 6 }}>
          <EquityChart data={sparkData} color={avgReturn >= 0 ? "#22c55e" : "#ef4444"} height={36} />
        </div>
      )}

      {/* Market titles (first 2) */}
      <div style={{ marginBottom: 7 }}>
        {run.marketTitles.slice(0, 2).map((t, i) => (
          <div key={i} style={{ fontSize: 9, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {t}
          </div>
        ))}
        {run.marketTitles.length > 2 && (
          <div style={{ fontSize: 9, color: "var(--muted)" }}>
            +{run.marketTitles.length - 2} more
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => onLoad(run)}
          style={{
            flex: 1, padding: "4px 0", borderRadius: 4, border: "1px solid rgba(0,212,168,0.25)",
            background: "rgba(0,212,168,0.06)", color: "var(--accent)", fontSize: 9,
            fontFamily: "IBM Plex Mono, monospace", cursor: "pointer",
          }}
        >
          Load
        </button>
        <button
          onClick={() => onDelete(run.id)}
          style={{
            padding: "4px 10px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.2)",
            background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 9,
            fontFamily: "IBM Plex Mono, monospace", cursor: "pointer",
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
