import { useState } from "react";
import { Market } from "../../types";
import MarketCard from "./MarketCard";

interface MarketSearchProps {
  markets: Market[];
  loading: boolean;
  error: string | null;
  selectedMarket: Market | null;
  queuedMarkets: Market[];
  onSelectMarket: (market: Market) => void;
  onToggleQueue: (market: Market) => void;
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
}: MarketSearchProps) {
  // Search/filter/sort state is local — only this panel uses it
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState<SortKey>("volume");

  const cats = ["All", ...Array.from(new Set(markets.map(m => m.category))).sort()];

  const filtered = markets
    .filter(m => {
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
            onChange={e => setQuery(e.target.value)}
            placeholder="Search markets, tags, categories…"
            autoFocus
          />
          {query && <span className="search-clear" onClick={() => setQuery("")}>×</span>}
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
