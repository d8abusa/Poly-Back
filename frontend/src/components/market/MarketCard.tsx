import type { Market } from "../../types";
import { probColor, catColor, fmtVol } from "../../utils";

interface MarketCardProps {
  market: Market;
  isSelected: boolean;
  isQueued: boolean;
  onSelect: (market: Market) => void;
  onToggleQueue: (market: Market) => void;
}

export default function MarketCard({
  market,
  isSelected,
  isQueued,
  onSelect,
  onToggleQueue,
}: MarketCardProps) {
  return (
    <div
      className={`market-item${isSelected ? " selected" : ""}${isQueued ? " queued" : ""}`}
      onClick={() => onSelect(market)}
    >
      <div
        className={`m-check${isQueued ? " on" : ""}`}
        onClick={e => { e.stopPropagation(); onToggleQueue(market); }}
      />
      <div className="m-body">
        <div className="m-title">{market.title}</div>
        <div className="m-meta">
          <span
            className="m-cat"
            style={{
              background: catColor(market.category) + "18",
              color: catColor(market.category),
              border: `1px solid ${catColor(market.category)}33`,
            }}
          >
            {market.category}
          </span>
          <span className="m-vol">{fmtVol(market.volume)}</span>
          {market.tags.slice(0, 1).map(t => <span key={t} className="m-tag">{t}</span>)}
        </div>
      </div>
      <div className="m-right">
        <span className={`m-prob ${probColor(market.prob)}`}>
          {market.prob > 1
            ? `$${market.prob.toFixed(2)}`
            : `${Math.round(market.prob * 100)}¢`}
        </span>
        {market.prev_prob != null && (() => {
          const delta = market.prob - market.prev_prob;
          const up = delta >= 0;
          const color = up ? "#22c55e" : "#ef4444";
          const sign = up ? "+" : "";
          const label = market.prob > 1
            ? `${sign}$${delta.toFixed(2)} (${sign}${((delta / market.prev_prob) * 100).toFixed(1)}%)`
            : `${sign}${Math.round(delta * 100)}¢`;
          return (
            <span style={{
              fontSize: "9px",
              color,
              fontFamily: "IBM Plex Mono, monospace",
              marginTop: "1px",
              display: "block",
            }}>
              {label}
            </span>
          );
        })()}
        {market.outcome && (
          <span className={`m-outcome ${market.outcome === "YES" ? "yes" : "no"}`}>
            {market.outcome}
          </span>
        )}
      </div>
    </div>
  );
}
