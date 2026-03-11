import type { Market } from "../types";
import { fmtVol, probColor, catColor } from "../utils";

interface Props {
  market: Market;
  isSelected: boolean;
  isQueued: boolean;
  onSelect: () => void;
  onToggleQueue: (e: React.MouseEvent) => void;
}

export default function MarketCard({ market, isSelected, isQueued, onSelect, onToggleQueue }: Props) {
  return (
    <div
      className={`market-item${isSelected ? " selected" : ""}${isQueued ? " queued" : ""}`}
      onClick={onSelect}
    >
      <div className={`m-check${isQueued ? " on" : ""}`} onClick={onToggleQueue} />
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
        <span className={`m-prob ${probColor(market.prob)}`}>{Math.round(market.prob * 100)}¢</span>
        {market.outcome && (
          <span className={`m-outcome ${market.outcome === "YES" ? "yes" : "no"}`}>
            {market.outcome}
          </span>
        )}
      </div>
    </div>
  );
}
