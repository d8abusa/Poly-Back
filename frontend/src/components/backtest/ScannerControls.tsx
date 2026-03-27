import { useState, useEffect, useRef, useCallback } from "react";
import type { Market, StrategyParams } from "../../types";
import { apiFetch } from "../../lib/apiFetch";

interface ScannerStatus {
  running: boolean;
  strategy: string;
  exchange: string;
  interval_seconds: number;
  execution_mode: string;
  markets: string[];
  signals_fired: number;
  ticks_total: number;
  last_scan_at: string | null;
  recent_errors: string[];
}

interface ScannerControlsProps {
  queuedMarkets: Market[];
  activeStrategy: string;
  strategyParams: StrategyParams;
  executionMode: string;
  exchange: string;
}

const PRESETS = [
  { label: "1s",  seconds: 1 },
  { label: "5s",  seconds: 5 },
  { label: "15s", seconds: 15 },
  { label: "30s", seconds: 30 },
  { label: "1m",  seconds: 60 },
  { label: "5m",  seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "30m", seconds: 1800 },
  { label: "1h",  seconds: 3600 },
];

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtAgo(iso: string | null): string {
  if (!iso) return "";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 5)   return "just now";
  if (secs < 60)  return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export default function ScannerControls({
  queuedMarkets,
  activeStrategy,
  strategyParams,
  executionMode,
  exchange,
}: ScannerControlsProps) {
  const [status, setStatus]           = useState<ScannerStatus | null>(null);
  const [interval, setIntervalSecs]   = useState<number>(60);
  const [loading, setLoading]         = useState(false);
  const [expanded, setExpanded]       = useState(false);
  const pollRef                       = useRef<ReturnType<typeof setInterval> | null>(null);
  const [tick, setTick]               = useState(0); // for ago refresh

  // Poll status while expanded or running
  const fetchStatus = useCallback(async () => {
    try {
      const r = await apiFetch("/api/scanner/status");
      if (r.ok) setStatus(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (!expanded) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [expanded, fetchStatus]);

  // Tick for ago display
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  async function handleStart() {
    if (!queuedMarkets.length) return;
    setLoading(true);
    try {
      const body = {
        markets:          queuedMarkets.map(m => ({ condition_id: m.id, token_id: m.id, title: m.title })),
        strategy:         activeStrategy,
        params:           strategyParams,
        interval_seconds: interval,
        execution_mode:   executionMode,
        exchange,
      };
      const r = await apiFetch("/api/scanner/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) { setStatus(await r.json()); setExpanded(true); }
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    setLoading(true);
    try {
      await apiFetch("/api/scanner/stop", { method: "POST" });
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  }

  async function applyInterval(secs: number) {
    setIntervalSecs(secs);
    if (status?.running) {
      await apiFetch("/api/scanner/interval", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: secs }),
      });
      await fetchStatus();
    }
  }

  const isRunning = status?.running ?? false;
  const accentOn  = "#f59e0b"; // amber for scanner

  return (
    <div style={{
      borderTop: "1px solid var(--border)",
      background: isRunning ? "rgba(245,158,11,0.04)" : "transparent",
    }}>
      {/* Header row */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "7px 14px",
          cursor: "pointer", userSelect: "none",
        }}
        onClick={() => setExpanded(e => !e)}
      >
        {/* Live indicator */}
        <div style={{
          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
          background: isRunning ? accentOn : "var(--border2)",
          boxShadow: isRunning ? `0 0 6px ${accentOn}` : "none",
          animation: isRunning ? "pulse 1.5s ease-in-out infinite" : "none",
        }} />

        <div style={{ fontSize: 9, color: isRunning ? accentOn : "var(--muted)", textTransform: "uppercase", letterSpacing: 1, flex: 1 }}>
          Live Scanner {isRunning ? `· ${status?.signals_fired ?? 0} signals · tick ${status?.ticks_total ?? 0}` : "· idle"}
        </div>

        {/* Quick last-scan */}
        {isRunning && status?.last_scan_at && (
          <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace" }}>
            {fmtAgo(status.last_scan_at)}
          </div>
        )}

        <div style={{ fontSize: 9, color: "var(--muted)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: "0 14px 10px", display: "flex", flexDirection: "column", gap: 8 }}>

          {/* Interval presets */}
          <div>
            <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>
              Poll interval
            </div>
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {PRESETS.map(p => {
                const active = interval === p.seconds;
                return (
                  <button
                    key={p.label}
                    onClick={() => applyInterval(p.seconds)}
                    style={{
                      padding: "3px 7px", borderRadius: 4, cursor: "pointer",
                      fontSize: 9, fontFamily: "IBM Plex Mono, monospace",
                      border: `1px solid ${active ? accentOn + "88" : "var(--border2)"}`,
                      background: active ? accentOn + "18" : "var(--surface2)",
                      color: active ? accentOn : "var(--muted2)",
                      fontWeight: active ? 700 : 400,
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Status info */}
          {status && isRunning && (
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px",
              fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace",
              background: "var(--surface2)", borderRadius: 5, padding: "7px 10px",
              border: "1px solid var(--border)",
            }}>
              <span>strategy: <span style={{ color: "var(--muted2)" }}>{status.strategy}</span></span>
              <span>exchange: <span style={{ color: "var(--muted2)" }}>{status.exchange}</span></span>
              <span>markets: <span style={{ color: "var(--muted2)" }}>{status.markets.length}</span></span>
              <span>mode: <span style={{ color: "var(--muted2)" }}>{status.execution_mode}</span></span>
              <span>signals: <span style={{ color: accentOn, fontWeight: 700 }}>{status.signals_fired}</span></span>
              <span>last scan: <span style={{ color: "var(--muted2)" }}>{fmtTime(status.last_scan_at)}</span></span>
            </div>
          )}

          {/* Recent errors */}
          {status?.recent_errors && status.recent_errors.length > 0 && (
            <div style={{ fontSize: 8, color: "#ef4444", fontFamily: "IBM Plex Mono, monospace", lineHeight: 1.6 }}>
              {status.recent_errors.slice(-3).map((e, i) => (
                <div key={i} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e}</div>
              ))}
            </div>
          )}

          {/* Start / Stop */}
          <div style={{ display: "flex", gap: 6 }}>
            {!isRunning ? (
              <button
                onClick={handleStart}
                disabled={loading || !queuedMarkets.length}
                style={{
                  flex: 1, padding: "6px 12px", borderRadius: 5, cursor: queuedMarkets.length ? "pointer" : "not-allowed",
                  fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 600,
                  border: `1px solid ${accentOn}55`,
                  background: queuedMarkets.length ? `${accentOn}18` : "var(--surface2)",
                  color: queuedMarkets.length ? accentOn : "var(--muted)",
                  opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? "Starting…" : queuedMarkets.length ? `▶ Scan ${queuedMarkets.length} market${queuedMarkets.length > 1 ? "s" : ""}` : "Add markets to queue first"}
              </button>
            ) : (
              <button
                onClick={handleStop}
                disabled={loading}
                style={{
                  flex: 1, padding: "6px 12px", borderRadius: 5, cursor: "pointer",
                  fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 600,
                  border: "1px solid rgba(239,68,68,0.4)",
                  background: "rgba(239,68,68,0.1)",
                  color: "#ef4444",
                  opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? "Stopping…" : "■ Stop Scanner"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
