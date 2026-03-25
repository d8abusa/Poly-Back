import React, { useState } from "react";
import type { BacktestResult, TradeEntry, EquityPoint } from "../../types";

interface DrawdownChartProps {
  result: BacktestResult;
  strategyName: string;
}

interface TooltipState {
  index: number;
  date: string;
  drawdown: number;
  peak: number;
  cumulativeReturn: number;
  duration: number;
  recoveryTime: number;
}

export default function DrawdownChart({ result, strategyName }: DrawdownChartProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const equityCurve = result.equity_curve;
  const trades = result.trades;

  if (!result.success || equityCurve.length < 5) {
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
        {result.success ? "Insufficient data for drawdown analysis" : "Backtest failed"}
      </div>
    );
  }

  // Extract dates and values
  const dates = equityCurve.map((pt) => pt.date);
  const values = equityCurve.map((pt) => pt.value);
  const prices = equityCurve.map((pt) => pt.price);

  // Calculate cumulative drawdown series
  const cumulativeDrawdown: number[] = [];
  const maxPeak = values.reduce((max, val) => Math.max(max, val), values[0]);

  for (let i = 0; i < values.length; i++) {
    const peak = Math.max(values.slice(0, i + 1));
    const drawdown = ((peak - values[i]) / peak) * 100;
    cumulativeDrawdown.push(drawdown);
  }

  // Find maximum drawdown event
  let maxDrawdownValue = Math.max(...cumulativeDrawdown);
  let maxDrawdownIndex = cumulativeDrawdown.indexOf(maxDrawdownValue);

  // Calculate duration and recovery
  let maxDrawdownDuration = 0;
  let recoveryTime = Infinity;

  for (let i = maxDrawdownIndex; i < values.length; i++) {
    if (values[i] > values[maxDrawdownIndex]) {
      recoveryTime = i - maxDrawdownIndex;
      break;
    }
  }

  // Calculate duration from first trade entry to exit
  if (trades.length >= 2) {
    const firstEntry = trades.find((t) => t.action === "BUY")?.date || trades[0].date;
    const lastExit = trades.find((t) => t.action === "SELL")?.date || trades[0].date;
    maxDrawdownDuration = (() => {
      const [entry] = firstEntry.split(" ");
      const [exit] = lastExit.split(" ");
      const date1 = new Date(entry);
      const date2 = new Date(exit);
      return Math.round((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24));
    })();
  }

  const W = 800;
  const H = 300;
  const pad = { t: 16, r: 16, b: 40, l: 60 };

  const minX = 0;
  const maxX = (values.length - 1) * 1.05;
  const minY = Math.max(0, Math.min(...cumulativeDrawdown) * 1.1);
  const maxY = Math.max(Math.abs(maxDrawdownValue) * 1.1, 5);
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;

  const getX = (index: number) => pad.l + (index / (values.length - 1)) * (W - pad.l - pad.r);
  const getY = (value: number) => pad.t + (1 - (value - minY) / rangeY) * (H - pad.t - pad.b);

  const linePoints = cumulativeDrawdown.map((d, i) => `${getX(i)},${getY(d)}`).join(" ");

  // Group trades by date for tooltip
  const tradeMap = new Map<string, TradeEntry>();
  for (const trade of trades) {
    const tradeDate = trade.date.split(" ")[0];
    tradeMap.set(tradeDate, trade);
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const svg = e.currentTarget.getBoundingClientRect();
    const scaleX = W / svg.width;
    const relX = (e.clientX - svg.left) * scaleX;

    const idx = Math.round((relX - pad.l) / (W - pad.l - pad.r) * (values.length - 1));

    if (idx < 0 || idx >= values.length) {
      setTooltip(null);
      return;
    }

    // Calculate peak value up to this point
    const peak = Math.max(...values.slice(0, idx + 1));
    const drawdown = ((peak - values[idx]) / peak) * 100;
    const cumulativeReturn = ((values[idx] - values[0]) / values[0]) * 100;

    // Calculate duration
    let duration = 0;
    let recovery = Infinity;

    for (let i = idx; i < values.length; i++) {
      if (values[i] > values[idx]) {
        recovery = i - idx;
        break;
      }
    }

    const [entry] = trades.find((t) => t.action === "BUY")?.date?.split(" ") || trades[0].date.split(" ");
    const [exit] = trades.find((t) => t.action === "SELL")?.date?.split(" ") || trades[0].date.split(" ");
    const date1 = new Date(entry);
    const date2 = new Date(exit);
    duration = Math.round((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24));

    setTooltip({
      index: idx,
      date: dates[idx],
      drawdown,
      peak,
      cumulativeReturn,
      duration,
      recoveryTime: recovery === Infinity ? null : recovery,
    });
  };

  const handleMouseLeave = () => {
    setTooltip(null);
  };

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
          {strategyName} — Drawdown Analysis
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
          <span>Max Drawdown: {Math.abs(maxDrawdownValue).toFixed(2)}%</span>
          <span>Duration: {maxDrawdownDuration} days</span>
          <span>Recovery: {maxDrawdownDuration > 0 && maxDrawdownIndex < values.length - 1 ? maxDrawdownDuration - (maxDrawdownIndex < values.length - maxDrawdownIndex ? maxDrawdownIndex : values.length - 1 - maxDrawdownIndex) : "N/A"}</span>
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
          {/* Zero Line */}
          <line
            x1={pad.l}
            y1={getY(0)}
            x2={W - pad.r}
            y2={getY(0)}
            stroke="#1e2330"
            strokeWidth="1"
          />

          {/* Grid Lines */}
          {[
            getY(minY / 2),
            getY(minY),
            getY(maxY / 4),
            getY(maxY / 2),
            getY(maxY * 0.75),
          ].map((y, i) => (
            <line
              key={`grid-${i}`}
              x1={pad.l}
              y1={y}
              x2={W - pad.r}
              y2={y}
              stroke="#1e2330"
              strokeWidth="1"
              strokeDasharray="4,4"
            />
          ))}

          {/* Cumulative Drawdown Area */}
          <polygon
            points={`${getX(0)},${H - pad.b} ${linePoints.slice(0, linePoints.indexOf(getY(0)))} ${getY(0)},${getY(0)} ${linePoints}`}
            fill="var(--accent, rgba(239, 68, 68, 0.15))"
          />

          {/* Cumulative Drawdown Line */}
          <polyline
            points={linePoints}
            fill="none"
            stroke="#ef4444"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Max Drawdown Highlight */}
          {maxDrawdownIndex > 0 && maxDrawdownIndex < values.length - 1 && (
            <>
              {/* Peak Line */}
              <line
                x1={getX(0)}
                y1={getY(0)}
                x2={getX(maxDrawdownIndex)}
                y2={getY(0)}
                stroke="#f59e0b"
                strokeWidth="1"
                strokeDasharray="4,4"
                opacity="0.6"
              />
              <text
                x={getX(maxDrawdownIndex)}
                y={getY(0) + 16}
                textAnchor="middle"
                fontSize="10"
                fill="#f59e0b"
              >
                Peak ({(values[maxDrawdownIndex] - values[0]) / values[0] * 100 > 0 ? values[maxDrawdownIndex].toFixed(2) : "---"})
              </text>

              {/* Trough Line */}
              <line
                x1={0}
                y1={pad.t + (1 - maxDrawdownValue / rangeY) * (H - pad.t - pad.b)}
                x2={W}
                y2={pad.t + (1 - maxDrawdownValue / rangeY) * (H - pad.t - pad.b)}
                stroke="#22c55e"
                strokeWidth="1"
                strokeDasharray="4,4"
                opacity="0.6"
              />
              <text
                x={W - pad.r + 5}
                y={pad.t + (1 - maxDrawdownValue / rangeY) * (H - pad.t - pad.b)}
                textAnchor="start"
                fontSize="10"
                fill="#22c55e"
              >
                Max Drawdown
              </text>

              {/* Trough Circle */}
              <circle
                cx={getX(maxDrawdownIndex)}
                cy={getY(maxDrawdownValue)}
                r="6"
                fill="rgba(34, 197, 94, 0.2)"
                stroke="#22c55e"
                strokeWidth="2"
              />
              <circle
                cx={getX(maxDrawdownIndex)}
                cy={getY(maxDrawdownValue)}
                r="3"
                fill="#22c55e"
              />
            </>
          )}

          {/* Cumulative Return Line (baseline) */}
          <polyline
            points={cumulativeDrawdown.map((d, i) => `${getX(i)},${getY(d * 0.1)}`).join(" ")}
            fill="none"
            stroke="#606880"
            strokeWidth="1"
            strokeDasharray="2,2"
            opacity="0.4"
          />

          {/* Tooltip Line */}
          {tooltip && (() => {
            const { index, date, drawdown, peak, cumulativeReturn, duration, recoveryTime } = tooltip;
            const x = getX(index);
            const y = getY(drawdown);
            const peakY = getY(0);

            return (
              <>
                <line
                  x1={x}
                  y1={peakY}
                  x2={x}
                  y2={y}
                  stroke="#252d3d"
                  strokeWidth="1"
                  strokeDasharray="3,3"
                />
                <circle cx={x} cy={y} r="5" fill="#ef4444" stroke="#0a0c0f" strokeWidth="2" />
              </>
            );
          })()}
        </svg>
      </div>

      {/* Tooltip */}
      {tooltip && (() => {
        const { index, date, drawdown, peak, cumulativeReturn, duration, recoveryTime } = tooltip;

        return (
          <div
            className="svg-tooltip"
            style={{
              position: "absolute",
              left: `${(index / (values.length - 1)) * 100 + 5}%`,
              top: `${(1 - Math.abs(drawdown) / maxY) * 100}%`,
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
              <span style={{ fontSize: "11px", color: "#606880" }}>Drawdown</span>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: drawdown > 0 ? "#ef4444" : "#22c55e",
                }}
              >
                {Math.abs(drawdown).toFixed(2)}%
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: "11px", color: "#606880" }}>Peak</span>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#e5e7eb" }}>
                ${(peak - values[0]) / values[0] * 100 > 0 ? `${(peak / values[0] - 1) * 100 > 0 ? (peak / values[0] - 1) * 100 : "---"}%` : "---"}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: "11px", color: "#606880" }}>Cumulative Return</span>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: cumulativeReturn > 0 ? "#22c55e" : "#ef4444",
                }}
              >
                {cumulativeReturn > 0 ? `+${cumulativeReturn.toFixed(2)}%` : `${cumulativeReturn.toFixed(2)}%`}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: "8px",
                paddingTop: "8px",
                borderTop: "1px solid var(--border, #1e2330)",
              }}
            >
              <span style={{ fontSize: "11px", color: "#606880" }}>Duration</span>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "#e5e7eb" }}>
                {duration} days
              </span>
            </div>
            {recoveryTime !== null && recoveryTime !== undefined && recoveryTime !== Infinity && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: "4px",
                }}
              >
                <span style={{ fontSize: "11px", color: "#606880" }}>Recovery Time</span>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: recoveryTime < 10 ? "#f59e0b" : "#22c55e",
                  }}
                >
                  {recoveryTime} days
                </span>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}