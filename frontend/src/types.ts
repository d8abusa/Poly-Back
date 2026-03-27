// ── Domain types shared across the entire component tree ──────────────────────

export type ExecutionMode  = "auto" | "confirm" | "alert_only";
export type SignalStatus   = "pending" | "approved" | "rejected" | "auto_executed";
export type ExchangeId     = "coinbase" | "kalshi" | "manifold" | "polymarket" | "yahoo";

export interface ExchangeInfo {
  id:          ExchangeId;
  name:        string;
  type:        "real_money" | "play_money" | "market_data";
  description: string;
}

export interface Signal {
  id:               string;
  market_id:        string;
  strategy:         string;
  side:             "BUY" | "SELL";
  entry_price:      number;
  target_price:     number;
  stop_loss:        number | null;
  suggested_size:   number;
  suggested_shares: number;
  expected_edge:    number;
  maker_edge:       number;
  delta_taker:      number;
  confidence:       number;
  reasoning:        string;
  execution_mode:   ExecutionMode;
  status:           SignalStatus;
  created_at:       string;
  resolved_at:      string | null;
}

export interface Position {
  id:            string;
  signal_id:     string;
  market_id:     string;
  market_title:  string;
  strategy:      string;
  side:          "YES" | "NO";
  entry_price:   number;
  current_prob:  number;
  exit_target:   number;
  stop_loss:     number | null;
  shares:        number;
  capital:       number;
  status:        "open" | "closed";
  entry_date:    string;
  closed_at:     string | null;
  realized_pnl:  number | null;
}

export interface PositionSummary {
  total_unrealized_pnl: number;
  open_count:           number;
  capital_deployed:     number;
  today_realized:       number;
  max_drawdown:         number;
  win_rate:             number;
  profitable_count:     number;
  at_risk_count:        number;
}

export interface Alert {
  id:             string;
  signal_id:      string;
  market_id:      string;
  strategy:       string;
  side:           string;
  entry_price:    number;
  suggested_size: number;
  confidence:     number;
  reasoning:      string;
  error:          string | null;
  read:           boolean;
  created_at:     string;
}

export interface Market {
  id: string;
  condition_id: string | null;
  token_id: string | null;
  title: string;
  category: string;
  prob: number;
  prev_prob?: number;   // previous period close for delta display
  volume: number;
  liquidity: number;
  resolved: boolean;
  outcome: string | null;
  end_date: string;
  tags: string[];
  exchange: ExchangeId;
  history?: HistoryPoint[];   // pre-fetched by Yahoo client — skip separate history call
}

export interface HistoryPoint {
  t: number; // unix timestamp
  p: number; // probability 0–1
}

export interface StrategyMeta {
  id: string;
  label: string;
}

export interface StrategyParams {
  entry_threshold: number;
  exit_threshold:  number;
  stop_loss:       number | null;
  zscore_window:   number;
  zscore_entry:    number;
  zscore_exit:     number;
  zscore_stop:     number;
  kelly_fraction:  number;
  mm_spread:       number;
  xgb_n_estimators:  number;
  xgb_learning_rate: number;
  xgb_max_depth:     number;
  xgb_train_frac:    number;
  xgb_confidence:    number;
  // Momentum Chaser (stocks/crypto)
  window:        number;
  momentum_min:  number;
  trail_pct:     number;
  // Mean Reversion
  lookback_window:     number;
  reversion_threshold: number;
  // Wizard
  wizard_windows:    number;
  wizard_strategies: string[];
  // Universal
  slippage_bps: number;
}

export interface TradeEntry {
  date: string;
  action: string;
  price: number;
  shares: number;
  value: number;
  pnl: number | null;
}

export interface EquityPoint {
  date: string;
  value: number;
  price: number;
}

export interface RegimeSplit {
  window:   number;
  start?:   number;
  end?:     number;
  trend:    "bull" | "bear" | "sideways" | "unknown";
  rankings: WizardRanking[];
}

export interface WizardRanking {
  strategy:     string;
  name:         string;
  total_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate:     number;
  total_trades: number;
  wins?:        number;
  consistency?: number;
}

export interface BacktestResult {
  success: boolean;
  error?: string;
  condition_id: string;
  initial_capital: number;
  final_value: number;
  total_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  total_trades: number;
  win_rate: number;
  equity_curve: EquityPoint[];
  trades: TradeEntry[];
  wizard_rankings?: WizardRanking[];
  regime_splits?:   RegimeSplit[];
}

export interface BatchBacktestResult {
  total: number;
  succeeded: number;
  failed: number;
  fetch_duration_ms: number;
  results: BacktestResult[];
}

export interface HistoryRun {
  id: string;
  runAt: string;         // ISO timestamp
  strategy: string;
  exchange: ExchangeId;
  marketTitles: string[];
  batch: BatchBacktestResult;
}
