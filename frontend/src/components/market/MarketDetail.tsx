import { useMemo } from "react";
import type { Market, HistoryPoint, TradeEntry } from "../../types";
import { probColor, catColor, fmtVol } from "../../utils";
import PriceChart from "../charts/PriceChart";

interface MarketDetailProps {
  selectedMarket: Market | null;
  priceHistory: HistoryPoint[] | null;
  historyLoading: boolean;
  dateFrom?: string;
  dateTo?: string;
  trades?: TradeEntry[];
}

function useStructMetrics(history: HistoryPoint[] | null) {
  return useMemo(() => {
    if (!history || history.length < 5) return null;

    const prices = history.map(h => h.p);
    const isStock = prices[0] > 1;
    const n = prices.length;
    const last = prices[n - 1];

    // ── Returns ──────────────────────────────────────────────────────────────
    const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
    const meanR   = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, r) => a + (r - meanR) ** 2, 0) / returns.length;
    const dailyVol = Math.sqrt(variance);
    // Annualise: daily candles → ×√252, hourly → ×√(252×6.5), else leave as-is
    const annVol = dailyVol * Math.sqrt(252) * 100;

    // ── Trend: linear regression slope (% per period) ─────────────────────
    const xMean = (n - 1) / 2;
    const yMean = prices.reduce((a, b) => a + b, 0) / n;
    const ssxy  = prices.reduce((a, p, i) => a + (i - xMean) * (p - yMean), 0);
    const ssxx  = prices.reduce((a, _, i) => a + (i - xMean) ** 2, 0);
    const slope    = ssxx > 0 ? ssxy / ssxx : 0;
    const trendPct = yMean !== 0 ? (slope / yMean) * 100 : 0; // %/period

    // ── Max drawdown ──────────────────────────────────────────────────────
    let peak = prices[0], maxDD = 0;
    for (const p of prices) {
      if (p > peak) peak = p;
      const dd = peak > 0 ? (peak - p) / peak : 0;
      if (dd > maxDD) maxDD = dd;
    }

    // ── Momentum: price vs 20-period MA ──────────────────────────────────
    const window20 = prices.slice(-Math.min(20, n));
    const ma20     = window20.reduce((a, b) => a + b, 0) / window20.length;
    const momPct   = ma20 !== 0 ? ((last - ma20) / ma20) * 100 : 0;

    // ── Mean-reversion half-life (AR1) ────────────────────────────────────
    // Half-life = log(0.5) / log(|ρ|)  where ρ is the AR(1) coefficient
    const ar_x = prices.slice(0, -1);
    const ar_y = prices.slice(1);
    const axm  = ar_x.reduce((a, b) => a + b, 0) / ar_x.length;
    const aym  = ar_y.reduce((a, b) => a + b, 0) / ar_y.length;
    const sxy2 = ar_x.reduce((a, x, i) => a + (x - axm) * (ar_y[i] - aym), 0);
    const sxx2 = ar_x.reduce((a, x) => a + (x - axm) ** 2, 0);
    const ar1  = sxx2 > 0 ? sxy2 / sxx2 : 1;
    const halfLife = Math.abs(ar1) > 0 && Math.abs(ar1) < 1
      ? Math.round(Math.log(0.5) / Math.log(Math.abs(ar1)))
      : null;

    return { annVol, trendPct, maxDD: maxDD * 100, momPct, halfLife, isStock, n };
  }, [history]);
}

export default function MarketDetail({
  selectedMarket,
  priceHistory,
  historyLoading,
  dateFrom,
  dateTo,
  trades,
}: MarketDetailProps) {
  const metrics = useStructMetrics(priceHistory);

  if (!selectedMarket) {
    return (
      <div className="detail-empty">
        <div className="detail-empty-icon">📊</div>
        <div className="detail-empty-title">No market selected</div>
        <div className="detail-empty-sub">
          Click any market on the left to preview its probability curve and stats
        </div>
        <div className="detail-empty-hint">☑ Check the box to add to your backtest queue</div>
      </div>
    );
  }

  const m = selectedMarket;
  const isStock = m.prob > 1;

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
        </div>
      </div>

      <div className="prob-chart-wrap">
        <div className="prob-chart-label">
          {isStock ? "Price Chart" : "Probability Curve"}
          <span>
            {historyLoading
              ? "Loading history…"
              : trades?.length ? "Hover to inspect · B/S/C = backtest trades" : "Hover to inspect · run backtest to see trades"}
          </span>
        </div>
        <PriceChart market={m} history={priceHistory} dateFrom={dateFrom} dateTo={dateTo} trades={trades} />
      </div>

      <div className="detail-stats">
        <div className="dstat">
          <div className="dstat-label">{isStock ? "Price" : "Final Prob"}</div>
          <div className={`dstat-val ${valClass}`}>
            {isStock ? `$${m.prob.toFixed(2)}` : `${Math.round(m.prob * 100)}%`}
          </div>
          <div className="dstat-sub">{isStock ? "last close" : "at resolution"}</div>
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
          <div className="dstat-sub">{m.tags?.[0] ?? "—"}</div>
        </div>
      </div>

      {/* ── Structural metrics strip ────────────────────────────────────────── */}
      <div className="edge-strip">
        <span className="edge-badge">📐 METRICS</span>
        <div className="edge-div" />

        {!metrics && (
          <div style={{ fontSize: 10, color: "var(--muted)", padding: "0 8px" }}>
            {historyLoading ? "Computing…" : "Not enough history"}
          </div>
        )}

        {metrics && (() => {
          const { annVol, trendPct, maxDD, momPct, halfLife, isStock: isSt, n } = metrics;

          const volColor  = annVol < 15 ? "good" : annVol < 40 ? "warn" : "bad";
          const trendColor = trendPct > 0 ? "good" : trendPct < 0 ? "bad" : "neutral";
          const ddColor   = maxDD < 10 ? "good" : maxDD < 25 ? "warn" : "bad";
          const momColor  = momPct > 0 ? "good" : momPct < 0 ? "bad" : "neutral";

          const trendArrow = trendPct > 0.01 ? "↑" : trendPct < -0.01 ? "↓" : "→";
          const trendLabel = isSt ? "$/period" : "Δ/tick";

          return (
            <>
              <div className="edge-item" title="Annualised volatility — std dev of daily returns × √252">
                <div className="edge-label">Volatility</div>
                <div className={`edge-val ${volColor}`}>{annVol.toFixed(1)}%</div>
              </div>

              <div className="edge-item" title="Linear regression slope over the loaded window, normalised to % per period">
                <div className="edge-label">Trend {trendLabel}</div>
                <div className={`edge-val ${trendColor}`}>
                  {trendArrow} {Math.abs(trendPct).toFixed(3)}%
                </div>
              </div>

              <div className="edge-item" title="Largest peak-to-trough decline in the loaded window">
                <div className="edge-label">Max Drawdown</div>
                <div className={`edge-val ${ddColor}`}>-{maxDD.toFixed(1)}%</div>
              </div>

              <div className="edge-item" title="Current price vs 20-period moving average">
                <div className="edge-label">vs MA20</div>
                <div className={`edge-val ${momColor}`}>
                  {momPct >= 0 ? "+" : ""}{momPct.toFixed(1)}%
                </div>
              </div>

              {!isSt && halfLife !== null && (
                <>
                  <div className="edge-div" />
                  <div className="edge-item" title="Estimated ticks for price to revert halfway to the mean (AR1 half-life). Lower = faster reversion.">
                    <div className="edge-label">Reversion t½</div>
                    <div className={`edge-val ${halfLife < 5 ? "good" : halfLife < 15 ? "warn" : "neutral"}`}>
                      {halfLife} ticks
                    </div>
                  </div>
                </>
              )}

              <div className="edge-div" />
              <div style={{ fontSize: 9, color: "var(--muted)", alignSelf: "center", paddingRight: 4, whiteSpace: "nowrap" }}>
                {n} pts
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
