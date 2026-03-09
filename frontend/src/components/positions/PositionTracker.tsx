import { useState, useEffect, useRef, useCallback } from "react";
import type { Position, PositionSummary } from "../../types";

// ── Live position (extends Position with locally-managed prob) ─────────────────
interface LivePosition extends Position {
  liveProb: number;
}

interface LogEntry {
  time: string;
  msg: string;
}

// ── PnL helpers ────────────────────────────────────────────────────────────────
function calcPnl(pos: LivePosition): number {
  return pos.side === "YES"
    ? (pos.liveProb - pos.entry_price) * pos.shares
    : (pos.entry_price - pos.liveProb) * pos.shares;
}

function pnlPct(pos: LivePosition): number {
  return pos.capital > 0 ? (calcPnl(pos) / pos.capital) * 100 : 0;
}

function fmtPnl(val: number): string {
  return `${val >= 0 ? "+" : ""}$${Math.abs(val).toFixed(2)}`;
}

function fmtPct(val: number): string {
  return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
}

// ── PnL Summary Bar ────────────────────────────────────────────────────────────
function PnLBar({ positions, summary }: { positions: LivePosition[]; summary: PositionSummary | null }) {
  const unrealized = positions.reduce((s, p) => s + calcPnl(p), 0);
  const profitable = positions.filter(p => calcPnl(p) >= 0).length;
  const atRisk     = positions.length - profitable;

  const cell = (label: string, value: string, cls: string, sub: string) => (
    <div style={{ padding: "14px 20px", borderRight: "1px solid var(--border)", minWidth: 0 }}>
      <div style={{ fontSize: 9, letterSpacing: "0.15em", color: "var(--muted)", textTransform: "uppercase", marginBottom: 6, fontFamily: "IBM Plex Mono, monospace" }}>
        {label}
      </div>
      <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 18, fontWeight: 600, lineHeight: 1, color: cls }}>
        {value}
      </div>
      <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
        {sub}
      </div>
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
      {cell("Total Unrealized PnL", fmtPnl(unrealized), unrealized >= 0 ? "var(--yes)" : "var(--no)", `${unrealized >= 0 ? "+" : ""}${positions.length > 0 ? ((unrealized / positions.reduce((s,p)=>s+p.capital,0))*100).toFixed(2) : "0.00"}% overall`)}
      {cell("Open Positions", String(positions.length), "var(--accent)", `${profitable} profitable · ${atRisk} at-risk`)}
      {cell("Capital Deployed", `$${positions.reduce((s,p)=>s+p.capital,0).toFixed(0)}`, "var(--text)", "of $25,000 max")}
      {cell("Today's Realized", fmtPnl(summary?.today_realized ?? 0), (summary?.today_realized ?? 0) >= 0 ? "var(--yes)" : "var(--no)", `${positions.filter(p=>p.closed_at?.startsWith(new Date().toISOString().slice(0,10))).length} closed today`)}
      {cell("Max Drawdown", fmtPnl(Math.min(0, ...positions.map(p=>calcPnl(p)), 0)), "var(--no)", `${positions.length > 0 && positions.reduce((s,p)=>s+p.capital,0) > 0 ? (Math.abs(Math.min(0,...positions.map(p=>calcPnl(p)),0))/positions.reduce((s,p)=>s+p.capital,0)*100).toFixed(1) : "0.0"}% of capital`)}
      {cell("Win Rate", `${summary?.win_rate.toFixed(1) ?? "0.0"}%`, "var(--text)", `${summary ? Math.round((summary.win_rate/100)*((summary.open_count||0)+(summary.at_risk_count||0))) : 0}W / ${summary?.at_risk_count ?? 0}L all-time`)}
    </div>
  );
}

// ── Prob bar ───────────────────────────────────────────────────────────────────
function ProbBar({ prob, color }: { prob: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 60, height: 3, background: "var(--border2)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.round(prob * 100)}%`, background: color, borderRadius: 2, transition: "width 0.4s ease" }} />
      </div>
      <span style={{ color: "var(--muted2)", fontSize: 10 }}>{Math.round(prob * 100)}%</span>
    </div>
  );
}

// ── Position Detail sidebar ────────────────────────────────────────────────────
function PositionDetail({ pos, onClose }: { pos: LivePosition | null; onClose: (id: string) => void }) {
  if (!pos) {
    return (
      <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, lineHeight: 1.8 }}>
        ← Select a position<br />to view details
      </div>
    );
  }

  const pnl      = calcPnl(pos);
  const pct      = pnlPct(pos);
  const isPos    = pnl >= 0;
  const rawProg  = pos.side === "YES"
    ? (pos.liveProb - pos.entry_price) / (pos.exit_target - pos.entry_price)
    : (pos.entry_price - pos.liveProb) / (pos.entry_price - pos.exit_target);
  const progress = Math.max(0, Math.min(100, rawProg * 100));

  const item = (label: string, value: string, cls?: string) => (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 3, padding: "8px 10px" }}>
      <div style={{ fontSize: 8, letterSpacing: "0.12em", color: "var(--muted)", textTransform: "uppercase", marginBottom: 4, fontFamily: "IBM Plex Mono, monospace" }}>{label}</div>
      <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 13, fontWeight: 500, color: cls ?? "var(--text)" }}>{value}</div>
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginBottom: 12, lineHeight: 1.4 }}>
        {pos.market_title.length > 60 ? pos.market_title.slice(0, 60) + "…" : pos.market_title}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        {item("Side",         pos.side,                                   pos.side === "YES" ? "var(--yes)" : "var(--no)")}
        {item("Strategy",     pos.strategy,                               "var(--accent)")}
        {item("Entry Prob",   `${(pos.entry_price * 100).toFixed(0)}¢`)}
        {item("Current Prob", `${(pos.liveProb * 100).toFixed(0)}¢`,     isPos ? "var(--yes)" : "var(--no)")}
        {item("Exit Target",  `${(pos.exit_target * 100).toFixed(0)}¢`)}
        {item("Stop Loss",    pos.stop_loss ? `${(pos.stop_loss * 100).toFixed(0)}¢` : "—", "var(--no)")}
        {item("Shares",       pos.shares.toFixed(0))}
        {item("Capital",      `$${pos.capital.toFixed(0)}`)}
      </div>
      {/* PnL full-width */}
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 3, padding: "8px 10px", marginBottom: 8 }}>
        <div style={{ fontSize: 8, letterSpacing: "0.12em", color: "var(--muted)", textTransform: "uppercase", marginBottom: 4, fontFamily: "IBM Plex Mono, monospace" }}>Unrealized PnL</div>
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 18, fontWeight: 600, color: isPos ? "var(--yes)" : "var(--no)" }}>
          {fmtPnl(pnl)} <span style={{ fontSize: 12 }}>({fmtPct(pct)})</span>
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 3, padding: "8px 10px", marginBottom: 12 }}>
        <div style={{ fontSize: 8, letterSpacing: "0.12em", color: "var(--muted)", textTransform: "uppercase", marginBottom: 6, fontFamily: "IBM Plex Mono, monospace" }}>Target Progress</div>
        <div style={{ height: 4, background: "var(--border2)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "var(--accent)", borderRadius: 2, transition: "width 0.5s ease" }} />
        </div>
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
          {progress.toFixed(0)}% to exit target
        </div>
      </div>
      <button
        onClick={() => onClose(pos.id)}
        style={{
          width: "100%", padding: "8px 0", borderRadius: 3,
          border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.08)",
          color: "var(--no)", fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
          fontWeight: 600, cursor: "pointer", letterSpacing: "0.05em",
        }}
      >
        ⚠ Manual Close Position
      </button>
    </div>
  );
}

// ── Risk Gauges ────────────────────────────────────────────────────────────────
function RiskGauges({ positions }: { positions: LivePosition[] }) {
  const capital = positions.reduce((s, p) => s + p.capital, 0);
  const pnls    = positions.map(p => calcPnl(p));
  const worstPnl = pnls.length ? Math.min(...pnls) : 0;

  const drawdownPct     = capital > 0 ? Math.max(0, (-worstPnl / capital) * 100) : 0;
  const exposurePct     = Math.min(100, (capital / 25000) * 100);
  const maxPos          = positions.length ? Math.max(...positions.map(p => p.capital)) : 0;
  const concentrationPct = capital > 0 ? (maxPos / capital) * 100 : 0;
  const totalLoss       = pnls.reduce((s, v) => s + (v < 0 ? v : 0), 0);
  const dailyLossPct    = capital > 0 ? Math.max(0, (-totalLoss / capital) * 100) : 0;

  const gauge = (label: string, pct: number) => {
    const color = pct < 40 ? "var(--yes)" : pct < 70 ? "var(--accent2)" : "var(--no)";
    return (
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "var(--muted2)", width: 110 }}>{label}</div>
        <div style={{ flex: 1, height: 4, background: "var(--border2)", borderRadius: 2, margin: "0 10px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(100, pct).toFixed(0)}%`, background: color, borderRadius: 2, transition: "width 0.8s ease" }} />
        </div>
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color, width: 36, textAlign: "right" }}>
          {pct.toFixed(0)}%
        </div>
      </div>
    );
  };

  return (
    <>
      {gauge("Drawdown",     drawdownPct)}
      {gauge("Exposure",     exposurePct)}
      {gauge("Concentration", concentrationPct)}
      {gauge("Daily Loss",   dailyLossPct)}
    </>
  );
}

// ── Close Confirm Modal ────────────────────────────────────────────────────────
function CloseModal({ pos, onConfirm, onCancel }: {
  pos: LivePosition;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const pnl   = calcPnl(pos);
  const isPos = pnl >= 0;
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--surface)", border: "1px solid var(--border2)",
          borderRadius: 4, padding: 24, width: 340,
        }}
      >
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 12, fontWeight: 600, color: "var(--no)", marginBottom: 8, letterSpacing: "0.1em" }}>
          ⚠ MANUAL CLOSE
        </div>
        <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 16, lineHeight: 1.4 }}>
          {pos.market_title.length > 60 ? pos.market_title.slice(0, 60) + "…" : pos.market_title}
        </div>
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 3, padding: 12, marginBottom: 16, fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: "var(--muted2)", lineHeight: 1.8 }}>
          Side: <span style={{ color: "var(--text)" }}>{pos.side}</span><br />
          Entry: <span style={{ color: "var(--text)" }}>{(pos.entry_price * 100).toFixed(0)}¢</span> → Current: <span style={{ color: "var(--text)" }}>{(pos.liveProb * 100).toFixed(0)}¢</span><br />
          Shares: <span style={{ color: "var(--text)" }}>{pos.shares.toFixed(0)}</span><br />
          Est. PnL at close: <span style={{ color: isPos ? "var(--yes)" : "var(--no)", fontWeight: 600 }}>{fmtPnl(pnl)}</span>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, padding: "8px 16px", borderRadius: 3, cursor: "pointer", border: "1px solid var(--border2)", background: "none", color: "var(--muted2)" }}>
            Cancel
          </button>
          <button onClick={onConfirm} style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, padding: "8px 16px", borderRadius: 3, cursor: "pointer", border: "1px solid rgba(239,68,68,0.5)", background: "rgba(239,68,68,0.1)", color: "var(--no)", fontWeight: 600 }}>
            Close Position
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main PositionTracker ───────────────────────────────────────────────────────
type Filter = "all" | "YES" | "NO" | "winning" | "at-risk";

export default function PositionTracker() {
  const [positions,  setPositions]  = useState<Position[]>([]);
  const [liveProbs,  setLiveProbs]  = useState<Record<string, number>>({});
  const [summary,    setSummary]    = useState<PositionSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter,     setFilter]     = useState<Filter>("all");
  const [closingId,  setClosingId]  = useState<string | null>(null);
  const [log,        setLog]        = useState<LogEntry[]>([]);

  const posRef = useRef(positions);
  posRef.current = positions;

  const addLog = useCallback((msg: string) => {
    const time = new Date().toTimeString().slice(0, 8);
    setLog(prev => [{ time, msg }, ...prev].slice(0, 10));
  }, []);

  // ── Poll backend ──────────────────────────────────────────────────────────────
  const loadPositions = useCallback(async () => {
    try {
      const [posRes, sumRes] = await Promise.all([
        fetch("/api/positions"),
        fetch("/api/positions/summary"),
      ]);
      if (!posRes.ok || !sumRes.ok) return;
      const [posData, sumData] = await Promise.all([posRes.json(), sumRes.json()]);
      const incoming: Position[] = posData.positions ?? [];

      // Initialise liveProbs for new positions only
      setLiveProbs(prev => {
        const next = { ...prev };
        incoming.forEach(p => {
          if (!(p.id in next)) next[p.id] = p.current_prob;
        });
        // Remove closed positions
        const ids = new Set(incoming.map(p => p.id));
        Object.keys(next).forEach(k => { if (!ids.has(k)) delete next[k]; });
        return next;
      });

      setPositions(incoming);
      setSummary(sumData);
    } catch { /* keep existing */ }
  }, []);

  useEffect(() => {
    loadPositions();
    const id = setInterval(loadPositions, 5000);
    return () => clearInterval(id);
  }, [loadPositions]);

  // ── Live prob tick (every 2s) ─────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setLiveProbs(prev => {
        const next = { ...prev };
        posRef.current.forEach(p => {
          if (p.id in next) {
            const drift = (Math.random() - 0.49) * 0.006;
            next[p.id] = Math.max(0.02, Math.min(0.98, next[p.id] + drift));
          }
        });
        return next;
      });
    }, 2000);
    return () => clearInterval(id);
  }, []);

  // ── Build live positions ──────────────────────────────────────────────────────
  const livePositions: LivePosition[] = positions.map(p => ({
    ...p,
    liveProb: liveProbs[p.id] ?? p.current_prob,
  }));

  // ── Filter ────────────────────────────────────────────────────────────────────
  const filtered = livePositions.filter(p => {
    if (filter === "YES")      return p.side === "YES";
    if (filter === "NO")       return p.side === "NO";
    if (filter === "winning")  return calcPnl(p) >= 0;
    if (filter === "at-risk")  return calcPnl(p) < 0;
    return true;
  });

  const selectedPos = livePositions.find(p => p.id === selectedId) ?? null;

  // ── Close position ────────────────────────────────────────────────────────────
  const handleConfirmClose = async () => {
    if (!closingId) return;
    const pos = livePositions.find(p => p.id === closingId);
    const res = await fetch(`/api/positions/${closingId}/close`, { method: "POST" });
    if (res.ok) {
      addLog(`Closed <b>${pos?.market_title.slice(0, 40) ?? closingId}</b> · PnL: ${pos ? fmtPnl(calcPnl(pos)) : "—"}`);
      if (selectedId === closingId) setSelectedId(null);
      await loadPositions();
    }
    setClosingId(null);
  };

  // ── Column headers ────────────────────────────────────────────────────────────
  const TH = (label: string) => (
    <th key={label} style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, letterSpacing: "0.1em", color: "var(--muted)", textTransform: "uppercase", padding: "8px 16px", textAlign: "left", borderBottom: "1px solid var(--border)", background: "var(--bg)", whiteSpace: "nowrap", position: "sticky", top: 45 }}>
      {label}
    </th>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", zIndex: 1 }}>

      {/* PnL Bar */}
      <PnLBar positions={livePositions} summary={summary} />

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", flex: 1, overflow: "hidden" }}>

        {/* Left: positions table */}
        <div style={{ overflow: "auto", borderRight: "1px solid var(--border)" }}>
          {/* Table header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface)", position: "sticky", top: 0, zIndex: 10 }}>
            <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, letterSpacing: "0.15em", color: "var(--muted2)", textTransform: "uppercase" }}>
              Open Positions
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["all", "YES", "NO", "winning", "at-risk"] as Filter[]).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, padding: "3px 8px", border: `1px solid ${filter === f ? "rgba(0,212,168,0.4)" : "var(--border2)"}`, borderRadius: 2, background: filter === f ? "rgba(0,212,168,0.08)" : "none", color: filter === f ? "var(--accent)" : "var(--muted2)", cursor: "pointer" }}>
                  {f === "at-risk" ? "At-Risk" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace", fontSize: 11 }}>
              {positions.length === 0
                ? "No open positions — approve a signal to open one"
                : "No positions match the current filter"}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Market", "Side", "Entry", "Current", "Prob", "Shares", "PnL", "PnL%", "Strategy", ""].map(TH)}</tr></thead>
              <tbody>
                {filtered.map(pos => {
                  const pnl   = calcPnl(pos);
                  const pct   = pnlPct(pos);
                  const isPos = pnl >= 0;
                  const probColor = pos.side === "YES"
                    ? (pos.liveProb > pos.entry_price ? "var(--yes)" : "var(--no)")
                    : (pos.liveProb < pos.entry_price ? "var(--yes)" : "var(--no)");

                  return (
                    <tr
                      key={pos.id}
                      onClick={() => setSelectedId(pos.id)}
                      style={{
                        borderBottom: "1px solid var(--border)", cursor: "pointer",
                        background: selectedId === pos.id ? "#0d1a24" : "transparent",
                        borderLeft: selectedId === pos.id ? "2px solid var(--accent)" : "2px solid transparent",
                      }}
                    >
                      <td style={{ padding: "10px 16px", maxWidth: 220 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: 11 }}>
                          {pos.market_title.length > 45 ? pos.market_title.slice(0, 45) + "…" : pos.market_title}
                        </div>
                        <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace", marginTop: 2 }}>
                          {pos.strategy} · {pos.entry_date.slice(0, 10)}
                        </div>
                      </td>
                      <td style={{ padding: "10px 16px" }}>
                        <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 2, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", background: pos.side === "YES" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", color: pos.side === "YES" ? "var(--yes)" : "var(--no)", border: `1px solid ${pos.side === "YES" ? "#22c55e44" : "#ef444444"}` }}>
                          {pos.side}
                        </span>
                      </td>
                      <td style={{ padding: "10px 16px", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: "var(--muted2)" }}>
                        {(pos.entry_price * 100).toFixed(0)}¢
                      </td>
                      <td style={{ padding: "10px 16px", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 500, color: probColor }}>
                        {(pos.liveProb * 100).toFixed(0)}¢
                      </td>
                      <td style={{ padding: "10px 16px" }}>
                        <ProbBar prob={pos.liveProb} color={probColor} />
                      </td>
                      <td style={{ padding: "10px 16px", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: "var(--muted2)" }}>
                        {pos.shares.toFixed(0)}
                      </td>
                      <td style={{ padding: "10px 16px", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 500, color: isPos ? "var(--yes)" : "var(--no)" }}>
                        {fmtPnl(pnl)}
                      </td>
                      <td style={{ padding: "10px 16px", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 500, color: isPos ? "var(--yes)" : "var(--no)" }}>
                        {fmtPct(pct)}
                      </td>
                      <td style={{ padding: "10px 16px", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "var(--muted)" }}>
                        {pos.strategy}
                      </td>
                      <td style={{ padding: "10px 16px" }}>
                        <button
                          onClick={e => { e.stopPropagation(); setClosingId(pos.id); }}
                          style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, padding: "3px 8px", border: "1px solid var(--border2)", borderRadius: 2, background: "none", color: "var(--muted)", cursor: "pointer", letterSpacing: "0.05em" }}
                          onMouseEnter={e => { (e.target as HTMLElement).style.color = "var(--no)"; (e.target as HTMLElement).style.borderColor = "#ef444466"; }}
                          onMouseLeave={e => { (e.target as HTMLElement).style.color = "var(--muted)"; (e.target as HTMLElement).style.borderColor = "var(--border2)"; }}
                        >
                          CLOSE
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Right: sidebar */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "auto", background: "var(--surface)" }}>

          {/* Position Detail */}
          <div style={{ padding: 16, borderBottom: "1px solid var(--border)", flex: 1 }}>
            <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, letterSpacing: "0.15em", color: "var(--muted)", textTransform: "uppercase", marginBottom: 12 }}>
              Position Detail
            </div>
            <PositionDetail pos={selectedPos} onClose={id => setClosingId(id)} />
          </div>

          {/* Risk Gauges */}
          <div style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, letterSpacing: "0.15em", color: "var(--muted)", textTransform: "uppercase", marginBottom: 12 }}>
              Risk Gauges
            </div>
            <RiskGauges positions={livePositions} />
          </div>

          {/* Activity Log */}
          <div style={{ padding: 16 }}>
            <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, letterSpacing: "0.15em", color: "var(--muted)", textTransform: "uppercase", marginBottom: 12 }}>
              Activity Log
            </div>
            {log.length === 0 ? (
              <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace" }}>No activity yet</div>
            ) : (
              log.map((entry, i) => (
                <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, fontFamily: "IBM Plex Mono, monospace", fontSize: 10 }}>
                  <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{entry.time}</span>
                  <span style={{ color: "var(--muted2)", lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: entry.msg }} />
                </div>
              ))
            )}
          </div>

        </div>
      </div>

      {/* Close modal */}
      {closingId && (() => {
        const pos = livePositions.find(p => p.id === closingId);
        return pos ? (
          <CloseModal pos={pos} onConfirm={handleConfirmClose} onCancel={() => setClosingId(null)} />
        ) : null;
      })()}
    </div>
  );
}
