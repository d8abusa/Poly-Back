import React, { useState } from "react";
import type { BacktestResult, TradeEntry, EquityPoint } from "../../types";

interface BacktestChartProps {
  result: BacktestResult;
  strategyName: string;
}

interface TooltipState {
  index: number;
  date: string;
  equity: number;
  price: number;
  trade: TradeEntry | null;
}

export default function BacktestChart({ result, strategyName }: BacktestChartProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const equityCurve = result.equity_curve;
  const trades = result.trades;

  if (!result.success || equityCurve.length < 2) {
    return (
      <div
        style={{
          height: "300px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--card-bg, #12161d)",
          border: "1px solid var(--border, #1e2330)",
          borderRadius: "12px",
          color: "#606880",
        }}
      >
        {result.success ? "Not enough data points" : "Backtest failed"}
      </div>
    );
  }

  // Extract dates and values
  const dates = equityCurve.map((pt) => pt.date);
  const values = equityCurve.map((pt) => pt.value);
  const prices = equityCurve.map((pt) => pt.price);

  const initialCapital = values[0];
  const finalValue = values[values.length - 1];

  // Normalize to initial capital for comparison
  const normalizedValues = values.map((v) => v / initialCapital);

  const W = 800;
  const H = 300;
  const pad = { t: 16, r: 16, b: 40, l: 60 };

  const minX = normalizedValues[0];
  const maxX = Math.max(1.0, ...normalizedValues) * 1.05;
  const minY = Math.min(0.8, ...normalizedValues) * 0.95;
  const maxY = maxX;
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;

  const getX = (index: number) => pad.l + (index / (equityCurve.length - 1)) * (W - pad.l - pad.r);
  const getY = (value: number) => pad.t + (1 - (value - minY) / rangeY) * (H - pad.t - pad.b);

  const linePoints = normalizedValues.map((v, i) => `${getX(i)},${getY(v)}`).join(" ");

  // Group trades by date for tooltip
  const tradeMap = new Map<string, TradeEntry>();
  for (const trade of trades) {
    // Use just the date portion for comparison
    const tradeDate = trade.date.split(" ")[0];
    tradeMap.set(tradeDate, trade);
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const svg = e.currentTarget.getBoundingClientRect();
    const scaleX = W / svg.width;
    const relX = (e.clientX - svg.left) * scaleX;

    const idx = Math.round(((relX - pad.l) / (W - pad.l - pad.r)) * (equityCurve.length - 1));

    if (idx < 0 || idx >= equityCurve.length) {
      setTooltip(null);
      return;
    }

    const date = dates[idx];
    const equity = values[idx];
    const price = prices[idx];
    const trade = tradeMap.get(date.split(" ")[0]) || null;

    setTooltip({ index: idx, date, equity, price, trade });
  };

  const handleMouseLeave = () => {
    setTooltip(null);
  };

  // Helper to find nearby trade entries
  const getTradeMarkers = () => {
    return trades
      .filter((trade) => {
        const tradeDate = trade.date.split(" ")[0];
        return dates.some((d) => d.startsWith(tradeDate));
      })
      .slice(0, 50); // Limit to first 50 to avoid overcrowding
  };

  const tradeMarkers = getTradeMarkers();

  return (
    <div
      style={{
        background: "var(--card-bg, #12161d)",
        border: "1px solid var(--border, #1e2330)",
        borderRadius: "12px",
        padding: "20px",
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Chart Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "16px",
        }}
      >
        <h2
          style={{
            fontSize: "16px",
            fontWeight: 700,
            color: "#e5e7eb",
            margin: 0,
          }}
        >
          {strategyName} — Equity Curve
        </h2>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            fontSize: "12px",
            color: "#606880",
          }}
        >
          <span>Initial: ${initialCapital.toFixed(2)}</span>
          <span>Final: ${finalValue.toFixed(2)}</span>
          <span>Total Return: {(finalValue - initialCapital) / initialCapital * 100}X</span>
        </div>
      </div>

      {/* Chart Container */}
      <div
        style={{
          height: H,
          position: "relative",
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{
            width: "100%",
            height: "100%",
            display: "block",
          }}
        >
          {/* Grid Lines - Horizontal */}
          {[
            pad.t + (H - pad.t - pad.b) * 0.25,
            pad.t + (H - pad.t - pad.b) * 0.5,
            pad.t + (H - pad.t - pad.b) * 0.75,
          ].map((y, i) => (
            <line
              key={`h-${i}`}
              x1={pad.l}
              y1={y}
              x2={W - pad.r}
              y2={y}
              stroke="#1e2330"
              strokeWidth="1"
            />
          ))}

          {/* Grid Lines - Vertical */}
          {[
            (W - pad.l - pad.r) * 0.25,
            (W - pad.l - pad.r) * 0.5,
            (W - pad.l - pad.r) * 0.75,
          ].map((x, i) => (
            <line
              key={`v-${i}`}
              x1={pad.l + x}
              y1={pad.t}
              x2={pad.l + x}
              y2={H - pad.b}
              stroke="#1e2330"
              strokeWidth="1"
            />
          ))}

          {/* Baseline - Initial Capital */}
          <line
            x1={pad.l}
            y1={getY(1.0)}
            x2={W - pad.r}
            y2={getY(1.0)}
            stroke="#606880"
            strokeWidth="1"
            strokeDasharray="4,4"
          />
          {/* baseline label rendered as HTML overlay — see below */}

          {/* Equity Curve */}
          <polygon
            points={`${getX(0)},${H - pad.b} ${linePoints} ${getX(equityCurve.length - 1)},${H - pad.b}`}
            fill="var(--accent, rgba(0, 212, 168, 0.1))"
          />
          <polyline
            points={linePoints}
            fill="none"
            stroke="#00d4a8"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Trade Markers */}
          {tradeMarkers.map((trade, i) => {
            const dateStr = trade.date.split(" ")[0];
            const idx = dates.findIndex((d) => d.startsWith(dateStr));
            if (idx === -1) return null;

            const x = getX(idx);
            const y = getY(normalizedValues[idx]);
            const isBuy = trade.action === "BUY";

            return (
              <g key={i} transform={`translate(${x},${y})`}>
                <circle r="6" fill={isBuy ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)"} />
                <circle r="4" fill={isBuy ? "rgba(34, 197, 94, 1)" : "rgba(239, 68, 68, 1)"} />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="9"
                  fontWeight="700"
                  fontFamily="IBM Plex Mono, monospace"
                  fill={isBuy ? "#22c55e" : "#ef4444"}
                >
                  {isBuy ? "B" : "S"}
                </text>
              </g>
            );
          })}

          {/* Tooltip Line */}
          {tooltip && (() => {
            const { index, date, equity, price, trade } = tooltip;
            const x = getX(index);
            const y = getY(normalizedValues[index]);

            return (
              <>
                <line
                  x1={x}
                  y1={pad.t}
                  x2={x}
                  y2={H - pad.b}
                  stroke="#252d3d"
                  strokeWidth="1"
                  strokeDasharray="3,3"
                />
                <circle cx={x} cy={y} r="5" fill="#00d4a8" stroke="#0a0c0f" strokeWidth="2" />
              </>
            );
          })()}
        </svg>

        {/* Baseline label — HTML overlay to avoid SVG font stretching on resize */}
        <div style={{
          position: "absolute",
          top: `${getY(1.0) / H * 100}%`,
          left: 0,
          width: `${(pad.l - 4) / W * 100}%`,
          transform: "translateY(-50%)",
          textAlign: "right",
          fontSize: "10px",
          color: "#606880",
          fontFamily: "IBM Plex Mono, monospace",
          pointerEvents: "none",
          lineHeight: 1,
        }}>
          1.0X
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (() => {
        const { index, date, equity, price, trade } = tooltip;
        return (
          <div
            className="svg-tooltip"
            style={{
              position: "absolute",
              left: `${(index / (equityCurve.length - 1)) * 100 + 5}%`,
              top: `${(1 - normalizedValues[index]) * 100}%`,
              transform: "translate(-50%, -100%)",
              background: "rgba(10, 12, 15, 0.95)",
              border: "1px solid var(--border, #1e2330)",
              borderRadius: "8px",
              padding: "12px",
              minWidth: "200px",
              pointerEvents: "none",
              backdropFilter: "blur(4px)",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                color: "#606880",
                marginBottom: "8px",
              }}
            >
              {date}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "4px",
              }}
            >
              <span style={{ fontSize: "11px", color: "#606880" }}>Equity</span>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#a1f5c4" }}>
                ${equity.toFixed(2)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: "11px", color: "#606880" }}>Price</span>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#e5e7eb" }}>
                ${price.toFixed(2)}
              </span>
            </div>
            {trade && (
              <div
                style={{
                  marginTop: "8px",
                  paddingTop: "8px",
                  borderTop: "1px solid var(--border, #1e2330)",
                  fontSize: "11px",
                  color: "#606880",
                }}
              >
                [{trade.action}] {trade.shares.toFixed(1)} shares @ ${trade.price.toFixed(2)}
                {trade.pnl !== null && (
                  <span
                    style={{
                      display: "block",
                      marginTop: "4px",
                      color: trade.pnl > 0 ? "#22c55e" : "#ef4444",
                      fontWeight: 600,
                    }}
                  >
                    PnL: ${trade.pnl.toFixed(2)}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}