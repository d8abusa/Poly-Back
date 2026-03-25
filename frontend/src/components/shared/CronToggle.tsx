import { useState, useEffect } from "react";

interface CronToggleProps {
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}

export default function CronToggle({ enabled, disabled, onToggle }: CronToggleProps) {
  return (
    <div style={{ background: "#111318", border: "1px solid #1e2330", borderRadius: 10, padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {/* Toggle switch */}
        <button
          onClick={onToggle}
          disabled={disabled}
          style={{
            width: 52, height: 28, border: "none", borderRadius: 14,
            background: enabled ? "linear-gradient(135deg, #22c55e, #16a34a)" : "#252d3d",
            cursor: disabled ? "not-allowed" : "pointer",
            position: "relative",
            transition: "all 0.2s ease",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 2,
              left: enabled ? "23px" : "4px",
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 0.2s ease",
            }}
          />
        </button>

        {/* Info */}
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 14, color: "#e8eaf0" }}>
            {enabled ? "Scheduled Jobs" : "Scheduled Jobs"} 
          </div>
          <div style={{ fontSize: 11, color: "#606880", marginTop: 3 }}>
            {enabled
              ? "Automated tasks run every hour based on your cron schedule"
              : "Automated tasks are paused. Manual execution required."
            }
          </div>
        </div>

        {/* Status badge */}
        <div style={{
          padding: "4px 12px", borderRadius: 20, fontSize: 10, fontWeight: 600,
          background: enabled ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
          color: enabled ? "#22c55e" : "#ef4444",
          border: `1px solid ${enabled ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
        }}>
          {enabled ? "RUNNING" : "PAUSED"}
        </div>
      </div>

      {/* Schedule info */}
      <div style={{
        marginTop: 16, padding: 12, borderRadius: 6, background: "#0d1017",
        border: "1px solid #1e2330", fontSize: 10, color: "#8891aa",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span>▶</span>
        <span>Schedule: <code style={{ color: "#7b61ff" }}>0 * * * *</code> (Every hour)</span>
      </div>
    </div>
  );
}
