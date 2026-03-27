import { useState } from "react";
import type { Market } from "../../types";
import MarketCard from "./MarketCard";

interface MarketSearchProps {
  markets: Market[];
  loading: boolean;
  error: string | null;
  selectedMarket: Market | null;
  queuedMarkets: Market[];
  onSelectMarket: (market: Market) => void;
  onToggleQueue: (market: Market) => void;
  /** When true, the search box calls onLiveSearch instead of filtering locally */
  liveSearch?: boolean;
  onLiveSearch?: (q: string) => void;
  /** Trigger a fresh price pull from the backend */
  onRefresh?: () => void;
}

const SORT_OPTIONS = [
  ["volume", "Volume"],
  ["prob", "Probability"],
  ["recent", "Recent"],
] as const;

type SortKey = "volume" | "prob" | "recent";

export default function MarketSearch({
  markets,
  loading,
  error,
  selectedMarket,
  queuedMarkets,
  onSelectMarket,
  onToggleQueue,
  liveSearch = false,
  onLiveSearch,
  onRefresh,
}: MarketSearchProps) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState<SortKey>("volume");

  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (liveSearch) onLiveSearch?.(val);
  };

  const cats = ["All", ...Array.from(new Set(markets.map(m => m.category))).sort()];

  // Live search: markets are already the API result — just sort them
  // Local search: filter client-side
  const filtered = markets
    .filter(m => {
      if (liveSearch) return cat === "All" || m.category === cat;
      const q = query.toLowerCase();
      const matchQ =
        !q ||
        m.title.toLowerCase().includes(q) ||
        m.tags.some(t => t.toLowerCase().includes(q)) ||
        m.category.toLowerCase().includes(q);
      const matchC = cat === "All" || m.category === cat;
      return matchQ && matchC;
    })
    .sort((a, b) => {
      if (sort === "volume") return b.volume - a.volume;
      if (sort === "prob") return b.prob - a.prob;
      if (sort === "recent") return b.end_date.localeCompare(a.end_date);
      return 0;
    });

  return (
    <div className="search-panel">
      {/* Search input */}
      <div className="search-box">
        <div className="search-wrap">
          <svg className="search-icon" width="13" height="13" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="search-input"
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            placeholder={liveSearch ? "Search any ticker or company name…" : "Search markets, tags, categories…"}
            autoFocus
          />
          {query && <span className="search-clear" onClick={() => handleQueryChange("")}>×</span>}
        </div>
      </div>

      {/* Category filter */}
      <div className="cat-bar">
        {cats.map(c => (
          <button
            key={c}
            className={`cat-btn${cat === c ? " active" : ""}`}
            onClick={() => setCat(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Sort controls */}
      <div className="sort-bar">
        <span className="sort-label">Sort:</span>
        {SORT_OPTIONS.map(([k, l]) => (
          <button
            key={k}
            className={`sort-btn${sort === k ? " active" : ""}`}
            onClick={() => setSort(k)}
          >
            {l}
          </button>
        ))}
        <span className="result-count">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            title="Refresh prices"
            style={{
              marginLeft: "auto",
              padding: "2px 8px",
              borderRadius: 4,
              border: "1px solid var(--border2)",
              background: "var(--surface2)",
              color: loading ? "var(--muted)" : "var(--accent)",
              fontSize: 11,
              fontFamily: "IBM Plex Mono, monospace",
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <span style={{ display: "inline-block", animation: loading ? "spin 1s linear infinite" : "none" }}>⟳</span>
            {loading ? "…" : "Refresh"}
          </button>
        )}
      </div>

      {/* Market list */}
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
            <div className="no-results-sub">{error}<br />Is the backend running on port 8000?</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="no-results">
            <div className="no-results-icon">🔍</div>
            <div className="no-results-title">No markets found</div>
            <div className="no-results-sub">Try different keywords or clear the category filter</div>
          </div>
        ) : (
          filtered.map(m => (
            <MarketCard
              key={m.id}
              market={m}
              isSelected={selectedMarket?.id === m.id}
              isQueued={queuedMarkets.some(x => x.id === m.id)}
              onSelect={onSelectMarket}
              onToggleQueue={onToggleQueue}
            />
          ))
        )}
      </div>
    </div>
  );
}
