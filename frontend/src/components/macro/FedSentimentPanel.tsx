/**
 * FedSentimentPanel — displays FRASER NLP results for FOMC minutes and statements.
 *
 * Shows:
 *   - Tone gauge (-1 hawkish → +1 dovish) for the most recent document
 *   - Tone sparkline over time
 *   - Rate direction + guidance strength indicators
 *   - Key phrases extracted from the document
 *   - Concern breakdown (inflation / employment / growth)
 *   - Summary of the most recent analysis
 *   - Refresh button to trigger new document fetch + NLP
 */

import { useState, useEffect, useCallback } from "react";
import type { FraserAnalysis, FraserSentimentPoint } from "../../types";
import { apiFetch } from "../../lib/apiFetch";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TONE_COLORS: Record<string, string> = {
  hawkish:          "#ef4444",
  slightly_hawkish: "#f97316",
  neutral:          "#94a3b8",
  slightly_dovish:  "#22d3ee",
  dovish:           "#22c55e",
};

const DIR_LABELS: Record<string, { label: string; color: string }> = {
  hike:    { label: "▲ Hike", color: "#ef4444" },
  hold:    { label: "◆ Hold", color: "#94a3b8" },
  cut:     { label: "▼ Cut",  color: "#22c55e" },
  unknown: { label: "—",      color: "#475569" },
};

const GUIDANCE_COLORS: Record<string, string> = {
  strong:   "#f59e0b",
  moderate: "#3b82f6",
  weak:     "#475569",
  none:     "#334155",
};

function toneColor(score: number): string {
  if (score <= -0.5) return TONE_COLORS.hawkish;
  if (score <= -0.15) return TONE_COLORS.slightly_hawkish;
  if (score >= 0.5) return TONE_COLORS.dovish;
  if (score >= 0.15) return TONE_COLORS.slightly_dovish;
  return TONE_COLORS.neutral;
}

function toneLabel(score: number): string {
  if (score <= -0.5) return "Hawkish";
  if (score <= -0.15) return "Slightly Hawkish";
  if (score >= 0.5) return "Dovish";
  if (score >= 0.15) return "Slightly Dovish";
  return "Neutral";
}

// ── Tone gauge ────────────────────────────────────────────────────────────────

function ToneGauge({ score }: { score: number }) {
  // Map -1..+1 to 0..100%
  const pct  = ((score + 1) / 2) * 100;
  const col  = toneColor(score);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 8, color: "#ef4444", fontFamily: "IBM Plex Mono, monospace", textTransform: "uppercase" }}>Hawkish</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: col, fontFamily: "IBM Plex Mono, monospace" }}>
          {score >= 0 ? "+" : ""}{score.toFixed(2)} — {toneLabel(score)}
        </span>
        <span style={{ fontSize: 8, color: "#22c55e", fontFamily: "IBM Plex Mono, monospace", textTransform: "uppercase" }}>Dovish</span>
      </div>
      <div style={{ position: "relative", height: 8, background: "linear-gradient(to right, #ef4444, #94a3b8, #22c55e)", borderRadius: 4 }}>
        {/* Neutral marker */}
        <div style={{ position: "absolute", left: "50%", top: -2, width: 1, height: 12, background: "var(--border)", transform: "translateX(-50%)" }} />
        {/* Pointer */}
        <div style={{
          position: "absolute", left: `${pct}%`, top: "50%",
          width: 12, height: 12, background: col,
          border: "2px solid var(--bg)", borderRadius: "50%",
          transform: "translate(-50%, -50%)",
          transition: "left 0.5s ease",
          boxShadow: `0 0 6px ${col}80`,
        }} />
      </div>
    </div>
  );
}

// ── Sparkline ──────────────────────────────────────────────────────────────────

function ToneSparkline({ points }: { points: FraserSentimentPoint[] }) {
  if (points.length < 2) return null;

  const W = 320, H = 60, PAD = 8;
  const scores = points.map(p => p.tone_score);
  const minS = Math.min(...scores, -0.2);
  const maxS = Math.max(...scores,  0.2);
  const range = maxS - minS || 1;

  const toX = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const toY = (s: number) => H - PAD - ((s - minS) / range) * (H - PAD * 2);

  const pathD = points.map((p, i) =>
    `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.tone_score).toFixed(1)}`
  ).join(" ");

  const zeroY = toY(0);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* Zero line */}
      <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="var(--border)" strokeWidth={0.5} strokeDasharray="3 3" />
      {/* Area fill */}
      <path
        d={`${pathD} L${toX(points.length - 1)},${H} L${toX(0)},${H} Z`}
        fill="rgba(59,130,246,0.08)"
      />
      {/* Line */}
      <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
      {/* Dots */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={toX(i)} cy={toY(p.tone_score)} r={3}
          fill={toneColor(p.tone_score)}
          stroke="var(--bg)" strokeWidth={1}
        >
          <title>{`${p.doc_date ?? p.date} — ${p.tone_score.toFixed(2)} (${p.tone_label})`}</title>
        </circle>
      ))}
    </svg>
  );
}

// ── Concern bars ──────────────────────────────────────────────────────────────

function ConcernBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
      <span style={{ width: 68, fontSize: 8, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: "var(--border2)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${value * 100}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.4s" }} />
      </div>
      <span style={{ fontSize: 9, color, fontFamily: "IBM Plex Mono, monospace", width: 32, textAlign: "right" }}>
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function FedSentimentPanel() {
  const [analyses,  setAnalyses]  = useState<FraserAnalysis[]>([]);
  const [trend,     setTrend]     = useState<FraserSentimentPoint[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [expanded,  setExpanded]  = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [aRes, tRes] = await Promise.all([
        apiFetch("/api/fraser/analyses?limit=10").then(r => r.ok ? r.json() : null),
        apiFetch("/api/fraser/sentiment-trend?months=24").then(r => r.ok ? r.json() : null),
      ]);
      if (aRes?.analyses) setAnalyses(aRes.analyses);
      if (tRes?.trend)    setTrend(tRes.trend);
    } catch { setError("Failed to load Fed sentiment data"); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await apiFetch("/api/fraser/refresh", { method: "POST" });
      if (res.ok) {
        const d = await res.json();
        setRefreshing(false);
        if (d.new_documents > 0 || d.new_analyses > 0) await load();
      }
    } catch { /* ignore */ }
    setRefreshing(false);
  };

  const latest = analyses[0];

  const box: React.CSSProperties = {
    background: "var(--surface2)", border: "1px solid var(--border2)",
    borderRadius: 6, padding: "12px 14px",
  };
  const label: React.CSSProperties = {
    fontSize: 8, color: "var(--muted)", textTransform: "uppercase",
    letterSpacing: "0.1em", marginBottom: 8,
    fontFamily: "IBM Plex Mono, monospace",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "IBM Plex Mono, monospace" }}>
          Fed Sentiment (FRASER NLP)
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            fontSize: 8, padding: "3px 10px", borderRadius: 3, cursor: "pointer",
            border: "1px solid var(--border2)", background: "var(--surface2)",
            color: refreshing ? "var(--accent)" : "var(--muted)",
            fontFamily: "IBM Plex Mono, monospace",
          }}
        >
          {refreshing ? "Fetching…" : "↻ Refresh"}
        </button>
      </div>

      {loading && (
        <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace", padding: "20px 0", textAlign: "center" }}>
          Loading FRASER data…
        </div>
      )}

      {!loading && analyses.length === 0 && (
        <div style={{ ...box }}>
          <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace", lineHeight: 1.8 }}>
            No analyses yet. Click <strong>↻ Refresh</strong> to fetch and analyze recent FOMC documents.<br />
            Make sure FRASER_API_KEY is set in backend/.env and Ollama is running.
          </div>
        </div>
      )}

      {!loading && latest && (
        <>
          {/* Tone gauge */}
          <div style={box}>
            <div style={label}>Latest — {latest.doc_date} · {latest.document_type.replace("_", " ").toUpperCase()}</div>
            <ToneGauge score={latest.tone_score} />

            {/* Rate direction + guidance */}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {(() => {
                const dir = DIR_LABELS[latest.rate_direction] ?? DIR_LABELS.unknown;
                return (
                  <div style={{ flex: 1, background: "var(--surface)", borderRadius: 4, padding: "8px 10px", textAlign: "center", border: `1px solid ${dir.color}30` }}>
                    <div style={{ fontSize: 7, color: "var(--muted)", marginBottom: 3, textTransform: "uppercase" }}>Rate Signal</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: dir.color, fontFamily: "IBM Plex Mono, monospace" }}>{dir.label}</div>
                    <div style={{ fontSize: 7, color: GUIDANCE_COLORS[latest.rate_signal_strength] ?? "var(--muted)", marginTop: 2 }}>{latest.rate_signal_strength} signal</div>
                  </div>
                );
              })()}

              <div style={{ flex: 1, background: "var(--surface)", borderRadius: 4, padding: "8px 10px", textAlign: "center", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 7, color: "var(--muted)", marginBottom: 3, textTransform: "uppercase" }}>Balance Sheet</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: latest.bs_direction === "shrink" ? "#ef4444" : latest.bs_direction === "expand" ? "#22c55e" : "#94a3b8", fontFamily: "IBM Plex Mono, monospace" }}>
                  {latest.bs_direction.toUpperCase()}
                </div>
                <div style={{ fontSize: 7, color: GUIDANCE_COLORS[latest.guidance_strength] ?? "var(--muted)", marginTop: 2 }}>{latest.guidance_strength} guidance</div>
              </div>
            </div>

            {/* Concern breakdown */}
            <div style={{ marginTop: 12 }}>
              <ConcernBar label="Inflation"   value={latest.inflation_concern}   color="#ef4444" />
              <ConcernBar label="Employment"  value={latest.employment_concern}  color="#22c55e" />
              <ConcernBar label="Growth"      value={latest.growth_concern}      color="#3b82f6" />
            </div>
          </div>

          {/* Sparkline */}
          {trend.length >= 2 && (
            <div style={box}>
              <div style={label}>Tone Score — last {trend.length} documents</div>
              <ToneSparkline points={trend} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span style={{ fontSize: 7, color: "var(--muted)" }}>{trend[0]?.date?.slice(0, 7)}</span>
                <span style={{ fontSize: 7, color: "var(--muted)" }}>{trend[trend.length - 1]?.date?.slice(0, 7)}</span>
              </div>
            </div>
          )}

          {/* Key phrases */}
          {latest.key_phrases?.length > 0 && (
            <div style={box}>
              <div style={label}>Key Phrases — {latest.doc_date}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {latest.key_phrases.map((phrase, i) => (
                  <span key={i} style={{
                    fontSize: 8, padding: "3px 8px", borderRadius: 10,
                    background: "var(--surface)", border: "1px solid var(--border)",
                    color: "var(--muted2)", fontFamily: "IBM Plex Mono, monospace",
                    lineHeight: 1.5,
                  }}>
                    "{phrase}"
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          {latest.summary && (
            <div style={box}>
              <div style={label}>Analysis Summary</div>
              <div style={{ fontSize: 9, color: "var(--text)", lineHeight: 1.7, fontFamily: "IBM Plex Mono, monospace" }}>
                {latest.summary}
              </div>
              {latest.policy_intent && (
                <div style={{ marginTop: 8, padding: "6px 10px", background: "var(--surface)", borderRadius: 4, border: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 7, color: "var(--muted)", textTransform: "uppercase" }}>Policy Intent: </span>
                  <span style={{ fontSize: 9, color: "var(--accent)" }}>{latest.policy_intent}</span>
                </div>
              )}
            </div>
          )}

          {/* Document list */}
          <div style={box}>
            <div style={label}>Recent Documents ({analyses.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {analyses.map(a => {
                const isOpen = expanded === a.id;
                const col = toneColor(a.tone_score);
                return (
                  <div key={a.id}>
                    <div
                      onClick={() => setExpanded(isOpen ? null : a.id)}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "5px 8px", borderRadius: 3, cursor: "pointer",
                        background: isOpen ? "var(--surface)" : "transparent",
                        border: `1px solid ${isOpen ? "var(--border)" : "transparent"}`,
                        transition: "all 0.1s",
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 7, color: "var(--muted)", width: 55 }}>{a.doc_date}</span>
                        <span style={{ fontSize: 8, color: "var(--muted2)", textTransform: "uppercase", letterSpacing: "0.04em", width: 60 }}>
                          {a.document_type.replace("_", " ")}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: col, fontFamily: "IBM Plex Mono, monospace" }}>
                          {a.tone_score >= 0 ? "+" : ""}{a.tone_score.toFixed(2)}
                        </span>
                        <span style={{ fontSize: 7, color: DIR_LABELS[a.rate_direction]?.color ?? "var(--muted)" }}>
                          {DIR_LABELS[a.rate_direction]?.label ?? "—"}
                        </span>
                        <span style={{ fontSize: 8, color: "var(--muted)" }}>{isOpen ? "▲" : "▼"}</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "6px 8px 8px", fontSize: 8, color: "var(--muted2)", lineHeight: 1.7, fontFamily: "IBM Plex Mono, monospace" }}>
                        {a.summary || a.policy_intent || "No summary available."}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {error && (
        <div style={{ fontSize: 8, color: "var(--no)", fontFamily: "IBM Plex Mono, monospace" }}>{error}</div>
      )}
    </div>
  );
}
