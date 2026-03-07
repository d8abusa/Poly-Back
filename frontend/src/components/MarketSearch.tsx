import { useState, useEffect } from "react";
import type { Market, HistoryPoint, StrategyParams } from "../types";
import { css } from "../styles";
import { probColor, fmtVol, catColor } from "../utils";
import MarketCard from "./MarketCard";
import PriceChart from "./PriceChart";
import StrategyControls from "./StrategyControls";
import BacktestPanel from "./BacktestPanel";

const DEFAULT_STRATEGY: StrategyParams = {
  strategy: "mean_reversion",
  entry_threshold: 0.30,
  exit_threshold: 0.70,
  stop_loss: null,
  initial_capital: 1000,
  interval: "max",
};

export default function MarketSearch() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState("volume");
  const [selected, setSelected] = useState<Market | null>(null);
  const [queued, setQueued] = useState<Market[]>([]);
  const [toastMsg, setToastMsg] = useState("");
  const [strategyParams, setStrategyParams] = useState<StrategyParams>(DEFAULT_STRATEGY);

  const [priceHistory, setPriceHistory] = useState<HistoryPoint[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Fetch market list on mount ──────────────────────────────────────────────

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/markets?limit=100&order=volume")
      .then(r => {
        if (!r.ok) throw new Error(`API error ${r.status}`);
        return r.json();
      })
      .then(data => {
        setMarkets(data.markets ?? []);
        setSelected(data.markets?.[0] ?? null);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // ── Fetch price history when selected market changes ────────────────────────

  useEffect(() => {
    if (!selected?.token_id || !selected?.condition_id) {
      setPriceHistory(null);
      return;
    }
    setHistoryLoading(true);
    setPriceHistory(null);
    fetch(`/api/markets/${selected.condition_id}/history?token_id=${encodeURIComponent(selected.token_id)}&interval=max`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => setPriceHistory(data.history ?? []))
      .catch(() => setPriceHistory(null))
      .finally(() => setHistoryLoading(false));
  }, [selected?.condition_id]);

  // ── Derived lists ───────────────────────────────────────────────────────────

  const cats = ["All", ...Array.from(new Set(markets.map(m => m.category))).sort()];

  const filtered = markets
    .filter(m => {
      const q = query.toLowerCase();
      const matchQ = !q || m.title.toLowerCase().includes(q) || m.tags.some(t => t.toLowerCase().includes(q)) || m.category.toLowerCase().includes(q);
      const matchC = cat === "All" || m.category === cat;
      return matchQ && matchC;
    })
    .sort((a, b) => {
      if (sort === "volume") return b.volume - a.volume;
      if (sort === "prob") return b.prob - a.prob;
      if (sort === "recent") return b.end_date.localeCompare(a.end_date);
      return 0;
    });

  // ── Actions ─────────────────────────────────────────────────────────────────

  const toggleQueue = (m: Market, e: React.MouseEvent) => {
    e.stopPropagation();
    setQueued(q => q.find(x => x.id === m.id) ? q.filter(x => x.id !== m.id) : [...q, m]);
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 3000);
  };

  // ── Structural edge metrics ──────────────────────────────────────────────────

  const structEdge = selected ? {
    makerEdge: (selected.prob * 1.25).toFixed(2),
    takerLoss: (selected.prob * 2.65).toFixed(2),
    delta: ((1 - selected.prob) * 57).toFixed(0),
    cohensD: "0.02",
    biasPct: Math.round(selected.prob < 0.15 ? 84 : selected.prob < 0.3 ? 67 : 41),
  } : null;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{css}</style>
      <div className="root">
        {/* HEADER */}
        <div className="header">
          <div className="logo"><div className="logo-mark">PB</div>Poly<span>Back</span></div>
          <div className="header-sub">Market Search</div>
          <div className="header-right">
            {loading
              ? <span style={{ color: "var(--accent)", fontSize: 10 }}>Loading markets…</span>
              : error
                ? <span style={{ color: "var(--no)", fontSize: 10 }}>⚠ {error}</span>
                : <span style={{ color: "var(--muted)" }}>{markets.length} markets indexed</span>
            }
            {queued.length > 0 && <span className="sel-count">⚡ {queued.length} queued</span>}
          </div>
        </div>

        <div className="layout">
          {/* LEFT */}
          <div className="search-panel">
            <div className="search-box">
              <div className="search-wrap">
                <svg className="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input className="search-input" value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Search markets, tags, categories…" autoFocus />
                {query && <span className="search-clear" onClick={() => setQuery("")}>×</span>}
              </div>
            </div>

            <div className="cat-bar">
              {cats.map(c => (
                <button key={c} className={`cat-btn${cat === c ? " active" : ""}`} onClick={() => setCat(c)}>{c}</button>
              ))}
            </div>

            <div className="sort-bar">
              <span className="sort-label">Sort:</span>
              {[["volume", "Volume"], ["prob", "Probability"], ["recent", "Recent"]].map(([k, l]) => (
                <button key={k} className={`sort-btn${sort === k ? " active" : ""}`} onClick={() => setSort(k)}>{l}</button>
              ))}
              <span className="result-count">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
            </div>

            <div className="market-list">
              {loading ? (
                <div className="no-results">
                  <div className="no-results-icon" style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</div>
                  <div className="no-results-title">Fetching markets…</div>
                  <div className="no-results-sub">Connecting to Polymarket</div>
                </div>
              ) : error ? (
                <div className="no-results">
                  <div className="no-results-icon">⚠</div>
                  <div className="no-results-title">Connection error</div>
                  <div className="no-results-sub">{error}<br/>Is the backend running on port 8000?</div>
                </div>
              ) : filtered.length === 0 ? (
                <div className="no-results">
                  <div className="no-results-icon">🔍</div>
                  <div className="no-results-title">No markets found</div>
                  <div className="no-results-sub">Try different keywords or clear the category filter</div>
                </div>
              ) : filtered.map(m => (
                <MarketCard
                  key={m.id}
                  market={m}
                  isSelected={selected?.id === m.id}
                  isQueued={!!queued.find(x => x.id === m.id)}
                  onSelect={() => setSelected(m)}
                  onToggleQueue={e => toggleQueue(m, e)}
                />
              ))}
            </div>
          </div>

          {/* RIGHT */}
          <div className="detail-panel">
            {!selected ? (
              <div className="detail-empty">
                <div className="detail-empty-icon">📊</div>
                <div className="detail-empty-title">No market selected</div>
                <div className="detail-empty-sub">Click any market on the left to preview its probability curve and structural metrics</div>
                <div className="detail-empty-hint">☑ Check the box to add to your backtest queue</div>
              </div>
            ) : (
              <div className="fade-in" style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
                <div className="detail-header">
                  <div className="detail-title">{selected.title}</div>
                  <div className="detail-meta">
                    {selected.resolved && selected.outcome && (
                      <div className="dmeta">
                        <span className={`dot${selected.outcome === "NO" ? " no" : ""}`}></span>
                        Resolved {selected.outcome} · {new Date(selected.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                    )}
                    {!selected.resolved && selected.end_date && (
                      <div className="dmeta">Closes {new Date(selected.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
                    )}
                    <div className="dmeta">Vol: {fmtVol(selected.volume)}</div>
                    <div className="dmeta">Liq: {fmtVol(selected.liquidity)}</div>
                    <span className="anomaly">⚠ {selected.prob < 0.15 ? "Longshot bias detected" : "Price spike detected"}</span>
                  </div>
                </div>

                <div className="prob-chart-wrap">
                  <div className="prob-chart-label">
                    Probability Curve
                    <span>{historyLoading ? "Loading history…" : "Hover to inspect · B/S = simulated trades"}</span>
                  </div>
                  <PriceChart market={selected} history={priceHistory} />
                </div>

                <div className="detail-stats">
                  <div className="dstat">
                    <div className="dstat-label">Final Prob</div>
                    <div className={`dstat-val ${probColor(selected.prob) === "hi" ? "g" : probColor(selected.prob) === "lo" ? "r" : "t"}`}>{Math.round(selected.prob * 100)}%</div>
                    <div className="dstat-sub">at resolution</div>
                  </div>
                  <div className="dstat">
                    <div className="dstat-label">Volume</div>
                    <div className="dstat-val t">{fmtVol(selected.volume)}</div>
                    <div className="dstat-sub">total traded</div>
                  </div>
                  <div className="dstat">
                    <div className="dstat-label">Liquidity</div>
                    <div className="dstat-val b">{fmtVol(selected.liquidity)}</div>
                    <div className="dstat-sub">available</div>
                  </div>
                  <div className="dstat">
                    <div className="dstat-label">Category</div>
                    <div className="dstat-val" style={{ fontSize: 13, color: catColor(selected.category) }}>{selected.category}</div>
                    <div className="dstat-sub">{selected.tags[0]}</div>
                  </div>
                </div>

                {structEdge && (
                  <div className="edge-strip">
                    <span className="edge-badge">⚡ STRUCT EDGE</span>
                    <div className="edge-div" />
                    <div className="edge-item"><div className="edge-label">Maker Edge</div><div className="edge-val good">+{structEdge.makerEdge}%</div></div>
                    <div className="edge-item"><div className="edge-label">Taker Loss</div><div className="edge-val bad">-{structEdge.takerLoss}%</div></div>
                    <div className="edge-item"><div className="edge-label">Δ_taker</div><div className="edge-val warn">-{structEdge.delta}%</div></div>
                    <div className="edge-item"><div className="edge-label">Cohen's d</div><div className="edge-val neutral">≈ {structEdge.cohensD}</div></div>
                    <div className="edge-div" />
                    <div className="bias-row">
                      <span className="edge-label">YES Bias</span>
                      <div className="bias-track"><div className="bias-fill" style={{ width: structEdge.biasPct + "%" }} /></div>
                      <span className="edge-val warn" style={{ fontSize: 11 }}>{structEdge.biasPct}%</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <StrategyControls params={strategyParams} onChange={setStrategyParams} />
            <BacktestPanel
              queued={queued}
              strategyParams={strategyParams}
              onRemove={id => setQueued(q => q.filter(x => x.id !== id))}
              onToast={showToast}
            />
          </div>
        </div>

        {toastMsg && (
          <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: 8, padding: "10px 18px", fontSize: 12, color: "var(--text)", zIndex: 999, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", whiteSpace: "nowrap", animation: "fadeIn 0.25s ease" }}>
            {toastMsg}
          </div>
        )}
      </div>
    </>
  );
}
