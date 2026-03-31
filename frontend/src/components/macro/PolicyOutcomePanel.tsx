/**
 * PolicyOutcomePanel — displays Fed policy decisions and whether they worked.
 *
 * For each detected FOMC decision:
 *   - Shows the decision (rate hike/cut/hold, basis points)
 *   - Shows the stated goal
 *   - At 6- and 12-month lags, shows actual vs target with hit/partial/miss score
 *
 * Also shows:
 *   - Rolling Fed credibility score (0–1)
 *   - Credibility trend over time
 */

import { useState, useEffect, useCallback } from "react";
import type { PolicyDecision, PolicyOutcome } from "../../types";
import { apiFetch } from "../../lib/apiFetch";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SCORE_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  hit:     { label: "HIT",     color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
  partial: { label: "PARTIAL", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  miss:    { label: "MISS",    color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
};

const DECISION_COLORS: Record<string, string> = {
  rate_hike: "#ef4444",
  rate_cut:  "#22c55e",
  hold:      "#94a3b8",
  qt_start:  "#f97316",
  qt_end:    "#22d3ee",
  qe_start:  "#22c55e",
  none:      "#475569",
};

function decisionLabel(type: string, bps: number): string {
  if (type === "rate_hike") return `▲ Hike +${bps}bps`;
  if (type === "rate_cut")  return `▼ Cut ${bps}bps`;
  if (type === "hold")      return "◆ Hold";
  if (type === "qt_start")  return "QT Start";
  if (type === "qt_end")    return "QT End";
  if (type === "qe_start")  return "QE Start";
  return type.replace("_", " ").toUpperCase();
}

// ── Credibility gauge ─────────────────────────────────────────────────────────

function CredibilityGauge({ score }: { score: number }) {
  const pct   = score * 100;
  const color = score >= 0.8 ? "#22c55e" : score >= 0.6 ? "#f59e0b" : "#ef4444";
  const label = score >= 0.8 ? "High" : score >= 0.6 ? "Moderate" : score >= 0.4 ? "Low" : "Very Low";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace" }}>
          Fed Credibility Score
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: "IBM Plex Mono, monospace" }}>
          {(score * 100).toFixed(0)}% — {label}
        </span>
      </div>
      <div style={{ height: 8, background: "var(--border2)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%", background: color,
          borderRadius: 4, transition: "width 0.5s ease",
        }} />
      </div>
      <div style={{ fontSize: 7, color: "var(--muted)", marginTop: 4, fontFamily: "IBM Plex Mono, monospace" }}>
        Exponentially weighted average of last 8 policy outcomes — 1.0 = all targets met
      </div>
    </div>
  );
}

// ── Outcome badge ─────────────────────────────────────────────────────────────

function OutcomeBadge({ score }: { score: "hit" | "partial" | "miss" }) {
  const s = SCORE_STYLE[score] ?? SCORE_STYLE.miss;
  return (
    <span style={{
      fontSize: 7, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
      color: s.color, background: s.bg, border: `1px solid ${s.color}40`,
      fontFamily: "IBM Plex Mono, monospace", letterSpacing: "0.06em",
    }}>
      {s.label}
    </span>
  );
}

// ── Decision card ─────────────────────────────────────────────────────────────

function DecisionCard({ dec, outcomes }: { dec: PolicyDecision; outcomes: PolicyOutcome[] }) {
  const [open, setOpen] = useState(false);
  const myOutcomes = outcomes.filter(o => o.decision_id === dec.id);
  const decColor   = DECISION_COLORS[dec.decision_type] ?? "#94a3b8";

  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: 5, overflow: "hidden",
      marginBottom: 6,
    }}>
      {/* Header row */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
          background: "var(--surface2)", cursor: "pointer",
        }}
      >
        <span style={{ width: 60, fontSize: 8, color: "var(--muted)", flexShrink: 0 }}>
          {dec.decision_date}
        </span>
        <span style={{
          fontSize: 9, fontWeight: 700, color: decColor,
          fontFamily: "IBM Plex Mono, monospace", width: 100, flexShrink: 0,
        }}>
          {decisionLabel(dec.decision_type, dec.rate_change_bps)}
        </span>
        {dec.target_metric && dec.target_value != null && (
          <span style={{ fontSize: 8, color: "var(--muted2)", flex: 1 }}>
            Target: {dec.target_metric.toUpperCase()} → {dec.target_value.toFixed(1)}%
          </span>
        )}
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {myOutcomes.length === 0 && (
            <span style={{ fontSize: 7, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace" }}>
              {dec.target_date ? `Due ${dec.target_date}` : "Pending"}
            </span>
          )}
          {myOutcomes.map(o => (
            <OutcomeBadge key={o.id} score={o.score as "hit" | "partial" | "miss"} />
          ))}
        </div>
        <span style={{ fontSize: 8, color: "var(--muted)", marginLeft: 4 }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: "10px 12px", background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
          {dec.stated_goal && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 7, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>Stated Goal</div>
              <div style={{ fontSize: 8, color: "var(--text)", lineHeight: 1.7, fontFamily: "IBM Plex Mono, monospace" }}>{dec.stated_goal}</div>
            </div>
          )}
          {dec.document_title && (
            <div style={{ fontSize: 7, color: "var(--muted)", marginBottom: 10 }}>Source: {dec.document_title}</div>
          )}
          {myOutcomes.length > 0 && (
            <div>
              <div style={{ fontSize: 7, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Outcome Measurements</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {myOutcomes.map(o => (
                  <div key={o.id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "6px 8px",
                    background: "var(--surface2)", borderRadius: 3, border: "1px solid var(--border2)",
                  }}>
                    <span style={{ fontSize: 8, color: "var(--muted)", width: 55 }}>{o.measurement_date}</span>
                    <span style={{ fontSize: 7, color: "var(--muted)", width: 40 }}>+{o.lag_months}mo</span>
                    <span style={{ fontSize: 7, color: "var(--muted)", width: 50 }}>{o.fred_series}</span>
                    <span style={{ fontSize: 8, fontFamily: "IBM Plex Mono, monospace", flex: 1 }}>
                      Target <strong>{o.target_value.toFixed(2)}</strong> → Actual <strong style={{ color: o.deviation > 0 ? "#ef4444" : "#22c55e" }}>{o.actual_value.toFixed(2)}</strong>
                      <span style={{ color: "var(--muted)", marginLeft: 4 }}>
                        ({o.deviation >= 0 ? "+" : ""}{o.deviation.toFixed(2)} deviation)
                      </span>
                    </span>
                    <OutcomeBadge score={o.score as "hit" | "partial" | "miss"} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {myOutcomes.length === 0 && dec.target_date && (
            <div style={{ fontSize: 8, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace" }}>
              Outcome measurement due {dec.target_date} — will be scored automatically when FRED data is available.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PolicyOutcomePanel() {
  const [decisions,    setDecisions]    = useState<PolicyDecision[]>([]);
  const [outcomes,     setOutcomes]     = useState<PolicyOutcome[]>([]);
  const [credibility,  setCredibility]  = useState<number>(0.5);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [decRes, outRes, credRes] = await Promise.all([
        apiFetch("/api/fraser/policy-decisions?limit=20").then(r => r.ok ? r.json() : null),
        apiFetch("/api/fraser/policy-outcomes?limit=50").then(r => r.ok ? r.json() : null),
        apiFetch("/api/fraser/credibility").then(r => r.ok ? r.json() : null),
      ]);
      if (decRes?.decisions)    setDecisions(decRes.decisions);
      if (outRes?.outcomes)     setOutcomes(outRes.outcomes);
      if (credRes?.score != null) setCredibility(credRes.score);
    } catch { setError("Failed to load policy outcome data"); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const box: React.CSSProperties = {
    background: "var(--surface2)", border: "1px solid var(--border2)",
    borderRadius: 6, padding: "12px 14px",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 8, color: "var(--muted)", textTransform: "uppercase",
    letterSpacing: "0.1em", marginBottom: 10,
    fontFamily: "IBM Plex Mono, monospace",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "IBM Plex Mono, monospace" }}>
        Policy Outcome Tracker
      </div>

      {loading && (
        <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace", padding: "16px 0", textAlign: "center" }}>
          Loading…
        </div>
      )}

      {!loading && decisions.length === 0 && (
        <div style={box}>
          <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace", lineHeight: 1.8 }}>
            No policy decisions detected yet. Run <strong>↻ Refresh</strong> in the Fed Sentiment panel to analyze FOMC documents.
          </div>
        </div>
      )}

      {!loading && decisions.length > 0 && (
        <>
          {/* Credibility gauge */}
          <div style={box}>
            <CredibilityGauge score={credibility} />
          </div>

          {/* Decision list */}
          <div style={box}>
            <div style={labelStyle}>Detected Policy Decisions ({decisions.length})</div>
            {decisions.map(dec => (
              <DecisionCard key={dec.id} dec={dec} outcomes={outcomes} />
            ))}
          </div>

          {/* Outcome stats */}
          {outcomes.length > 0 && (() => {
            const hits     = outcomes.filter(o => o.score === "hit").length;
            const partials = outcomes.filter(o => o.score === "partial").length;
            const misses   = outcomes.filter(o => o.score === "miss").length;
            const total    = outcomes.length;
            return (
              <div style={box}>
                <div style={labelStyle}>Outcome Summary ({total} measurements)</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {[
                    { label: "Hits",     count: hits,     color: "#22c55e" },
                    { label: "Partials", count: partials, color: "#f59e0b" },
                    { label: "Misses",   count: misses,   color: "#ef4444" },
                  ].map(({ label, count, color }) => (
                    <div key={label} style={{
                      flex: 1, textAlign: "center", background: "var(--surface)",
                      borderRadius: 4, padding: "10px 6px", border: `1px solid ${color}30`,
                    }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "IBM Plex Mono, monospace" }}>{count}</div>
                      <div style={{ fontSize: 7, color: "var(--muted)", marginTop: 2 }}>{label}</div>
                      <div style={{ fontSize: 7, color, marginTop: 1 }}>{total > 0 ? `${((count / total) * 100).toFixed(0)}%` : "—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {error && (
        <div style={{ fontSize: 8, color: "var(--no)", fontFamily: "IBM Plex Mono, monospace" }}>{error}</div>
      )}
    </div>
  );
}
