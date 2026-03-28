import { useState } from "react";
import type { Signal } from "../../types";

interface ConfirmationCardProps {
  signal: Signal;
  onApprove: (signalId: string, modifiedSize?: number) => void;
  onReject: (signalId: string) => void;
  onModify: (signalId: string, size: number, price?: number) => void;
}

export default function ConfirmationCard({
  signal,
  onApprove,
  onReject,
  onModify,
}: ConfirmationCardProps) {
  const [editing, setEditing] = useState(false);
  const [editSize, setEditSize] = useState(signal.suggested_size);
  const [editPrice, setEditPrice] = useState("");

  const isExit = signal.side === "SELL";
  const sideColor = isExit ? "#ef4444" : "#22c55e";
  const borderColor = isExit ? "rgba(239,68,68,0.2)" : "rgba(0,212,168,0.15)";

  const CRYPTO_SUFFIXES = ["-USD", "-USDC", "-USDT", "-EUR", "-GBP"];
  const isCrypto = CRYPTO_SUFFIXES.some(s => signal.market_id.toUpperCase().endsWith(s));

  const fmtPrice = (p: number) =>
    isCrypto
      ? p >= 1000 ? `$${p.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                  : `$${p.toFixed(4)}`
      : `${(p * 100).toFixed(1)}¢`;

  const handleApplyModify = () => {
    const price = editPrice ? parseFloat(editPrice) : undefined;
    onModify(signal.id, editSize, price);
    setEditing(false);
  };

  const edgePct = isCrypto
    ? `+${(signal.expected_edge * 100).toFixed(2)}%`
    : `+${signal.expected_edge.toFixed(2)}%`;

  const METRICS: [string, string][] = [
    ["Entry",  fmtPrice(signal.entry_price)],
    ["Target", fmtPrice(signal.target_price)],
    ["Stop",   signal.stop_loss != null ? fmtPrice(signal.stop_loss) : "—"],
    ["Edge",   edgePct],
    ["Size",   `$${signal.suggested_size}`],
    [isCrypto ? "Units" : "Shares",
               isCrypto ? `${signal.suggested_shares.toFixed(6)}` : `${signal.suggested_shares.toFixed(0)}`],
    ["Conf",   `${(signal.confidence * 100).toFixed(0)}%`],
  ];

  return (
    <div style={{
      background: "var(--surface)",
      border: `1px solid ${borderColor}`,
      borderRadius: 8,
      padding: "12px 14px",
      marginBottom: 8,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: sideColor, fontFamily: "IBM Plex Mono, monospace" }}>
            {isExit ? "EXIT" : "ENTER"} · {signal.side}
          </span>
          <span style={{
            fontSize: 8, background: "var(--surface2)", border: "1px solid var(--border2)",
            borderRadius: 3, padding: "2px 6px", color: "var(--muted2)",
          }}>
            {signal.strategy.toUpperCase()}
          </span>
          {isCrypto && (
            <span style={{
              fontSize: 8, fontWeight: 700,
              background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.35)",
              borderRadius: 3, padding: "2px 6px", color: "#fbbf24",
              fontFamily: "IBM Plex Mono, monospace", letterSpacing: 0.5,
            }}>
              CRYPTO
            </span>
          )}
        </div>
        <span style={{ fontSize: 8, color: "var(--muted)", fontFamily: "IBM Plex Mono, monospace" }}>
          {new Date(signal.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      </div>

      {/* Market ID */}
      <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 8, fontFamily: "IBM Plex Mono, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {signal.market_id.length > 40 ? `${signal.market_id.slice(0, 40)}…` : signal.market_id}
      </div>

      {/* Metrics grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 8 }}>
        {METRICS.map(([l, v]) => (
          <div key={l} style={{ background: "var(--surface2)", borderRadius: 4, padding: "5px 7px" }}>
            <div style={{ fontSize: 7, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{l}</div>
            <div style={{ fontSize: 11, fontFamily: "Syne, sans-serif", fontWeight: 700, color: "var(--text)" }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Reasoning */}
      {signal.reasoning && (
        <div style={{
          fontSize: 9, color: "var(--muted2)", background: "var(--surface2)",
          border: "1px solid var(--border)", borderRadius: 4,
          padding: "6px 8px", marginBottom: 8, lineHeight: 1.5,
        }}>
          {signal.reasoning}
        </div>
      )}

      {/* Inline size / price editor */}
      {editing && (
        <div style={{ marginBottom: 8, display: "flex", gap: 6, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 8, color: "var(--muted)", marginBottom: 3 }}>Size ($)</div>
            <input
              type="number"
              value={editSize}
              onChange={e => setEditSize(Number(e.target.value))}
              style={{
                width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)",
                borderRadius: 4, padding: "5px 8px", color: "var(--text)",
                fontFamily: "IBM Plex Mono, monospace", fontSize: 10, outline: "none",
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 8, color: "var(--muted)", marginBottom: 3 }}>
              Price override ({isCrypto ? "$" : "¢"})
            </div>
            <input
              type="number"
              value={editPrice}
              onChange={e => setEditPrice(e.target.value)}
              placeholder={isCrypto
                ? `${signal.entry_price.toFixed(2)}`
                : `${(signal.entry_price * 100).toFixed(1)}`}
              style={{
                width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)",
                borderRadius: 4, padding: "5px 8px", color: "var(--text)",
                fontFamily: "IBM Plex Mono, monospace", fontSize: 10, outline: "none",
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <button
              onClick={handleApplyModify}
              style={{
                padding: "5px 10px", borderRadius: 4,
                border: "1px solid rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.08)",
                color: "#f59e0b", fontSize: 9, fontFamily: "IBM Plex Mono, monospace", cursor: "pointer",
              }}
            >Apply</button>
            <button
              onClick={() => setEditing(false)}
              style={{
                padding: "5px 10px", borderRadius: 4,
                border: "1px solid var(--border2)", background: "var(--surface2)",
                color: "var(--muted)", fontSize: 9, fontFamily: "IBM Plex Mono, monospace", cursor: "pointer",
              }}
            >Cancel</button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!editing && (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => onApprove(signal.id)}
            style={{
              flex: 2, padding: "6px 0", borderRadius: 4,
              border: `1px solid ${isExit ? "rgba(239,68,68,0.35)" : "rgba(34,197,94,0.35)"}`,
              background: isExit ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
              color: sideColor, fontSize: 9, fontFamily: "IBM Plex Mono, monospace",
              fontWeight: 700, cursor: "pointer",
            }}
          >
            {isExit ? "Close Position" : "Execute"}
          </button>
          <button
            onClick={() => setEditing(true)}
            style={{
              flex: 1, padding: "6px 0", borderRadius: 4,
              border: "1px solid rgba(245,158,11,0.25)", background: "rgba(245,158,11,0.06)",
              color: "#f59e0b", fontSize: 9, fontFamily: "IBM Plex Mono, monospace", cursor: "pointer",
            }}
          >Modify</button>
          <button
            onClick={() => onReject(signal.id)}
            style={{
              flex: 1, padding: "6px 0", borderRadius: 4,
              border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)",
              color: "#ef4444", fontSize: 9, fontFamily: "IBM Plex Mono, monospace", cursor: "pointer",
            }}
          >Reject</button>
        </div>
      )}
    </div>
  );
}
