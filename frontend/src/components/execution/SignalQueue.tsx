import { useState, useEffect } from "react";
import type { Signal, ExecutionMode } from "../../types";
import ConfirmationCard from "./ConfirmationCard";
import { apiFetch } from "../../lib/apiFetch";

interface FraserModifier {
  available: boolean;
  multiplier: number;
  tone_label: string;
  rate_direction: string;
  doc_date: string;
  summary: string;
}

interface SignalQueueProps {
  executionMode: ExecutionMode;
}

export default function SignalQueue({ executionMode }: SignalQueueProps) {
  const [signals, setSignals]   = useState<Signal[]>([]);
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null);
  const [fraser, setFraser]     = useState<FraserModifier | null>(null);

  useEffect(() => {
    apiFetch("/api/fraser/modifier")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.available) setFraser(d); })
      .catch(() => {});
  }, []);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 6000);
  };

  const loadSignals = async () => {
    try {
      const res = await apiFetch("/api/signals?status=pending");
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
    try {
      const res = await apiFetch(`/api/signals/${signalId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modified_size: modifiedSize ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(`Order rejected: ${data.detail ?? "unknown error"}`, false);
        return;
      }
      // Show Coinbase order confirmation
      if (data.exchange === "coinbase" && data.order?.order_id) {
        showToast(
          `✓ Coinbase order placed · ${data.shares} units · $${data.size_usd} · ID: ${data.order.order_id.slice(0, 8)}…`,
          true
        );
      } else {
        showToast("✓ Signal approved", true);
      }
      setSignals(s => s.filter(x => x.id !== signalId));
    } catch (err) {
      showToast(`Network error: ${err}`, false);
    }
  };

  const handleReject = async (signalId: string) => {
    await apiFetch(`/api/signals/${signalId}/reject`, { method: "POST" });
    setSignals(s => s.filter(x => x.id !== signalId));
  };

  const handleModify = async (signalId: string, size: number, price?: number) => {
    await apiFetch(`/api/signals/${signalId}/modify`, {
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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
      {/* Order confirmation toast */}
      {toast && (
        <div style={{
          position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
          zIndex: 50, background: toast.ok ? "#0d2b22" : "#2b0d0d",
          border: `1px solid ${toast.ok ? "#22c55e55" : "#ef444455"}`,
          color: toast.ok ? "#22c55e" : "#ef4444",
          borderRadius: 6, padding: "9px 16px", fontSize: 11,
          fontFamily: "IBM Plex Mono, monospace", whiteSpace: "nowrap",
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        }}>
          {toast.msg}
        </div>
      )}
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
          {fraser && (
            <span
              title={fraser.summary}
              style={{
                background: fraser.multiplier > 1.0
                  ? "rgba(34,197,94,0.1)"
                  : fraser.multiplier < 1.0
                    ? "rgba(239,68,68,0.1)"
                    : "rgba(148,163,184,0.1)",
                color: fraser.multiplier > 1.0 ? "#22c55e"
                  : fraser.multiplier < 1.0 ? "#ef4444" : "var(--muted)",
                border: `1px solid ${fraser.multiplier > 1.0 ? "rgba(34,197,94,0.25)" : fraser.multiplier < 1.0 ? "rgba(239,68,68,0.25)" : "rgba(148,163,184,0.2)"}`,
                borderRadius: 10, padding: "2px 8px", fontSize: 9, fontWeight: 700,
                cursor: "default", userSelect: "none",
              }}
            >
              FRASER {fraser.multiplier > 1.0 ? "↑" : fraser.multiplier < 1.0 ? "↓" : "→"} {fraser.multiplier.toFixed(2)}×
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
