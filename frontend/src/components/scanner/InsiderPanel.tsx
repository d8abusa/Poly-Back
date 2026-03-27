import { useState } from "react";
import { apiFetch } from "../../lib/apiFetch";

// ── Types ─────────────────────────────────────────────────────────────────────

interface InsiderSignals {
  book_imbalance:  number;
  whale_trade:     number;
  price_velocity:  number;
  spread_widening: number;
  book_thinness:   number;
}

interface InsiderRaw {
  bid_depth:      number;
  ask_depth:      number;
  max_trade_pct:  number;
  spread:         number | null;
  velocity_range: number;
  total_depth:    number;
}

interface InsiderResult {
  market_id:         string;
  title:             string;
  exchange:          string;
  smart_money_score: number;
  interpretation:    "noise" | "watch" | "elevated" | "strong";
  flags:             string[];
  scanned_at:        string;
  error:             string | null;
  signals:           InsiderSignals;
  raw:               InsiderRaw;
}

interface ScanResponse {
  exchange: string;
  scanned:  number;
  results:  InsiderResult[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const INTERP_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  strong:   { color: "#f87171", bg: "rgba(248,113,113,0.08)",  label: "Strong" },
  elevated: { color: "#fbbf24", bg: "rgba(251,191,36,0.08)",   label: "Elevated" },
  watch:    { color: "#38bdf8", bg: "rgba(56,189,248,0.06)",   label: "Watch" },
  noise:    { color: "#475569", bg: "transparent",             label: "Noise" },
};

const SIGNAL_LABELS: Record<keyof InsiderSignals, string> = {
  book_imbalance:  "Book Imbalance",
  whale_trade:     "Whale Trade",
  price_velocity:  "Price Velocity",
  spread_widening: "Spread Widening",
  book_thinness:   "Book Thinness",
};

const SIGNAL_WEIGHTS: Record<keyof InsiderSignals, number> = {
  book_imbalance:  30,
  whale_trade:     25,
  price_velocity:  20,
  spread_widening: 15,
  book_thinness:   10,
};

const MONO: React.CSSProperties = { fontFamily: "IBM Plex Mono, monospace" };

function scoreColor(v: number): string {
  if (v >= 70) return "#f87171";
  if (v >= 50) return "#fbbf24";
  if (v >= 30) return "#38bdf8";
  return "#475569";
}

function ScoreBar({ value, width = 80 }: { value: number; width?: number }) {
  return (
    <div style={{ width, height: 4, background: "var(--border2)", borderRadius: 2, overflow: "hidden" }}>
      <div style={{
        width: `${value}%`, height: "100%",
        background: scoreColor(value), borderRadius: 2,
        transition: "width 0.4s ease",
      }} />
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InsiderPanel({ markets }: { markets: { condition_id: string; token_id?: string; title?: string }[] }) {
  const [results,   setResults]   = useState<InsiderResult[]>([]);
  const [scanning,  setScanning]  = useState(false);
  const [exchange,  setExchange]  = useState("polymarket");
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  const run = async () => {
    if (!markets.length) { setError("No markets loaded — search for markets first"); return; }
    setScanning(true);
    setError(null);
    try {
      const r = await apiFetch("/api/scanner/insider", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          markets:  markets.map(m => ({ condition_id: m.condition_id, token_id: m.token_id, title: m.title })),
          exchange,
          persist:  true,
        }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail ?? r.status); }
      const data: ScanResponse = await r.json();
      setResults(data.results);
      setScannedAt(new Date().toLocaleTimeString());
    } catch (e: any) {
      setError(e.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const significant = results.filter(r => r.smart_money_score >= 30);
  const noise       = results.filter(r => r.smart_money_score <  30);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg)",
            fontFamily: "Syne, sans-serif", letterSpacing: 0.5 }}>
            Insider Detection
          </div>
          <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 2, ...MONO }}>
            Order-book imbalance · whale trades · price velocity · spread dynamics
            {scannedAt && ` · scanned ${scannedAt}`}
          </div>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={exchange}
            onChange={e => setExchange(e.target.value)}
            style={{
              padding: "3px 6px", borderRadius: 4, fontSize: 9, ...MONO,
              background: "var(--surface2)", border: "1px solid var(--border2)",
              color: "var(--muted2)", cursor: "pointer",
            }}
          >
            <option value="polymarket">Polymarket</option>
            <option value="kalshi">Kalshi</option>
          </select>

          <button
            onClick={run}
            disabled={scanning || !markets.length}
            style={{
              padding: "4px 14px", borderRadius: 4, cursor: scanning ? "wait" : "pointer",
              border: "1px solid var(--accent)", background: scanning ? "var(--surface2)" : "rgba(0,212,168,0.08)",
              color: "var(--accent)", fontSize: 10, fontWeight: 700, ...MONO,
              opacity: !markets.length ? 0.4 : 1,
            }}
          >
            {scanning ? "Scanning…" : `▶ Scan ${markets.length} market${markets.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", marginBottom: 12, borderRadius: 5, fontSize: 9, ...MONO,
          background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171" }}>
          {error}
        </div>
      )}

      {!results.length && !scanning && (
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 10, ...MONO,
          marginTop: 60, lineHeight: 1.8 }}>
          Click Scan to analyse loaded markets for informed-flow signals.<br />
          <span style={{ fontSize: 8, color: "var(--muted)" }}>
            Signals: book imbalance (30%) · whale trades (25%) · price velocity (20%) · spread (15%) · thinness (10%)
          </span>
        </div>
      )}

      {/* Summary row */}
      {results.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {(["strong", "elevated", "watch", "noise"] as const).map(interp => {
            const count = results.filter(r => r.interpretation === interp).length;
            const s = INTERP_STYLE[interp];
            return (
              <div key={interp} style={{
                background: s.bg, border: `1px solid ${count ? s.color : "var(--border2)"}`,
                borderRadius: 6, padding: "5px 12px", display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: s.color, ...MONO }}>{count}</span>
                <span style={{ fontSize: 8, color: s.color, textTransform: "uppercase", letterSpacing: 1 }}>
                  {s.label}
                </span>
              </div>
            );
          })}
          <span style={{ marginLeft: "auto", fontSize: 8, color: "var(--muted)", alignSelf: "center", ...MONO }}>
            {results.length} markets analysed
          </span>
        </div>
      )}

      {/* Significant markets */}
      {significant.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {significant.map(r => {
            const s     = INTERP_STYLE[r.interpretation];
            const isExp = expanded === r.market_id;
            return (
              <div key={r.market_id} style={{ marginBottom: 6 }}>
                <div
                  onClick={() => setExpanded(isExp ? null : r.market_id)}
                  style={{
                    background: s.bg, border: `1px solid ${s.color}`,
                    borderRadius: 7, padding: "10px 14px", cursor: "pointer",
                    display: "grid",
                    gridTemplateColumns: "80px 1fr auto",
                    alignItems: "center", gap: 14,
                    transition: "border-color 0.15s",
                  }}
                >
                  {/* Score */}
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: s.color, ...MONO,
                      lineHeight: 1 }}>
                      {r.smart_money_score.toFixed(0)}
                    </div>
                    <div style={{ fontSize: 7, color: s.color, textTransform: "uppercase",
                      letterSpacing: 1, marginTop: 2 }}>{s.label}</div>
                    <ScoreBar value={r.smart_money_score} width={60} />
                  </div>

                  {/* Title + flags */}
                  <div>
                    <div style={{ fontSize: 10, color: "var(--fg)", fontWeight: 600, marginBottom: 3 }}>
                      {r.title || r.market_id}
                    </div>
                    {r.flags.slice(0, 2).map((f, i) => (
                      <div key={i} style={{ fontSize: 8, color: s.color, marginTop: 2 }}>
                        ▸ {f}
                      </div>
                    ))}
                    {r.flags.length > 2 && (
                      <div style={{ fontSize: 7, color: "var(--muted)", marginTop: 2 }}>
                        +{r.flags.length - 2} more signal{r.flags.length - 2 !== 1 ? "s" : ""}
                      </div>
                    )}
                  </div>

                  {/* Expand chevron */}
                  <div style={{ color: "var(--muted)", fontSize: 10 }}>{isExp ? "▲" : "▼"}</div>
                </div>

                {/* Expanded signal breakdown */}
                {isExp && (
                  <div style={{
                    background: "var(--surface2)", border: `1px solid var(--border2)`,
                    borderTop: "none", borderRadius: "0 0 7px 7px",
                    padding: "12px 16px",
                  }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                      {(Object.keys(SIGNAL_LABELS) as (keyof InsiderSignals)[]).map(key => {
                        const val = r.signals[key];
                        return (
                          <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                              <span style={{ fontSize: 8, color: "var(--muted)", ...MONO }}>
                                {SIGNAL_LABELS[key]}
                                <span style={{ color: "#475569" }}> ×{SIGNAL_WEIGHTS[key]}%</span>
                              </span>
                              <span style={{ fontSize: 9, color: scoreColor(val), fontWeight: 700, ...MONO }}>
                                {val.toFixed(0)}
                              </span>
                            </div>
                            <ScoreBar value={val} width={120} />
                          </div>
                        );
                      })}
                    </div>

                    {/* Raw values */}
                    <div style={{ borderTop: "1px solid var(--border2)", paddingTop: 8,
                      display: "flex", gap: 16, flexWrap: "wrap" }}>
                      {[
                        ["Bid depth",   r.raw.bid_depth.toFixed(1)],
                        ["Ask depth",   r.raw.ask_depth.toFixed(1)],
                        ["Max fill",    `${r.raw.max_trade_pct.toFixed(1)}% of vol`],
                        ["Spread",      r.raw.spread != null ? `${(r.raw.spread * 100).toFixed(1)}¢` : "—"],
                        ["Velocity",    `${r.raw.velocity_range.toFixed(1)}¢ range`],
                        ["Total depth", r.raw.total_depth.toFixed(1)],
                      ].map(([label, val]) => (
                        <div key={label as string} style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 7, color: "var(--muted)", marginBottom: 2 }}>{label}</div>
                          <div style={{ fontSize: 9, color: "var(--muted2)", ...MONO }}>{val}</div>
                        </div>
                      ))}
                    </div>

                    {r.error && (
                      <div style={{ marginTop: 8, fontSize: 8, color: "#f87171", ...MONO }}>
                        ⚠ Partial data: {r.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Noise markets — collapsed list */}
      {noise.length > 0 && results.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 3, height: 12, background: "#334155", borderRadius: 2 }} />
            <span style={{ fontSize: 8, color: "#475569", textTransform: "uppercase",
              letterSpacing: 1.5, ...MONO }}>
              Noise ({noise.length})
            </span>
            <div style={{ flex: 1, height: 1, background: "var(--border2)" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {noise.map(r => (
              <div key={r.market_id} style={{
                background: "var(--surface2)", border: "1px solid var(--border2)",
                borderRadius: 5, padding: "6px 12px",
                display: "flex", alignItems: "center", gap: 12, opacity: 0.6,
              }}>
                <span style={{ fontSize: 9, color: "#475569", fontWeight: 700, ...MONO, minWidth: 24 }}>
                  {r.smart_money_score.toFixed(0)}
                </span>
                <span style={{ fontSize: 9, color: "var(--muted)" }}>{r.title || r.market_id}</span>
                {r.error && <span style={{ marginLeft: "auto", fontSize: 7, color: "#64748b", ...MONO }}>
                  data error
                </span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
