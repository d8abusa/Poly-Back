/**
 * FraserHeatmap3D — 3D scatter plot showing Fed tone vs macro conditions.
 *
 * Axes:
 *   X: Fed Tone Score (-1 hawkish → +1 dovish)
 *   Y: CPI YoY %
 *   Z: Unemployment %
 *   Color: Time (months ago — blue=recent, red=older)
 *   Size: Guidance strength (larger = stronger forward guidance)
 *   Hover: Date, tone label, rate direction, document title
 *
 * Rendered with react-plotly.js (already in project deps).
 */

import { useState, useEffect } from "react";
import Plot from "react-plotly.js";
import type { FraserSurfacePoint } from "../../types";
import { apiFetch } from "../../lib/apiFetch";

const TONE_COLORSCALE = [
  [0.0, "#ef4444"],   // hawkish
  [0.4, "#f97316"],
  [0.5, "#94a3b8"],   // neutral
  [0.7, "#22d3ee"],
  [1.0, "#22c55e"],   // dovish
];

const TIME_COLORSCALE = [
  [0.0, "#3b82f6"],   // recent = blue
  [0.5, "#8b5cf6"],
  [1.0, "#ef4444"],   // older  = red
];

type ColorMode = "tone" | "time" | "rate";

export default function FraserHeatmap3D() {
  const [points,   setPoints]   = useState<FraserSurfacePoint[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [colorMode,setColorMode]= useState<ColorMode>("tone");

  useEffect(() => {
    setLoading(true);
    apiFetch("/api/fraser/sentiment-surface")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.points) setPoints(d.points); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: 200, fontSize: 9, color: "var(--muted)",
        fontFamily: "IBM Plex Mono, monospace", background: "var(--surface2)",
        borderRadius: 8, border: "1px solid var(--border2)",
      }}>
        Loading 3D surface…
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: 160, fontSize: 9, color: "var(--muted)",
        fontFamily: "IBM Plex Mono, monospace", background: "var(--surface2)",
        borderRadius: 8, border: "1px solid var(--border2)", flexDirection: "column", gap: 6,
      }}>
        <div>No data for 3D surface</div>
        <div style={{ fontSize: 8 }}>Run ↻ Refresh to fetch and analyze FOMC documents</div>
      </div>
    );
  }

  // Color values by mode
  const colorValues = points.map(p => {
    if (colorMode === "tone") return (p.tone_score + 1) / 2;           // 0–1
    if (colorMode === "time") return p.months_ago;                      // age
    // rate_direction
    if (p.rate_direction === "hike") return 1.0;
    if (p.rate_direction === "cut")  return 0.0;
    return 0.5;
  });

  const colorscale = colorMode === "tone" ? TONE_COLORSCALE : TIME_COLORSCALE;

  const hoverText = points.map(p =>
    `<b>${p.date.slice(0, 7)}</b><br>` +
    `Tone: ${p.tone_score.toFixed(2)} (${p.tone_label})<br>` +
    `Rate signal: ${p.rate_direction}<br>` +
    `CPI: ${p.cpi.toFixed(1)}%<br>` +
    `Unemployment: ${p.unrate.toFixed(1)}%<br>` +
    (p.fed_rate != null ? `Fed Funds: ${p.fed_rate.toFixed(2)}%<br>` : "") +
    `<i>${p.title}</i>`
  );

  const trace: Plotly.Data = {
    type:   "scatter3d",
    x:      points.map(p => p.tone_score),
    y:      points.map(p => p.cpi),
    z:      points.map(p => p.unrate),
    mode:   "markers+text",
    marker: {
      size:       8,
      color:      colorValues,
      colorscale,
      showscale:  true,
      colorbar: {
        thickness: 8,
        len:       0.6,
        title: {
          text: colorMode === "tone" ? "Hawkish→Dovish" : colorMode === "time" ? "Months Ago" : "Rate Dir",
          side: "right",
          font: { size: 8, color: "#94a3b8" },
        },
        tickfont: { size: 7, color: "#94a3b8" },
        bgcolor:  "rgba(0,0,0,0)",
        bordercolor: "rgba(255,255,255,0.1)",
      },
      opacity:    0.9,
      line:       { color: "rgba(255,255,255,0.3)", width: 0.5 },
    },
    text:        points.map(p => p.date.slice(0, 7)),
    hovertext:   hoverText,
    hoverinfo:   "text",
  };

  const layout: Partial<Plotly.Layout> = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor:  "rgba(0,0,0,0)",
    margin:        { l: 0, r: 0, t: 30, b: 0 },
    height:        380,
    scene: {
      xaxis: {
        title:          { text: "Fed Tone (hawkish → dovish)", font: { size: 8, color: "#94a3b8" } },
        gridcolor:      "rgba(255,255,255,0.07)",
        zerolinecolor:  "rgba(255,255,255,0.2)",
        tickfont:       { size: 7, color: "#94a3b8" },
        range:          [-1.1, 1.1],
      },
      yaxis: {
        title:     { text: "CPI YoY %", font: { size: 8, color: "#94a3b8" } },
        gridcolor: "rgba(255,255,255,0.07)",
        tickfont:  { size: 7, color: "#94a3b8" },
      },
      zaxis: {
        title:     { text: "Unemployment %", font: { size: 8, color: "#94a3b8" } },
        gridcolor: "rgba(255,255,255,0.07)",
        tickfont:  { size: 7, color: "#94a3b8" },
      },
      bgcolor:   "rgba(0,0,0,0)",
      camera: {
        eye: { x: 1.5, y: -1.5, z: 0.9 },
      },
    },
    font:   { family: "IBM Plex Mono, monospace", size: 8, color: "#94a3b8" },
    legend: { font: { size: 7, color: "#94a3b8" } },
  };

  const btnStyle = (active: boolean): React.CSSProperties => ({
    fontSize: 8, padding: "3px 10px", borderRadius: 3, cursor: "pointer",
    border: `1px solid ${active ? "rgba(59,130,246,0.5)" : "var(--border2)"}`,
    background: active ? "rgba(59,130,246,0.12)" : "var(--surface2)",
    color: active ? "#3b82f6" : "var(--muted2)",
    fontFamily: "IBM Plex Mono, monospace", fontWeight: active ? 700 : 400,
    transition: "all 0.12s",
  });

  return (
    <div style={{
      background: "var(--surface2)", border: "1px solid var(--border2)",
      borderRadius: 8, padding: "14px 16px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "IBM Plex Mono, monospace" }}>
          3D Macro Surface — Fed Tone × CPI × Unemployment ({points.length} meetings)
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["tone", "time", "rate"] as const).map(m => (
            <button key={m} onClick={() => setColorMode(m)} style={btnStyle(colorMode === m)}>
              {m === "tone" ? "Tone" : m === "time" ? "Time" : "Rate Dir"}
            </button>
          ))}
        </div>
      </div>
      <Plot
        data={[trace]}
        layout={layout}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: "100%" }}
      />
      <div style={{ fontSize: 7, color: "var(--muted)", marginTop: 4, fontFamily: "IBM Plex Mono, monospace" }}>
        Each point = one FOMC meeting. Color by: Fed tone (-1=hawkish, +1=dovish) · time (blue=recent) · rate signal.
        Drag to rotate · scroll to zoom.
      </div>
    </div>
  );
}
