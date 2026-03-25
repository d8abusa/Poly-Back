import { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine
} from "recharts";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClosedPosition {
  id: number;
  market: string;
  category: string;
  side: "YES" | "NO";
  entry_prob: number;
  exit_prob: number;
  shares: number;
  strategy: string;
  opened_at: string;
  closed_at: string;
  realized_pnl: number;
  close_reason: "target" | "stop_loss" | "manual" | "resolution";
}


// ─── Helpers ─────────────────────────────────────────────────────────────────

const STRATEGY_COLORS: Record<string, string> = {
  "Prob Drift": "#00d4a8",
  "Mean Rev":   "#7b61ff",
  "Momentum":   "#f59e0b",
  "Anchor":     "#22c55e",
};

const REASON_LABELS: Record<string, { label: string; color: string }> = {
  target:            { label: "Target Hit",   color: "#22c55e" },
  stop_loss:         { label: "Stop Loss",    color: "#ef4444" },
  manual:            { label: "Manual",       color: "#f59e0b" },
  manual_kill_switch:{ label: "Kill Switch",  color: "#ef4444" },
  resolution:        { label: "Resolved",     color: "#00d4a8" },
};
const DEFAULT_REASON = { label: "Closed", color: "#8892a4" };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtPnl(n: number) {
  return (n >= 0 ? "+" : "") + "$" + Math.abs(n).toFixed(2);
}

// Custom tooltip for charts
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0d1117", border: "1px solid #1e2a35", padding: "8px 12px", borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
      <div style={{ color: "#8892a4", marginBottom: 4 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color || "#e8eaf0" }}>{p.name}: {typeof p.value === "number" && p.name?.includes("PnL") ? fmtPnl(p.value) : p.value}</div>
      ))}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HistoryView() {
  const [history, setHistory] = useState<ClosedPosition[]>([]);
  const [filterStrategy, setFilterStrategy] = useState<string>("All");
  const [filterReason, setFilterReason]     = useState<string>("All");
  const [sortKey, setSortKey]               = useState<"closed_at" | "realized_pnl">("closed_at");
  const [selectedId, setSelectedId]         = useState<number | null>(null);

  // Fetch real closed positions from the API
  useEffect(() => {
    fetch("/api/positions/closed")
      .then(r => r.ok ? r.json() : [])
      .then((data: ClosedPosition[]) => setHistory(Array.isArray(data) ? data : []))
      .catch(() => setHistory([]));
  }, []);

  // ── Derived stats ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return history
      .filter(p => filterStrategy === "All" || p.strategy === filterStrategy)
      .filter(p => filterReason   === "All" || p.close_reason === filterReason)
      .sort((a, b) => sortKey === "closed_at"
        ? new Date(b.closed_at).getTime() - new Date(a.closed_at).getTime()
        : b.realized_pnl - a.realized_pnl);
  }, [history, filterStrategy, filterReason, sortKey]);

  const totalPnl   = history.reduce((s, p) => s + p.realized_pnl, 0);
  const wins       = history.filter(p => p.realized_pnl > 0);
  const losses     = history.filter(p => p.realized_pnl <= 0);
  const winRate    = history.length ? (wins.length / history.length * 100).toFixed(1) : "0";
  const avgWin     = wins.length   ? wins.reduce((s,p) => s + p.realized_pnl, 0) / wins.length : 0;
  const avgLoss    = losses.length ? losses.reduce((s,p) => s + p.realized_pnl, 0) / losses.length : 0;
  const profitFactor = Math.abs(avgLoss) > 0 ? (avgWin / Math.abs(avgLoss)).toFixed(2) : "∞";

  // ── Cumulative PnL curve ──────────────────────────────────────────────────

  const pnlCurve = useMemo(() => {
    const sorted = [...history].sort((a,b) => new Date(a.closed_at).getTime() - new Date(b.closed_at).getTime());
    let cum = 0;
    return sorted.map(p => {
      cum += p.realized_pnl;
      return { date: fmtDate(p.closed_at), cumPnl: parseFloat(cum.toFixed(2)), tradePnl: p.realized_pnl };
    });
  }, [history]);

  // ── Strategy breakdown ────────────────────────────────────────────────────

  const stratBreakdown = useMemo(() => {
    const map: Record<string, { trades: number; pnl: number; wins: number }> = {};
    history.forEach(p => {
      if (!map[p.strategy]) map[p.strategy] = { trades: 0, pnl: 0, wins: 0 };
      map[p.strategy].trades++;
      map[p.strategy].pnl += p.realized_pnl;
      if (p.realized_pnl > 0) map[p.strategy].wins++;
    });
    return Object.entries(map).map(([name, v]) => ({
      name,
      trades: v.trades,
      pnl: parseFloat(v.pnl.toFixed(2)),
      winRate: parseFloat((v.wins / v.trades * 100).toFixed(1)),
      color: STRATEGY_COLORS[name] || "#8892a4",
    }));
  }, [history]);

  // ── Selected position ─────────────────────────────────────────────────────

  const selected = history.find(p => p.id === selectedId);

  // ── Render ────────────────────────────────────────────────────────────────

  const strategies = ["All", ...Array.from(new Set(history.map(p => p.strategy)))];
  const reasons    = ["All", ...Array.from(new Set(history.map(p => p.close_reason)))];

  return (
    <div style={styles.root}>

      {/* ── Stats Bar ── */}
      <div style={styles.statsBar}>
        {[
          { label: "Total Realized PnL", value: fmtPnl(totalPnl), cls: totalPnl >= 0 ? "pos" : "neg" },
          { label: "Total Trades",        value: history.length,   cls: "neutral" },
          { label: "Win Rate",            value: `${winRate}%`,    cls: "neutral" },
          { label: "Avg Win",             value: fmtPnl(avgWin),   cls: "pos" },
          { label: "Avg Loss",            value: fmtPnl(avgLoss),  cls: "neg" },
          { label: "Profit Factor",       value: profitFactor,     cls: parseFloat(profitFactor as string) >= 1.5 ? "pos" : "neutral" },
        ].map((s, i) => (
          <div key={i} style={styles.statCell}>
            <div style={styles.statLabel}>{s.label}</div>
            <div style={{ ...styles.statValue, color: s.cls === "pos" ? "#22c55e" : s.cls === "neg" ? "#ef4444" : "#e8eaf0" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Charts Row ── */}
      <div style={styles.chartsRow}>

        {/* Cumulative PnL */}
        <div style={{ ...styles.chartCard, flex: 2 }}>
          <div style={styles.chartTitle}>CUMULATIVE PNL</div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={pnlCurve} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#00d4a8" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00d4a8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: "#4a5568", fontSize: 9, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#4a5568", fontSize: 9, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
              <ReferenceLine y={0} stroke="#1e2a35" strokeDasharray="3 3" />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="cumPnl" name="Cumulative PnL" stroke="#00d4a8" strokeWidth={2} fill="url(#pnlGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Strategy PnL bars */}
        <div style={{ ...styles.chartCard, flex: 1 }}>
          <div style={styles.chartTitle}>PNL BY STRATEGY</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={stratBreakdown} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fill: "#4a5568", fontSize: 9, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#4a5568", fontSize: 9, fontFamily: "IBM Plex Mono" }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
              <ReferenceLine y={0} stroke="#1e2a35" />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="pnl" name="PnL" radius={[2,2,0,0]}>
                {stratBreakdown.map((s, i) => (
                  <Cell key={i} fill={s.pnl >= 0 ? s.color : "#ef4444"} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Strategy table */}
        <div style={{ ...styles.chartCard, flex: 1 }}>
          <div style={styles.chartTitle}>STRATEGY BREAKDOWN</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Strategy","Trades","PnL","W%"].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stratBreakdown.map((s, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #1e2a35" }}>
                  <td style={{ ...styles.td, color: s.color }}>{s.name}</td>
                  <td style={styles.td}>{s.trades}</td>
                  <td style={{ ...styles.td, color: s.pnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtPnl(s.pnl)}</td>
                  <td style={{ ...styles.td, color: s.winRate >= 60 ? "#22c55e" : "#f59e0b" }}>{s.winRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>

      {/* ── Trade Log + Detail ── */}
      <div style={styles.bottomRow}>

        {/* Filters + Table */}
        <div style={styles.tablePanel}>
          <div style={styles.tableHeader}>
            <div style={styles.panelTitle}>TRADE LOG</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>

              {/* Strategy filter */}
              <div style={{ display: "flex", gap: 4 }}>
                {strategies.map(s => (
                  <button key={s} onClick={() => setFilterStrategy(s)}
                    style={{ ...styles.filterBtn, ...(filterStrategy === s ? styles.filterBtnActive : {}) }}>
                    {s}
                  </button>
                ))}
              </div>

              {/* Reason filter */}
              <div style={{ display: "flex", gap: 4 }}>
                {reasons.map(r => (
                  <button key={r} onClick={() => setFilterReason(r)}
                    style={{ ...styles.filterBtn, ...(filterReason === r ? styles.filterBtnActive : {}),
                      color: r !== "All" ? REASON_LABELS[r]?.color : undefined }}>
                    {r === "All" ? "All Exits" : REASON_LABELS[r]?.label}
                  </button>
                ))}
              </div>

              {/* Sort */}
              <button onClick={() => setSortKey(k => k === "closed_at" ? "realized_pnl" : "closed_at")}
                style={{ ...styles.filterBtn, color: "#00d4a8", borderColor: "#00d4a855" }}>
                Sort: {sortKey === "closed_at" ? "Date ↓" : "PnL ↓"}
              </button>
            </div>
          </div>

          <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
            {history.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "#4a5568", fontFamily: "IBM Plex Mono", fontSize: 11, lineHeight: 2 }}>
                No closed trades yet.<br />
                <span style={{ fontSize: 10 }}>Positions appear here after they close (target hit, stop loss, or manual close).</span>
              </div>
            ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Market", "Side", "Strategy", "Entry", "Exit", "Shares", "PnL", "Exit Reason", "Closed"].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(pos => {
                  const isPos = pos.realized_pnl >= 0;
                  const reason = REASON_LABELS[pos.close_reason] ?? DEFAULT_REASON;
                  return (
                    <tr key={pos.id}
                      onClick={() => setSelectedId(id => id === pos.id ? null : pos.id)}
                      style={{
                        ...styles.tableRow,
                        background: selectedId === pos.id ? "#0d1a24" : undefined,
                        borderLeft: selectedId === pos.id ? "2px solid #00d4a8" : "2px solid transparent",
                      }}>
                      <td style={{ ...styles.td, maxWidth: 220 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#e8eaf0", fontFamily: "IBM Plex Sans, sans-serif", fontWeight: 500 }}>
                          {pos.market}
                        </div>
                        <div style={{ fontSize: 9, color: "#4a5568", fontFamily: "IBM Plex Mono" }}>{pos.category}</div>
                      </td>
                      <td style={styles.td}>
                        <span style={{ ...styles.sideBadge, ...(pos.side === "YES" ? styles.sideYes : styles.sideNo) }}>{pos.side}</span>
                      </td>
                      <td style={{ ...styles.td, color: STRATEGY_COLORS[pos.strategy] || "#8892a4" }}>{pos.strategy}</td>
                      <td style={{ ...styles.td, color: "#8892a4" }}>{(pos.entry_prob * 100).toFixed(0)}¢</td>
                      <td style={{ ...styles.td, color: isPos ? "#22c55e" : "#ef4444" }}>{(pos.exit_prob * 100).toFixed(0)}¢</td>
                      <td style={styles.td}>{pos.shares}</td>
                      <td style={{ ...styles.td, color: isPos ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{fmtPnl(pos.realized_pnl)}</td>
                      <td style={styles.td}>
                        <span style={{ ...styles.reasonBadge, color: reason.color, borderColor: reason.color + "44", background: reason.color + "15" }}>
                          {reason.label}
                        </span>
                      </td>
                      <td style={{ ...styles.td, color: "#4a5568" }}>{fmtDate(pos.closed_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>
        </div>

        {/* Position Detail */}
        <div style={styles.detailPanel}>
          <div style={styles.panelTitle}>TRADE DETAIL</div>
          {selected ? (
            <div>
              <div style={{ fontSize: 13, fontFamily: "IBM Plex Sans", fontWeight: 500, color: "#e8eaf0", marginBottom: 14, lineHeight: 1.5 }}>
                {selected.market}
              </div>
              <div style={styles.detailGrid}>
                {[
                  { label: "Side",      value: selected.side,                               color: selected.side === "YES" ? "#22c55e" : "#ef4444" },
                  { label: "Strategy",  value: selected.strategy,                           color: STRATEGY_COLORS[selected.strategy] },
                  { label: "Entry",     value: `${(selected.entry_prob*100).toFixed(0)}¢`,  color: "#e8eaf0" },
                  { label: "Exit",      value: `${(selected.exit_prob*100).toFixed(0)}¢`,   color: selected.realized_pnl >= 0 ? "#22c55e" : "#ef4444" },
                  { label: "Shares",    value: selected.shares,                             color: "#e8eaf0" },
                  { label: "Capital",   value: `$${(selected.entry_prob * selected.shares).toFixed(0)}`, color: "#e8eaf0" },
                  { label: "Exit Type", value: (REASON_LABELS[selected.close_reason] ?? DEFAULT_REASON).label,  color: (REASON_LABELS[selected.close_reason] ?? DEFAULT_REASON).color },
                  { label: "Category",  value: selected.category,                           color: "#8892a4" },
                ].map((item, i) => (
                  <div key={i} style={styles.detailItem}>
                    <div style={styles.detailLabel}>{item.label}</div>
                    <div style={{ ...styles.detailValue, color: item.color }}>{item.value}</div>
                  </div>
                ))}
                <div style={{ ...styles.detailItem, gridColumn: "1 / -1" }}>
                  <div style={styles.detailLabel}>Realized PnL</div>
                  <div style={{ ...styles.detailValue, fontSize: 22, color: selected.realized_pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                    {fmtPnl(selected.realized_pnl)}
                    <span style={{ fontSize: 12, color: "#8892a4", marginLeft: 8 }}>
                      ({((selected.realized_pnl / (selected.entry_prob * selected.shares)) * 100).toFixed(1)}%)
                    </span>
                  </div>
                </div>
                <div style={{ ...styles.detailItem, gridColumn: "1 / -1" }}>
                  <div style={styles.detailLabel}>Holding Period</div>
                  <div style={{ ...styles.detailValue, color: "#8892a4" }}>
                    {Math.round((new Date(selected.closed_at).getTime() - new Date(selected.opened_at).getTime()) / (1000 * 60 * 60 * 24))} days
                    <span style={{ color: "#4a5568", fontSize: 10, marginLeft: 8 }}>
                      {fmtDate(selected.opened_at)} → {fmtDate(selected.closed_at)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: "#4a5568", fontFamily: "IBM Plex Mono", fontSize: 11, textAlign: "center", paddingTop: 40, lineHeight: 2 }}>
              ← Select a trade<br />to view details
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    background: "#080a0d",
    overflow: "hidden",
    fontFamily: "'IBM Plex Mono', monospace",
  },
  statsBar: {
    display: "grid",
    gridTemplateColumns: "repeat(6, 1fr)",
    borderBottom: "1px solid #1e2a35",
    background: "#0d1117",
    flexShrink: 0,
  },
  statCell: {
    padding: "14px 20px",
    borderRight: "1px solid #1e2a35",
  },
  statLabel: {
    fontSize: 9,
    letterSpacing: "0.15em",
    color: "#4a5568",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 600,
    lineHeight: 1,
  },
  chartsRow: {
    display: "flex",
    gap: 0,
    borderBottom: "1px solid #1e2a35",
    background: "#0d1117",
    height: 180
  },
  chartCard: {
    padding: "14px 16px",
    borderRight: "1px solid #1e2a35",
  },
  chartTitle: {
    fontSize: 9,
    letterSpacing: "0.15em",
    color: "#4a5568",
    textTransform: "uppercase",
    marginBottom: 10,
  },
  th: {
    fontSize: 9,
    letterSpacing: "0.1em",
    color: "#4a5568",
    textTransform: "uppercase",
    padding: "8px 12px",
    textAlign: "left" as const,
    borderBottom: "1px solid #1e2a35",
    whiteSpace: "nowrap" as const,
    background: "#080a0d",
    fontWeight: 400,
  },
  td: {
    padding: "10px 12px",
    fontSize: 11,
    color: "#8892a4",
    whiteSpace: "nowrap" as const,
  },
  bottomRow: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  tablePanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRight: "1px solid #1e2a35",
  },
  tableHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    borderBottom: "1px solid #1e2a35",
    background: "#0d1117",
    flexShrink: 0,
    gap: 12,
    flexWrap: "wrap" as const,
  },
  panelTitle: {
    fontSize: 9,
    letterSpacing: "0.15em",
    color: "#4a5568",
    textTransform: "uppercase" as const,
  },
  filterBtn: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    padding: "3px 10px",
    border: "1px solid #1e2a35",
    borderRadius: 2,
    background: "none",
    color: "#8892a4",
    cursor: "pointer",
    letterSpacing: "0.05em",
  },
  filterBtnActive: {
    color: "#00d4a8",
    borderColor: "#00d4a855",
    background: "#00d4a815",
  },
  tableRow: {
    borderBottom: "1px solid #1e2a35",
    cursor: "pointer",
    transition: "background 0.1s",
  },
  sideBadge: {
    display: "inline-block",
    padding: "2px 7px",
    borderRadius: 2,
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: "0.1em",
    border: "1px solid",
  },
  sideYes: {
    background: "#22c55e15",
    color: "#22c55e",
    borderColor: "#22c55e44",
  },
  sideNo: {
    background: "#ef444415",
    color: "#ef4444",
    borderColor: "#ef444444",
  },
  reasonBadge: {
    display: "inline-block",
    padding: "2px 7px",
    borderRadius: 2,
    fontSize: 9,
    letterSpacing: "0.05em",
    border: "1px solid",
  },
  detailPanel: {
    width: 280,
    padding: 16,
    background: "#0d1117",
    overflowY: "auto" as const,
    flexShrink: 0,
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },
  detailItem: {
    background: "#131920",
    border: "1px solid #1e2a35",
    borderRadius: 3,
    padding: "8px 10px",
  },
  detailLabel: {
    fontSize: 8,
    letterSpacing: "0.12em",
    color: "#4a5568",
    textTransform: "uppercase" as const,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: 500,
    color: "#e8eaf0",
  },
};
