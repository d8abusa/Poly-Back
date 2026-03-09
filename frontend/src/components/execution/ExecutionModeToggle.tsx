import { useState } from "react";
import type { ExecutionMode } from "../../types";

interface ExecutionModeToggleProps {
  mode: ExecutionMode;
  onChange: (mode: ExecutionMode) => void;
  scope?: "global" | "signal";
}

const MODES: { id: ExecutionMode; label: string; color: string; desc: string }[] = [
  { id: "auto",       label: "AUTO",       color: "#ef4444", desc: "Execute orders immediately without confirmation" },
  { id: "confirm",    label: "CONFIRM",    color: "#00d4a8", desc: "Queue signals for manual review before execution" },
  { id: "alert_only", label: "ALERT ONLY", color: "#7b61ff", desc: "Log signals only — no orders placed" },
];

export default function ExecutionModeToggle({
  mode,
  onChange,
  scope = "global",
}: ExecutionModeToggleProps) {
  const [pendingAuto, setPendingAuto] = useState(false);

  const handleSelect = (m: ExecutionMode) => {
    if (m === "auto" && mode !== "auto") {
      setPendingAuto(true);
      return;
    }
    onChange(m);
  };

  const confirmAuto = () => {
    setPendingAuto(false);
    onChange("auto");
  };

  return (
    <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
      <div style={{
        fontSize: 9, color: "var(--muted)", textTransform: "uppercase",
        letterSpacing: 1, marginBottom: 8, display: "flex", alignItems: "center", gap: 6,
      }}>
        Execution Mode
        {scope === "signal" && (
          <span style={{ color: "var(--accent3)", letterSpacing: 0 }}>· signal</span>
        )}
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        {MODES.map(m => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => handleSelect(m.id)}
              title={m.desc}
              style={{
                flex: 1,
                padding: "5px 4px",
                borderRadius: 5,
                border: `1px solid ${active ? `${m.color}55` : "var(--border2)"}`,
                background: active ? `${m.color}14` : "var(--surface2)",
                color: active ? m.color : "var(--muted2)",
                fontFamily: "IBM Plex Mono, monospace",
                fontSize: 8,
                fontWeight: active ? 700 : 400,
                cursor: "pointer",
                transition: "all 0.12s",
                letterSpacing: 0.4,
                whiteSpace: "nowrap",
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {pendingAuto && (
        <div style={{
          marginTop: 8,
          background: "rgba(239,68,68,0.07)",
          border: "1px solid rgba(239,68,68,0.25)",
          borderRadius: 6,
          padding: "10px 12px",
        }}>
          <div style={{ fontSize: 10, color: "#ef4444", fontWeight: 700, marginBottom: 4 }}>
            ⚠ AUTO mode — trades execute without confirmation
          </div>
          <div style={{ fontSize: 9, color: "var(--muted2)", marginBottom: 10, lineHeight: 1.6 }}>
            Orders will be submitted to the Polymarket CLOB immediately when a signal fires.
            Ensure your position sizing and stop-loss parameters are correctly configured.
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={confirmAuto}
              style={{
                flex: 1, padding: "5px 0", borderRadius: 4,
                border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.12)",
                color: "#ef4444", fontSize: 9, fontFamily: "IBM Plex Mono, monospace",
                fontWeight: 700, cursor: "pointer",
              }}
            >
              I understand — Enable AUTO
            </button>
            <button
              onClick={() => setPendingAuto(false)}
              style={{
                padding: "5px 14px", borderRadius: 4,
                border: "1px solid var(--border2)", background: "var(--surface2)",
                color: "var(--muted)", fontSize: 9, fontFamily: "IBM Plex Mono, monospace",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
