import { EquityPoint } from "../../types";

interface EquityChartProps {
  data: EquityPoint[] | number[];
  color?: string;
  height?: number;
}

/**
 * SVG mini equity curve. Accepts either EquityPoint[] (from BacktestResult)
 * or a raw number[] (from strategy synthetic curves).
 */
export default function EquityChart({ data, color = "#00d4a8", height = 50 }: EquityChartProps) {
  const values: number[] =
    data.length > 0 && typeof data[0] === "object"
      ? (data as EquityPoint[]).map(p => p.value)
      : (data as number[]);

  if (values.length < 2) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#606880", fontSize: 10 }}>
        no data
      </div>
    );
  }

  const W = 200, H = height, pad = 4;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 0.01;
  const pts = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (W - pad * 2),
    pad + (1 - (v - min) / range) * (H - pad * 2),
  ] as [number, number]);

  const d = pts.reduce((acc, [x, y], i) => i === 0 ? `M${x},${y}` : `${acc} L${x},${y}`, "");
  const area = `${d} L${pts[pts.length - 1][0]},${H - pad} L${pts[0][0]},${H - pad} Z`;
  const gid = `eq-g-${color.replace("#", "")}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
