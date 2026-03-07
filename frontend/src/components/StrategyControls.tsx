import { useState, useEffect } from "react";
import type { StrategyParams, StrategyMeta } from "../types";

const INTERVALS = ["max", "1w", "1d", "6h", "1h"];

interface Props {
  params: StrategyParams;
  onChange: (params: StrategyParams) => void;
}

export default function StrategyControls({ params, onChange }: Props) {
  const set = (patch: Partial<StrategyParams>) => onChange({ ...params, ...patch });
  const [strategies, setStrategies] = useState<StrategyMeta[]>([]);

  useEffect(() => {
    fetch("/api/strategies")
      .then(r => r.json())
      .then(data => setStrategies(data.strategies ?? []));
  }, []);

  return (
    <div className="strategy-controls">
      <span className="sc-label">Strategy</span>
      <select className="sc-select" value={params.strategy} onChange={e => set({ strategy: e.target.value })}
        disabled={strategies.length === 0}>
        {strategies.length === 0
          ? <option value="">Loading…</option>
          : strategies.map(s => <option key={s.id} value={s.id}>{s.label}</option>)
        }
      </select>

      <div className="sc-divider" />

      <span className="sc-label">Entry</span>
      <input className="sc-input" type="number" min="0.01" max="0.99" step="0.01"
        value={params.entry_threshold}
        onChange={e => set({ entry_threshold: parseFloat(e.target.value) })} />

      <span className="sc-label">Exit</span>
      <input className="sc-input" type="number" min="0.01" max="0.99" step="0.01"
        value={params.exit_threshold}
        onChange={e => set({ exit_threshold: parseFloat(e.target.value) })} />

      <div className="sc-divider" />

      <span className="sc-label">Capital $</span>
      <input className="sc-input" style={{ width: 72 }} type="number" min="1" step="100"
        value={params.initial_capital}
        onChange={e => set({ initial_capital: parseFloat(e.target.value) })} />

      <span className="sc-label">Interval</span>
      <select className="sc-select" value={params.interval} onChange={e => set({ interval: e.target.value })}>
        {INTERVALS.map(i => <option key={i} value={i}>{i}</option>)}
      </select>
    </div>
  );
}
