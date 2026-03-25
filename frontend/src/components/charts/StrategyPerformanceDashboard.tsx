import React from "react";
import type { BacktestResult } from "../../types";

interface PerformanceMetricCardProps {
  label: string;
  value: number | null;
  unit: string;
  target?: number | null;
  status: "good" | "warning" | "critical" | "insufficient";
  description: string;
  sampleSize?: number;
}

const PerformanceMetricCard: React.FC<PerformanceMetricCardProps> = ({
  label,
  value,
  unit,
  target,
  status,
  description,
  sampleSize,
}) => {
  const getValueDisplay = () => {
    if (value === null) return "N/A";
    if (typeof value === "number") {
      return `${value.toFixed(2)}${unit}`;
    }
    return String(value);
  };

  const getStatusColor = () => {
    switch (status) {
      case "good": return "#22c55e";
      case "warning": return "#f59e0b";
      case "critical": return "#ef4444";
      case "insufficient": return "#6b7280";
      default: return "#6b7280";
    }
  };

  const getStatusBg = () => {
    switch (status) {
      case "good": return "rgba(34, 197, 94, 0.15)";
      case "warning": return "rgba(245, 158, 11, 0.15)";
      case "critical": return "rgba(239, 68, 68, 0.15)";
      case "insufficient": return "rgba(107, 114, 128, 0.15)";
      default: return "rgba(107, 114, 128, 0.15)";
    }
  };

  return (
    <div
      style={{
        background: "var(--card-bg, #12161d)",
        border: "1px solid var(--border, #1e2330)",
        borderRadius: "12px",
        padding: "16px",
        flex: 1,
        minWidth: "180px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span
          style={{
            fontSize: "11px",
            color: "#606880",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          {label}
        </span>
        <div
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: getStatusColor(),
          }}
          title={status}
        />
      </div>

      {/* Value */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
        <span
          style={{
            fontSize: "24px",
            fontWeight: 700,
            color: "#e5e7eb",
          }}
        >
          {getValueDisplay()}
        </span>
        <span style={{ fontSize: "12px", color: "#606880" }}>{unit}</span>
      </div>

      {/* Description */}
      <span
        style={{
          fontSize: "12px",
          color: "#a1f5c4",
        }}
      >
        {description}
      </span>

      {/* Target / Sample Size */}
      <div style={{ marginTop: "auto", paddingTop: "12px", borderTop: "1px solid var(--border, #1e2330)" }}>
        {sampleSize !== undefined && (
          <div
            style={{
              fontSize: "11px",
              color: "#606880",
            }}
          >
            {sampleSize} trades
          </div>
        )}
        {target !== null && value !== null && (
          <div
            style={{
              fontSize: "11px",
              color: "#6b7280",
              marginTop: "4px",
            }}
          >
            Target: {target} {unit}
          </div>
        )}
      </div>
    </div>
  );
};

interface StrategyPerformanceDashboardProps {
  result: BacktestResult;
  strategyName: string;
}

export default function StrategyPerformanceDashboard({
  result,
  strategyName,
}: StrategyPerformanceDashboardProps) {
  const {
    success,
    error,
    initial_capital,
    final_value,
    total_return,
    sharpe_ratio,
    max_drawdown,
    total_trades,
    win_rate,
  } = result;

  // Calculate sample size validation
  const sampleSizeValid = total_trades >= 30;

  // Sharpe ratio validation
  const sharpeTarget = 1.0;
  const sharpeStatus = sharpe_ratio >= sharpeTarget ? "good" : "warning";

  // Max drawdown validation
  const ddTarget = 25;
  const ddStatus = max_drawdown <= ddTarget ? "good" : max_drawdown <= 40 ? "warning" : "critical";

  // Win rate validation
  const winRateTarget = 55;
  const winRateStatus = win_rate >= winRateTarget ? "good" : winRateStatus = "critical"; // Default to warning logic below

  // Actually define winRateStatus properly
  const winRateDisplayStatus = win_rate >= winRateTarget ? "good" : win_rate >= 45 ? "warning" : "critical";

  if (!success) {
    return (
      <div
        style={{
          background: "var(--card-bg, #12161d)",
          border: "1px solid var(--border, #1e2330)",
          borderRadius: "12px",
          padding: "24px",
          textAlign: "center",
          color: "#ef4444",
        }}
      >
        <div
          style={{
            fontSize: "18px",
            fontWeight: 600,
          }}
        >
          Backtest Failed
        </div>
        <div style={{ marginTop: "8px", color: "#606880" }}>
          {error || "Unknown error occurred"}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: "16px",
        padding: "20px",
        background: "var(--card-bg, #12161d)",
        borderRadius: "12px",
        border: "1px solid var(--border, #1e2330)",
      }}
    >
      {/* Strategy Name */}
      <div
        style={{
          gridColumn: "1 / -1",
          marginBottom: "8px",
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
          {strategyName}
        </h2>
      </div>

      {/* Sharpe Ratio */}
      <PerformanceMetricCard
        label="Sharpe Ratio"
        value={sharpe_ratio}
        unit=""
        target={sharpeTarget}
        status={sharpeStatus}
        description={sharpe_ratio >= 1.0 ? "Exceeds target (1.0)" : "Within acceptable range"}
      />

      {/* Max Drawdown */}
      <PerformanceMetricCard
        label="Max Drawdown"
        value={Math.abs(max_drawdown)}
        unit="%"
        target={ddTarget}
        status={ddStatus}
        description={max_drawdown <= 25 ? "Medium-risk" : max_drawdown <= 40 ? "High-risk" : "Extreme risk"}
      />

      {/* Win Rate */}
      <PerformanceMetricCard
        label="Win Rate"
        value={win_rate}
        unit="%"
        target={winRateDisplayStatus === "warning" ? 45 : winRateTarget}
        status={winRateDisplayStatus}
        description={total_trades < 30 ? "Insufficient data" : win_rate >= 55 ? "Strong" : win_rate >= 45 ? "Acceptable" : "Poor"}
        sampleSize={total_trades}
      />

      {/* Total Return */}
      <PerformanceMetricCard
        label="Total Return"
        value={total_return}
        unit="%"
        target={null}
        status="good"
        description={`${initial_capital.toFixed(0)} → ${final_value.toFixed(0)}`}
      />

      {/* Profit Factor */}
      <PerformanceMetricCard
        label="Profit Factor"
        value={null} // Not calculated in current BacktestResult
        unit=""
        target={1.5}
        status="warning"
        description="Calculated in future version"
      />

      {/* Total Trades */}
      <PerformanceMetricCard
        label="Total Trades"
        value={total_trades}
        unit=""
        target={30}
        status={sampleSizeValid ? "good" : "insufficient"}
        description={
          total_trades < 30
            ? "Statistically insignificant"
            : "Adequate sample size for analysis"
        }
        sampleSize={total_trades}
      />

      {/* Combined Edge Indicator */}
      <div
        style={{
          gridColumn: "1 / -1",
          marginTop: "8px",
          padding: "16px",
          background: "var(--card-bg, #12161d)",
          border: "1px solid var(--border, #1e2330)",
          borderRadius: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span
              style={{
                fontSize: "12px",
                color: "#606880",
              }}
            >
              Strategy Combined Edge
            </span>
            <div
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: "#a1f5c4",
                marginTop: "4px",
              }}
            >
              {sampleSizeValid ? "Edge: Weak-strong" : "Edge: Insufficient data"}
            </div>
          </div>
          {sampleSizeValid && (
            <div
              style={{
                textAlign: "right",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  color: "#606880",
                }}
              >
                Sample Size
              </div>
              <div
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#e5e7eb",
                  marginTop: "4px",
                }}
              >
                {total_trades}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}