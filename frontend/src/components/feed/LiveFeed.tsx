import { useState, useEffect, useRef } from "react";
import type { Market } from "../../types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrderLevel { price: number; size: number; }

interface Trade {
  price:      number;
  size:       number;
  side:       string;
  match_time: string;
}

interface MarketInfo {
  title:    string;
  active:   boolean;
  closed:   boolean;
  end_date: string;
  outcome:  string | null;
}

interface Snapshot {
  last_price:    number | null;
  midpoint:      number | null;
  best_bid:      number | null;
  best_ask:      number | null;
  spread:        number | null;
  bids:          OrderLevel[];
  asks:          OrderLevel[];
  recent_trades: Trade[];
  market:        MarketInfo;
}

interface LiveFeedProps {
  markets:  Market[];
  exchange: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number | null) {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}¢`;
}

function fmtSize(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0);
}

function fmtTime(iso: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ""; }
}

const POLL_MS = 8000;

// ── Sub-components ────────────────────────────────────────────────────────────

function StatBar({ snap }: { snap: Snapshot }) {
  const statusColor = snap.market.closed ? "#ef4444" : snap.market.active ? "#22c55e" : "#f59e0b";
  const statusLabel = snap.market.closed
    ? (snap.market.outcome ? `Resolved · ${snap.market.outcome}` : "Resolved")
    : snap.market.active ? "Active" : "Paused";

  const cells = [
    { label: "Status",     value: statusLabel,             color: statusColor },
    { label: "Last Trade", value: pct(snap.last_price),    color: "var(--text)" },
    { label: "Midpoint",   value: pct(snap.midpoint),      color: "var(--accent)" },
    { label: "Best Bid",   value: pct(snap.best_bid),      color: "#22c55e" },
    { label: "Best Ask",   value: pct(snap.best_ask),      color: "#ef4444" },
    { label: "Spread",     value: pct(snap.spread),        color: "var(--muted2)" },
  ];
  if (snap.market.end_date) {
    cells.push({
      label: "End Date",
      value: new Date(snap.market.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      color: "var(--muted2)",
    });
  }

  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0, overflowX: "auto" }}>
      {cells.map((c, i) => (
        <div key={i} style={{ padding: "10px 16px", borderRight: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ fontSize: 8, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>{c.label}</div>
          <div style={{ fontSize: 13, fontFamily: "IBM Plex Mono, monospace", fontWeight: 600, color: c.color }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function OrderBook({ bids, asks }: { bids: OrderLevel[]; asks: OrderLevel[] }) {
  const maxSize = Math.max(...[...bids, ...asks].map(l => l.size), 1);
  const Row = ({ level, side }: { level: OrderLevel; side: "bid" | "ask" }) => {
    const color = side === "bid" ? "#22c55e" : "#ef4444";
    return (
      <div style={{ display: "grid", gridTemplateColumns: "56px 56px 1fr", gap: 6, padding: "3px 14px", alignItems: "center", fontFamily: "IBM Plex Mono, monospace", fontSize: 10 }}>
        <span style={{ color }}>{pct(level.price)}</span>
        <span style={{ color: "var(--muted2)" }}>{fmtSize(level.size)}</span>
        <div style={{ position: "relative", height: 8 }}>
          <div style={{
            position: "absolute", top: 0, height: "100%",
            [side === "bid" ? "left" : "right"]: 0,
            width: `${(level.size / maxSize) * 100}%`,
            background: side === "bid" ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)",
            borderRadius: 1,
          }} />
        </div>
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "56px 56px 1fr", gap: 6, padding: "6px 14px 4px", fontSize: 8, color: "var(--muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
        <span>Price</span><span>Size</span><span>Depth</span>
      </div>
      {[...asks].reverse().map((a, i) => <Row key={`a${i}`} level={a} side="ask" />)}
      <div style={{ margin: "4px 14px", borderTop: "1px dashed var(--border2)", display: "flex", justifyContent: "center", paddingTop: 3 }}>
        <span style={{ fontSize: 8, color: "var(--muted)", fontFamily: "IBM Plex Mono", letterSpacing: "0.1em" }}>SPREAD</span>
      </div>
      {bids.map((b, i) => <Row key={`b${i}`} level={b} side="bid" />)}
    </div>
  );
}

function TradeStream({ trades }: { trades: Trade[] }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "24px 56px 56px 1fr", gap: 6, padding: "6px 14px 4px", fontSize: 8, color: "var(--muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
        <span /><span>Price</span><span>Size</span><span>Time</span>
      </div>
      {trades.length === 0 && (
        <div style={{ padding: "16px 14px", color: "var(--muted)", fontSize: 10, fontFamily: "IBM Plex Mono" }}>No recent trades</div>
      )}
      {trades.map((t, i) => {
        const isBuy = t.side?.toUpperCase() === "BUY";
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "24px 56px 56px 1fr", gap: 6, padding: "3px 14px", alignItems: "center", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, opacity: Math.max(0.35, 1 - i * 0.05) }}>
            <span style={{ color: isBuy ? "#22c55e" : "#ef4444", fontWeight: 700 }}>{isBuy ? "B" : "S"}</span>
            <span style={{ color: isBuy ? "#22c55e" : "#ef4444" }}>{pct(t.price)}</span>
            <span style={{ color: "var(--muted2)" }}>{fmtSize(t.size)}</span>
            <span style={{ color: "var(--muted)" }}>{fmtTime(t.match_time)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function LiveFeed({ markets, exchange }: LiveFeedProps) {
  const [search, setSearch]           = useState("");
  const [showActive, setShowActive]   = useState(true);
  const [activeMarkets, setActiveMarkets] = useState<Market[]>([]);
  const [selected, setSelected]       = useState<Market | null>(null);
  const [snapshot, setSnapshot]       = useState<Snapshot | null>(null);
  const [loading, setLoading]         = useState(false);
  const [lastPollAt, setLastPollAt]   = useState<Date | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch active markets independently for the feed
  useEffect(() => {
    fetch(`/api/markets?limit=100&order=volumeNum&active=true&closed=false&exchange=${exchange}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.markets && setActiveMarkets(d.markets))
      .catch(() => {});
  }, [exchange]);

  const pool = showActive ? activeMarkets : markets;

  const filtered = pool.filter(m => {
    if (!search) return true;
    return m.title.toLowerCase().includes(search.toLowerCase()) ||
           (m.condition_id ?? "").includes(search);
  });

  const poll = async (market: Market) => {
    setLoading(true);
    setError(null);
    try {
      const mid = market.id;
      const tid = market.token_id ?? market.id;
      const cid = market.condition_id ?? market.id;
      const url = `/api/feed/snapshot?market_id=${encodeURIComponent(mid)}&token_id=${encodeURIComponent(tid)}&condition_id=${encodeURIComponent(cid)}&exchange=${exchange}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSnapshot(await r.json());
      setLastPollAt(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const select = (market: Market) => {
    setSelected(market);
    setSnapshot(null);
    setError(null);
    if (timerRef.current) clearInterval(timerRef.current);
    poll(market);
    timerRef.current = setInterval(() => poll(market), POLL_MS);
  };

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  // Clear selection when exchange changes
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setSelected(null);
    setSnapshot(null);
    setError(null);
    setActiveMarkets([]);
  }, [exchange]);

  // Auto-select first active market once activeMarkets loads
  useEffect(() => {
    if (!selected && activeMarkets.length > 0) {
      const first = activeMarkets[0];
      select(first);
    }
  }, [activeMarkets.length]);

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative", zIndex: 1 }}>

      {/* ── Left: market list ── */}
      <div style={{ width: 280, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden" }}>

        {/* Search */}
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search markets…"
            style={{
              width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)",
              borderRadius: 5, padding: "6px 10px", color: "var(--text)",
              fontFamily: "IBM Plex Mono, monospace", fontSize: 11, outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 4, padding: "6px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          {(["Active", "All"] as const).map(opt => {
            const on = opt === "Active" ? showActive : !showActive;
            return (
              <button key={opt} onClick={() => setShowActive(opt === "Active")} style={{
                padding: "2px 10px", borderRadius: 3, cursor: "pointer", fontSize: 9,
                fontFamily: "IBM Plex Mono, monospace", letterSpacing: "0.08em",
                border: `1px solid ${on ? "rgba(0,212,168,0.4)" : "var(--border2)"}`,
                background: on ? "rgba(0,212,168,0.08)" : "var(--surface2)",
                color: on ? "var(--accent)" : "var(--muted)",
              }}>{opt}</button>
            );
          })}
          <span style={{ marginLeft: "auto", fontSize: 8, color: "var(--muted)", alignSelf: "center", fontFamily: "IBM Plex Mono" }}>
            {filtered.length} markets
          </span>
        </div>

        {/* Market list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.map(m => {
            const active = selected?.id === m.id;
            return (
              <div
                key={m.id}
                onClick={() => select(m)}
                style={{
                  padding: "9px 12px", borderBottom: "1px solid var(--border)",
                  cursor: "pointer", transition: "background 0.1s",
                  background: active ? "rgba(0,212,168,0.05)" : undefined,
                  borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                }}
              >
                <div style={{
                  fontSize: 11, color: "var(--text)", lineHeight: 1.35, marginBottom: 3,
                  overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box",
                  WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                }}>
                  {m.title}
                </div>
                <div style={{ display: "flex", gap: 8, fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>
                  <span style={{ color: m.prob >= 0.6 ? "#22c55e" : m.prob <= 0.4 ? "#ef4444" : "var(--accent)" }}>
                    {(m.prob * 100).toFixed(0)}¢
                  </span>
                  <span>{m.category}</span>
                  {m.resolved && <span style={{ color: "#ef4444" }}>resolved</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right: live data ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {!selected ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, opacity: 0.15, marginBottom: 10 }}>📡</div>
              <div style={{ fontSize: 12, color: "var(--muted2)" }}>Select a market to watch</div>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 14, fontFamily: "Instrument Serif, serif", fontStyle: "italic", color: "var(--text)", lineHeight: 1.3, marginBottom: 4 }}>
                  {selected.title}
                </div>
                <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>
                  {selected.condition_id?.slice(0, 20)}…
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 9, fontFamily: "IBM Plex Mono", color: "var(--muted)", flexShrink: 0 }}>
                {loading && <span style={{ color: "var(--accent)" }}>● live</span>}
                {lastPollAt && <span>{fmtTime(lastPollAt.toISOString())}</span>}
                <span style={{ color: "var(--border2)" }}>·</span>
                <span>{POLL_MS / 1000}s</span>
              </div>
            </div>

            {error && (
              <div style={{ padding: "8px 14px", background: "rgba(239,68,68,0.06)", borderBottom: "1px solid rgba(239,68,68,0.2)", fontSize: 10, color: "#ef4444", fontFamily: "IBM Plex Mono", flexShrink: 0 }}>
                ⚠ {error}
              </div>
            )}

            {snapshot && (
              <>
                <StatBar snap={snapshot} />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", flex: 1, overflow: "hidden" }}>
                  {/* Order book */}
                  <div style={{ borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <div style={{ padding: "7px 14px", borderBottom: "1px solid var(--border)", fontSize: 9, color: "var(--muted)", letterSpacing: "0.12em", textTransform: "uppercase" as const, flexShrink: 0 }}>
                      Order Book
                    </div>
                    <div style={{ overflowY: "auto", flex: 1 }}>
                      <OrderBook bids={snapshot.bids} asks={snapshot.asks} />
                    </div>
                  </div>

                  {/* Trade stream */}
                  <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    <div style={{ padding: "7px 14px", borderBottom: "1px solid var(--border)", fontSize: 9, color: "var(--muted)", letterSpacing: "0.12em", textTransform: "uppercase" as const, flexShrink: 0 }}>
                      Recent Trades
                    </div>
                    <div style={{ overflowY: "auto", flex: 1 }}>
                      <TradeStream trades={snapshot.recent_trades} />
                    </div>
                  </div>
                </div>
              </>
            )}

            {!snapshot && !loading && !error && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>Fetching…</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
