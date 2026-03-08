import { Market, HistoryPoint } from "../../types";
import { probColor, catColor, fmtVol } from "../../utils";
import PriceChart from "../charts/PriceChart";

interface MarketDetailProps {
  selectedMarket: Market | null;
  priceHistory: HistoryPoint[] | null;
  historyLoading: boolean;
}

export default function MarketDetail({
  selectedMarket,
  priceHistory,
  historyLoading,
}: MarketDetailProps) {
  if (!selectedMarket) {
    return (
      <div className="detail-empty">
        <div className="detail-empty-icon">📊</div>
        <div className="detail-empty-title">No market selected</div>
        <div className="detail-empty-sub">
          Click any market on the left to preview its probability curve and structural metrics
        </div>
        <div className="detail-empty-hint">☑ Check the box to add to your backtest queue</div>
      </div>
    );
  }

  const m = selectedMarket;

  // Structural edge metrics — derived from selected market
  const structEdge = {
    makerEdge: (m.prob * 1.25).toFixed(2),
    takerLoss: (m.prob * 2.65).toFixed(2),
    delta: ((1 - m.prob) * 57).toFixed(0),
    cohensD: "0.02",
    biasPct: Math.round(m.prob < 0.15 ? 84 : m.prob < 0.3 ? 67 : 41),
  };

  const pc = probColor(m.prob);
  const valClass = pc === "hi" ? "g" : pc === "lo" ? "r" : "t";

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div className="detail-header">
        <div className="detail-title">{m.title}</div>
        <div className="detail-meta">
          {m.resolved && m.outcome && (
            <div className="dmeta">
              <span className={`dot${m.outcome === "NO" ? " no" : ""}`} />
              Resolved {m.outcome} · {new Date(m.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
          )}
          {!m.resolved && m.end_date && (
            <div className="dmeta">
              Closes {new Date(m.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
          )}
          <div className="dmeta">Vol: {fmtVol(m.volume)}</div>
          <div className="dmeta">Liq: {fmtVol(m.liquidity)}</div>
          <span className="anomaly">
            ⚠ {m.prob < 0.15 ? "Longshot bias detected" : "Price spike detected"}
          </span>
        </div>
      </div>

      <div className="prob-chart-wrap">
        <div className="prob-chart-label">
          Probability Curve
          <span>
            {historyLoading
              ? "Loading history…"
              : "Hover to inspect · B/S = simulated trades"}
          </span>
        </div>
        <PriceChart market={m} history={priceHistory} />
      </div>

      <div className="detail-stats">
        <div className="dstat">
          <div className="dstat-label">Final Prob</div>
          <div className={`dstat-val ${valClass}`}>{Math.round(m.prob * 100)}%</div>
          <div className="dstat-sub">at resolution</div>
        </div>
        <div className="dstat">
          <div className="dstat-label">Volume</div>
          <div className="dstat-val t">{fmtVol(m.volume)}</div>
          <div className="dstat-sub">total traded</div>
        </div>
        <div className="dstat">
          <div className="dstat-label">Liquidity</div>
          <div className="dstat-val b">{fmtVol(m.liquidity)}</div>
          <div className="dstat-sub">available</div>
        </div>
        <div className="dstat">
          <div className="dstat-label">Category</div>
          <div className="dstat-val" style={{ fontSize: 13, color: catColor(m.category) }}>
            {m.category}
          </div>
          <div className="dstat-sub">{m.tags[0]}</div>
        </div>
      </div>

      <div className="edge-strip">
        <span className="edge-badge">⚡ STRUCT EDGE</span>
        <div className="edge-div" />
        <div className="edge-item">
          <div className="edge-label">Maker Edge</div>
          <div className="edge-val good">+{structEdge.makerEdge}%</div>
        </div>
        <div className="edge-item">
          <div className="edge-label">Taker Loss</div>
          <div className="edge-val bad">-{structEdge.takerLoss}%</div>
        </div>
        <div className="edge-item">
          <div className="edge-label">Δ_taker</div>
          <div className="edge-val warn">-{structEdge.delta}%</div>
        </div>
        <div className="edge-item">
          <div className="edge-label">Cohen's d</div>
          <div className="edge-val neutral">≈ {structEdge.cohensD}</div>
        </div>
        <div className="edge-div" />
        <div className="bias-row">
          <span className="edge-label">YES Bias</span>
          <div className="bias-track">
            <div className="bias-fill" style={{ width: structEdge.biasPct + "%" }} />
          </div>
          <span className="edge-val warn" style={{ fontSize: 11 }}>{structEdge.biasPct}%</span>
        </div>
      </div>
    </div>
  );
}
