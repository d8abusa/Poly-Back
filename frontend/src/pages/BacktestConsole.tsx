import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";

import { globalCss } from "../styles";
import type { Market, HistoryPoint, BatchBacktestResult, HistoryRun, ExecutionMode, StrategyParams, ExchangeId, TradeEntry } from "../types";
import { DEFAULT_PARAMS } from "../components/backtest/ParamSliders";

import MarketSearch from "../components/market/MarketSearch";
import MarketDetail from "../components/market/MarketDetail";
import BacktestPanel from "../components/backtest/BacktestPanel";
import BacktestResults from "../components/backtest/BacktestResults";
import RunsView from "../components/runs/RunsView";
import SignalQueue from "../components/execution/SignalQueue";
import ExecutionLog from "../components/execution/ExecutionLog";
import PositionTracker from "../components/positions/PositionTracker";
import HistoryView from "../components/history/HistoryView";
import LiveFeed from "../components/feed/LiveFeed";
import AuthStatus from "../components/shared/AuthStatus";
import StrategyDetailPanel from "../components/shared/StrategyDetailPanel";
import SettingsPanel from "../components/shared/SettingsPanel";
import Watchlist from "../components/watchlist/Watchlist";
import MacroPanel from "../components/macro/MacroPanel";
import OpsPanel from "../components/ops/OpsPanel";
import { apiFetch, clearToken } from "../lib/apiFetch";

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

  // ── Exchange ──────────────────────────────────────────────────────────────────
  const [exchange, setExchange] = useState<ExchangeId>("kalshi");
  const [refreshTick, setRefreshTick] = useState(0);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");

  // ── Account tier (stocks only) ────────────────────────────────────────────────
  type AccountTier = "standard" | "margin" | "day_trading";
  const [accountTier, setAccountTier] = useState<AccountTier>("standard");
  const [showSettings,    setShowSettings]    = useState(false);

  // ── Capital + execution mode + view ──────────────────────────────────────────
  const [capital, setCapital] = useState<number>(0);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("confirm");
  const [view, setView] = useState<"backtest" | "signals" | "positions" | "history" | "strategies" | "feed" | "runs" | "watchlist" | "macro" | "ops">("backtest");

  // ── Toast ────────────────────────────────────────────────────────────────────
  const [toastMsg, setToastMsg] = useState("");

  // ── Results panel resize ─────────────────────────────────────────────────────
  const [resultsHeight, setResultsHeight] = useState(280);
  const resultsDragRef = useRef<{ startY: number; startH: number } | null>(null);
  const onResultsDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resultsDragRef.current = { startY: e.clientY, startH: resultsHeight };
    const onMove = (ev: MouseEvent) => {
      if (!resultsDragRef.current) return;
      const delta = resultsDragRef.current.startY - ev.clientY;
      setResultsHeight(Math.max(120, Math.min(800, resultsDragRef.current.startH + delta)));
    };
    const onUp = () => {
      resultsDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [resultsHeight]);

  // ── Load persisted run history on mount ──────────────────────────────────────
  useEffect(() => {
    apiFetch("/api/backtest/history?limit=50")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        const runs: HistoryRun[] = (data.runs ?? []).map((r: any) => ({
          id:           r.id,
          runAt:        r.run_at,
          strategy:     r.strategy,
          exchange:     r.exchange ?? "kalshi",
          marketTitles: Array.isArray(r.market_titles) ? r.market_titles : [],
          batch:        r.payload,
        }));
        if (runs.length > 0) setHistoryRuns(runs);
      })
      .catch(() => {/* history unavailable — start fresh */});
  }, []);

  // ── History cache — pre-populated from embedded market.history ───────────────
  const [historyCache, setHistoryCache] = useState<Record<string, HistoryPoint[]>>({});

  // ── Live search (Yahoo only) ──────────────────────────────────────────────────
  const liveSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleLiveSearch = useCallback((q: string) => {
    if (liveSearchTimer.current) clearTimeout(liveSearchTimer.current);
    liveSearchTimer.current = setTimeout(() => {
      setLoading(true);
      apiFetch(`/api/markets?limit=20&exchange=${exchange}&q=${encodeURIComponent(q)}`)
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(data => {
          const list: Market[] = data.markets ?? [];
          setMarkets(list);
          if (list.length) setSelectedMarket(list[0]);
          const cache: Record<string, HistoryPoint[]> = {};
          for (const m of list) {
            if (m.history?.length) cache[m.id] = m.history;
          }
          if (Object.keys(cache).length) setHistoryCache(prev => ({ ...prev, ...cache }));
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 450);
  }, [exchange]);

  // ── Fetch market list on mount / exchange change ─────────────────────────────
  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch(`/api/markets?limit=100&order=volume&exchange=${exchange}`)
      .then(r => {
        if (!r.ok) throw new Error(`API error ${r.status}`);
        return r.json();
      })
      .then(data => {
        const list: Market[] = data.markets ?? [];
        setMarkets(list);
        setSelectedMarket(list[0] ?? null);
        // Cache any pre-fetched histories from the response (Yahoo bundles them)
        const cache: Record<string, HistoryPoint[]> = {};
        for (const m of list) {
          if (m.history?.length) cache[m.id] = m.history;
        }
        if (Object.keys(cache).length) setHistoryCache(prev => ({ ...prev, ...cache }));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [exchange, refreshTick]);

  // ── Fetch price history when selected market changes ─────────────────────────
  useEffect(() => {
    if (!selectedMarket?.id) { setPriceHistory(null); return; }

    // Use pre-fetched history from cache (Yahoo bundles 1Y on search)
    const cached = historyCache[selectedMarket.id];
    if (cached?.length) {
      setPriceHistory(cached);
      return;
    }

    setHistoryLoading(true);
    setPriceHistory(null);
    const tid = selectedMarket.token_id ?? selectedMarket.id;
    apiFetch(
      `/api/markets/${selectedMarket.id}/history` +
      `?token_id=${encodeURIComponent(tid)}&interval=max&exchange=${exchange}`
    )
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        const h = data.history ?? [];
        setPriceHistory(h);
        if (h.length) setHistoryCache(prev => ({ ...prev, [selectedMarket.id]: h }));
      })
      .catch(() => setPriceHistory(null))
      .finally(() => setHistoryLoading(false));
  }, [selectedMarket?.id, exchange]);

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

  // Trades from the last run that belong to the currently selected market
  const selectedMarketTrades = useMemo((): TradeEntry[] => {
    if (!backtestResults || !selectedMarket) return [];
    const id = selectedMarket.condition_id ?? selectedMarket.id;
    return backtestResults.results.find(r => r.condition_id === id)?.trades ?? [];
  }, [backtestResults, selectedMarket]);

  const handleRunBacktest = async () => {
    const runnable = queuedMarkets.filter(m => m.token_id && m.condition_id);
    if (!runnable.length) {
      showToast("⚠ Selected markets have no price history available");
      return;
    }

    setRunning(true);
    showToast(`▶ Running ${activeStrategy} on ${runnable.length} market${runnable.length > 1 ? "s" : ""}…`);

    try {
      const resp = await apiFetch(`/api/backtest/batch?exchange=${exchange}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markets: runnable.map(m => ({
            condition_id: m.condition_id ?? m.id,
            token_id: m.token_id ?? m.id,
          })),
          strategy: activeStrategy,
          ...strategyParams,
          initial_capital: capital,
          interval: "max",
          execution_mode: executionMode,
          account_tier: exchange === "yahoo" ? accountTier : "standard",
          ...(dateFrom ? { date_from: dateFrom } : {}),
          ...(dateTo   ? { date_to:   dateTo   } : {}),
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail ?? `API ${resp.status}`);
      }
      const batch: BatchBacktestResult = await resp.json();

      setBacktestResults(batch);

      // Push to history
      const run: HistoryRun = {
        id: `${Date.now()}`,
        runAt: new Date().toISOString(),
        strategy: activeStrategy,
        exchange,
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      showToast(`⚠ ${msg}`);
    } finally {
      setRunning(false);
    }
  };

  // ── Auto-rerun on param / strategy / date change ─────────────────────────────
  // Keep a ref to the latest run function to avoid stale closures in the timer.
  const handleRunBacktestRef = useRef(handleRunBacktest);
  useEffect(() => { handleRunBacktestRef.current = handleRunBacktest; });

  const autoRunKey = useMemo(
    () => JSON.stringify({ strategyParams, activeStrategy, dateFrom, dateTo }),
    [strategyParams, activeStrategy, dateFrom, dateTo]
  );
  const isFirstRender = useRef(true);
  useEffect(() => {
    // Skip the very first render so we don't fire on mount before any user action
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (!queuedMarkets.length || running) return;
    const timer = setTimeout(() => handleRunBacktestRef.current(), 650);
    return () => clearTimeout(timer);
  }, [autoRunKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadRun = (run: HistoryRun) => {
    setBacktestResults(run.batch);
    setExchange(run.exchange ?? "kalshi");
    setActiveStrategy(run.strategy);
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

          {/* Exchange selector */}
          <div style={{ display: "flex", gap: 2, marginLeft: 8 }}>
            {(["kalshi", "coinbase", "yahoo", "polymarket"] as const).map(ex => {
              const labels: Record<string, string> = { kalshi: "Kalshi", coinbase: "Coinbase", yahoo: "Stocks", polymarket: "Polymarket" };
              const colors: Record<string, string> = { kalshi: "#3b82f6", coinbase: "#0052ff", yahoo: "#22c55e", polymarket: "#00d4a8" };
              const active = exchange === ex;
              return (
                <button
                  key={ex}
                  onClick={() => { setExchange(ex); setMarkets([]); setSelectedMarket(null); setQueuedMarkets([]); }}
                  style={{
                    padding: "3px 10px", borderRadius: 4, cursor: "pointer",
                    fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                    border: `1px solid ${active ? `${colors[ex]}50` : "var(--border2)"}`,
                    background: active ? `${colors[ex]}12` : "var(--surface2)",
                    color: active ? colors[ex] : "var(--muted2)",
                    fontWeight: active ? 700 : 400,
                    transition: "all 0.12s",
                  }}
                >
                  {labels[ex]}
                </button>
              );
            })}
          </div>

          {/* Account tier selector — stocks only */}
          {exchange === "yahoo" && (() => {
            const tiers: { id: AccountTier; label: string; desc: string }[] = [
              { id: "standard",    label: "Standard",    desc: "3-day min hold (cash account)" },
              { id: "margin",      label: "Margin",      desc: "2-day min hold (margin account)" },
              { id: "day_trading", label: "Day Trading", desc: "No hold restriction (PDT account)" },
            ];
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 12 }}>
                <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace", textTransform: "uppercase", letterSpacing: 1 }}>
                  Account
                </span>
                {tiers.map(t => {
                  const active = accountTier === t.id;
                  return (
                    <button
                      key={t.id}
                      title={t.desc}
                      onClick={() => setAccountTier(t.id)}
                      style={{
                        padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                        fontFamily: "IBM Plex Mono, monospace", fontSize: 9,
                        border: `1px solid ${active ? "rgba(34,197,94,0.4)" : "var(--border2)"}`,
                        background: active ? "rgba(34,197,94,0.1)" : "var(--surface2)",
                        color: active ? "#22c55e" : "var(--muted2)",
                        fontWeight: active ? 700 : 400,
                        transition: "all 0.12s",
                      }}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            );
          })()}

          <div className="header-right">
            {loading
              ? <span style={{ color: "var(--accent)", fontSize: 10 }}>Loading markets…</span>
              : error
                ? <span style={{ color: "var(--no)", fontSize: 10 }}>⚠ {error}</span>
                : <span style={{ color: "var(--muted)" }}>{markets.length} markets indexed</span>
            }
            {queuedMarkets.length > 0 && (
              <span
                className="sel-count"
                onClick={() => setView("backtest")}
                title="Click to go to backtest queue"
                style={{ cursor: "pointer" }}
              >
                ⚡ {queuedMarkets.length} queued
              </span>
            )}
            {/* View nav */}
            {(["backtest", "signals", "positions", "history", "strategies", "feed", "runs", "watchlist", "macro", "ops"] as const).map(v => {
              const labels: Record<string, string> = {
                backtest: "Backtest", signals: "Signals", positions: "Positions",
                history: "Trade History", strategies: "Strategies", feed: "Feed", runs: "Runs", watchlist: "Watchlist",
                macro: "Macro", ops: "Ops",
              };
              const active = view === v;
              return (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  style={{
                    padding: "3px 10px", borderRadius: 4, cursor: "pointer",
                    fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                    border: `1px solid ${active ? "rgba(0,212,168,0.35)" : "var(--border2)"}`,
                    background: active ? "rgba(0,212,168,0.08)" : "var(--surface2)",
                    color: active ? "var(--accent)" : "var(--muted2)",
                    fontWeight: active ? 700 : 400,
                    position: "relative",
                  }}
                >
                  {labels[v]}
                  {v === "runs" && historyRuns.length > 0 && (
                    <span style={{
                      position: "absolute", top: -4, right: -4, width: 14, height: 14,
                      background: "var(--accent3)", borderRadius: "50%", fontSize: 8,
                      color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {historyRuns.length}
                    </span>
                  )}
                </button>
              );
            })}
            <AuthStatus />
            {/* Logout */}
            <button
              onClick={() => { clearToken(); window.dispatchEvent(new Event("polyback:logout")); }}
              title="Sign out"
              style={{
                padding: "4px 9px", borderRadius: 5, cursor: "pointer",
                border: "1px solid var(--border2)", background: "var(--surface2)",
                color: "var(--muted2)", fontSize: 11, lineHeight: 1,
                fontFamily: "IBM Plex Mono, monospace",
                transition: "all 0.12s",
              }}
            >
              ⏻
            </button>
            {/* Settings gear */}
            <button
              onClick={() => setShowSettings(true)}
              title="Settings"
              style={{
                padding: "4px 9px", borderRadius: 5, cursor: "pointer",
                border: "1px solid var(--border2)", background: "var(--surface2)",
                color: "var(--muted2)", fontSize: 13, lineHeight: 1,
                transition: "all 0.12s",
              }}
              onMouseEnter={e => { (e.target as HTMLElement).style.color = "#7b61ff"; (e.target as HTMLElement).style.borderColor = "rgba(123,97,255,0.4)"; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.color = "var(--muted2)"; (e.target as HTMLElement).style.borderColor = "var(--border2)"; }}
            >
              ⚙
            </button>
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
              liveSearch={exchange === "yahoo"}
              onLiveSearch={handleLiveSearch}
              onRefresh={exchange === "yahoo" ? () => setRefreshTick(t => t + 1) : undefined}
            />

            {/* Right: detail + backtest */}
            <div className="detail-panel">
              <MarketDetail
                selectedMarket={selectedMarket}
                priceHistory={priceHistory}
                historyLoading={historyLoading}
                dateFrom={dateFrom}
                dateTo={dateTo}
                trades={selectedMarketTrades}
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
                exchange={exchange}
                capital={capital}
                onCapitalChange={setCapital}
                dateFrom={dateFrom}
                dateTo={dateTo}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
              />

              {backtestResults && !running && (
                <>
                  <div
                    onMouseDown={onResultsDragStart}
                    style={{
                      height: 6, cursor: "ns-resize", background: "var(--border)",
                      borderTop: "1px solid var(--border2)", display: "flex",
                      alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}
                  >
                    <div style={{ width: 32, height: 2, borderRadius: 1, background: "var(--muted)" }} />
                  </div>
                  <div style={{ height: resultsHeight, minHeight: 120, overflow: "hidden", flexShrink: 0, display: "flex", flexDirection: "column" }}>
                    <BacktestResults
                      results={backtestResults}
                      capital={capital}
                      executionMode={executionMode}
                      exchange={exchange}
                      strategy={activeStrategy}
                      queuedMarkets={queuedMarkets}
                      onStaged={() => { showToast("Signal staged → check Signals tab"); setView("signals"); }}
                    />
                  </div>
                </>
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
            <StrategyDetailPanel onUseStrategy={id => { setActiveStrategy(id); setView("backtest"); }} />
          </div>
        ) : view === "feed" ? (
          <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative", zIndex: 1 }}>
            <LiveFeed markets={markets} exchange={exchange} />
          </div>
        ) : view === "watchlist" ? (
          <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative", zIndex: 1 }}>
            <Watchlist />
          </div>
        ) : view === "macro" ? (
          <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative", zIndex: 1 }}>
            <MacroPanel />
          </div>
        ) : view === "ops" ? (
          <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative", zIndex: 1 }}>
            <OpsPanel />
          </div>
        ) : (
          <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative", zIndex: 1 }}>
            <RunsView
              historyRuns={historyRuns}
              onLoadRun={run => { handleLoadRun(run); setView("backtest"); }}
              onDeleteRun={handleDeleteRun}
            />
          </div>
        )}

        {/* Settings panel */}
        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

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
