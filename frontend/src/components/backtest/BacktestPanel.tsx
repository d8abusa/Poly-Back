import { useState } from "react";
import type { Market, BatchBacktestResult, ExecutionMode, StrategyParams } from "../../types";
import StrategyControls from "./StrategyControls";
import BulkLoadModal from "./BulkLoadModal";

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
}: BacktestPanelProps) {
  const [showBulk, setShowBulk] = useState(false);

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
      />

      <div className="queue-bar">
        <span className="queue-label">Backtest queue:</span>
        <div className="queue-chips">
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
