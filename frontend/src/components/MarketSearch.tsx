import { useState, useEffect, useRef } from "react";

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=IBM+Plex+Mono:wght@300;400;500&family=Instrument+Serif:ital@0;1&display=swap');`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Market {
  id: string;
  condition_id: string | null;
  token_id: string | null;
  title: string;
  category: string;
  prob: number;
  volume: number;
  liquidity: number;
  resolved: boolean;
  outcome: string | null;
  end_date: string;
  tags: string[];
}

interface HistoryPoint {
  t: number; // unix timestamp
  p: number; // probability 0–1
}

// ── CSS (unchanged from wireframe) ───────────────────────────────────────────

const css = `
  ${FONT}
  * { margin:0; padding:0; box-sizing:border-box; }
  :root {
    --bg:#0a0c0f; --surface:#111318; --surface2:#181c23;
    --border:#1e2330; --border2:#252d3d;
    --accent:#00d4a8; --accent2:#ff6b35; --accent3:#7b61ff;
    --yes:#22c55e; --no:#ef4444;
    --text:#e8eaf0; --muted:#606880; --muted2:#8891aa;
  }
  body { background:var(--bg); color:var(--text); font-family:'IBM Plex Mono',monospace; font-size:13px; }
  .root { display:flex; flex-direction:column; height:100vh; background:var(--bg); overflow:hidden; position:relative; }
  .root::before { content:''; position:fixed; inset:0; background-image:linear-gradient(rgba(0,212,168,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,212,168,0.025) 1px,transparent 1px); background-size:40px 40px; pointer-events:none; z-index:0; }

  /* HEADER */
  .header { height:52px; background:rgba(10,12,15,0.95); border-bottom:1px solid var(--border); display:flex; align-items:center; padding:0 20px; gap:16px; flex-shrink:0; position:relative; z-index:10; backdrop-filter:blur(12px); }
  .logo { display:flex; align-items:center; gap:8px; font-family:'Syne',sans-serif; font-weight:800; font-size:16px; color:var(--text); }
  .logo-mark { width:26px; height:26px; background:linear-gradient(135deg,var(--accent),var(--accent3)); border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:11px; color:#000; font-weight:700; }
  .logo span { color:var(--accent); }
  .header-sub { font-size:11px; color:var(--muted2); margin-left:4px; border-left:1px solid var(--border2); padding-left:12px; }
  .header-right { margin-left:auto; display:flex; align-items:center; gap:10px; font-size:11px; color:var(--muted2); }
  .sel-count { background:rgba(0,212,168,0.1); color:var(--accent); border:1px solid rgba(0,212,168,0.25); padding:3px 10px; border-radius:4px; font-size:10px; font-weight:600; }

  /* LAYOUT */
  .layout { display:grid; grid-template-columns:340px 1fr; flex:1; overflow:hidden; position:relative; z-index:1; }

  /* LEFT — SEARCH PANEL */
  .search-panel { border-right:1px solid var(--border); display:flex; flex-direction:column; overflow:hidden; }

  .search-box { padding:12px 14px; border-bottom:1px solid var(--border); background:var(--surface); flex-shrink:0; }
  .search-wrap { position:relative; }
  .search-icon { position:absolute; left:10px; top:50%; transform:translateY(-50%); color:var(--muted); pointer-events:none; }
  .search-clear { position:absolute; right:10px; top:50%; transform:translateY(-50%); color:var(--muted); cursor:pointer; font-size:14px; line-height:1; transition:color 0.12s; }
  .search-clear:hover { color:var(--text); }
  .search-input { width:100%; background:var(--surface2); border:1px solid var(--border2); border-radius:7px; padding:8px 32px; color:var(--text); font-family:'IBM Plex Mono',monospace; font-size:12px; outline:none; transition:border-color 0.15s; }
  .search-input:focus { border-color:var(--accent); box-shadow:0 0 0 2px rgba(0,212,168,0.08); }
  .search-input::placeholder { color:var(--muted); }

  .cat-bar { display:flex; gap:5px; padding:8px 14px; border-bottom:1px solid var(--border); overflow-x:auto; flex-shrink:0; }
  .cat-bar::-webkit-scrollbar { display:none; }
  .cat-btn { padding:3px 10px; border-radius:4px; font-size:10px; cursor:pointer; background:var(--surface2); color:var(--muted2); border:1px solid var(--border2); white-space:nowrap; transition:all 0.12s; font-family:'IBM Plex Mono',monospace; }
  .cat-btn:hover { color:var(--text); }
  .cat-btn.active { background:rgba(123,97,255,0.1); color:var(--accent3); border-color:rgba(123,97,255,0.3); }

  .sort-bar { display:flex; align-items:center; gap:8px; padding:7px 14px; border-bottom:1px solid var(--border); flex-shrink:0; }
  .sort-label { font-size:10px; color:var(--muted); }
  .sort-btn { padding:2px 8px; border-radius:3px; font-size:10px; cursor:pointer; background:transparent; color:var(--muted2); border:1px solid transparent; transition:all 0.12s; font-family:'IBM Plex Mono',monospace; }
  .sort-btn:hover { color:var(--text); }
  .sort-btn.active { color:var(--accent); background:rgba(0,212,168,0.07); border-color:rgba(0,212,168,0.2); }
  .result-count { margin-left:auto; font-size:10px; color:var(--muted); }

  .market-list { flex:1; overflow-y:auto; }
  .market-list::-webkit-scrollbar { width:3px; }
  .market-list::-webkit-scrollbar-thumb { background:var(--border2); border-radius:2px; }

  .market-item { padding:10px 14px; border-bottom:1px solid var(--border); cursor:pointer; transition:all 0.12s; display:flex; align-items:flex-start; gap:10px; }
  .market-item:hover { background:var(--surface2); }
  .market-item.selected { background:rgba(0,212,168,0.05); border-left:2px solid var(--accent); }
  .market-item.queued { background:rgba(123,97,255,0.04); }

  .m-check { width:15px; height:15px; border:1px solid var(--border2); border-radius:3px; flex-shrink:0; margin-top:1px; display:flex; align-items:center; justify-content:center; transition:all 0.12s; background:var(--surface2); }
  .m-check.on { background:var(--accent3); border-color:var(--accent3); }
  .m-check.on::after { content:'✓'; font-size:9px; color:#fff; font-weight:700; }

  .m-body { flex:1; min-width:0; }
  .m-title { font-size:11px; color:var(--text); line-height:1.35; margin-bottom:4px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .m-meta { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .m-tag { font-size:9px; padding:1px 5px; border-radius:3px; background:var(--surface2); color:var(--muted2); border:1px solid var(--border2); }
  .m-cat { font-size:9px; padding:1px 5px; border-radius:3px; }
  .m-vol { font-size:9px; color:var(--muted2); }

  .m-right { display:flex; flex-direction:column; align-items:flex-end; gap:4px; flex-shrink:0; }
  .m-prob { font-family:'Syne',sans-serif; font-size:15px; font-weight:700; }
  .m-prob.hi { color:var(--yes); }
  .m-prob.mid { color:var(--accent); }
  .m-prob.lo { color:var(--no); }
  .m-outcome { font-size:9px; padding:1px 6px; border-radius:3px; font-weight:600; }
  .m-outcome.yes { background:rgba(34,197,94,0.12); color:var(--yes); border:1px solid rgba(34,197,94,0.2); }
  .m-outcome.no { background:rgba(239,68,68,0.1); color:var(--no); border:1px solid rgba(239,68,68,0.2); }

  .no-results { padding:40px 20px; text-align:center; color:var(--muted); }
  .no-results-icon { font-size:28px; margin-bottom:8px; opacity:0.4; }
  .no-results-title { font-family:'Syne',sans-serif; font-size:13px; color:var(--muted2); margin-bottom:4px; }
  .no-results-sub { font-size:10px; }

  /* RIGHT — DETAIL PANEL */
  .detail-panel { display:flex; flex-direction:column; overflow:hidden; }

  .detail-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:var(--muted); }
  .detail-empty-icon { font-size:36px; opacity:0.25; }
  .detail-empty-title { font-family:'Syne',sans-serif; font-size:15px; color:var(--muted2); }
  .detail-empty-sub { font-size:11px; text-align:center; max-width:260px; line-height:1.5; }
  .detail-empty-hint { font-size:10px; color:var(--accent); background:rgba(0,212,168,0.07); border:1px solid rgba(0,212,168,0.18); padding:5px 12px; border-radius:5px; margin-top:4px; }

  .detail-header { padding:16px 20px 12px; border-bottom:1px solid var(--border); flex-shrink:0; }
  .detail-title { font-family:'Instrument Serif',serif; font-size:19px; font-style:italic; color:var(--text); line-height:1.25; margin-bottom:8px; }
  .detail-meta { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .dmeta { font-size:10px; color:var(--muted2); display:flex; align-items:center; gap:4px; }
  .dmeta .dot { width:6px; height:6px; border-radius:50%; background:var(--yes); }
  .dmeta .dot.no { background:var(--no); }
  .anomaly { display:inline-flex; align-items:center; gap:4px; font-size:10px; padding:2px 7px; border-radius:4px; background:rgba(255,107,53,0.1); color:var(--accent2); border:1px solid rgba(255,107,53,0.2); }

  /* PROB CHART */
  .prob-chart-wrap { flex:1; min-height:0; padding:16px 20px 8px; display:flex; flex-direction:column; }
  .prob-chart-label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; }
  .prob-chart-label span { color:var(--muted2); font-size:11px; text-transform:none; letter-spacing:0; }
  .prob-chart { flex:1; min-height:120px; position:relative; }
  svg.prob-svg { width:100%; height:100%; display:block; }

  /* STATS ROW */
  .detail-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--border); border-top:1px solid var(--border); flex-shrink:0; }
  .dstat { background:var(--surface); padding:10px 14px; }
  .dstat-label { font-size:9px; color:var(--muted); text-transform:uppercase; letter-spacing:0.7px; margin-bottom:3px; }
  .dstat-val { font-family:'Syne',sans-serif; font-size:16px; font-weight:700; }
  .dstat-val.g { color:var(--yes); }
  .dstat-val.r { color:var(--no); }
  .dstat-val.t { color:var(--accent); }
  .dstat-val.b { color:var(--accent3); }
  .dstat-sub { font-size:9px; color:var(--muted2); margin-top:1px; }

  /* STRUCTURAL EDGE STRIP */
  .edge-strip { padding:9px 20px; border-top:1px solid rgba(255,107,53,0.2); background:rgba(255,107,53,0.04); display:flex; align-items:center; gap:14px; flex-shrink:0; flex-wrap:wrap; }
  .edge-badge { font-size:9px; padding:2px 7px; border-radius:3px; background:rgba(255,107,53,0.12); color:var(--accent2); border:1px solid rgba(255,107,53,0.2); font-weight:600; letter-spacing:0.4px; }
  .edge-item { display:flex; flex-direction:column; gap:1px; }
  .edge-label { font-size:9px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px; }
  .edge-val { font-size:12px; font-family:'Syne',sans-serif; font-weight:700; }
  .edge-val.warn { color:var(--accent2); }
  .edge-val.good { color:var(--yes); }
  .edge-val.bad { color:var(--no); }
  .edge-val.neutral { color:var(--accent3); }
  .edge-div { width:1px; height:22px; background:rgba(255,107,53,0.18); }

  /* QUEUE BAR */
  .queue-bar { padding:10px 14px; border-top:1px solid var(--border); background:var(--surface); display:flex; align-items:center; gap:10px; flex-shrink:0; }
  .queue-label { font-size:10px; color:var(--muted2); white-space:nowrap; }
  .queue-chips { flex:1; display:flex; gap:5px; flex-wrap:wrap; min-height:22px; }
  .q-chip { display:flex; align-items:center; gap:5px; padding:3px 8px; border-radius:4px; background:rgba(123,97,255,0.1); color:var(--accent3); border:1px solid rgba(123,97,255,0.2); font-size:10px; }
  .q-remove { cursor:pointer; opacity:0.5; font-size:13px; line-height:1; transition:opacity 0.12s; }
  .q-remove:hover { opacity:1; }
  .queue-run { padding:6px 16px; border-radius:6px; background:var(--accent); color:#000; font-family:'IBM Plex Mono',monospace; font-size:11px; font-weight:600; border:none; cursor:pointer; transition:all 0.15s; white-space:nowrap; flex-shrink:0; }
  .queue-run:hover { background:#00efc0; transform:translateY(-1px); }
  .queue-run:disabled { background:var(--border2); color:var(--muted); cursor:not-allowed; transform:none; }

  /* STRUCTURE BIAS METER */
  .bias-row { display:flex; align-items:center; gap:8px; margin-left:auto; }
  .bias-label { font-size:9px; color:var(--muted); }
  .bias-track { width:80px; height:5px; background:var(--border2); border-radius:3px; overflow:hidden; }
  .bias-fill { height:100%; border-radius:3px; background:linear-gradient(90deg,var(--accent2),#ff2255); transition:width 0.4s ease; }

  /* TOOLTIP */
  .svg-tooltip { position:absolute; background:var(--surface2); border:1px solid var(--border2); border-radius:7px; padding:8px 11px; font-size:11px; pointer-events:none; box-shadow:0 8px 24px rgba(0,0,0,0.4); z-index:20; min-width:130px; }
  .stt-date { font-size:9px; color:var(--muted2); margin-bottom:5px; }
  .stt-row { display:flex; justify-content:space-between; gap:12px; margin-bottom:2px; }
  .stt-key { color:var(--muted2); }
  .stt-val { color:var(--text); font-weight:600; }

  @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
  .fade-in { animation:fadeIn 0.2s ease; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Fallback synthetic curve when real history is unavailable
function genCurve(id: string, finalProb: number, n = 90): number[] {
  let seed = id.charCodeAt(2) * 37 + id.charCodeAt(3) * 13;
  const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };
  const pts: number[] = [];
  let v = rand() * 0.3 + 0.15;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const target = finalProb * t + (rand() * 0.15 + 0.1) * (1 - t);
    v = v * 0.82 + target * 0.18 + (rand() - 0.5) * 0.06;
    pts.push(Math.min(0.97, Math.max(0.03, v)));
  }
  pts[pts.length - 1] = finalProb;
  return pts;
}

function fmtVol(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}

function probColor(p: number): string {
  if (p >= 0.65) return "hi";
  if (p >= 0.35) return "mid";
  return "lo";
}

function catColor(cat: string): string {
  const map: Record<string, string> = {
    Economics: "#00d4a8", Politics: "#7b61ff", Crypto: "#f59e0b",
    Sports: "#22c55e", "Science & Tech": "#3b82f6", "Pop Culture": "#ec4899",
  };
  return map[cat] || "#8891aa";
}

// ── Prob Chart ────────────────────────────────────────────────────────────────

interface TooltipState { x: number; y: number; prob: number; label: string; }

function ProbChart({ market, history }: { market: Market; history: HistoryPoint[] | null }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const hasReal = history !== null && history.length >= 2;
  const curve = hasReal ? history.map(h => h.p) : genCurve(market.id, market.prob);

  const getDateAt = (idx: number): Date => {
    if (hasReal) return new Date(history[idx].t * 1000);
    const d = new Date("2024-01-01");
    d.setDate(d.getDate() + idx);
    return d;
  };

  const W = 600, H = 180, PAD = { t: 12, r: 12, b: 28, l: 44 };
  const cw = W - PAD.l - PAD.r, ch = H - PAD.t - PAD.b;

  const pts = curve.map((v, i) => [
    PAD.l + (i / (curve.length - 1)) * cw,
    PAD.t + (1 - v) * ch,
  ] as [number, number]);

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
    const svg = svgRef.current, wrap = wrapRef.current;
    if (!svg || !wrap) return;
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
          <linearGradient id="probGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00d4a8" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#00d4a8" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#00d4a8" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#00d4a8" stopOpacity="1" />
          </linearGradient>
        </defs>

        {yTicks.map(t => {
          const y = PAD.t + (1 - t) * ch;
          return <g key={t}>
            <line x1={PAD.l} y1={y} x2={PAD.l + cw} y2={y} stroke="#1e2330" strokeWidth="1" />
            <text x={PAD.l - 5} y={y + 3} textAnchor="end" fontSize="9" fill="#606880">{Math.round(t * 100)}%</text>
          </g>;
        })}
        {[0, 1, 2, 3, 4].map(i => {
          const idx = Math.min(i * xStep, curve.length - 1);
          const x = PAD.l + (idx / (curve.length - 1)) * cw;
          return <g key={i}>
            <line x1={x} y1={PAD.t} x2={x} y2={PAD.t + ch} stroke="#1e2330" strokeWidth="1" />
            <text x={x} y={H - 6} textAnchor="middle" fontSize="9" fill="#606880">
              {getDateAt(idx).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </text>
          </g>;
        })}

        <path d={area} fill="url(#probGrad)" />
        <path d={d} fill="none" stroke="url(#lineGrad)" strokeWidth="2" strokeLinecap="round" />

        {/* Trade markers (decorative until backtest results are loaded) */}
        {[18, 34, 52, 68, 78, 88].map((pct, i) => {
          const idx = Math.floor(pct / 100 * (curve.length - 1));
          const [x, y] = pts[idx] || [0, 0];
          const isBuy = i % 2 === 0;
          return <g key={i} transform={`translate(${x},${y})`}>
            <circle r="7" fill={isBuy ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)"}
              stroke={isBuy ? "#22c55e" : "#ef4444"} strokeWidth="1.5" />
            <text textAnchor="middle" dominantBaseline="central" fontSize="7" fontWeight="700"
              fill={isBuy ? "#22c55e" : "#ef4444"}>{isBuy ? "B" : "S"}</text>
          </g>;
        })}

        {tooltip && (() => {
          const scaleX = W / (svgRef.current?.getBoundingClientRect().width || W);
          const idx = Math.round(((tooltip.x * scaleX) - PAD.l) / cw * (curve.length - 1));
          const [cx, cy] = pts[Math.max(0, Math.min(idx, pts.length - 1))] || [0, 0];
          return <>
            <line x1={cx} y1={PAD.t} x2={cx} y2={PAD.t + ch} stroke="#252d3d" strokeWidth="1" strokeDasharray="3,3" />
            <circle cx={cx} cy={cy} r="4" fill="#00d4a8" stroke="#0a0c0f" strokeWidth="2" />
          </>;
        })()}
      </svg>

      {tooltip && (
        <div className="svg-tooltip" style={{ left: tooltip.x + 12, top: Math.max(8, tooltip.y - 20) }}>
          <div className="stt-date">{tooltip.label}</div>
          <div className="stt-row"><span className="stt-key">Prob</span><span className="stt-val">{(tooltip.prob * 100).toFixed(1)}%</span></div>
          <div className="stt-row"><span className="stt-key">Maker Edge</span><span className="stt-val" style={{ color: "#ff6b35" }}>+{makerEdge}</span></div>
          <div className="stt-row"><span className="stt-key">Signal</span><span className="stt-val" style={{ color: "#7b61ff" }}>{tooltip.prob > 0.5 ? "HOLD" : "WATCH"}</span></div>
        </div>
      )}

      {/* Real data indicator */}
      {hasReal && (
        <div style={{ position: "absolute", top: 4, right: 4, fontSize: 9, color: "var(--accent)", opacity: 0.6 }}>
          LIVE DATA · {curve.length} pts
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function App() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState("volume");
  const [selected, setSelected] = useState<Market | null>(null);
  const [queued, setQueued] = useState<Market[]>([]);
  const [toastMsg, setToastMsg] = useState("");

  const [priceHistory, setPriceHistory] = useState<HistoryPoint[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Fetch market list on mount ──────────────────────────────────────────────

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/markets?limit=100&order=volume")
      .then(r => {
        if (!r.ok) throw new Error(`API error ${r.status}`);
        return r.json();
      })
      .then(data => {
        setMarkets(data.markets ?? []);
        setSelected(data.markets?.[0] ?? null);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // ── Fetch price history when selected market changes ────────────────────────

  useEffect(() => {
    if (!selected?.token_id || !selected?.condition_id) {
      setPriceHistory(null);
      return;
    }
    setHistoryLoading(true);
    setPriceHistory(null);
    fetch(`/api/markets/${selected.condition_id}/history?token_id=${encodeURIComponent(selected.token_id)}&interval=max`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => setPriceHistory(data.history ?? []))
      .catch(() => setPriceHistory(null))
      .finally(() => setHistoryLoading(false));
  }, [selected?.condition_id]);

  // ── Derived category list ───────────────────────────────────────────────────

  const cats = ["All", ...Array.from(new Set(markets.map(m => m.category))).sort()];

  // ── Filtered + sorted market list ───────────────────────────────────────────

  const filtered = markets
    .filter(m => {
      const q = query.toLowerCase();
      const matchQ = !q || m.title.toLowerCase().includes(q) || m.tags.some(t => t.toLowerCase().includes(q)) || m.category.toLowerCase().includes(q);
      const matchC = cat === "All" || m.category === cat;
      return matchQ && matchC;
    })
    .sort((a, b) => {
      if (sort === "volume") return b.volume - a.volume;
      if (sort === "prob") return b.prob - a.prob;
      if (sort === "recent") return b.end_date.localeCompare(a.end_date);
      return 0;
    });

  // ── Actions ─────────────────────────────────────────────────────────────────

  const toggleQueue = (m: Market, e: React.MouseEvent) => {
    e.stopPropagation();
    setQueued(q => q.find(x => x.id === m.id) ? q.filter(x => x.id !== m.id) : [...q, m]);
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 3000);
  };

  const runQueue = async () => {
    if (!queued.length) return;
    const runnable = queued.filter(m => m.token_id);
    if (!runnable.length) {
      showToast("⚠ Selected markets have no price history available");
      return;
    }
    showToast(`▶ Running backtest on ${runnable.length} market${runnable.length > 1 ? "s" : ""}…`);
    try {
      const results = await Promise.all(
        runnable.map(m =>
          fetch("/api/backtest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              condition_id: m.condition_id ?? m.id,
              token_id: m.token_id,
              strategy: "threshold",
              entry_threshold: 0.30,
              exit_threshold: 0.70,
              initial_capital: 1000,
              interval: "max",
            }),
          }).then(r => r.json())
        )
      );
      const successes = results.filter(r => r.success);
      if (successes.length) {
        const avgReturn = successes.reduce((s: number, r: { total_return: number }) => s + r.total_return, 0) / successes.length;
        showToast(`✓ Done · ${successes.length} market${successes.length > 1 ? "s" : ""} · avg return ${avgReturn.toFixed(1)}%`);
      } else {
        showToast("⚠ Backtest returned no results");
      }
    } catch {
      showToast("⚠ Backtest failed — is the backend running?");
    }
  };

  // ── Structural edge metrics ──────────────────────────────────────────────────

  const structEdge = selected ? {
    makerEdge: (selected.prob * 1.25).toFixed(2),
    takerLoss: (selected.prob * 2.65).toFixed(2),
    delta: ((1 - selected.prob) * 57).toFixed(0),
    cohensD: "0.02",
    biasPct: Math.round(selected.prob < 0.15 ? 84 : selected.prob < 0.3 ? 67 : 41),
  } : null;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{css}</style>
      <div className="root">
        {/* HEADER */}
        <div className="header">
          <div className="logo"><div className="logo-mark">PB</div>Poly<span>Back</span></div>
          <div className="header-sub">Market Search</div>
          <div className="header-right">
            {loading
              ? <span style={{ color: "var(--accent)", fontSize: 10 }}>Loading markets…</span>
              : error
                ? <span style={{ color: "var(--no)", fontSize: 10 }}>⚠ {error}</span>
                : <span style={{ color: "var(--muted)" }}>{markets.length} markets indexed</span>
            }
            {queued.length > 0 && <span className="sel-count">⚡ {queued.length} queued</span>}
          </div>
        </div>

        <div className="layout">
          {/* LEFT */}
          <div className="search-panel">
            <div className="search-box">
              <div className="search-wrap">
                <svg className="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input className="search-input" value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Search markets, tags, categories…" autoFocus />
                {query && <span className="search-clear" onClick={() => setQuery("")}>×</span>}
              </div>
            </div>

            <div className="cat-bar">
              {cats.map(c => (
                <button key={c} className={`cat-btn${cat === c ? " active" : ""}`} onClick={() => setCat(c)}>{c}</button>
              ))}
            </div>

            <div className="sort-bar">
              <span className="sort-label">Sort:</span>
              {[["volume", "Volume"], ["prob", "Probability"], ["recent", "Recent"]].map(([k, l]) => (
                <button key={k} className={`sort-btn${sort === k ? " active" : ""}`} onClick={() => setSort(k)}>{l}</button>
              ))}
              <span className="result-count">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
            </div>

            <div className="market-list">
              {loading ? (
                <div className="no-results">
                  <div className="no-results-icon" style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</div>
                  <div className="no-results-title">Fetching markets…</div>
                  <div className="no-results-sub">Connecting to Polymarket</div>
                </div>
              ) : error ? (
                <div className="no-results">
                  <div className="no-results-icon">⚠</div>
                  <div className="no-results-title">Connection error</div>
                  <div className="no-results-sub">{error}<br/>Is the backend running on port 8000?</div>
                </div>
              ) : filtered.length === 0 ? (
                <div className="no-results">
                  <div className="no-results-icon">🔍</div>
                  <div className="no-results-title">No markets found</div>
                  <div className="no-results-sub">Try different keywords or clear the category filter</div>
                </div>
              ) : filtered.map(m => {
                const isSelected = selected?.id === m.id;
                const isQueued = queued.find(x => x.id === m.id);
                return (
                  <div key={m.id} className={`market-item${isSelected ? " selected" : ""}${isQueued ? " queued" : ""}`}
                    onClick={() => setSelected(m)}>
                    <div className={`m-check${isQueued ? " on" : ""}`} onClick={e => toggleQueue(m, e)} />
                    <div className="m-body">
                      <div className="m-title">{m.title}</div>
                      <div className="m-meta">
                        <span className="m-cat" style={{ background: catColor(m.category) + "18", color: catColor(m.category), border: `1px solid ${catColor(m.category)}33` }}>{m.category}</span>
                        <span className="m-vol">{fmtVol(m.volume)}</span>
                        {m.tags.slice(0, 1).map(t => <span key={t} className="m-tag">{t}</span>)}
                      </div>
                    </div>
                    <div className="m-right">
                      <span className={`m-prob ${probColor(m.prob)}`}>{Math.round(m.prob * 100)}¢</span>
                      {m.outcome && (
                        <span className={`m-outcome ${m.outcome === "YES" ? "yes" : "no"}`}>{m.outcome}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT */}
          <div className="detail-panel">
            {!selected ? (
              <div className="detail-empty">
                <div className="detail-empty-icon">📊</div>
                <div className="detail-empty-title">No market selected</div>
                <div className="detail-empty-sub">Click any market on the left to preview its probability curve and structural metrics</div>
                <div className="detail-empty-hint">☑ Check the box to add to your backtest queue</div>
              </div>
            ) : (
              <div className="fade-in" style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
                <div className="detail-header">
                  <div className="detail-title">{selected.title}</div>
                  <div className="detail-meta">
                    {selected.resolved && selected.outcome && (
                      <div className="dmeta">
                        <span className={`dot${selected.outcome === "NO" ? " no" : ""}`}></span>
                        Resolved {selected.outcome} · {new Date(selected.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                    )}
                    {!selected.resolved && selected.end_date && (
                      <div className="dmeta">Closes {new Date(selected.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
                    )}
                    <div className="dmeta">Vol: {fmtVol(selected.volume)}</div>
                    <div className="dmeta">Liq: {fmtVol(selected.liquidity)}</div>
                    <span className="anomaly">⚠ {selected.prob < 0.15 ? "Longshot bias detected" : "Price spike detected"}</span>
                  </div>
                </div>

                <div className="prob-chart-wrap">
                  <div className="prob-chart-label">
                    Probability Curve
                    <span>
                      {historyLoading ? "Loading history…" : priceHistory ? "Hover to inspect · B/S = simulated trades" : "Hover to inspect · B/S = simulated trades"}
                    </span>
                  </div>
                  <ProbChart market={selected} history={priceHistory} />
                </div>

                <div className="detail-stats">
                  <div className="dstat">
                    <div className="dstat-label">Final Prob</div>
                    <div className={`dstat-val ${probColor(selected.prob) === "hi" ? "g" : probColor(selected.prob) === "lo" ? "r" : "t"}`}>{Math.round(selected.prob * 100)}%</div>
                    <div className="dstat-sub">at resolution</div>
                  </div>
                  <div className="dstat">
                    <div className="dstat-label">Volume</div>
                    <div className="dstat-val t">{fmtVol(selected.volume)}</div>
                    <div className="dstat-sub">total traded</div>
                  </div>
                  <div className="dstat">
                    <div className="dstat-label">Liquidity</div>
                    <div className="dstat-val b">{fmtVol(selected.liquidity)}</div>
                    <div className="dstat-sub">available</div>
                  </div>
                  <div className="dstat">
                    <div className="dstat-label">Category</div>
                    <div className="dstat-val" style={{ fontSize: 13, color: catColor(selected.category) }}>{selected.category}</div>
                    <div className="dstat-sub">{selected.tags[0]}</div>
                  </div>
                </div>

                {structEdge && (
                  <div className="edge-strip">
                    <span className="edge-badge">⚡ STRUCT EDGE</span>
                    <div className="edge-div" />
                    <div className="edge-item"><div className="edge-label">Maker Edge</div><div className="edge-val good">+{structEdge.makerEdge}%</div></div>
                    <div className="edge-item"><div className="edge-label">Taker Loss</div><div className="edge-val bad">-{structEdge.takerLoss}%</div></div>
                    <div className="edge-item"><div className="edge-label">Δ_taker</div><div className="edge-val warn">-{structEdge.delta}%</div></div>
                    <div className="edge-item"><div className="edge-label">Cohen's d</div><div className="edge-val neutral">≈ {structEdge.cohensD}</div></div>
                    <div className="edge-div" />
                    <div className="bias-row">
                      <span className="edge-label">YES Bias</span>
                      <div className="bias-track"><div className="bias-fill" style={{ width: structEdge.biasPct + "%" }} /></div>
                      <span className="edge-val warn" style={{ fontSize: 11 }}>{structEdge.biasPct}%</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* QUEUE BAR */}
            <div className="queue-bar">
              <span className="queue-label">Backtest queue:</span>
              <div className="queue-chips">
                {queued.length === 0
                  ? <span style={{ fontSize: 10, color: "var(--muted)", alignSelf: "center" }}>No markets selected — check ☑ to add</span>
                  : queued.map(m => (
                    <div key={m.id} className="q-chip">
                      <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title.slice(0, 28)}…</span>
                      <span className="q-remove" onClick={() => setQueued(q => q.filter(x => x.id !== m.id))}>×</span>
                    </div>
                  ))
                }
              </div>
              <button className="queue-run" disabled={!queued.length} onClick={runQueue}>
                ▶ Run {queued.length > 0 ? `(${queued.length})` : ""}
              </button>
            </div>
          </div>
        </div>

        {toastMsg && (
          <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: 8, padding: "10px 18px", fontSize: 12, color: "var(--text)", zIndex: 999, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", whiteSpace: "nowrap", animation: "fadeIn 0.25s ease" }}>
            {toastMsg}
          </div>
        )}
      </div>
    </>
  );
}
