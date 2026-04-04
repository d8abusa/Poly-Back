import { useState, useCallback } from "react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Legend,
} from "recharts";
import type { Market } from "../../types";
import { fetchForecast, type ForecastResult } from "../../api/forecastClient";

interface ForecastPanelProps {
  market:  Market;
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (v >= 1)    return `$${v.toFixed(2)}`;
  return `${(v * 100).toFixed(2)}¢`;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────

function ForecastTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const price    = payload.find((p: any) => p.dataKey === "price")?.value;
  const yhat     = payload.find((p: any) => p.dataKey === "yhat")?.value;
  const lower    = payload.find((p: any) => p.dataKey === "band")?.[0];
  const upper    = payload.find((p: any) => p.dataKey === "band")?.[1];
  const ciLow    = payload.find((p: any) => p.dataKey === "ci")?.[0];
  const ciHigh   = payload.find((p: any) => p.dataKey === "ci")?.[1];

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "8px 12px", fontSize: 11,
    }}>
      <div style={{ color: "var(--muted)", marginBottom: 4 }}>{fmtDate(label)}</div>
      {price   != null && <div>Price: <b>{fmtPrice(price)}</b></div>}
      {yhat    != null && <div style={{ color: "#00c805" }}>Forecast: <b>{fmtPrice(yhat)}</b></div>}
      {(ciLow != null && ciHigh != null) && (
        <div style={{ color: "var(--muted)" }}>
          90% CI: {fmtPrice(ciLow)} – {fmtPrice(ciHigh)}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ForecastPanel({ market }: ForecastPanelProps) {
  const [result,  setResult]  = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const run = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchForecast(market.id, market.exchange, 7, force);
      setResult(data);
    } catch (e: any) {
      setError(e.message ?? "Forecast failed");
    } finally {
      setLoading(false);
    }
  }, [market.id, market.exchange]);

  // ── Build unified chart data ───────────────────────────────────────────────
  const chartData = result ? (() => {
    const hist = result.history.map(h => ({ date: h.date, price: h.price }));
    const fcast = result.forecast.map(f => ({
      date:      f.date,
      yhat:      f.yhat,
      ci:        [f.yhat_lower, f.yhat_upper] as [number, number],
    }));
    // Stitch: last history point also starts the forecast line for continuity
    if (hist.length && fcast.length) {
      fcast[0] = { ...fcast[0], yhat: fcast[0].yhat };
      const bridge = { date: hist[hist.length - 1].date, yhat: hist[hist.length - 1].price, ci: [hist[hist.length - 1].price, hist[hist.length - 1].price] as [number, number] };
      return [...hist, bridge, ...fcast];
    }
    return [...hist, ...fcast];
  })() : [];

  const splitDate = result?.history[result.history.length - 1]?.date;

  // ── Trend styling ─────────────────────────────────────────────────────────
  const trendColor = !result ? "var(--muted)"
    : result.trend === "bullish" ? "#00c805"
    : result.trend === "bearish" ? "#ef4444"
    : "var(--muted2)";

  const bullPct = result ? Math.round(result.bull_probability * 100) : 0;

  return (
    <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8 }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 2px 8px" }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
          📈 7-Day Forecast
        </span>
        <span style={{ fontSize: 9, color: "var(--muted)", flex: 1 }}>
          {result ? `· ${result.model} · generated ${new Date(result.generated_at).toLocaleTimeString()}` : "· advisory only"}
        </span>
        {result && (
          <button
            onClick={() => run(true)}
            disabled={loading}
            style={{ fontSize: 9, padding: "2px 8px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--muted)", cursor: "pointer" }}
          >
            {loading ? "…" : "↺ Refresh"}
          </button>
        )}
        <button
          onClick={() => run(false)}
          disabled={loading}
          style={{
            fontSize: 9, padding: "2px 10px",
            background: loading ? "var(--surface2)" : "var(--accent)",
            border: "none", borderRadius: 4,
            color: loading ? "var(--muted)" : "#000",
            cursor: loading ? "default" : "pointer", fontWeight: 700,
          }}
        >
          {loading ? "Running…" : result ? "Re-run" : "Generate"}
        </button>
      </div>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ fontSize: 10, color: "#ef4444", padding: "4px 0 8px" }}>{error}</div>
      )}

      {/* ── Empty state ────────────────────────────────────────────────────── */}
      {!result && !loading && !error && (
        <div style={{ fontSize: 10, color: "var(--muted)", padding: "8px 0 4px" }}>
          Click Generate to run the 7-day price forecast for this asset.
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {result && !result.error && (
        <>
          {/* Stats row */}
          <div style={{ display: "flex", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>

            <div style={{ minWidth: 80 }}>
              <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase" }}>7d Target</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#00c805" }}>
                {fmtPrice(result.target_price)}
              </div>
              <div style={{ fontSize: 9, color: "var(--muted)" }}>
                {fmtPrice(result.target_lower)} – {fmtPrice(result.target_upper)}
              </div>
            </div>

            <div style={{ minWidth: 70 }}>
              <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase" }}>Bull Prob</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: trendColor }}>{bullPct}%</div>
              <div style={{ fontSize: 9, color: trendColor, textTransform: "uppercase" }}>{result.trend}</div>
            </div>

            {/* Bull/Bear bar */}
            <div style={{ flex: 1, minWidth: 100, display: "flex", flexDirection: "column", justifyContent: "center", gap: 3 }}>
              <div style={{ fontSize: 9, color: "var(--muted)" }}>Bear ←→ Bull</div>
              <div style={{ height: 6, borderRadius: 3, background: "var(--surface2)", overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${bullPct}%`,
                  background: result.trend === "bullish" ? "#00c805" : result.trend === "bearish" ? "#ef4444" : "var(--muted2)",
                  borderRadius: 3, transition: "width 0.4s",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "var(--muted)" }}>
                <span>0%</span><span>50%</span><span>100%</span>
              </div>
            </div>

            <div style={{ minWidth: 52 }}>
              <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase" }}>RSI(14)</div>
              <div style={{
                fontSize: 13, fontWeight: 700,
                color: result.rsi > 70 ? "#ef4444" : result.rsi < 30 ? "#00c805" : "var(--fg)",
              }}>
                {result.rsi.toFixed(0)}
              </div>
              <div style={{ fontSize: 9, color: "var(--muted)" }}>
                {result.rsi > 70 ? "overbought" : result.rsi < 30 ? "oversold" : "neutral"}
              </div>
            </div>

            <div style={{ minWidth: 52 }}>
              <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase" }}>R²</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: result.r_squared > 0.6 ? "#00c805" : result.r_squared > 0.3 ? "var(--fg)" : "var(--muted)" }}>
                {(result.r_squared * 100).toFixed(0)}%
              </div>
              <div style={{ fontSize: 9, color: "var(--muted)" }}>fit quality</div>
            </div>

            <div style={{ minWidth: 52 }}>
              <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase" }}>Daily Vol</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{result.daily_vol_pct.toFixed(1)}%</div>
              <div style={{ fontSize: 9, color: "var(--muted)" }}>σ/day</div>
            </div>
          </div>

          {/* Chart */}
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDate}
                tick={{ fontSize: 9, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={v => fmtPrice(v)}
                tick={{ fontSize: 9, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={false}
                width={54}
              />
              <Tooltip content={<ForecastTooltip />} />

              {/* 90% CI shaded area (forecast only) */}
              <Area
                dataKey="ci"
                stroke="none"
                fill="#00c805"
                fillOpacity={0.12}
                connectNulls
                isAnimationActive={false}
              />

              {/* Historical price */}
              <Line
                dataKey="price"
                stroke="var(--muted2)"
                strokeWidth={1.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />

              {/* Forecast line */}
              <Line
                dataKey="yhat"
                stroke="#00c805"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />

              {/* Divider between history and forecast */}
              {splitDate && (
                <ReferenceLine
                  x={splitDate}
                  stroke="var(--border)"
                  strokeDasharray="4 2"
                  label={{ value: "now", position: "top", fontSize: 8, fill: "var(--muted)" }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>

          <div style={{ fontSize: 8, color: "var(--muted)", paddingTop: 4 }}>
            Log-linear trend · 90% confidence interval · Advisory only — not a trading signal
          </div>
        </>
      )}

      {result?.error && (
        <div style={{ fontSize: 10, color: "#ef4444", padding: "4px 0" }}>{result.error}</div>
      )}
    </div>
  );
}
