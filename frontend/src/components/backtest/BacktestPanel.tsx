import { useState, useRef, useCallback } from "react";
import type { Market, BatchBacktestResult, ExecutionMode, StrategyParams } from "../../types";
import StrategyControls from "./StrategyControls";
import BulkLoadModal from "./BulkLoadModal";
import ScannerControls from "./ScannerControls";

interface BacktestPanelProps {
  markets: Market[];
  queuedMarkets: Market[];
  activeStrategy: string;
  backtestResults: BatchBacktestResult | null;
  running: boolean;
  onRemoveFromQueue: (marketId: string) => void;
  onBulkAdd: (markets: Market[]) => void;
  onRunBacktest: () => void;
  onStrategyChange: (strategy: string) => void;
  strategyParams: StrategyParams;
  onParamsChange: (p: StrategyParams) => void;
  executionMode: ExecutionMode;
  onExecutionModeChange: (mode: ExecutionMode) => void;
  exchange: string;
  capital: number;
  onCapitalChange: (v: number) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
}

export default function BacktestPanel({
  markets,
  queuedMarkets,
  activeStrategy,
  backtestResults,
  running,
  onRemoveFromQueue,
  onBulkAdd,
  onRunBacktest,
  onStrategyChange,
  strategyParams,
  onParamsChange,
  executionMode,
  onExecutionModeChange,
  exchange,
  capital,
  onCapitalChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}: BacktestPanelProps) {
  const [showBulk, setShowBulk] = useState(false);
  const [queueHeight, setQueueHeight] = useState(80);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: queueHeight };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      setQueueHeight(Math.max(48, Math.min(400, dragRef.current.startH + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [queueHeight]);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {showBulk && (
        <BulkLoadModal
          markets={markets}
          onAdd={m => { onBulkAdd(m); }}
          onClose={() => setShowBulk(false)}
        />
      )}

      <StrategyControls
        activeStrategy={activeStrategy}
        onStrategyChange={onStrategyChange}
        strategyParams={strategyParams}
        onParamsChange={onParamsChange}
        executionMode={executionMode}
        onExecutionModeChange={onExecutionModeChange}
        exchange={exchange}
        capital={capital}
        onCapitalChange={onCapitalChange}
      />

      {/* Drag handle */}
      <div
        onMouseDown={onDragStart}
        style={{
          height: 6,
          cursor: "ns-resize",
          background: "var(--border)",
          borderTop: "1px solid var(--border2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <div style={{ width: 32, height: 2, borderRadius: 1, background: "var(--muted)" }} />
      </div>

      <div className="queue-bar" style={{ height: queueHeight, alignItems: "flex-start", overflow: "hidden" }}>
        <span className="queue-label" style={{ paddingTop: 2 }}>Backtest queue:</span>
        <div className="queue-chips" style={{ overflowY: "auto", maxHeight: "100%", alignContent: "flex-start" }}>
          {queuedMarkets.length === 0 ? (
            <span style={{ fontSize: 10, color: "var(--muted)", alignSelf: "center" }}>
              No markets selected — check ☑ to add
            </span>
          ) : (
            queuedMarkets.map(m => (
              <div key={m.id} className="q-chip">
                <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.title.slice(0, 28)}…
                </span>
                <span className="q-remove" onClick={() => onRemoveFromQueue(m.id)}>×</span>
              </div>
            ))
          )}
        </div>
        <button
          className="queue-run"
          style={{ background: "var(--surface2)", border: "1px solid var(--border2)", color: "var(--muted2)", marginRight: 4 }}
          onClick={() => setShowBulk(true)}
        >
          Bulk Load
        </button>
        {/* Date range window */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginRight: 6, flexShrink: 0 }}>
          <input
            type="date"
            value={dateFrom}
            onChange={e => onDateFromChange(e.target.value)}
            title="Backtest start date"
            style={{
              background: "var(--surface2)", border: "1px solid var(--border2)",
              color: "var(--muted2)", borderRadius: 4, padding: "1px 4px",
              fontSize: 9, fontFamily: "IBM Plex Mono, monospace",
              colorScheme: "dark", width: 108,
            }}
          />
          <input
            type="date"
            value={dateTo}
            onChange={e => onDateToChange(e.target.value)}
            title="Backtest end date"
            style={{
              background: "var(--surface2)", border: "1px solid var(--border2)",
              color: "var(--muted2)", borderRadius: 4, padding: "1px 4px",
              fontSize: 9, fontFamily: "IBM Plex Mono, monospace",
              colorScheme: "dark", width: 108,
            }}
          />
        </div>
        {executionMode === "auto" && strategyParams.stop_loss === null && (
          <div style={{ fontSize: 8, color: "#ef4444", fontFamily: "IBM Plex Mono, monospace", marginBottom: 4 }}>
            ⚠ HARBOR: stop-loss required for AUTO
          </div>
        )}
        <button
          className="queue-run"
          disabled={!queuedMarkets.length || running}
          onClick={onRunBacktest}
        >
          {running
            ? "Running…"
            : `▶ Run ${queuedMarkets.length > 0 ? `(${queuedMarkets.length})` : ""}`}
        </button>
      </div>

      {/* Progress bar while running */}
      {running && (
        <div style={{ height: 2, background: "var(--border)" }}>
          <div style={{
            height: "100%",
            background: "linear-gradient(90deg, var(--accent), var(--accent3))",
            animation: "progress 1.5s ease-in-out infinite",
            width: "60%",
          }} />
        </div>
      )}

      <ScannerControls
        queuedMarkets={queuedMarkets}
        activeStrategy={activeStrategy}
        strategyParams={strategyParams}
        executionMode={executionMode}
        exchange={exchange}
      />

      {/* Inline summary when results are ready */}
      {backtestResults && !running && (
        <div style={{
          padding: "8px 14px",
          background: "rgba(0,212,168,0.04)",
          borderTop: "1px solid rgba(0,212,168,0.12)",
          fontSize: 10,
          color: "var(--muted2)",
          display: "flex",
          gap: 16,
          flexShrink: 0,
        }}>
          <span>
            <span style={{ color: "var(--accent)", fontWeight: 600 }}>{backtestResults.succeeded}</span>
            /{backtestResults.total} succeeded
          </span>
          <span>
            fetch: <span style={{ color: "var(--muted)" }}>{backtestResults.fetch_duration_ms.toFixed(0)}ms</span>
          </span>
          {backtestResults.succeeded > 0 && (() => {
            const ok = backtestResults.results.filter(r => r.success);
            const avg = ok.reduce((s, r) => s + r.total_return, 0) / ok.length;
            return (
              <span>
                avg return: <span style={{ color: avg >= 0 ? "var(--yes)" : "var(--no)", fontWeight: 600 }}>
                  {avg >= 0 ? "+" : ""}{avg.toFixed(1)}%
                </span>
              </span>
            );
          })()}
        </div>
      )}
    </div>
  );
}
