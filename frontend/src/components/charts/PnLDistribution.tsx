import type { TradeEntry } from "../../types";

interface PnLDistributionProps {
  trades: TradeEntry[];
}

/**
 * Stacked bar chart showing the distribution of trade PnL values across buckets.
 */
export default function PnLDistribution({ trades }: PnLDistributionProps) {
  const sells = trades.filter(t => t.pnl !== null && t.action.startsWith("SELL"));
  if (sells.length === 0) {
    return (
      <div style={{ padding: "20px 0", textAlign: "center", color: "#606880", fontSize: 11 }}>
        No completed trades to display
      </div>
    );
  }

  const pnls = sells.map(t => t.pnl as number);
  const min = Math.min(...pnls), max = Math.max(...pnls);
  const bucketCount = 10;
  const bucketSize = (max - min) / bucketCount || 1;

  // Build buckets
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    lo: min + i * bucketSize,
    hi: min + (i + 1) * bucketSize,
    wins: 0,
    losses: 0,
  }));
  for (const pnl of pnls) {
    const bi = Math.min(Math.floor((pnl - min) / bucketSize), bucketCount - 1);
    if (pnl >= 0) buckets[bi].wins++;
    else buckets[bi].losses++;
  }

  const maxCount = Math.max(...buckets.map(b => b.wins + b.losses), 1);
  const W = 300, H = 80, pad = { t: 4, r: 4, b: 20, l: 24 };
  const bw = (W - pad.l - pad.r) / bucketCount;
  const ch = H - pad.t - pad.b;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }}>
      {buckets.map((b, i) => {
        const total = b.wins + b.losses;
        const barH = (total / maxCount) * ch;
        const winH = (b.wins / maxCount) * ch;
        const x = pad.l + i * bw;
        const y = pad.t + ch - barH;
        const isPositive = b.lo >= 0;

        return (
          <g key={i}>
            {/* loss portion */}
            {b.losses > 0 && (
              <rect x={x + 1} y={y} width={bw - 2} height={barH - winH}
                fill="rgba(239,68,68,0.6)" rx="1" />
            )}
            {/* win portion */}
            {b.wins > 0 && (
              <rect x={x + 1} y={y + (barH - winH)} width={bw - 2} height={winH}
                fill={isPositive ? "rgba(34,197,94,0.7)" : "rgba(0,212,168,0.5)"} rx="1" />
            )}
          </g>
        );
      })}

      {/* x-axis labels: min and max */}
      <text x={pad.l} y={H - 4} fontSize="8" fill="#606880" textAnchor="start">
        {min.toFixed(1)}
      </text>
      <text x={W - pad.r} y={H - 4} fontSize="8" fill="#606880" textAnchor="end">
        +{max.toFixed(1)}
      </text>
      <text x={W / 2} y={H - 4} fontSize="8" fill="#606880" textAnchor="middle">PnL</text>
    </svg>
  );
}
