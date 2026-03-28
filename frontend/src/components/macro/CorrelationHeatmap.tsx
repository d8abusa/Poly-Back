import { useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { apiFetch } from "../../lib/apiFetch";

interface HeatmapData {
  x:     string[];
  y:     string[];
  z:     number[][];
  n_obs: number;
  note:  string;
}

export default function CorrelationHeatmap() {
  const [data, setData]             = useState<HeatmapData | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    apiFetch("/api/fred/correlation")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError("Failed to load correlation data"); setLoading(false); });
  }, []);

  if (loading) return (
    <div style={{ fontSize: 10, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
      Computing correlations…
    </div>
  );

  if (error || !data || data.x.length === 0) return (
    <div style={{ fontSize: 10, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
      {error ?? "Insufficient data — seed FRED cache first"}
    </div>
  );

  const text = data.z.map(row => row.map(v => v === null ? "—" : v.toFixed(2)));

  const plotData = [{
    type:        "heatmap" as const,
    x:           data.x,
    y:           data.y,
    z:           data.z,
    text:        text,
    texttemplate: "%{text}",
    colorscale:  "RdBu",
    zmid:        0,
    zmin:        -1,
    zmax:        1,
    showscale:   true,
    hoverongaps: false,
    hovertemplate: "<b>%{y}</b> × <b>%{x}</b><br>r = %{z:.3f}<extra></extra>",
    colorbar: {
      thickness: 12, len: 0.8,
      tickfont:  { size: 9, color: "#94a3b8", family: "IBM Plex Mono, monospace" },
      tickvals:  [-1, -0.5, 0, 0.5, 1],
      ticktext:  ["-1", "-0.5", "0", "+0.5", "+1"],
    },
  }];

  const plotLayout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor:  "rgba(0,0,0,0)",
    margin:        { t: 10, r: 60, b: 80, l: 100 },
    font:          { family: "IBM Plex Mono, monospace", size: 10, color: "#94a3b8" },
    xaxis: { tickangle: -35, tickfont: { size: 9, color: "#94a3b8" }, gridcolor: "rgba(255,255,255,0.05)" },
    yaxis: { tickfont: { size: 9, color: "#94a3b8" }, gridcolor: "rgba(255,255,255,0.05)", autorange: "reversed" as const },
    annotations: data.z.flatMap((row, i) =>
      row.map((val, j) => ({
        x: data.x[j], y: data.y[i], text: val.toFixed(2), showarrow: false,
        font: { size: 9, color: Math.abs(val) > 0.5 ? "#fff" : "#94a3b8", family: "IBM Plex Mono, monospace" },
      }))
    ),
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
      Pearson r on first-differences · pairwise alignment · up to {data.n_obs} obs/pair · blue = positive · red = negative
    </div>
  );

  const warning = data.n_obs < 6 && (
    <div style={{ fontSize: 8, color: "#f59e0b", marginTop: 6 }}>
      ⚠ Only {data.n_obs} pairwise observations — seed more FRED cache data to improve statistical power
    </div>
  );

  if (fullscreen) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--bg)",
        display: "flex", flexDirection: "column", padding: "20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Indicator Correlation Matrix</span>
          {toggleBtn}
        </div>
        {subtitle}
        <Plot data={plotData as any} layout={{ ...plotLayout, autosize: true }}
          config={{ displayModeBar: true, responsive: true, displaylogo: false }}
          style={{ width: "100%", flex: 1 }} useResizeHandler />
        {warning}
      </div>
    );
  }

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: 8, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Indicator Correlation Matrix</span>
        {toggleBtn}
      </div>
      {subtitle}
      <Plot data={plotData as any} layout={plotLayout}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%", height: 340 }} useResizeHandler />
      {warning}
    </div>
  );
}
