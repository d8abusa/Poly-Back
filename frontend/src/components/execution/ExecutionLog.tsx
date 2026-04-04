import { useState, useEffect } from "react";
import type { Signal } from "../../types";
import { apiFetch } from "../../lib/apiFetch";

interface LogEntry extends Signal {
  _type: "executed" | "rejected";
}

export default function ExecutionLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [approvedRes, rejectedRes] = await Promise.all([
          apiFetch("/api/signals?status=approved"),
          apiFetch("/api/signals?status=rejected"),
        ]);
        if (!approvedRes.ok || !rejectedRes.ok) return;
        const [approvedData, rejectedData] = await Promise.all([
          approvedRes.json(),
          rejectedRes.json(),
        ]);
        const executed: LogEntry[] = (approvedData.signals ?? []).map(
          (s: Signal) => ({ ...s, _type: "executed" as const }),
        );
        const rejected: LogEntry[] = (rejectedData.signals ?? []).map(
          (s: Signal) => ({ ...s, _type: "rejected" as const }),
        );
        const all = [...executed, ...rejected].sort(
          (a, b) => (b.resolved_at ?? "").localeCompare(a.resolved_at ?? ""),
        );
        setEntries(all);
      } catch {
        // keep existing
      }
    };
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 14px", background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 12,
        flexShrink: 0,
      }}>
        Execution Log
      </div>

      <div style={{ overflowY: "auto", maxHeight: 340 }}>
        {entries.length === 0 ? (
          <div style={{ padding: "24px 14px", textAlign: "center", fontSize: 10, color: "var(--muted)" }}>
            No activity this session
          </div>
        ) : (
          entries.map(e => (
            <div
              key={e.id}
              style={{
                display: "grid",
                gridTemplateColumns: "44px 1fr 44px 46px",
                alignItems: "center",
                gap: 8,
                padding: "6px 14px",
                borderBottom: "1px solid var(--border)",
                fontSize: 9,
                fontFamily: "IBM Plex Mono, monospace",
              }}
            >
              <span style={{
                color: e._type === "executed" ? "#22c55e" : "#ef4444",
                fontWeight: 700,
              }}>
                {e._type === "executed" ? "EXEC" : "REJ"}
              </span>
              <span style={{
                color: "var(--muted2)", overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {e.strategy.toUpperCase()} · {e.market_id.slice(0, 22)}…
              </span>
              <span style={{ color: "var(--text)", textAlign: "right" }}>
                ${e.suggested_size}
              </span>
              <span style={{ color: "var(--muted)", textAlign: "right" }}>
                {e.resolved_at
                  ? new Date(e.resolved_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                  : "—"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
