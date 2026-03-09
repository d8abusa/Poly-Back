import { useState } from "react";
import type { HistoryRun, BatchBacktestResult } from "../../types";
import RunCard from "./RunCard";

interface HistoryDrawerProps {
  historyRuns: HistoryRun[];
  onLoadRun: (batch: BatchBacktestResult) => void;
  onDeleteRun: (runId: string) => void;
}

export default function HistoryDrawer({
  historyRuns,
  onLoadRun,
  onDeleteRun,
}: HistoryDrawerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const filtered = historyRuns.filter(
    r =>
      !filter ||
      r.strategy.includes(filter) ||
      r.marketTitles.some(t => t.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          padding: "3px 10px", borderRadius: 4, border: "1px solid var(--border2)",
          background: "var(--surface2)", color: "var(--muted2)", fontSize: 10,
          fontFamily: "IBM Plex Mono, monospace", cursor: "pointer", position: "relative",
        }}
      >
        Runs
        {historyRuns.length > 0 && (
          <span style={{
            position: "absolute", top: -4, right: -4, width: 14, height: 14,
            background: "var(--accent3)", borderRadius: "50%", fontSize: 8,
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {historyRuns.length}
          </span>
        )}
      </button>

      {/* Drawer panel */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 49,
              background: "rgba(0,0,0,0.45)",
            }}
          />
        <div style={{
          position: "fixed", top: 52, right: 0, bottom: 0, width: 320,
          background: "var(--surface)", borderLeft: "1px solid var(--border2)",
          display: "flex", flexDirection: "column", zIndex: 50,
          boxShadow: "-12px 0 40px rgba(0,0,0,0.6)",
        }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13 }}>
              Run History
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16 }}
            >
              ×
            </button>
          </div>

          {/* Search */}
          <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter by strategy or market…"
              style={{
                width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)",
                borderRadius: 5, padding: "6px 10px", color: "var(--text)",
                fontFamily: "IBM Plex Mono, monospace", fontSize: 11, outline: "none",
              }}
            />
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.2 }}>⏱</div>
                <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 6 }}>
                  {historyRuns.length === 0 ? "No runs yet" : "No matching runs"}
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.6 }}>
                  {historyRuns.length === 0
                    ? "Queue some markets on the Backtest tab and hit ▶ Run to record a run here."
                    : "Try a different filter."}
                </div>
              </div>
            ) : (
              filtered.map(run => (
                <RunCard
                  key={run.id}
                  run={run}
                  onLoad={r => { onLoadRun(r.batch); setOpen(false); }}
                  onDelete={onDeleteRun}
                />
              ))
            )}
          </div>
        </div>
        </>
      )}
    </>
  );
}
