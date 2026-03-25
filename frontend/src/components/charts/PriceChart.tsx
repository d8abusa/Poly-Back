import { useState, useRef, useId } from "react";
import type { Market, HistoryPoint, TradeEntry } from "../../types";

interface TooltipState {
  x: number;
  y: number;
  prob: number;
  label: string;
}

interface PriceChartProps {
  market: Market;
  history: HistoryPoint[] | null;
  dateFrom?: string;
  dateTo?: string;
  trades?: TradeEntry[];
}

const TIMEFRAMES = [
  { label: "1M",  days: 30  },
  { label: "3M",  days: 90  },
  { label: "6M",  days: 180 },
  { label: "1Y",  days: 365 },
  { label: "ALL", days: 0   },
] as const;

export default function PriceChart({ market, history, dateFrom, dateTo, trades }: PriceChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  // Default stocks to 1Y, prediction markets to ALL (shorter histories)
  const isStock = (history?.length ?? 0) > 0 && (history?.[0]?.p ?? 0) > 1;
  const [viewDays, setViewDays] = useState<number>(isStock ? 365 : 0);
  const uid = useId().replace(/:/g, "");

  // Calendar window (from backtest date pickers) takes full precedence when set.
  // Otherwise apply the timeframe selector.
  const hasCalWindow = !!(dateFrom || dateTo);

  const filteredHistory = (() => {
    if (!history) return null;
    if (hasCalWindow) {
      const result = history.filter(h => {
        const d = new Date(h.t * 1000).toISOString().slice(0, 10);
        return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
      });
      return result.length >= 2 ? result : null;
    }
    if (viewDays === 0) return history;
    const cutoff = Date.now() / 1000 - viewDays * 86400;
    const result = history.filter(h => h.t >= cutoff);
    return result.length >= 2 ? result : history; // fall back to full if too sparse
  })();

  const hasReal = filteredHistory !== null && filteredHistory.length >= 2;

  if (!hasReal) {
    return (
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--muted)", fontSize: 10, fontFamily: "IBM Plex Mono, monospace",
        opacity: 0.5,
      }}>
        {history === null ? "Loading…" : hasCalWindow ? "No data in selected window" : "No history available"}
      </div>
    );
  }

  const rawCurve = filteredHistory.map(h => h.p);
  // Normalize to 0–1 if values are stock prices (> 1)
  const needsNorm = rawCurve.some(v => v > 1);
  const minP = Math.min(...rawCurve), maxP = Math.max(...rawCurve);
  const curve = needsNorm
    ? (maxP > minP ? rawCurve.map(v => (v - minP) / (maxP - minP)) : rawCurve.map(() => 0.5))
    : rawCurve;

  const getDateAt = (idx: number): Date => new Date(filteredHistory[idx].t * 1000);

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
    <div ref={wrapRef} style={{ flex: 1, position: "relative", minHeight: 0 }}
      onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
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
            <line key={t} x1={PAD.l} y1={y} x2={PAD.l + cw} y2={y} stroke="#1e2330" strokeWidth="1" />
          );
        })}

        {[0, 1, 2, 3, 4].map(i => {
          const idx = Math.min(i * xStep, curve.length - 1);
          const x = PAD.l + (idx / (curve.length - 1)) * cw;
          return (
            <line key={i} x1={x} y1={PAD.t} x2={x} y2={PAD.t + ch} stroke="#1e2330" strokeWidth="1" />
          );
        })}

        <path d={area} fill={`url(#probGrad_${uid})`} />
        <path d={d} fill="none" stroke={`url(#lineGrad_${uid})`} strokeWidth="2" strokeLinecap="round" />

        {/* Trade markers — from actual backtest results */}
        {trades && trades.map((trade, i) => {
          const tradeDate = trade.date;
          const idx = filteredHistory.findIndex(
            h => new Date(h.t * 1000).toISOString().slice(0, 10) === tradeDate
          );
          if (idx < 0) return null;
          const [x, y] = pts[idx] ?? [0, 0];

          const isBuy   = trade.action.startsWith("BUY");
          const isShort = trade.action.startsWith("SHORT");
          const isCover = trade.action.startsWith("COVER");
          // SELL and SELL (forced close) both start with SELL
          const color  = isBuy ? "#22c55e" : isShort ? "#f59e0b" : isCover ? "#7b61ff" : "#ef4444";
          const fill   = isBuy ? "rgba(34,197,94,0.18)" : isShort ? "rgba(245,158,11,0.18)" : isCover ? "rgba(123,97,255,0.18)" : "rgba(239,68,68,0.18)";
          const label  = isBuy ? "B" : isShort ? "↓" : isCover ? "C" : "S";

          return (
            <g key={i} transform={`translate(${x},${y})`}>
              <circle r="7" fill={fill} stroke={color} strokeWidth="1.5" />
              <text textAnchor="middle" dominantBaseline="central" fontSize="7" fontWeight="700"
                fontFamily="IBM Plex Mono, monospace" fill={color}>{label}</text>
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

      {/* HTML axis labels — rendered outside SVG so they don't stretch on resize */}
      <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
        {yTicks.map(t => {
          const yPct = (PAD.t + (1 - t) * ch) / H * 100;
          const label = needsNorm
            ? `$${(minP + t * (maxP - minP)).toFixed(0)}`
            : `${Math.round(t * 100)}%`;
          return (
            <div key={t} style={{
              position: "absolute",
              top: `${yPct}%`,
              left: 0,
              width: `${(PAD.l - 6) / W * 100}%`,
              transform: "translateY(-50%)",
              textAlign: "right",
              fontSize: "9px",
              color: "#606880",
              fontFamily: "IBM Plex Mono, monospace",
              lineHeight: 1,
            }}>
              {label}
            </div>
          );
        })}
        {[0, 1, 2, 3, 4].map(i => {
          const idx = Math.min(i * xStep, curve.length - 1);
          const xPct = (PAD.l + (idx / (curve.length - 1)) * cw) / W * 100;
          return (
            <div key={i} style={{
              position: "absolute",
              bottom: `${6 / H * 100}%`,
              left: `${xPct}%`,
              transform: "translateX(-50%)",
              fontSize: "9px",
              color: "#606880",
              fontFamily: "IBM Plex Mono, monospace",
              whiteSpace: "nowrap",
              lineHeight: 1,
            }}>
              {getDateAt(idx).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </div>
          );
        })}
      </div>

      {tooltip && (
        <div className="svg-tooltip" style={{ left: tooltip.x + 12, top: Math.max(8, tooltip.y - 20) }}>
          <div className="stt-date">{tooltip.label}</div>
          <div className="stt-row">
            <span className="stt-key">{needsNorm ? "Price" : "Prob"}</span>
            <span className="stt-val">
              {needsNorm
                ? `$${(minP + tooltip.prob * (maxP - minP)).toFixed(2)}`
                : `${(tooltip.prob * 100).toFixed(1)}%`}
            </span>
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

      {/* Timeframe selector — hidden when a backtest calendar window overrides it */}
      {!hasCalWindow && (
        <div style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 2 }}>
          {TIMEFRAMES.map(tf => {
            const active = viewDays === tf.days;
            return (
              <button
                key={tf.label}
                onClick={() => setViewDays(tf.days)}
                style={{
                  padding: "1px 5px", borderRadius: 3, cursor: "pointer",
                  fontFamily: "IBM Plex Mono, monospace", fontSize: 8, fontWeight: active ? 700 : 400,
                  border: `1px solid ${active ? "rgba(0,212,168,0.5)" : "var(--border2)"}`,
                  background: active ? "rgba(0,212,168,0.12)" : "var(--surface2)",
                  color: active ? "var(--accent)" : "var(--muted)",
                }}
              >
                {tf.label}
              </button>
            );
          })}
        </div>
      )}
      {hasCalWindow && (
        <div style={{ position: "absolute", top: 4, right: 4, fontSize: 8, color: "var(--accent)", opacity: 0.7, fontFamily: "IBM Plex Mono, monospace" }}>
          {dateFrom ?? "…"} → {dateTo ?? "now"}
        </div>
      )}
    </div>
  );
}
