import { useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { apiFetch } from "../../lib/apiFetch";

interface Dimension {
  label:  string;
  values: number[];
}

interface ParallelData {
  dimensions: Dimension[];
  months:     string[];
  n_obs:      number;
}

export default function SurfacePlot() {
  const [data, setData]             = useState<ParallelData | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    apiFetch("/api/fred/parallel")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError("Failed to load surface data"); setLoading(false); });
  }, []);

  if (loading) return (
    <div style={{ fontSize: 10, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
      Building macro terrain…
    </div>
  );

  if (error || !data || data.dimensions.length === 0 || data.n_obs < 3) return (
    <div style={{ fontSize: 10, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
      {error ?? "Insufficient data — seed FRED cache first"}
    </div>
  );

  // Z matrix: one row per indicator, one column per month (rows = y-axis, cols = x-axis)
  const z      = data.dimensions.map(d => d.values);
  const labels = data.dimensions.map(d => d.label);

  // Show every Nth month label to avoid crowding
  const step     = Math.max(1, Math.floor(data.months.length / 8));
  const xLabels  = data.months.map((m, i) => (i % step === 0 ? m.slice(0, 7) : ""));

  const plotData = [{
    type: "surface" as const,
    x: xLabels, y: labels, z,
    colorscale: [[0.0,"#7f1d1d"],[0.25,"#b45309"],[0.5,"#1e3a5f"],[0.75,"#0e7490"],[1.0,"#14532d"]],
    cmin: 0, cmax: 100, showscale: true,
    colorbar: { thickness: 12, len: 0.7, tickvals: [0,25,50,75,100], ticktext: ["0","25","50","75","100"],
      tickfont: { size: 8, color: "#94a3b8", family: "IBM Plex Mono, monospace" } },
    contours: { z: { show: true, usecolormap: true, highlightcolor: "#ffffff22", project: { z: true } } },
    opacity: 0.92,
    hovertemplate: "<b>%{y}</b><br>%{x}<br>Score: %{z:.1f}<extra></extra>",
  } as any];

  const sceneConfig = {
    bgcolor: "rgba(0,0,0,0)",
    xaxis: { title: { text: "Month", font: { size: 9, color: "#94a3b8" } }, tickfont: { size: 8, color: "#94a3b8", family: "IBM Plex Mono, monospace" }, gridcolor: "rgba(255,255,255,0.08)", showbackground: false },
    yaxis: { title: { text: "", font: { size: 9, color: "#94a3b8" } }, tickfont: { size: 8, color: "#94a3b8", family: "IBM Plex Mono, monospace" }, gridcolor: "rgba(255,255,255,0.08)", showbackground: false },
    zaxis: { title: { text: "Score", font: { size: 9, color: "#94a3b8" } }, range: [0,100], tickvals: [0,25,50,75,100], tickfont: { size: 8, color: "#94a3b8", family: "IBM Plex Mono, monospace" }, gridcolor: "rgba(255,255,255,0.08)", showbackground: false },
    camera: { eye: { x: 1.6, y: -1.6, z: 0.9 }, center: { x: 0, y: 0, z: -0.1 } },
    aspectmode: "manual" as const, aspectratio: { x: 2.2, y: 1, z: 0.7 },
  };

  const plotLayout = {
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    margin: { t: 10, r: 20, b: 10, l: 20 },
    scene: sceneConfig,
    font: { family: "IBM Plex Mono, monospace", size: 9, color: "#94a3b8" },
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
      X = time · Y = indicator · Z = normalised score 0–100 · green peaks = elevated · red valleys = suppressed
      &nbsp;·&nbsp;{data.n_obs} months · drag to rotate
    </div>
  );

  if (fullscreen) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--bg)",
        display: "flex", flexDirection: "column", padding: "20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Macro Landscape — 3D Surface</span>
          {toggleBtn}
        </div>
        {subtitle}
        <Plot data={plotData} layout={{ ...plotLayout, autosize: true }}
          config={{ displayModeBar: true, responsive: true, displaylogo: false }}
          style={{ width: "100%", flex: 1 }} useResizeHandler />
      </div>
    );
  }

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: 8, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Macro Landscape — 3D Surface</span>
        {toggleBtn}
      </div>
      {subtitle}
      <Plot data={plotData} layout={plotLayout}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%", height: 380 }} useResizeHandler />
    </div>
  );
}
