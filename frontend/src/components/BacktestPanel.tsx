import type { Market, StrategyParams } from "../types";

interface Props {
  queued: Market[];
  strategyParams: StrategyParams;
  onRemove: (id: string) => void;
  onToast: (msg: string) => void;
}

export default function BacktestPanel({ queued, strategyParams, onRemove, onToast }: Props) {
  const runQueue = async () => {
    if (!queued.length) return;
    const runnable = queued.filter(m => m.token_id);
    if (!runnable.length) {
      onToast("⚠ Selected markets have no price history available");
      return;
    }
    onToast(`▶ Running backtest on ${runnable.length} market${runnable.length > 1 ? "s" : ""}…`);
    try {
      const results = await Promise.all(
        runnable.map(m =>
          fetch("/api/backtest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              condition_id: m.condition_id ?? m.id,
              token_id: m.token_id,
              strategy: strategyParams.strategy,
              entry_threshold: strategyParams.entry_threshold,
              exit_threshold: strategyParams.exit_threshold,
              stop_loss: strategyParams.stop_loss,
              initial_capital: strategyParams.initial_capital,
              interval: strategyParams.interval,
            }),
          }).then(r => r.json())
        )
      );
      const successes = results.filter(r => r.success);
      if (successes.length) {
        const avgReturn = successes.reduce((s: number, r: { total_return: number }) => s + r.total_return, 0) / successes.length;
        onToast(`✓ Done · ${successes.length} market${successes.length > 1 ? "s" : ""} · avg return ${avgReturn.toFixed(1)}%`);
      } else {
        onToast("⚠ Backtest returned no results");
      }
    } catch {
      onToast("⚠ Backtest failed — is the backend running?");
    }
  };

  return (
    <div className="queue-bar">
      <span className="queue-label">Backtest queue:</span>
      <div className="queue-chips">
        {queued.length === 0
          ? <span style={{ fontSize: 10, color: "var(--muted)", alignSelf: "center" }}>No markets selected — check ☑ to add</span>
          : queued.map(m => (
            <div key={m.id} className="q-chip">
              <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.title.slice(0, 28)}…
              </span>
              <span className="q-remove" onClick={() => onRemove(m.id)}>×</span>
            </div>
          ))
        }
      </div>
      <button className="queue-run" disabled={!queued.length} onClick={runQueue}>
        ▶ Run {queued.length > 0 ? `(${queued.length})` : ""}
      </button>
    </div>
  );
}
