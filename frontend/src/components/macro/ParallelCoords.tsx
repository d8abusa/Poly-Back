import { useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { apiFetch } from "../../lib/apiFetch";

interface Dimension {
  label:     string;
  series_id: string;
  values:    number[];
  range:     [number, number];
}

interface ParallelData {
  dimensions: Dimension[];
  months:     string[];
  n_obs:      number;
}

export default function ParallelCoords() {
  const [data, setData]             = useState<ParallelData | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    apiFetch("/api/fred/parallel")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError("Failed to load parallel data"); setLoading(false); });
  }, []);

  if (loading) return (
    <div style={{ fontSize: 10, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
      Loading parallel coordinates…
    </div>
  );

  if (error || !data || data.dimensions.length === 0) return (
    <div style={{ fontSize: 10, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
      {error ?? "Insufficient data — seed FRED cache first"}
    </div>
  );

  const n = data.months.length;

  // Colour lines by recency: 0 = oldest (dark purple), n-1 = newest (bright yellow)
  const lineColors = data.months.map((_, i) => i);

  const plotDimensions = data.dimensions.map(dim => ({
    label:          dim.label,
    values:         dim.values,
    range:          dim.range,
    tickvals:       [0, 25, 50, 75, 100],
    ticktext:       ["0", "25", "50", "75", "100"],
    tickfont:       { size: 9, color: "#94a3b8", family: "IBM Plex Mono, monospace" },
    labelfont:      { size: 10, color: "#cbd5e1", family: "IBM Plex Mono, monospace" },
  }));

  const customdata = data.months;

  const plotData = [{
    type: "parcoords" as const,
    line: {
      color: lineColors, colorscale: "Plasma", showscale: true, cmin: 0, cmax: n - 1,
      colorbar: {
        thickness: 12, len: 0.7,
        tickvals:  [0, Math.round((n - 1) / 2), n - 1],
        ticktext:  [data.months[0]?.slice(0, 7) ?? "oldest", data.months[Math.round((n - 1) / 2)]?.slice(0, 7) ?? "mid", data.months[n - 1]?.slice(0, 7) ?? "newest"],
        tickfont:  { size: 8, color: "#94a3b8", family: "IBM Plex Mono, monospace" },
        title:     { text: "", font: { size: 8 } },
      },
    },
    dimensions: plotDimensions,
    customdata,
  } as any];

  const plotLayout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor:  "rgba(0,0,0,0)",
    margin:        { t: 40, r: 80, b: 20, l: 60 },
    font:          { family: "IBM Plex Mono, monospace", size: 10, color: "#94a3b8" },
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
      Each line = one month · axes normalised 0–100 · dark purple = oldest · bright yellow = most recent
      &nbsp;·&nbsp;{n} observations
    </div>
  );

  const warning = n < 6 && (
    <div style={{ fontSize: 8, color: "#f59e0b", marginTop: 6 }}>
      ⚠ Only {n} observations — seed more FRED cache data for meaningful patterns
    </div>
  );

  if (fullscreen) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--bg)",
        display: "flex", flexDirection: "column", padding: "20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Macro Regime Trajectories</span>
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
        <span style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Macro Regime Trajectories</span>
        {toggleBtn}
      </div>
      {subtitle}
      <Plot data={plotData} layout={plotLayout}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%", height: 320 }} useResizeHandler />
      {warning}
    </div>
  );
}
