// ── Domain types shared across the entire component tree ──────────────────────

export type ExecutionMode  = "auto" | "confirm" | "alert_only";
export type SignalStatus   = "pending" | "approved" | "rejected" | "auto_executed";

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
  volume: number;
  liquidity: number;
  resolved: boolean;
  outcome: string | null;
  end_date: string;
  tags: string[];
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
  marketTitles: string[];
  batch: BatchBacktestResult;
}
