// Core Types

export interface Position {
  market: string;
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  slDistance: number;
  tpDistance: number;
  pnl: number;
  weight: number;
  exitProb?: number;
  closeReason?: string;
}

export interface Portfolio {
  value: number;
  drawdown: number;
  totalReturn: number;
  exposure: number;
  dailyPnL: number;
  positionSize: number;
}

export type RiskLevel = 'WATCH' | 'WARNING' | 'ALERT' | 'URGENT' | 'HALT';

// API Response Types

export interface BacktestRequest {
  startDate: string;
  endDate: string;
  initialBalance: number;
  leverage: number;
  maxDailyLoss: number;
  stopLoss: number;
  takeProfit: number;
  trendPeriodDays: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  strategy: 'trend' | 'mean_reversion' | 'breakout';
  market?: string;
}

export interface BacktestResult {
  totalReturn: number;
  tradeCount: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
  finalEquity: number;
  maxLeverage: number;
  maxPositionSize: number;
  trades: BacktestTrade[];
}

export interface BacktestTrade {
  date: string;
  entryPrice: number;
  exitPrice: number;
  type: 'LONG' | 'SHORT';
  pnl: number;
  pnlPercent: number;
  leverage: number;
  positionSize: number;
}

export interface Signal {
  market: string;
  signal: 'BUY' | 'SELL' | 'HOLD' | 'LONG' | 'SHORT' | 'CLOSE';
  strength?: number;
  confidence?: number;
  price: number;
  timestamp: string;
}

export interface MarketData {
  symbol: string;
  currentPrice: number;
  volume24h: number;
  high24h: number;
  low24h: number;
}

export type ExecutionMode = 'confirm' | 'auto' | 'simulation';

export type View = 'backtest' | 'signals' | 'positions' | 'history' | 'strategies' | 'feed' | 'runs' | 'watchlist';