import { useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { apiFetch } from "../../lib/apiFetch";

interface Cell {
  x:       number;
  y:       number;
  z:       number;
  color:   number;
  n_obs:   number;
  x_label: string;
  y_label: string;
  z_label: string;
  months:  string[];
}

interface GhostCell { x: number; y: number; z: number }

interface CubeFrame { month: string; cells: Cell[] }

interface CubeData {
  cells:       Cell[];
  ghost:       GhostCell[];
  n_obs:       number;
  bin_labels:  string[];
  frames:      CubeFrame[];
  window_size: number;
  axes:        { x: string; y: string; z: string; color: string };
}

// ── Shared colorscale (same as static version) ────────────────────────────────
const COLORSCALE = [
  [0.0,  "#7f1d1d"],
  [0.3,  "#b45309"],
  [0.5,  "#1e3a5f"],
  [0.7,  "#0e7490"],
  [1.0,  "#14532d"],
];

function buildCellTrace(cells: Cell[], axes: CubeData["axes"]) {
  return {
    type:      "scatter3d" as const,
    x:         cells.map(c => c.x),
    y:         cells.map(c => c.y),
    z:         cells.map(c => c.z),
    mode:      "markers" as const,
    marker: {
      size:       cells.map(c => Math.min(40, 10 + c.n_obs * 8)),
      color:      cells.map(c => c.color),
      colorscale: COLORSCALE,
      cmin:       0,
      cmax:       100,
      showscale:  true,
      opacity:    0.85,
      symbol:     "square",
      line:       { color: "rgba(255,255,255,0.15)", width: 0.5 },
      colorbar: {
        title:     { text: axes.color, font: { size: 8, color: "#94a3b8" } },
        thickness: 12,
        len:       0.55,
        tickvals:  [0, 25, 50, 75, 100],
        ticktext:  ["0", "25", "50", "75", "100"],
        tickfont:  { size: 8, color: "#94a3b8", family: "IBM Plex Mono, monospace" },
      },
    },
    text: cells.map(c =>
      `<b>${axes.x}:</b> ${c.x_label}<br>` +
      `<b>${axes.y}:</b> ${c.y_label}<br>` +
      `<b>${axes.z}:</b> ${c.z_label}<br>` +
      `<b>${axes.color}:</b> ${c.color.toFixed(1)}/100<br>` +
      `<b>Obs:</b> ${c.n_obs} month${c.n_obs !== 1 ? "s" : ""}<br>` +
      `<i>${c.months.join(", ")}</i>`
    ),
    hoverinfo:  "text" as const,
    hoverlabel: {
      bgcolor:     "#1e293b",
      bordercolor: "#38bdf8",
      font:        { size: 9, color: "#e2e8f0", family: "IBM Plex Mono, monospace" },
    },
    showlegend: false,
    name:       "regime cells",
  };
}

export default function CubeHeatmap() {
  const [data, setData]       = useState<CubeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/fred/cube")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError("Failed to load cube data"); setLoading(false); });
  }, []);

  if (loading) return (
    <div style={{ fontSize: 10, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
      Constructing macro cube…
    </div>
  );

  if (error || !data || data.cells.length === 0) return (
    <div style={{ fontSize: 10, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
      {error ?? "Insufficient data — need all 4 FRED series cached"}
    </div>
  );

  const { ghost, axes, frames, window_size } = data;
  const hasAnimation = frames.length >= 2;

  // ── Static ghost trace (never changes between frames) ────────────────
  const ghostTrace = {
    type:      "scatter3d" as const,
    x:         ghost.map(g => g.x),
    y:         ghost.map(g => g.y),
    z:         ghost.map(g => g.z),
    mode:      "markers" as const,
    marker: {
      size:    4,
      color:   "rgba(148,163,184,0.12)",
      symbol:  "square",
      line:    { color: "rgba(148,163,184,0.18)", width: 0.5 },
    },
    hoverinfo:  "none" as const,
    showlegend: false,
    name:       "empty cells",
  };

  // ── Initial cell trace (last frame = most recent window) ─────────────
  const initialCells = hasAnimation
    ? frames[frames.length - 1].cells
    : data.cells;
  const cellTrace = buildCellTrace(initialCells, axes);

  // ── Plotly animation frames ───────────────────────────────────────────
  const plotFrames = hasAnimation
    ? frames.map(f => ({
        name:   f.month,
        traces: [1],          // index 1 = cell trace; ghost (0) stays put
        data:   [buildCellTrace(f.cells, axes)],
      }))
    : [];

  // ── Axis tick config (shared) ─────────────────────────────────────────
  const tickVals = [16.7, 50.0, 83.3];
  const tickText = data.bin_labels;

  const sceneAxis = (title: string) => ({
    title:          { text: title, font: { size: 9, color: "#94a3b8" } },
    tickvals:       tickVals,
    ticktext:       tickText,
    tickfont:       { size: 8, color: "#94a3b8", family: "IBM Plex Mono, monospace" },
    gridcolor:      "rgba(255,255,255,0.07)",
    showbackground: false,
    range:          [0, 100] as [number, number],
  });

  // ── Slider steps ──────────────────────────────────────────────────────
  const sliderSteps = frames.map(f => ({
    label:  f.month.slice(0, 7),
    method: "animate" as const,
    args:   [
      [f.month],
      { mode: "immediate", transition: { duration: 200 }, frame: { duration: 350, redraw: true } },
    ],
  }));

  const layout: any = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor:  "rgba(0,0,0,0)",
    margin:        { t: 10, r: 20, b: hasAnimation ? 80 : 10, l: 10 },
    scene: {
      bgcolor:      "rgba(0,0,0,0)",
      xaxis:        sceneAxis(axes.x),
      yaxis:        sceneAxis(axes.y),
      zaxis:        sceneAxis(axes.z),
      camera: {
        eye:    { x: 1.5, y: -1.5, z: 1.0 },
        center: { x: 0,   y: 0,    z: -0.1 },
      },
      aspectmode: "cube",
    },
    font: { family: "IBM Plex Mono, monospace", size: 9, color: "#94a3b8" },
  };

  if (hasAnimation) {
    layout.updatemenus = [{
      type:        "buttons",
      showactive:  false,
      x:           0.08,
      y:           0.0,
      xanchor:     "left",
      yanchor:     "top",
      pad:         { t: 55, r: 10 },
      bgcolor:     "#1e293b",
      bordercolor: "#334155",
      borderwidth: 1,
      font:        { size: 10, color: "#94a3b8", family: "IBM Plex Mono, monospace" },
      buttons: [
        {
          label:  "▶ Play",
          method: "animate",
          args:   [null, {
            fromcurrent: true,
            transition:  { duration: 200, easing: "cubic-in-out" },
            frame:       { duration: 600, redraw: true },
          }],
        },
        {
          label:  "⏸ Pause",
          method: "animate",
          args:   [[null], {
            mode:       "immediate",
            transition: { duration: 0 },
            frame:      { duration: 0, redraw: false },
          }],
        },
      ],
    }];

    layout.sliders = [{
      active:      frames.length - 1,   // start at most recent frame
      steps:       sliderSteps,
      x:           0.08,
      y:           0.0,
      len:         0.88,
      xanchor:     "left",
      yanchor:     "top",
      pad:         { t: 35, b: 10 },
      bgcolor:     "rgba(30,41,59,0.8)",
      bordercolor: "#334155",
      borderwidth: 1,
      ticklen:     4,
      tickcolor:   "#475569",
      font:        { size: 8, color: "#94a3b8", family: "IBM Plex Mono, monospace" },
      currentvalue: {
        visible:  true,
        prefix:   "Window ending: ",
        xanchor:  "right",
        offset:   10,
        font:     { size: 9, color: "#38bdf8", family: "IBM Plex Mono, monospace" },
      },
      transition: { duration: 200, easing: "cubic-in-out" },
    }];
  }

  return (
    <div style={{
      background: "var(--surface2)", border: "1px solid var(--border2)",
      borderRadius: 8, padding: "14px 16px",
    }}>
      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
        3D Macro Regime Cube
        {hasAnimation && (
          <span style={{ color: "#38bdf8", marginLeft: 8, letterSpacing: 0.5 }}>
            · {window_size}-month rolling window
          </span>
        )}
      </div>
      <div style={{ fontSize: 8, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
        X = {axes.x} · Y = {axes.y} · Z = {axes.z} · colour = {axes.color} (recession signal)
        &nbsp;·&nbsp;{data.n_obs} months · size = observations in window
        {hasAnimation ? " · drag slider or press play to animate" : " · drag to rotate"}
      </div>

      <Plot
        data={[ghostTrace, cellTrace] as any}
        layout={layout}
        frames={plotFrames as any}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%", height: hasAnimation ? 480 : 420 }}
        useResizeHandler
      />

      <div style={{ fontSize: 8, color: "var(--muted)", marginTop: 4, lineHeight: 1.6 }}>
        Each cube = a macro regime cell · ghost cubes show the full 3×3×3 regime space
        · colour = avg yield spread (red = inverted / recession risk · green = steep / expansion)
        {hasAnimation && ` · each frame shows a ${window_size}-month rolling window`}
      </div>
    </div>
  );
}
