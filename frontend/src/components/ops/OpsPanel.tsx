import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../lib/apiFetch";

interface Job {
  name:             string;
  description:      string;
  category:         string;
  interval_seconds: number;
  enabled:          boolean;
  status:           string;   // "idle" | "running" | "ok" | "error" | "disabled"
  last_run:         string | null;
  last_error:       string | null;
  run_count:        number;
  error_count:      number;
  task_alive:       boolean;
}

interface Catalog {
  jobs:        Job[];
  total:       number;
  running:     number;
  errors:      number;
  disabled:    number;
  server_time: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtInterval(s: number): string {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff <  60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

const CATEGORY_COLOR: Record<string, string> = {
  risk:    "#f87171",
  data:    "#38bdf8",
  signal:  "#a78bfa",
  alert:   "#fbbf24",
  monitor: "#34d399",
};

const STATUS_DOT: Record<string, { color: string; label: string }> = {
  idle:     { color: "#475569", label: "Idle"     },
  running:  { color: "#38bdf8", label: "Running"  },
  ok:       { color: "#34d399", label: "OK"       },
  error:    { color: "#f87171", label: "Error"    },
  disabled: { color: "#334155", label: "Disabled" },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function OpsPanel() {
  const [catalog, setCatalog]       = useState<Catalog | null>(null);
  const [loading, setLoading]       = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [toasts, setToasts]         = useState<{ id: number; msg: string; ok: boolean }[]>([]);
  let toastId = 0;

  const toast = (msg: string, ok = true) => {
    const id = ++toastId;
    setToasts(t => [...t, { id, msg, ok }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  };

  const load = useCallback(() => {
    apiFetch("/api/ops/catalog")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setCatalog(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const toggle = async (job: Job) => {
    const next = !job.enabled;
    await apiFetch(`/api/ops/${job.name}/toggle`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ enabled: next }),
    });
    toast(`${job.name} ${next ? "enabled" : "disabled"}`, next);
    load();
  };

  const trigger = async (job: Job) => {
    setTriggering(job.name);
    try {
      const r = await apiFetch(`/api/ops/${job.name}/trigger`, { method: "POST" });
      if (r.ok) {
        toast(`${job.name} triggered`);
      } else {
        const d = await r.json();
        toast(d.detail ?? "Trigger failed", false);
      }
    } catch {
      toast("Network error", false);
    } finally {
      setTriggering(null);
      setTimeout(load, 1500);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const MONO: React.CSSProperties = { fontFamily: "IBM Plex Mono, monospace" };

  if (loading) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      color: "var(--muted)", fontSize: 11, ...MONO }}>
      Loading job catalog…
    </div>
  );

  if (!catalog) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      color: "var(--muted)", fontSize: 11, ...MONO }}>
      Failed to load catalog
    </div>
  );

  // Group by category
  const categories = Array.from(new Set(catalog.jobs.map(j => j.category))).sort();

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", position: "relative" }}>

      {/* Toast stack */}
      <div style={{ position: "fixed", top: 20, right: 24, zIndex: 9999, display: "flex",
        flexDirection: "column", gap: 6, pointerEvents: "none" }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.ok ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)",
            border: `1px solid ${t.ok ? "#34d399" : "#f87171"}`,
            color: t.ok ? "#34d399" : "#f87171",
            borderRadius: 6, padding: "6px 12px", fontSize: 10, ...MONO,
          }}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg)", fontFamily: "Syne, sans-serif",
            letterSpacing: 0.5 }}>
            Operations Catalog
          </div>
          <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 2, ...MONO }}>
            {catalog.total} jobs · {catalog.running} running · {catalog.errors} errors
            · refreshes every 15s · server {new Date(catalog.server_time).toLocaleTimeString()}
          </div>
        </div>
        <button onClick={load} style={{
          marginLeft: "auto", padding: "4px 10px", borderRadius: 4, cursor: "pointer",
          border: "1px solid var(--border2)", background: "var(--surface2)",
          color: "var(--muted2)", fontSize: 9, ...MONO,
        }}>
          ↻ Refresh
        </button>
      </div>

      {/* Summary pills */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Total",    value: catalog.total,    color: "#94a3b8" },
          { label: "Running",  value: catalog.running,  color: "#38bdf8" },
          { label: "Errors",   value: catalog.errors,   color: "#f87171" },
          { label: "Disabled", value: catalog.disabled, color: "#475569" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            background: "var(--surface2)", border: "1px solid var(--border2)",
            borderRadius: 6, padding: "6px 14px", display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 16, fontWeight: 700, color, ...MONO }}>{value}</span>
            <span style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase",
              letterSpacing: 1 }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Job table by category */}
      {categories.map(cat => {
        const jobs = catalog.jobs.filter(j => j.category === cat);
        const catColor = CATEGORY_COLOR[cat] ?? "#94a3b8";
        return (
          <div key={cat} style={{ marginBottom: 20 }}>
            {/* Category header */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ width: 3, height: 14, background: catColor, borderRadius: 2 }} />
              <span style={{ fontSize: 9, color: catColor, textTransform: "uppercase",
                letterSpacing: 1.5, ...MONO }}>
                {cat}
              </span>
              <div style={{ flex: 1, height: 1, background: "var(--border2)" }} />
            </div>

            {/* Job rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {jobs.map(job => {
                const dot   = STATUS_DOT[job.status] ?? STATUS_DOT.idle;
                const alive = job.task_alive;
                return (
                  <div key={job.name} style={{
                    background: "var(--surface2)", border: "1px solid var(--border2)",
                    borderRadius: 7, padding: "10px 14px",
                    display: "grid",
                    gridTemplateColumns: "12px 1fr auto auto auto auto auto",
                    alignItems: "center", gap: 12,
                    opacity: job.enabled ? 1 : 0.5,
                    transition: "opacity 0.2s",
                  }}>
                    {/* Status dot */}
                    <div title={dot.label} style={{
                      width: 8, height: 8, borderRadius: "50%", background: dot.color,
                      boxShadow: job.status === "running" ? `0 0 6px ${dot.color}` : "none",
                    }} />

                    {/* Name + description */}
                    <div>
                      <div style={{ fontSize: 10, color: "var(--fg)", fontWeight: 600, ...MONO }}>
                        {job.name}
                        {!alive && job.enabled && (
                          <span style={{ marginLeft: 6, fontSize: 8, color: "#f87171",
                            background: "rgba(248,113,113,0.1)", borderRadius: 3, padding: "1px 4px" }}>
                            task dead
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 8, color: "var(--muted)", marginTop: 2 }}>
                        {job.description}
                      </div>
                    </div>

                    {/* Interval */}
                    <div style={{ textAlign: "center", minWidth: 36 }}>
                      <div style={{ fontSize: 8, color: "var(--muted)", marginBottom: 2 }}>interval</div>
                      <div style={{ fontSize: 10, color: "var(--muted2)", ...MONO }}>
                        {fmtInterval(job.interval_seconds)}
                      </div>
                    </div>

                    {/* Last run */}
                    <div style={{ textAlign: "center", minWidth: 60 }}>
                      <div style={{ fontSize: 8, color: "var(--muted)", marginBottom: 2 }}>last run</div>
                      <div style={{ fontSize: 10, color: "var(--muted2)", ...MONO }}>
                        {fmtRelative(job.last_run)}
                      </div>
                    </div>

                    {/* Run / error counts */}
                    <div style={{ textAlign: "center", minWidth: 50 }}>
                      <div style={{ fontSize: 8, color: "var(--muted)", marginBottom: 2 }}>runs / err</div>
                      <div style={{ fontSize: 10, ...MONO }}>
                        <span style={{ color: "#34d399" }}>{job.run_count}</span>
                        <span style={{ color: "var(--muted)" }}> / </span>
                        <span style={{ color: job.error_count > 0 ? "#f87171" : "var(--muted)" }}>
                          {job.error_count}
                        </span>
                      </div>
                    </div>

                    {/* Manual trigger */}
                    <button
                      onClick={() => trigger(job)}
                      disabled={!job.enabled || triggering === job.name}
                      title="Run once immediately"
                      style={{
                        padding: "3px 8px", borderRadius: 4, cursor: job.enabled ? "pointer" : "not-allowed",
                        border: "1px solid var(--border2)", background: "var(--surface)",
                        color: "var(--muted2)", fontSize: 9, ...MONO,
                        opacity: !job.enabled ? 0.4 : 1,
                      }}
                    >
                      {triggering === job.name ? "…" : "▶ Run"}
                    </button>

                    {/* Enable / disable toggle */}
                    <div
                      onClick={() => toggle(job)}
                      title={job.enabled ? "Click to disable" : "Click to enable"}
                      style={{
                        width: 32, height: 18, borderRadius: 9, cursor: "pointer",
                        background: job.enabled ? "rgba(0,212,168,0.25)" : "var(--surface)",
                        border: `1px solid ${job.enabled ? "var(--accent)" : "var(--border2)"}`,
                        position: "relative", transition: "all 0.2s", flexShrink: 0,
                      }}
                    >
                      <div style={{
                        position: "absolute", top: 3, width: 10, height: 10, borderRadius: "50%",
                        background: job.enabled ? "var(--accent)" : "var(--muted)",
                        left: job.enabled ? 18 : 3, transition: "left 0.2s",
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Inline error details */}
            {jobs.filter(j => j.status === "error" && j.last_error).map(job => (
              <div key={`err-${job.name}`} style={{
                marginTop: 4, padding: "6px 12px",
                background: "rgba(248,113,113,0.06)",
                border: "1px solid rgba(248,113,113,0.2)",
                borderRadius: 5, fontSize: 9, color: "#f87171", ...MONO,
              }}>
                ⚠ {job.name}: {job.last_error}
              </div>
            ))}
          </div>
        );
      })}

      {catalog.jobs.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 11,
          marginTop: 60, ...MONO }}>
          No jobs registered
        </div>
      )}
    </div>
  );
}
