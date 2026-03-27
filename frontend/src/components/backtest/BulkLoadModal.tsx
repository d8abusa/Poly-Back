import { useState, useRef } from "react";
import type { Market } from "../../types";
import { apiFetch } from "../../lib/apiFetch";

interface BulkLoadModalProps {
  markets: Market[];          // already-loaded market list for the picker
  onAdd: (markets: Market[]) => void;
  onClose: () => void;
}

type LoadStatus = "idle" | "loading" | "done";

interface FetchResult {
  id: string;
  market: Market | null;
  error?: string;
}

function parseIds(text: string): string[] {
  return [...new Set(
    text
      .split(/[\n,]+/)
      .map(s => s.trim().split(/\s+/)[0])
      .filter(s => s.length > 10 && !/^(condition|market|id)$/i.test(s))
  )];
}

function downloadSampleCsv() {
  const rows = [
    "condition_id",
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12",
    "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
  ].join("\n");
  const blob = new Blob([rows], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bulk_markets_template.csv";
  a.click();
}

export default function BulkLoadModal({ markets, onAdd, onClose }: BulkLoadModalProps) {
  const [text, setText]       = useState("");
  const [status, setStatus]   = useState<LoadStatus>("idle");
  const [results, setResults] = useState<FetchResult[]>([]);
  const [tab, setTab]         = useState<"paste" | "pick">("paste");
  const [picked, setPicked]   = useState<Set<string>>(new Set());
  const [search, setSearch]   = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setText(t => t + (t ? "\n" : "") + (ev.target?.result as string));
      setStatus("idle");
      setResults([]);
    };
    reader.readAsText(file);
    // reset so the same file can be re-selected
    e.target.value = "";
  };

  const handleLoad = async () => {
    const ids = parseIds(text);
    if (!ids.length) return;
    setStatus("loading");
    setResults([]);

    const settled: FetchResult[] = await Promise.all(
      ids.map(async id => {
        try {
          const r = await apiFetch(`/api/markets/${encodeURIComponent(id)}`);
          if (!r.ok) return { id, market: null, error: `HTTP ${r.status}` };
          const data = await r.json();
          const market: Market = data.market ?? data;
          if (!market?.id) return { id, market: null, error: "no data" };
          return { id, market };
        } catch {
          return { id, market: null, error: "network error" };
        }
      })
    );

    setResults(settled);
    setStatus("done");
  };

  // ── "Pick from loaded" tab ────────────────────────────────────────────────

  const filtered = markets.filter(m =>
    !search || m.title.toLowerCase().includes(search.toLowerCase()) ||
    (m.condition_id ?? "").includes(search)
  );

  const togglePick = (id: string) => {
    setPicked(p => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleAddPicked = () => {
    onAdd(markets.filter(m => picked.has(m.id)));
    onClose();
  };

  // ── Paste tab submit ──────────────────────────────────────────────────────

  const found  = results.filter(r => r.market !== null);
  const failed = results.filter(r => r.market === null);

  const handleAdd = () => {
    onAdd(found.map(r => r.market as Market));
    onClose();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>

        {/* Header */}
        <div style={s.header}>
          <span style={s.title}>BULK LOAD MARKETS</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div style={s.tabs}>
          {(["paste", "pick"] as const).map(t => (
            <button key={t} style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }} onClick={() => setTab(t)}>
              {t === "paste" ? "Paste / Upload IDs" : `Pick from loaded (${markets.length})`}
            </button>
          ))}
        </div>

        {/* ── Paste tab ── */}
        {tab === "paste" && (
          <div style={s.body}>

            {/* Format hint */}
            <div style={s.formatBox}>
              <div style={s.formatTitle}>Expected format</div>
              <div style={s.formatCode}>
                condition_id<br />
                0x4a3b…ef12<br />
                0x7c9d…ab34<br />
              </div>
              <div style={s.formatNote}>
                One condition ID per line — or comma-separated. CSV files: first column is used, header row is skipped automatically.
                Condition IDs are 66-char hex strings starting with <code style={s.code}>0x</code>.
                Find them in the URL on Polymarket or export from the market detail API at{" "}
                <code style={s.code}>/api/markets/&#123;id&#125;</code>.
              </div>
              <button style={{ ...s.secondaryBtn, marginTop: 8, fontSize: 9 }} onClick={downloadSampleCsv}>
                ↓ Download sample CSV template
              </button>
            </div>

            <textarea
              style={s.textarea}
              placeholder={"Paste condition IDs here, e.g.:\n0x4a3b1234...\n0x7c9dabcd..."}
              value={text}
              onChange={e => { setText(e.target.value); setStatus("idle"); setResults([]); }}
              spellCheck={false}
            />

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={handleFileLoad} />
              <button style={s.secondaryBtn} onClick={() => fileRef.current?.click()}>
                Upload .csv / .txt
              </button>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: "var(--muted)" }}>
                {parseIds(text).length > 0 ? `${parseIds(text).length} IDs detected` : ""}
              </span>
              <button
                style={{ ...s.primaryBtn, opacity: !text.trim() || status === "loading" ? 0.5 : 1 }}
                disabled={!text.trim() || status === "loading"}
                onClick={handleLoad}
              >
                {status === "loading" ? "Fetching…" : "Fetch Markets"}
              </button>
            </div>

            {status === "done" && (
              <div style={s.resultsBox}>
                <div style={s.resultsSummary}>
                  <span style={{ color: "var(--yes)" }}>✓ {found.length} found</span>
                  {failed.length > 0 && <span style={{ color: "var(--no)" }}>✗ {failed.length} not found</span>}
                </div>
                {found.length > 0 && (
                  <div style={s.foundList}>
                    {found.map(r => (
                      <div key={r.id} style={s.foundRow}>
                        <span style={{ color: "var(--accent)", fontSize: 9 }}>{r.id.slice(0, 10)}…</span>
                        <span style={{ color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.market!.title}
                        </span>
                        <span style={{ color: "var(--muted)", fontSize: 10 }}>{(r.market!.prob * 100).toFixed(0)}¢</span>
                      </div>
                    ))}
                  </div>
                )}
                {failed.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {failed.map(r => (
                      <div key={r.id} style={{ ...s.foundRow, opacity: 0.5 }}>
                        <span style={{ color: "var(--no)", fontSize: 9 }}>{r.id.slice(0, 14)}…</span>
                        <span style={{ color: "var(--muted)", fontSize: 10 }}>{r.error}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Pick tab ── */}
        {tab === "pick" && (
          <div style={s.body}>
            <input
              style={s.searchInput}
              placeholder="Filter by title or condition ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: -4 }}>
              {picked.size > 0 ? `${picked.size} selected` : "Click rows to select"}
            </div>
            <div style={s.pickList}>
              {filtered.map(m => {
                const sel = picked.has(m.id);
                return (
                  <div key={m.id} style={{ ...s.pickRow, ...(sel ? s.pickRowSel : {}) }} onClick={() => togglePick(m.id)}>
                    <span style={{ ...s.pickCheck, ...(sel ? s.pickCheckSel : {}) }}>{sel ? "✓" : ""}</span>
                    <span style={{ flex: 1, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.title}
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: 9, flexShrink: 0 }}>
                      {(m.prob * 100).toFixed(0)}¢
                    </span>
                    <span style={{ color: "var(--muted2)", fontSize: 9, flexShrink: 0, fontFamily: "IBM Plex Mono" }}>
                      {m.condition_id?.slice(0, 8) ?? "—"}…
                    </span>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div style={{ color: "var(--muted)", fontSize: 11, padding: "20px 0", textAlign: "center" }}>
                  No markets match
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={s.footer}>
          <button style={s.secondaryBtn} onClick={onClose}>Cancel</button>
          {tab === "paste" && status === "done" && found.length > 0 && (
            <button style={s.primaryBtn} onClick={handleAdd}>
              Add {found.length} to queue
            </button>
          )}
          {tab === "pick" && picked.size > 0 && (
            <button style={s.primaryBtn} onClick={handleAddPicked}>
              Add {picked.size} to queue
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
  },
  modal: {
    width: 560, maxHeight: "82vh",
    background: "var(--surface)", border: "1px solid var(--border2)",
    borderRadius: 8, display: "flex", flexDirection: "column",
    boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "14px 18px", borderBottom: "1px solid var(--border)",
  },
  title: {
    fontSize: 10, letterSpacing: "0.15em", color: "var(--muted)",
    fontFamily: "IBM Plex Mono, monospace",
  },
  closeBtn: {
    background: "none", border: "none", color: "var(--muted)",
    cursor: "pointer", fontSize: 14, padding: 0,
  },
  tabs: {
    display: "flex", borderBottom: "1px solid var(--border)",
  },
  tab: {
    flex: 1, padding: "9px 0", fontSize: 10, fontFamily: "IBM Plex Mono, monospace",
    background: "none", border: "none", cursor: "pointer",
    color: "var(--muted)", letterSpacing: "0.05em",
  },
  tabActive: {
    color: "var(--accent)", borderBottom: "2px solid var(--accent)",
    marginBottom: -1,
  },
  body: {
    padding: 18, display: "flex", flexDirection: "column", gap: 12,
    overflowY: "auto", flex: 1,
  },
  formatBox: {
    background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: 4, padding: "10px 14px",
  },
  formatTitle: {
    fontSize: 9, letterSpacing: "0.12em", color: "var(--muted)",
    textTransform: "uppercase", marginBottom: 6,
  },
  formatCode: {
    fontFamily: "IBM Plex Mono, monospace", fontSize: 11,
    color: "var(--accent)", marginBottom: 8, lineHeight: 1.8,
  },
  formatNote: {
    fontSize: 10, color: "var(--muted)", lineHeight: 1.7,
  },
  code: {
    fontFamily: "IBM Plex Mono, monospace", color: "var(--accent)",
    background: "rgba(0,212,168,0.08)", padding: "1px 4px", borderRadius: 2,
  },
  textarea: {
    width: "100%", height: 100, resize: "vertical",
    background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: 4, color: "var(--text)", fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11, padding: "8px 10px", boxSizing: "border-box", outline: "none",
  },
  searchInput: {
    width: "100%", padding: "7px 10px", boxSizing: "border-box",
    background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: 4, color: "var(--text)", fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11, outline: "none",
  },
  pickList: {
    display: "flex", flexDirection: "column", gap: 2,
    overflowY: "auto", flex: 1, maxHeight: 340,
  },
  pickRow: {
    display: "flex", gap: 10, alignItems: "center",
    padding: "7px 8px", borderRadius: 3, cursor: "pointer",
    fontSize: 11, fontFamily: "IBM Plex Mono, monospace",
    border: "1px solid transparent",
  },
  pickRowSel: {
    background: "rgba(0,212,168,0.06)", border: "1px solid rgba(0,212,168,0.2)",
  },
  pickCheck: {
    width: 14, height: 14, border: "1px solid var(--border2)",
    borderRadius: 2, flexShrink: 0, display: "flex",
    alignItems: "center", justifyContent: "center",
    fontSize: 9, color: "transparent",
  },
  pickCheckSel: {
    background: "var(--accent)", border: "1px solid var(--accent)",
    color: "#000",
  },
  primaryBtn: {
    fontFamily: "IBM Plex Mono, monospace", fontSize: 11, padding: "6px 14px",
    background: "rgba(0,212,168,0.12)", border: "1px solid rgba(0,212,168,0.35)",
    borderRadius: 4, color: "var(--accent)", cursor: "pointer",
  },
  secondaryBtn: {
    fontFamily: "IBM Plex Mono, monospace", fontSize: 11, padding: "6px 14px",
    background: "var(--surface2)", border: "1px solid var(--border2)",
    borderRadius: 4, color: "var(--muted2)", cursor: "pointer",
  },
  resultsBox: {
    background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: 4, padding: "10px 12px",
  },
  resultsSummary: {
    display: "flex", gap: 16, fontSize: 11,
    fontFamily: "IBM Plex Mono, monospace", marginBottom: 8,
  },
  foundList: {
    display: "flex", flexDirection: "column", gap: 4,
    maxHeight: 180, overflowY: "auto",
  },
  foundRow: {
    display: "flex", gap: 10, alignItems: "center",
    fontSize: 11, fontFamily: "IBM Plex Mono, monospace",
  },
  footer: {
    display: "flex", gap: 8, justifyContent: "flex-end",
    padding: "12px 18px", borderTop: "1px solid var(--border)",
    flexShrink: 0,
  },
};
