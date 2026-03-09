import { useState, useEffect } from "react";
import type { Signal, ExecutionMode } from "../../types";
import ConfirmationCard from "./ConfirmationCard";

interface SignalQueueProps {
  executionMode: ExecutionMode;
}

export default function SignalQueue({ executionMode }: SignalQueueProps) {
  const [signals, setSignals] = useState<Signal[]>([]);

  const loadSignals = async () => {
    try {
      const res = await fetch("/api/signals?status=pending");
      if (res.ok) {
        const data = await res.json();
        setSignals(data.signals ?? []);
      }
    } catch {
      // network error — keep existing list
    }
  };

  useEffect(() => {
    loadSignals();
    const id = setInterval(loadSignals, 5000);
    return () => clearInterval(id);
  }, []);

  const handleApprove = async (signalId: string, modifiedSize?: number) => {
    await fetch(`/api/signals/${signalId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modified_size: modifiedSize ?? null }),
    });
    setSignals(s => s.filter(x => x.id !== signalId));
  };

  const handleReject = async (signalId: string) => {
    await fetch(`/api/signals/${signalId}/reject`, { method: "POST" });
    setSignals(s => s.filter(x => x.id !== signalId));
  };

  const handleModify = async (signalId: string, size: number, price?: number) => {
    await fetch(`/api/signals/${signalId}/modify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size, price: price ?? null }),
    });
    await loadSignals();
  };

  const handleApproveAll = async () => {
    await Promise.all(signals.map(s => handleApprove(s.id)));
  };

  const emptyHint =
    executionMode === "auto"
      ? "AUTO mode — signals execute immediately, nothing queues here"
      : executionMode === "alert_only"
        ? "ALERT ONLY mode — check the Execution Log for signal history"
        : "Run a backtest to generate signals — they'll appear here for review";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px", borderBottom: "1px solid var(--border)",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 14 }}>
            Signal Queue
          </div>
          {signals.length > 0 && (
            <span style={{
              background: "rgba(0,212,168,0.12)", color: "var(--accent)",
              border: "1px solid rgba(0,212,168,0.25)", borderRadius: 10,
              padding: "2px 8px", fontSize: 9, fontWeight: 700,
            }}>
              {signals.length} pending
            </span>
          )}
        </div>
        {executionMode === "confirm" && signals.length > 1 && (
          <button
            onClick={handleApproveAll}
            style={{
              padding: "5px 12px", borderRadius: 4,
              border: "1px solid rgba(0,212,168,0.3)", background: "rgba(0,212,168,0.08)",
              color: "var(--accent)", fontSize: 9, fontFamily: "IBM Plex Mono, monospace",
              fontWeight: 700, cursor: "pointer",
            }}
          >
            Approve All ({signals.length})
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        {signals.length === 0 ? (
          <div style={{
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            minHeight: 200, gap: 10,
          }}>
            <div style={{ fontSize: 32, opacity: 0.25 }}>⚡</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>No pending signals</div>
            <div style={{ fontSize: 10, color: "var(--muted)", opacity: 0.6, textAlign: "center", maxWidth: 280 }}>
              {emptyHint}
            </div>
          </div>
        ) : (
          signals.map(s => (
            <ConfirmationCard
              key={s.id}
              signal={s}
              onApprove={handleApprove}
              onReject={handleReject}
              onModify={handleModify}
            />
          ))
        )}
      </div>
    </div>
  );
}
