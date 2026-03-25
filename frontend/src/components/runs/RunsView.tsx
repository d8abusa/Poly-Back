import { useState } from "react";
import type { HistoryRun, BatchBacktestResult } from "../../types";
import RunCard from "../shared/RunCard";
import BacktestResults from "../backtest/BacktestResults";

interface RunsViewProps {
  historyRuns: HistoryRun[];
  onLoadRun: (batch: BatchBacktestResult) => void;
  onDeleteRun: (runId: string) => void;
}

export default function RunsView({ historyRuns, onLoadRun, onDeleteRun }: RunsViewProps) {
  const [filter, setFilter]         = useState("");
  const [selectedRun, setSelectedRun] = useState<HistoryRun | null>(
    historyRuns[0] ?? null
  );

  const filtered = historyRuns.filter(
    r =>
      !filter ||
      r.strategy.toLowerCase().includes(filter.toLowerCase()) ||
      r.marketTitles.some(t => t.toLowerCase().includes(filter.toLowerCase()))
  );

  function handleDelete(runId: string) {
    if (selectedRun?.id === runId) {
      const next = historyRuns.find(r => r.id !== runId) ?? null;
      setSelectedRun(next);
    }
    onDeleteRun(runId);
  }

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

      {/* ── Left: run list ── */}
      <div style={{
        width: 340, minWidth: 340, flexShrink: 0,
        borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "12px 14px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13 }}>
            Run History
          </div>
          <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>
            {historyRuns.length} run{historyRuns.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Search */}
        <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by strategy or market…"
            style={{
              width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)",
              borderRadius: 5, padding: "6px 10px", color: "var(--text)",
              fontFamily: "IBM Plex Mono, monospace", fontSize: 11, outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "40px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.2 }}>⏱</div>
              <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 6 }}>
                {historyRuns.length === 0 ? "No runs yet" : "No matching runs"}
              </div>
              <div style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.6 }}>
                {historyRuns.length === 0
                  ? "Queue some markets on the Backtest tab and hit ▶ Run."
                  : "Try a different filter."}
              </div>
            </div>
          ) : (
            filtered.map(run => (
              <div
                key={run.id}
                onClick={() => setSelectedRun(run)}
                style={{
                  cursor: "pointer",
                  borderLeft: `2px solid ${selectedRun?.id === run.id ? "var(--accent)" : "transparent"}`,
                  background: selectedRun?.id === run.id ? "rgba(0,212,168,0.04)" : undefined,
                  transition: "background 0.1s",
                }}
              >
                <RunCard
                  run={run}
                  onLoad={r => { onLoadRun(r.batch); }}
                  onDelete={handleDelete}
                />
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Right: selected run detail ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {selectedRun ? (
          <>
            {/* Run header */}
            <div style={{
              padding: "12px 16px", borderBottom: "1px solid var(--border)",
              background: "var(--surface)", flexShrink: 0,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: 14, fontFamily: "Instrument Serif, serif", fontStyle: "italic", color: "var(--text)", marginBottom: 3 }}>
                  {selectedRun.strategy.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                  <span style={{ fontSize: 10, fontStyle: "normal", color: "var(--muted)", marginLeft: 10, fontFamily: "IBM Plex Mono" }}>
                    {selectedRun.batch.total} market{selectedRun.batch.total !== 1 ? "s" : ""} · {selectedRun.batch.succeeded} succeeded
                  </span>
                </div>
                <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>
                  {new Date(selectedRun.runAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              <button
                onClick={() => onLoadRun(selectedRun.batch)}
                title="Load these results into the Backtest tab"
                style={{
                  padding: "5px 12px", borderRadius: 5, cursor: "pointer",
                  fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 600,
                  border: "1px solid rgba(0,212,168,0.3)",
                  background: "rgba(0,212,168,0.08)", color: "var(--accent)",
                }}
              >
                Load into Backtest
              </button>
            </div>

            {/* Results */}
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <BacktestResults results={selectedRun.batch} />
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, opacity: 0.15, marginBottom: 10 }}>⏱</div>
              <div style={{ fontSize: 12, color: "var(--muted2)" }}>Select a run to inspect</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
