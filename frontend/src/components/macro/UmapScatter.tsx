import { useState, useEffect } from "react";
import Plot from "react-plotly.js";
import { apiFetch } from "../../lib/apiFetch";

interface UmapPoint {
  month:             string;
  x:                 number;
  y:                 number;
  recession_label:   string;
  yield_spread:      number;
  fed_rate:          number;
  cpi_yoy_pct?:      number;
  cpi_yoy?:          number;
  unemployment:      number;
  dollar_index:      number;
  [key: string]:     string | number | undefined;
}

interface UmapData {
  points:   UmapPoint[];
  n_obs:    number;
  features: string[];
  note:     string;
}

const REGIME_COLOR: Record<string, string> = {
  elevated: "#f87171",   // red
  moderate: "#fbbf24",   // amber
  low:      "#34d399",   // green
};

const REGIME_ORDER = ["elevated", "moderate", "low"] as const;

export default function UmapScatter() {
  const [data, setData]       = useState<UmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/fred/umap")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError("Failed to compute UMAP"); setLoading(false); });
  }, []);

  if (loading) return (
    <div style={{ fontSize: 10, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
      Running UMAP embedding…
    </div>
  );

  if (error || !data || data.points.length === 0) return (
    <div style={{ fontSize: 10, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
      {error ?? (data?.note ?? "Insufficient data — need ≥4 months in FRED cache")}
    </div>
  );

  // Group points by recession label for separate traces (legend grouping)
  const groups = REGIME_ORDER.map(label => ({
    label,
    points: data.points.filter(p => p.recession_label === label),
  })).filter(g => g.points.length > 0);

  // Draw trajectory arrows: connect points in chronological order
  const sorted    = [...data.points].sort((a, b) => a.month.localeCompare(b.month));
  const arrowX    = sorted.flatMap(p => [p.x, null as unknown as number]);
  const arrowY    = sorted.flatMap(p => [p.y, null as unknown as number]);

  const trajectoryTrace = {
    type:       "scatter" as const,
    x:          arrowX,
    y:          arrowY,
    mode:       "lines" as const,
    line:       { color: "rgba(148,163,184,0.3)", width: 1, dash: "dot" as const },
    hoverinfo:  "none" as const,
    showlegend: false,
    name:       "trajectory",
  };

  const groupTraces = groups.map(g => {
    const cpiKey = g.points[0]?.cpi_yoy_pct !== undefined ? "cpi_yoy_pct" : "cpi_yoy";
    return {
      type:       "scatter" as const,
      x:          g.points.map(p => p.x),
      y:          g.points.map(p => p.y),
      mode:       "markers+text" as const,
      name:       `${g.label} risk`,
      marker: {
        size:    11,
        color:   REGIME_COLOR[g.label],
        opacity: 0.88,
        line:    { color: "rgba(255,255,255,0.2)", width: 1 },
      },
      text:       g.points.map(p => p.month.slice(0, 7)),
      textfont:   { size: 7, color: "rgba(203,213,225,0.7)", family: "IBM Plex Mono, monospace" },
      textposition: "top center" as const,
      customdata: g.points.map(p => ({
        month:  p.month,
        ys:     p.yield_spread,
        fed:    p.fed_rate,
        cpi:    p[cpiKey] ?? "—",
        unemp:  p.unemployment,
        dollar: p.dollar_index,
      })),
      hovertemplate:
        "<b>%{customdata.month}</b><br>" +
        "Yield Spread: %{customdata.ys}/100<br>" +
        "Fed Rate: %{customdata.fed}/100<br>" +
        "CPI YoY: %{customdata.cpi}/100<br>" +
        "Unemployment: %{customdata.unemp}/100<br>" +
        "Dollar Index: %{customdata.dollar}/100<br>" +
        "<extra></extra>",
      hoverlabel: {
        bgcolor:     "#1e293b",
        bordercolor: REGIME_COLOR[g.label],
        font:        { size: 9, color: "#e2e8f0", family: "IBM Plex Mono, monospace" },
      },
    };
  });

  // Highlight the most recent point with a ring
  const latest = sorted[sorted.length - 1];
  const latestTrace = {
    type:       "scatter" as const,
    x:          [latest.x],
    y:          [latest.y],
    mode:       "markers" as const,
    name:       "current",
    marker: {
      size:    18,
      color:   "rgba(0,0,0,0)",
      line:    { color: "#38bdf8", width: 2 },
      symbol:  "circle-open",
    },
    hoverinfo:  "none" as const,
    showlegend: false,
  };

  return (
    <div style={{
      background: "var(--surface2)", border: "1px solid var(--border2)",
      borderRadius: 8, padding: "14px 16px",
    }}>
      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
        UMAP Regime Scatter
      </div>
      <div style={{ fontSize: 8, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
        {data.note}<br />
        Each point = one month · nearby points = similar macro environment · colour = recession risk (yield spread)
        · dotted line = time trajectory · ○ ring = most recent month
      </div>

      <Plot
        data={[trajectoryTrace, ...groupTraces, latestTrace] as any}
        layout={{
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor:  "rgba(0,0,0,0)",
          margin:        { t: 20, r: 20, b: 40, l: 40 },
          xaxis: {
            title:      { text: "UMAP-1", font: { size: 9, color: "#94a3b8" } },
            tickfont:   { size: 8, color: "#94a3b8", family: "IBM Plex Mono, monospace" },
            gridcolor:  "rgba(255,255,255,0.05)",
            zeroline:   false,
          },
          yaxis: {
            title:      { text: "UMAP-2", font: { size: 9, color: "#94a3b8" } },
            tickfont:   { size: 8, color: "#94a3b8", family: "IBM Plex Mono, monospace" },
            gridcolor:  "rgba(255,255,255,0.05)",
            zeroline:   false,
            scaleanchor: "x",
          },
          legend: {
            x: 1.0, y: 1.0,
            xanchor:     "right",
            bgcolor:     "rgba(0,0,0,0)",
            bordercolor: "rgba(255,255,255,0.08)",
            borderwidth: 1,
            font:        { size: 8, color: "#94a3b8", family: "IBM Plex Mono, monospace" },
          },
          hovermode:  "closest",
          font:       { family: "IBM Plex Mono, monospace", size: 9, color: "#94a3b8" },
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%", height: 360 }}
        useResizeHandler
      />

      {data.n_obs < 12 && (
        <div style={{ fontSize: 8, color: "#f59e0b", marginTop: 6 }}>
          ⚠ {data.n_obs} months — UMAP geometry stabilises with more data. Clusters will sharpen as the cache grows.
        </div>
      )}
    </div>
  );
}
