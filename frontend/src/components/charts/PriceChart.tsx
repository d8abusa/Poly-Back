import { useState, useRef, useId } from "react";
import type { Market, HistoryPoint } from "../../types";
import { genCurve } from "../../utils";

interface TooltipState {
  x: number;
  y: number;
  prob: number;
  label: string;
}

interface PriceChartProps {
  market: Market;
  history: HistoryPoint[] | null;
}

export default function PriceChart({ market, history }: PriceChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const uid = useId().replace(/:/g, "");  // unique per instance — prevents gradient ID collision

  const hasReal = history !== null && history.length >= 2;
  const curve = hasReal ? history.map(h => h.p) : genCurve(market.id, market.prob);

  const getDateAt = (idx: number): Date => {
    if (hasReal) return new Date(history[idx].t * 1000);
    const d = new Date("2024-01-01");
    d.setDate(d.getDate() + idx);
    return d;
  };

  const W = 600, H = 180, PAD = { t: 12, r: 12, b: 28, l: 44 };
  const cw = W - PAD.l - PAD.r;
  const ch = H - PAD.t - PAD.b;

  const pts = curve.map(
    (v, i) =>
      [PAD.l + (i / (curve.length - 1)) * cw, PAD.t + (1 - v) * ch] as [number, number]
  );

  const d = pts.reduce((acc, [x, y], i) => {
    if (i === 0) return `M${x},${y}`;
    const [px, py] = pts[i - 1];
    const cpx = (px + x) / 2;
    return `${acc} C${cpx},${py} ${cpx},${y} ${x},${y}`;
  }, "");

  const area = `${d} L${pts[pts.length - 1][0]},${PAD.t + ch} L${pts[0][0]},${PAD.t + ch} Z`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const xStep = Math.floor(curve.length / 5);
  const makerEdge = (market.prob * 0.0125).toFixed(3);

  const handleMouseMove = (e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const mx = (e.clientX - rect.left) * scaleX;
    const relX = mx - PAD.l;
    const idx = Math.round((relX / cw) * (curve.length - 1));
    if (idx < 0 || idx >= curve.length) { setTooltip(null); return; }
    const label = getDateAt(idx).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const [px, py] = pts[idx];
    const scaleXr = rect.width / W, scaleYr = rect.height / H;
    setTooltip({ x: px * scaleXr, y: py * scaleYr, prob: curve[idx], label });
  };

  return (
    <div ref={wrapRef} style={{ flex: 1, position: "relative", minHeight: 140 }}
      onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%", display: "block" }}>
        <defs>
          <linearGradient id={`probGrad_${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00d4a8" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#00d4a8" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`lineGrad_${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#00d4a8" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#00d4a8" stopOpacity="1" />
          </linearGradient>
        </defs>

        {yTicks.map(t => {
          const y = PAD.t + (1 - t) * ch;
          return (
            <g key={t}>
              <line x1={PAD.l} y1={y} x2={PAD.l + cw} y2={y} stroke="#1e2330" strokeWidth="1" />
              <text x={PAD.l - 5} y={y + 3} textAnchor="end" fontSize="9" fill="#606880">
                {Math.round(t * 100)}%
              </text>
            </g>
          );
        })}

        {[0, 1, 2, 3, 4].map(i => {
          const idx = Math.min(i * xStep, curve.length - 1);
          const x = PAD.l + (idx / (curve.length - 1)) * cw;
          return (
            <g key={i}>
              <line x1={x} y1={PAD.t} x2={x} y2={PAD.t + ch} stroke="#1e2330" strokeWidth="1" />
              <text x={x} y={H - 6} textAnchor="middle" fontSize="9" fill="#606880">
                {getDateAt(idx).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </text>
            </g>
          );
        })}

        <path d={area} fill={`url(#probGrad_${uid})`} />
        <path d={d} fill="none" stroke={`url(#lineGrad_${uid})`} strokeWidth="2" strokeLinecap="round" />

        {/* Trade markers — decorative until real backtest results are wired */}
        {[18, 34, 52, 68, 78, 88].map((pct, i) => {
          const idx = Math.floor(pct / 100 * (curve.length - 1));
          const [x, y] = pts[idx] ?? [0, 0];
          const isBuy = i % 2 === 0;
          return (
            <g key={i} transform={`translate(${x},${y})`}>
              <circle r="7"
                fill={isBuy ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)"}
                stroke={isBuy ? "#22c55e" : "#ef4444"} strokeWidth="1.5" />
              <text textAnchor="middle" dominantBaseline="central" fontSize="7" fontWeight="700"
                fill={isBuy ? "#22c55e" : "#ef4444"}>{isBuy ? "B" : "S"}</text>
            </g>
          );
        })}

        {tooltip && (() => {
          const scaleX = W / (svgRef.current?.getBoundingClientRect().width || W);
          const idx = Math.round(((tooltip.x * scaleX) - PAD.l) / cw * (curve.length - 1));
          const [cx, cy] = pts[Math.max(0, Math.min(idx, pts.length - 1))] ?? [0, 0];
          return (
            <>
              <line x1={cx} y1={PAD.t} x2={cx} y2={PAD.t + ch}
                stroke="#252d3d" strokeWidth="1" strokeDasharray="3,3" />
              <circle cx={cx} cy={cy} r="4" fill="#00d4a8" stroke="#0a0c0f" strokeWidth="2" />
            </>
          );
        })()}
      </svg>

      {tooltip && (
        <div className="svg-tooltip" style={{ left: tooltip.x + 12, top: Math.max(8, tooltip.y - 20) }}>
          <div className="stt-date">{tooltip.label}</div>
          <div className="stt-row">
            <span className="stt-key">Prob</span>
            <span className="stt-val">{(tooltip.prob * 100).toFixed(1)}%</span>
          </div>
          <div className="stt-row">
            <span className="stt-key">Maker Edge</span>
            <span className="stt-val" style={{ color: "#ff6b35" }}>+{makerEdge}</span>
          </div>
          <div className="stt-row">
            <span className="stt-key">Signal</span>
            <span className="stt-val" style={{ color: "#7b61ff" }}>
              {tooltip.prob > 0.5 ? "HOLD" : "WATCH"}
            </span>
          </div>
        </div>
      )}

      {hasReal && (
        <div style={{ position: "absolute", top: 4, right: 4, fontSize: 9, color: "var(--accent)", opacity: 0.6 }}>
          LIVE DATA · {curve.length} pts
        </div>
      )}
    </div>
  );
}
