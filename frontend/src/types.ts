// ── Domain types shared across the entire component tree ──────────────────────

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
  strategy: string;
  entry_threshold: number;
  exit_threshold: number;
  stop_loss: number | null;
  initial_capital: number;
  interval: string;
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
