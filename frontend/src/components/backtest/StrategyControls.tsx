interface StrategyControlsProps {
  activeStrategy: string;
  onStrategyChange: (strategy: string) => void;
}

const STRATEGIES = [
  { id: "threshold", label: "Threshold", desc: "Buy low, sell high on probability levels" },
  { id: "momentum", label: "Momentum", desc: "Follow rising probability trends" },
] as const;

export default function StrategyControls({
  activeStrategy,
  onStrategyChange,
}: StrategyControlsProps) {
  return (
    <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
        Strategy
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {STRATEGIES.map(s => {
          const active = activeStrategy === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onStrategyChange(s.id)}
              title={s.desc}
              style={{
                flex: 1,
                padding: "6px 10px",
                borderRadius: 5,
                border: `1px solid ${active ? "rgba(0,212,168,0.4)" : "var(--border2)"}`,
                background: active ? "rgba(0,212,168,0.08)" : "var(--surface2)",
                color: active ? "var(--accent)" : "var(--muted2)",
                fontFamily: "IBM Plex Mono, monospace",
                fontSize: 10,
                fontWeight: active ? 600 : 400,
                cursor: "pointer",
                transition: "all 0.12s",
                textAlign: "center",
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
