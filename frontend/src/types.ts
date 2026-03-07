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
