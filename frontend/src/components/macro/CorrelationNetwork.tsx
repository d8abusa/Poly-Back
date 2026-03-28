import { useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { apiFetch } from "../../lib/apiFetch";

interface Node {
  id:            string;
  label:         string;
  n_connections: number;
}

interface Edge {
  source: string;
  target: string;
  r:      number;
  abs_r:  number;
  n_obs:  number;
}

interface NetworkData {
  nodes:     Node[];
  edges:     Edge[];
  threshold: number;
  n_active:  number;
}

// Place n nodes evenly around a unit circle.
function circleLayout(ids: string[]): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  ids.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / ids.length - Math.PI / 2;
    pos[id] = { x: Math.cos(angle), y: Math.sin(angle) };
  });
  return pos;
}

export default function CorrelationNetwork() {
  const [data, setData]             = useState<NetworkData | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    apiFetch("/api/fred/network")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError("Failed to load network data"); setLoading(false); });
  }, []);

  if (loading) return (
    <div style={{ fontSize: 10, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
      Building correlation network…
    </div>
  );

  if (error || !data || data.nodes.length === 0) return (
    <div style={{ fontSize: 10, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
      {error ?? "Insufficient data — seed FRED cache first"}
    </div>
  );

  const pos = circleLayout(data.nodes.map(n => n.id));

  // One scatter trace per edge so we can vary line width and color
  const edgeTraces = data.edges.map(e => {
    const a = pos[e.source];
    const b = pos[e.target];
    const positive = e.r >= 0;
    // opacity: 0.25 at threshold, 1.0 at |r|=1
    const opacity  = 0.25 + 0.75 * e.abs_r;
    const width    = 1 + e.abs_r * 7;

    return {
      type:      "scatter" as const,
      x:         [a.x, b.x],
      y:         [a.y, b.y],
      mode:      "lines" as const,
      line: {
        color:   positive ? `rgba(56,189,248,${opacity.toFixed(2)})` : `rgba(248,113,113,${opacity.toFixed(2)})`,
        width,
      },
      hoverinfo: "none" as const,
      showlegend: false,
    };
  });

  // Node sizes: base 18, +4 per connection
  const nodeX      = data.nodes.map(n => pos[n.id].x);
  const nodeY      = data.nodes.map(n => pos[n.id].y);
  const nodeSizes  = data.nodes.map(n => 18 + n.n_connections * 5);
  const nodeLabels = data.nodes.map(n => n.label);
  const nodeHover  = data.nodes.map(n => {
    const connected = data.edges
      .filter(e => e.source === n.id || e.target === n.id)
      .map(e => {
        const partner = e.source === n.id ? e.target : e.source;
        const pLabel  = data.nodes.find(x => x.id === partner)?.label ?? partner;
        return `  ${pLabel}: r=${e.r > 0 ? "+" : ""}${e.r.toFixed(2)} (${e.n_obs} obs)`;
      });
    return `<b>${n.label}</b><br>${connected.length ? connected.join("<br>") : "no edges above threshold"}`;
  });

  const nodeTrace = {
    type:        "scatter" as const,
    x:           nodeX,
    y:           nodeY,
    mode:        "markers+text" as const,
    marker: {
      size:      nodeSizes,
      color:     "#1e3a5f",
      line:      { color: "#38bdf8", width: 1.5 },
      opacity:   0.95,
    },
    text:        nodeLabels,
    textfont:    { size: 9, color: "#cbd5e1", family: "IBM Plex Mono, monospace" },
    textposition: "top center" as const,
    hovertext:   nodeHover,
    hoverinfo:   "text" as const,
    hoverlabel: {
      bgcolor:   "#1e293b",
      bordercolor: "#38bdf8",
      font:      { size: 9, color: "#e2e8f0", family: "IBM Plex Mono, monospace" },
    },
    showlegend:  false,
  };

  // Legend traces (invisible scatter, just for the legend)
  const posLegend = {
    type: "scatter" as const, x: [null], y: [null], mode: "lines" as const,
    line: { color: "rgba(56,189,248,0.8)", width: 3 },
    name: "positive r", showlegend: true,
  };
  const negLegend = {
    type: "scatter" as const, x: [null], y: [null], mode: "lines" as const,
    line: { color: "rgba(248,113,113,0.8)", width: 3 },
    name: "negative r", showlegend: true,
  };

  const plotData = [...edgeTraces, nodeTrace, posLegend, negLegend] as any;

  const plotLayout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor:  "rgba(0,0,0,0)",
    margin:        { t: 20, r: 20, b: 20, l: 20 },
    xaxis: { visible: false, range: [-1.45, 1.45], fixedrange: true },
    yaxis: { visible: false, range: [-1.45, 1.45], fixedrange: true, scaleanchor: "x" as const },
    legend: {
      x: 0.01, y: 0.99, bgcolor: "rgba(0,0,0,0)",
      bordercolor: "rgba(255,255,255,0.1)", borderwidth: 1,
      font: { size: 8, color: "#94a3b8", family: "IBM Plex Mono, monospace" },
    },
    hovermode: "closest" as const,
  };

  const toggleBtn = (
    <button onClick={() => setFullscreen(f => !f)} title={fullscreen ? "Minimize" : "Fullscreen"}
      style={{ background: "none", border: "1px solid var(--border2)", borderRadius: 3,
        color: "var(--muted)", cursor: "pointer", fontSize: 11, padding: "1px 6px",
        fontFamily: "IBM Plex Mono, monospace", lineHeight: 1 }}>
      {fullscreen ? "⊠" : "⛶"}
    </button>
  );

  const subtitle = (
    <div style={{ fontSize: 8, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
      Nodes = FRED indicators · edges = |r| ≥ {data.threshold} · thickness &amp; opacity = correlation strength
      · blue = positive · red = negative · hover nodes for details
    </div>
  );

  const warning = data.edges.length === 0 && (
    <div style={{ fontSize: 8, color: "#f59e0b", marginTop: 6 }}>
      ⚠ No edges above threshold ({data.threshold}) — all indicator pairs are weakly correlated
    </div>
  );

  if (fullscreen) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--bg)",
        display: "flex", flexDirection: "column", padding: "20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Correlation Network</span>
          {toggleBtn}
        </div>
        {subtitle}
        <Plot data={plotData} layout={{ ...plotLayout, autosize: true }}
          config={{ displayModeBar: true, responsive: true, displaylogo: false }}
          style={{ width: "100%", flex: 1 }} useResizeHandler />
        {warning}
      </div>
    );
  }

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: 8, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Correlation Network</span>
        {toggleBtn}
      </div>
      {subtitle}
      <Plot data={plotData} layout={plotLayout}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%", height: 360 }} useResizeHandler />
      {warning}
    </div>
  );
}
