import { useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { apiFetch } from "../../lib/apiFetch";

interface SunburstData {
  ids:              string[];
  labels:           string[];
  parents:          string[];
  values:           number[];
  colors:           number[];
  customdata:       Record<string, string | number | boolean | undefined>[];
  overall_stress:   number;
  interpretation:   "elevated" | "moderate" | "benign";
}

const INTERP_COLOR: Record<string, string> = {
  elevated: "#f87171",
  moderate: "#fbbf24",
  benign:   "#34d399",
};

const INTERP_LABEL: Record<string, string> = {
  elevated: "Elevated Stress",
  moderate: "Moderate Conditions",
  benign:   "Benign Environment",
};

export default function MacroSunburst() {
  const [data, setData]       = useState<SunburstData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/fred/sunburst")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError("Failed to load sunburst data"); setLoading(false); });
  }, []);

  if (loading) return (
    <div style={{ fontSize: 10, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
      Calculating macro stress…
    </div>
  );

  if (error || !data) return (
    <div style={{ fontSize: 10, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
      {error ?? "Insufficient data — seed FRED cache first"}
    </div>
  );

  const interpColor = INTERP_COLOR[data.interpretation] ?? "#94a3b8";
  const interpLabel = INTERP_LABEL[data.interpretation] ?? data.interpretation;

  // Build per-cell hover text
  const hoverText = data.labels.map((label, i) => {
    const cd = data.customdata[i];
    if (!cd || cd.category || label === "Macro") return label;
    const stress = cd.stress as number;
    const raw    = cd.raw    as string;
    const norm   = cd.norm   as number;
    const note   = cd.note   as string;
    const level  = stress > 65 ? "⚠ Stressed" : stress > 40 ? "◆ Moderate" : "✓ Benign";
    return (
      `<b>${label}</b><br>` +
      `Current: ${raw ?? "—"}<br>` +
      `Normalised: ${norm ?? "—"}/100<br>` +
      `Stress score: ${stress}/100<br>` +
      `Signal: ${level}<br>` +
      `<i>${note === "inverted" ? "low reading = high stress" : "high reading = high stress"}</i>`
    );
  });

  return (
    <div style={{
      background: "var(--surface2)", border: "1px solid var(--border2)",
      borderRadius: 8, padding: "14px 16px",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
          Macro Stress Sunburst
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: interpColor, flexShrink: 0,
          }} />
          <span style={{ fontSize: 9, color: interpColor, fontFamily: "IBM Plex Mono, monospace" }}>
            {interpLabel} · {data.overall_stress.toFixed(1)}/100
          </span>
        </div>
      </div>

      <div style={{ fontSize: 8, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
        Area &amp; colour = stress score (0–100) · red = stressed · green = benign · hover for raw values
        · inner ring = category avg · outer ring = individual indicators
      </div>

      <Plot
        data={[{
          type:       "sunburst" as const,
          ids:        data.ids,
          labels:     data.labels,
          parents:    data.parents,
          values:     data.values,
          marker: {
            colors:    data.colors,
            colorscale: [
              [0.0,  "#14532d"],   // 0   = no stress — deep green
              [0.25, "#166534"],
              [0.4,  "#1e3a5f"],   // 40  = neutral — navy
              [0.65, "#b45309"],   // 65  = moderate stress — amber
              [1.0,  "#7f1d1d"],   // 100 = maximum stress — deep red
            ],
            cmin:       0,
            cmax:       100,
            showscale:  true,
            colorbar: {
              thickness: 12,
              len:       0.65,
              tickvals:  [0, 25, 50, 75, 100],
              ticktext:  ["Benign", "Low", "Neutral", "Moderate", "Stressed"],
              tickfont:  { size: 7, color: "#94a3b8", family: "IBM Plex Mono, monospace" },
            },
          },
          branchvalues: "remainder" as const,
          hovertext:    hoverText,
          hoverinfo:    "text" as const,
          hoverlabel: {
            bgcolor:     "#1e293b",
            bordercolor: "#38bdf8",
            font:        { size: 9, color: "#e2e8f0", family: "IBM Plex Mono, monospace" },
          },
          insidetextfont: { size: 9, color: "#e2e8f0", family: "IBM Plex Mono, monospace" },
          outsidetextfont: { size: 8, color: "#94a3b8", family: "IBM Plex Mono, monospace" },
          leaf: { opacity: 0.88 },
          rotation: 90,
        } as any]}
        layout={{
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor:  "rgba(0,0,0,0)",
          margin:        { t: 10, r: 100, b: 10, l: 10 },
          font:          { family: "IBM Plex Mono, monospace", size: 9, color: "#94a3b8" },
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%", height: 400 }}
        useResizeHandler
      />

      {/* Stress key */}
      <div style={{ display: "flex", gap: 16, marginTop: 6, flexWrap: "wrap" }}>
        {[
          { range: "0–40",   label: "Benign",   color: "#34d399" },
          { range: "40–65",  label: "Moderate", color: "#fbbf24" },
          { range: "65–100", label: "Stressed", color: "#f87171" },
        ].map(({ range, label, color }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
            <span style={{ fontSize: 7, color: "#94a3b8", fontFamily: "IBM Plex Mono, monospace" }}>
              {range} — {label}
            </span>
          </div>
        ))}
        <span style={{ fontSize: 7, color: "#475569", fontFamily: "IBM Plex Mono, monospace", marginLeft: "auto" }}>
          Minimum cell size = 8 so all indicators remain visible
        </span>
      </div>
    </div>
  );
}
