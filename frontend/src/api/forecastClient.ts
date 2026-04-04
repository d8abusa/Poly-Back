import { apiFetch } from "../lib/apiFetch";

export interface ForecastPoint {
  date:       string;
  yhat:       number;
  yhat_lower: number;
  yhat_upper: number;
}

export interface ForecastResult {
  market_id:        string;
  exchange:         string;
  current_price:    number;
  target_price:     number;
  target_lower:     number;
  target_upper:     number;
  bull_probability: number;   // 0–1
  trend:            "bullish" | "bearish" | "neutral";
  rsi:              number;
  r_squared:        number;
  daily_vol_pct:    number;
  horizon_days:     number;
  history:          { date: string; price: number }[];
  forecast:         ForecastPoint[];
  generated_at:     string;
  model:            string;
  error:            string | null;
}

export interface ForecastGrade {
  market_id:         string;
  exchange:          string;
  as_of_date:        string;
  horizon_days:      number;
  forecast_7d:       number;
  actual_7d:         number;
  as_of_price:       number;
  direction_correct: boolean;
  within_ci:         boolean;
  mape_pct:          number;
  score:             number;   // 0–100
  color:             string;   // hex
  label:             string;   // "cold" | "warm" | "hot" | "very hot" | "n/a"
  generated_at:      string;
  note:              string | null;
}

export async function fetchForecastGrade(
  marketId: string,
  exchange: string,
  asOf:     string,   // YYYY-MM-DD
  horizon  = 7,
): Promise<ForecastGrade> {
  const params = new URLSearchParams({
    market_id: marketId,
    exchange,
    as_of:     asOf,
    horizon:   String(horizon),
  });
  const res = await apiFetch(`/api/forecast/grade?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Grade failed");
  }
  return res.json();
}

export async function fetchForecast(
  marketId: string,
  exchange: string,
  horizon  = 7,
  force    = false,
): Promise<ForecastResult> {
  const params = new URLSearchParams({
    market_id: marketId,
    exchange,
    horizon:   String(horizon),
    force:     String(force),
  });
  const res = await apiFetch(`/api/forecast?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Forecast failed");
  }
  return res.json();
}
