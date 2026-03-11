import { useState, useEffect } from "react";

import { globalCss } from "../styles";
import type { Market, HistoryPoint, BatchBacktestResult, HistoryRun, ExecutionMode, StrategyParams } from "../types";
import { DEFAULT_PARAMS } from "../components/backtest/ParamSliders";

import MarketSearch from "../components/market/MarketSearch";
import MarketDetail from "../components/market/MarketDetail";
import BacktestPanel from "../components/backtest/BacktestPanel";
import BacktestResults from "../components/backtest/BacktestResults";
import HistoryDrawer from "../components/shared/HistoryDrawer";
import SignalQueue from "../components/execution/SignalQueue";
import ExecutionLog from "../components/execution/ExecutionLog";
import PositionTracker from "../components/positions/PositionTracker";
import HistoryView from "../components/history/HistoryView";
import LiveFeed from "../components/feed/LiveFeed";
import AuthStatus from "../components/shared/AuthStatus";
import StrategyDetailPanel from "../components/shared/StrategyDetailPanel";

// ── BacktestConsole — owns ALL shared state ────────────────────────────────────

export default function BacktestConsole() {
  // ── Market data ──────────────────────────────────────────────────────────────
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Shared selection state ───────────────────────────────────────────────────
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [queuedMarkets, setQueuedMarkets] = useState<Market[]>([]);

  // ── Price history for selected market ────────────────────────────────────────
  const [priceHistory, setPriceHistory] = useState<HistoryPoint[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Strategy + results ───────────────────────────────────────────────────────
  const [activeStrategy, setActiveStrategy] = useState("threshold");
  const [strategyParams, setStrategyParams] = useState<StrategyParams>(DEFAULT_PARAMS);
  const [backtestResults, setBacktestResults] = useState<BatchBacktestResult | null>(null);
  const [running, setRunning] = useState(false);

  // ── Run history ──────────────────────────────────────────────────────────────
  const [historyRuns, setHistoryRuns] = useState<HistoryRun[]>([]);

  // ── Execution mode + view ─────────────────────────────────────────────────────
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("confirm");
  const [view, setView] = useState<"backtest" | "signals" | "positions" | "history" | "strategies" | "feed">("backtest");

  // ── Toast ────────────────────────────────────────────────────────────────────
  const [toastMsg, setToastMsg] = useState("");

  // ── Fetch market list on mount ───────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/markets?limit=100&order=volume")
      .then(r => {
        if (!r.ok) throw new Error(`API error ${r.status}`);
        return r.json();
      })
      .then(data => {
        setMarkets(data.markets ?? []);
        setSelectedMarket(data.markets?.[0] ?? null);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // ── Fetch price history when selected market changes ─────────────────────────
  useEffect(() => {
    if (!selectedMarket?.token_id || !selectedMarket?.condition_id) {
      setPriceHistory(null);
      return;
    }
    setHistoryLoading(true);
    setPriceHistory(null);
    fetch(
      `/api/markets/${selectedMarket.condition_id}/history` +
      `?token_id=${encodeURIComponent(selectedMarket.token_id)}&interval=max`
    )
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => setPriceHistory(data.history ?? []))
      .catch(() => setPriceHistory(null))
      .finally(() => setHistoryLoading(false));
  }, [selectedMarket?.condition_id]);

  // ── Callbacks passed down to children ────────────────────────────────────────

  const handleSelectMarket = (market: Market) => setSelectedMarket(market);

  const handleToggleQueue = (market: Market) => {
    setQueuedMarkets(q =>
      q.find(x => x.id === market.id)
        ? q.filter(x => x.id !== market.id)
        : [...q, market]
    );
  };

  const handleRemoveFromQueue = (marketId: string) => {
    setQueuedMarkets(q => q.filter(x => x.id !== marketId));
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 3000);
  };

  const handleRunBacktest = async () => {
    const runnable = queuedMarkets.filter(m => m.token_id && m.condition_id);
    if (!runnable.length) {
      showToast("⚠ Selected markets have no price history available");
      return;
    }

    setRunning(true);
    showToast(`▶ Running ${activeStrategy} on ${runnable.length} market${runnable.length > 1 ? "s" : ""}…`);

    try {
      const resp = await fetch("/api/backtest/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markets: runnable.map(m => ({
            condition_id: m.condition_id ?? m.id,
            token_id: m.token_id,
          })),
          strategy: activeStrategy,
          ...strategyParams,
          initial_capital: 1000,
          interval: "max",
          execution_mode: executionMode,
        }),
      });

      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const batch: BatchBacktestResult = await resp.json();

      setBacktestResults(batch);

      // Push to history
      const run: HistoryRun = {
        id: `${Date.now()}`,
        runAt: new Date().toISOString(),
        strategy: activeStrategy,
        marketTitles: runnable.map(m => m.title),
        batch,
      };
      setHistoryRuns(h => [run, ...h]);

      if (batch.succeeded > 0) {
        const ok = batch.results.filter(r => r.success);
        const avg = ok.reduce((s, r) => s + r.total_return, 0) / ok.length;
        showToast(`✓ Done · ${batch.succeeded} market${batch.succeeded > 1 ? "s" : ""} · avg return ${avg.toFixed(1)}%`);
      } else {
        showToast("⚠ Backtest returned no successful results");
      }
    } catch {
      showToast("⚠ Backtest failed — is the backend running?");
    } finally {
      setRunning(false);
    }
  };

  const handleLoadRun = (batch: BatchBacktestResult) => {
    setBacktestResults(batch);
  };

  const handleDeleteRun = (runId: string) => {
    setHistoryRuns(h => h.filter(r => r.id !== runId));
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{globalCss}</style>
      <div className="root">

        {/* Header */}
        <div className="header">
          <div className="logo">
            <div className="logo-mark">PB</div>
            Poly<span>Back</span>
          </div>
          <div className="header-sub">Market Search</div>
          <div className="header-right">
            {loading
              ? <span style={{ color: "var(--accent)", fontSize: 10 }}>Loading markets…</span>
              : error
                ? <span style={{ color: "var(--no)", fontSize: 10 }}>⚠ {error}</span>
                : <span style={{ color: "var(--muted)" }}>{markets.length} markets indexed</span>
            }
            {queuedMarkets.length > 0 && (
              <span className="sel-count">⚡ {queuedMarkets.length} queued</span>
            )}
            {/* View nav */}
            {(["backtest", "signals", "positions", "history", "strategies", "feed"] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: "3px 10px", borderRadius: 4, cursor: "pointer",
                  fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                  border: `1px solid ${view === v ? "rgba(0,212,168,0.35)" : "var(--border2)"}`,
                  background: view === v ? "rgba(0,212,168,0.08)" : "var(--surface2)",
                  color: view === v ? "var(--accent)" : "var(--muted2)",
                  fontWeight: view === v ? 700 : 400,
                }}
              >
                {v === "backtest" ? "Backtest" : v === "signals" ? "Signals" : v === "positions" ? "Positions" : v === "history" ? "History" : v === "strategies" ? "Strategies" : "Feed"}
              </button>
            ))}
            <HistoryDrawer
              historyRuns={historyRuns}
              onLoadRun={handleLoadRun}
              onDeleteRun={handleDeleteRun}
            />
            <AuthStatus />
          </div>
        </div>

        {/* Main layout */}
        {view === "backtest" ? (
          <div className="layout">
            {/* Left: search + market list */}
            <MarketSearch
              markets={markets}
              loading={loading}
              error={error}
              selectedMarket={selectedMarket}
              queuedMarkets={queuedMarkets}
              onSelectMarket={handleSelectMarket}
              onToggleQueue={handleToggleQueue}
            />

            {/* Right: detail + backtest */}
            <div className="detail-panel">
              <MarketDetail
                selectedMarket={selectedMarket}
                priceHistory={priceHistory}
                historyLoading={historyLoading}
              />

              <BacktestPanel
                markets={markets}
                queuedMarkets={queuedMarkets}
                activeStrategy={activeStrategy}
                backtestResults={backtestResults}
                running={running}
                onRemoveFromQueue={handleRemoveFromQueue}
                onBulkAdd={markets => setQueuedMarkets(q => {
                  const existing = new Set(q.map(m => m.id));
                  return [...q, ...markets.filter(m => !existing.has(m.id))];
                })}
                onRunBacktest={handleRunBacktest}
                onStrategyChange={setActiveStrategy}
                strategyParams={strategyParams}
                onParamsChange={setStrategyParams}
                executionMode={executionMode}
                onExecutionModeChange={setExecutionMode}
              />

              {backtestResults && !running && (
                <BacktestResults results={backtestResults} />
              )}
            </div>
          </div>
        ) : view === "signals" ? (
          <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative", zIndex: 1 }}>
            <SignalQueue executionMode={executionMode} />
            <div style={{ width: 340, minWidth: 340, flexShrink: 0, display: "flex", flexDirection: "column" }}>
              <ExecutionLog />
            </div>
          </div>
        ) : view === "positions" ? (
          <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative", zIndex: 1 }}>
            <PositionTracker />
          </div>
        ) : view === "history" ? (
          <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative", zIndex: 1 }}>
            <HistoryView />
          </div>
        ) : view === "strategies" ? (
          <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative", zIndex: 1 }}>
            <StrategyDetailPanel />
          </div>
        ) : (
          <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative", zIndex: 1 }}>
            <LiveFeed markets={markets} />
          </div>
        )}

        {/* Toast */}
        {toastMsg && (
          <div style={{
            position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
            background: "var(--surface2)", border: "1px solid var(--border2)",
            borderRadius: 8, padding: "10px 18px", fontSize: 12, color: "var(--text)",
            zIndex: 999, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            whiteSpace: "nowrap", animation: "fadeIn 0.25s ease",
          }}>
            {toastMsg}
          </div>
        )}
      </div>
    </>
  );
}
