import { useState, useEffect } from "react";
import {
  getFeeds, addFeed, updateFeed, deleteFeed, fetchFeed, getFeedDocs,
  getStance, triggerScore,
} from "../../api/instFeedsClient";
import type { InstFeed, InstDoc, InstStance } from "../../api/instFeedsClient";

function fmtAge(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function TypeBadge({ type }: { type: string }) {
  const color = type === "rss" ? "#0ea5e9" : type === "html" ? "#a855f7" : "#f59e0b";
  return (
    <span style={{
      fontSize: 8, padding: "1px 5px", borderRadius: 2,
      background: `${color}18`, border: `1px solid ${color}44`,
      color, fontFamily: "IBM Plex Mono", textTransform: "uppercase",
    }}>
      {type}
    </span>
  );
}

export default function FeedManager() {
  const [feeds, setFeeds]           = useState<InstFeed[]>([]);
  const [selected, setSelected]     = useState<InstFeed | null>(null);
  const [docs, setDocs]             = useState<InstDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [loading, setLoading]       = useState(true);
  const [fetching, setFetching]     = useState<string | null>(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [toast, setToast]           = useState("");
  const [stance, setStance]         = useState<InstStance | null>(null);
  const [scoring, setScoring]       = useState(false);
  const [stanceOpen, setStanceOpen] = useState(true);
  const [showInfo, setShowInfo]     = useState(false);

  // Add form state
  const [newName, setNewName]       = useState("");
  const [newUrl, setNewUrl]         = useState("");
  const [newInterval, setNewInterval] = useState(24);
  const [newType, setNewType]       = useState<"rss" | "html">("rss");
  const [adding, setAdding]         = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function load() {
    setLoading(true);
    try {
      setFeeds(await getFeeds());
    } catch {
      showToast("Failed to load feeds");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); loadStance(); }, []);

  async function loadStance() {
    try { setStance(await getStance()); } catch { /* non-fatal */ }
  }

  async function handleScore(force = false) {
    setScoring(true);
    try {
      const result = await triggerScore(force);
      setStance(result);
    } catch {
      showToast("Scoring failed");
    } finally {
      setScoring(false);
    }
  }

  async function loadDocs(feed: InstFeed) {
    setSelected(feed);
    setDocsLoading(true);
    setDocs([]);
    try {
      setDocs(await getFeedDocs(feed.id, 20));
    } finally {
      setDocsLoading(false);
    }
  }

  async function handleToggle(feed: InstFeed) {
    try {
      const updated = await updateFeed(feed.id, { enabled: !feed.enabled });
      setFeeds(f => f.map(x => x.id === feed.id ? updated : x));
      if (selected?.id === feed.id) setSelected(updated);
    } catch {
      showToast("Failed to update feed");
    }
  }

  async function handleFetch(feed: InstFeed) {
    setFetching(feed.id);
    try {
      const result = await fetchFeed(feed.id);
      showToast(`Fetched: +${result.added} new docs`);
      await load();
      if (selected?.id === feed.id) {
        const refreshed = (await getFeeds()).find(f => f.id === feed.id) ?? feed;
        loadDocs(refreshed);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Fetch failed";
      showToast(msg.length > 80 ? msg.slice(0, 80) + "…" : msg);
    } finally {
      setFetching(null);
    }
  }

  async function handleDelete(feed: InstFeed) {
    try {
      await deleteFeed(feed.id);
      if (selected?.id === feed.id) { setSelected(null); setDocs([]); }
      showToast("Feed removed");
      load();
    } catch {
      showToast("Cannot delete preset feeds — disable instead");
    }
  }

  async function handleAdd() {
    if (!newName.trim() || !newUrl.trim()) return;
    setAdding(true);
    try {
      await addFeed({ name: newName.trim(), url: newUrl.trim(), feed_type: newType, scrape_interval_hours: newInterval });
      setShowAdd(false);
      setNewName(""); setNewUrl(""); setNewInterval(24); setNewType("rss");
      showToast("Feed added");
      load();
    } catch {
      showToast("Failed to add feed");
    } finally {
      setAdding(false);
    }
  }

  const presets = feeds.filter(f => f.is_preset);
  const custom  = feeds.filter(f => !f.is_preset);
  const enabledCount = feeds.filter(f => f.enabled).length;

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

      {/* ── Left: feed registry ── */}
      <div style={{ width: 400, minWidth: 400, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>

        {/* Header */}
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13 }}>
            Institutional Feeds
            <span style={{ marginLeft: 8, fontSize: 10, color: "var(--muted)", fontFamily: "IBM Plex Mono", fontWeight: 400 }}>
              {enabledCount}/{feeds.length} active
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              onClick={() => setShowInfo(true)}
              title="How this works"
              style={{
                width: 22, height: 22, borderRadius: "50%", cursor: "pointer",
                border: "1px solid var(--border2)", background: "var(--surface2)",
                color: "var(--muted)", fontFamily: "IBM Plex Mono", fontSize: 11,
                fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, padding: 0,
              }}
            >
              ?
            </button>
            <button
              onClick={() => setShowAdd(true)}
              style={{
                padding: "4px 10px", borderRadius: 4, cursor: "pointer",
                fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 600,
                border: "1px solid rgba(0,212,168,0.3)", background: "rgba(0,212,168,0.07)",
                color: "var(--accent)",
              }}
            >
              + Custom
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: "20px 14px", color: "var(--muted)", fontSize: 10, fontFamily: "IBM Plex Mono" }}>Loading…</div>
          ) : (
            <>
              {/* Presets */}
              {presets.length > 0 && (
                <>
                  <div style={{ padding: "8px 14px 4px", fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono", textTransform: "uppercase", letterSpacing: 1 }}>
                    Preset Sources
                  </div>
                  {presets.map(feed => <FeedRow key={feed.id} feed={feed} selected={selected?.id === feed.id} fetching={fetching === feed.id} onSelect={() => loadDocs(feed)} onToggle={() => handleToggle(feed)} onFetch={() => handleFetch(feed)} onDelete={() => handleDelete(feed)} />)}
                </>
              )}

              {/* Custom */}
              {custom.length > 0 && (
                <>
                  <div style={{ padding: "8px 14px 4px", fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono", textTransform: "uppercase", letterSpacing: 1 }}>
                    Custom Sources
                  </div>
                  {custom.map(feed => <FeedRow key={feed.id} feed={feed} selected={selected?.id === feed.id} fetching={fetching === feed.id} onSelect={() => loadDocs(feed)} onToggle={() => handleToggle(feed)} onFetch={() => handleFetch(feed)} onDelete={() => handleDelete(feed)} />)}
                </>
              )}

              {feeds.length === 0 && (
                <div style={{ padding: "40px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 28, opacity: 0.15, marginBottom: 10 }}>📰</div>
                  <div style={{ fontSize: 11, color: "var(--muted2)" }}>No feeds configured</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Right: stance + document preview ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Stance card */}
        <StancePanel
          stance={stance}
          scoring={scoring}
          open={stanceOpen}
          onToggle={() => setStanceOpen(o => !o)}
          onScore={() => handleScore(false)}
          onForceScore={() => handleScore(true)}
        />

        {/* Panel header */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13 }}>
            {selected ? selected.name : "Documents"}
            {selected && (
              <span style={{ marginLeft: 8, fontSize: 10, color: "var(--muted)", fontFamily: "IBM Plex Mono", fontWeight: 400 }}>
                {selected.doc_count} docs · last {fmtAge(selected.last_fetched)}
              </span>
            )}
          </div>
          {selected && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <TypeBadge type={selected.feed_type} />
              {selected.tags.slice(0, 3).map(t => (
                <span key={t} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 2, background: "var(--surface2)", border: "1px solid var(--border2)", color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Doc list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px" }}>
          {!selected ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <div style={{ fontSize: 28, opacity: 0.12, marginBottom: 10 }}>🏛</div>
              <div style={{ fontSize: 11, color: "var(--muted2)" }}>Select a feed to preview documents</div>
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>Enable feeds and click Fetch to pull content</div>
            </div>
          ) : docsLoading ? (
            <div style={{ padding: "20px 0", color: "var(--muted)", fontSize: 10, fontFamily: "IBM Plex Mono" }}>Loading docs…</div>
          ) : docs.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center" }}>
              <div style={{ fontSize: 24, opacity: 0.15, marginBottom: 10 }}>📭</div>
              <div style={{ fontSize: 11, color: "var(--muted2)" }}>No documents yet</div>
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
                {selected.enabled ? "Click Fetch to pull content" : "Enable this feed first, then Fetch"}
              </div>
            </div>
          ) : (
            docs.map(doc => (
              <div key={doc.id} style={{
                padding: "10px 12px", marginBottom: 6, borderRadius: 6,
                background: "var(--surface2)", border: "1px solid var(--border)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <a
                    href={doc.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 11, color: "var(--accent)", fontWeight: 600,
                      textDecoration: "none", flex: 1, marginRight: 8,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                  >
                    {doc.title}
                  </a>
                  <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono", flexShrink: 0 }}>
                    {doc.published_at ? new Date(doc.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : fmtAge(doc.fetched_at)}
                  </span>
                </div>
                {doc.content && (
                  <div style={{ fontSize: 10, color: "var(--muted2)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {doc.content}
                  </div>
                )}
                {doc.relevance_tags.length > 0 && (
                  <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {doc.relevance_tags.map(t => (
                      <span key={t} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 2, background: "rgba(0,212,168,0.08)", border: "1px solid rgba(0,212,168,0.2)", color: "var(--accent)", fontFamily: "IBM Plex Mono" }}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Add custom feed modal ── */}
      {showAdd && (
        <>
          <div onClick={() => setShowAdd(false)} style={{ position: "fixed", inset: 0, zIndex: 49, background: "rgba(0,0,0,0.5)" }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: 10,
            padding: "20px 22px", width: 420, zIndex: 50, boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          }}>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13, marginBottom: 16 }}>
              Add Custom Feed
            </div>

            {[
              { label: "Source Name", value: newName, set: setNewName, placeholder: "e.g. Goldman Sachs Research" },
              { label: "Feed URL", value: newUrl, set: setNewUrl, placeholder: "https://example.com/feed.rss" },
            ].map(f => (
              <div key={f.label} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>{f.label}</div>
                <input
                  value={f.value}
                  onChange={e => f.set(e.target.value)}
                  placeholder={f.placeholder}
                  style={{
                    width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)",
                    borderRadius: 5, padding: "7px 10px", color: "var(--text)",
                    fontFamily: "IBM Plex Mono, monospace", fontSize: 11, outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            ))}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Type</div>
                <select value={newType} onChange={e => setNewType(e.target.value as "rss" | "html")} style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: 5, padding: "6px 8px", color: "var(--text)", fontFamily: "IBM Plex Mono", fontSize: 10, outline: "none" }}>
                  <option value="rss">RSS / Atom</option>
                  <option value="html">HTML (Phase 2)</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Fetch Every</div>
                <select value={newInterval} onChange={e => setNewInterval(Number(e.target.value))} style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: 5, padding: "6px 8px", color: "var(--text)", fontFamily: "IBM Plex Mono", fontSize: 10, outline: "none" }}>
                  {[6, 12, 24, 48, 168].map(h => <option key={h} value={h}>{h === 168 ? "weekly" : `${h}h`}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowAdd(false)} style={{ padding: "6px 14px", borderRadius: 5, cursor: "pointer", border: "1px solid var(--border2)", background: "var(--surface2)", color: "var(--muted2)", fontFamily: "IBM Plex Mono", fontSize: 10 }}>Cancel</button>
              <button
                onClick={handleAdd}
                disabled={!newName.trim() || !newUrl.trim() || adding}
                style={{
                  padding: "6px 14px", borderRadius: 5, cursor: !newName.trim() ? "not-allowed" : "pointer",
                  border: "1px solid rgba(0,212,168,0.35)", background: "rgba(0,212,168,0.1)",
                  color: "var(--accent)", fontFamily: "IBM Plex Mono", fontSize: 10, fontWeight: 600,
                  opacity: !newName.trim() || !newUrl.trim() ? 0.4 : 1,
                }}
              >
                {adding ? "Adding…" : "Add Feed"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Info modal ── */}
      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          background: "var(--surface2)", border: "1px solid var(--border2)",
          borderRadius: 8, padding: "10px 18px", fontSize: 12, color: "var(--text)",
          zIndex: 999, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", whiteSpace: "nowrap",
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}


// ── Info modal ────────────────────────────────────────────────────────────────

function InfoModal({ onClose }: { onClose: () => void }) {
  const section = (title: string) => (
    <div style={{ fontSize: 9, color: "var(--accent)", fontFamily: "IBM Plex Mono", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, marginTop: 18 }}>
      {title}
    </div>
  );
  const p = (text: string) => (
    <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--muted2)", lineHeight: 1.65 }}>{text}</p>
  );
  const bullet = (text: string) => (
    <div style={{ display: "flex", gap: 8, marginBottom: 5 }}>
      <span style={{ color: "var(--accent)", fontFamily: "IBM Plex Mono", fontSize: 10, flexShrink: 0, marginTop: 1 }}>→</span>
      <span style={{ fontSize: 11, color: "var(--muted2)", lineHeight: 1.6 }}>{text}</span>
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 49, background: "rgba(0,0,0,0.55)" }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: 10,
        padding: "24px 26px", width: 520, maxHeight: "80vh", overflowY: "auto",
        zIndex: 50, boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15 }}>Institutional Feeds</div>
            <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "IBM Plex Mono", marginTop: 3 }}>System thesis & usage guide</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 18, padding: 0, lineHeight: 1 }}>×</button>
        </div>

        {section("The Thesis")}
        {p("Prediction market edges are eroded when they miss macro regime shifts. A FOMC statement, an ECB press release, or a NBER working paper can reprice entire categories of contracts overnight — not because of any single data point, but because they change the narrative frame that market participants are reasoning within.")}
        {p("This system crowd-sources the institutional publication stream so PolyBack always has a pulse on that narrative frame, without requiring manual research. The feeds are not alpha sources — they are calibration inputs.")}

        {section("How It Works")}
        {bullet("Enabled feeds are auto-fetched on their configured interval (default 24h). New documents are stored locally.")}
        {bullet("When you click Score, the last 72 hours of headlines and excerpts are sent to the local LLM. It returns a structured macro stance: hawkish, dovish, neutral, or mixed — plus the key factors driving that assessment.")}
        {bullet("The stance score (−1 hawkish → +1 dovish) is blended into the Fraser sizing multiplier as a secondary component at ±5% weight. The primary FOMC tone signal remains dominant at ±15%.")}
        {bullet("The combined multiplier applies universally — stocks, crypto, and prediction markets alike. Macro conditions affect equity valuations and crypto liquidity mechanically and broadly. Prediction market contracts that are directly about macro outcomes (rate decisions, CPI prints) get the most precise signal, but the directional tilt is valid across asset classes.")}

        {section("Macro Stance Panel")}
        {bullet("Score — triggers the LLM to analyze recent docs. Results cache for 4 hours.")}
        {bullet("Force Rescore — bypasses the cache and runs a fresh analysis immediately.")}
        {bullet("The score bar shows position on the hawkish/dovish spectrum. Confidence reflects how consistent and clear the signal is across sources.")}
        {bullet("Dissenting sources are flagged when one institution diverges meaningfully from the consensus — useful context when confidence is low.")}

        {section("Feed Management")}
        {bullet("Preset sources (Fed, ECB, NBER, Atlanta Fed, Treasury, etc.) are curated and cannot be deleted — only disabled.")}
        {bullet("Add any RSS/Atom feed as a custom source. Financial news sites, research blogs, and think tanks with RSS feeds all work.")}
        {bullet("Enable only the feeds most relevant to your current market thesis. A tighter, higher-signal corpus produces better LLM assessments than a noisy firehose.")}

        {section("Multiplier Math")}
        {p("Fraser multiplier = 1.0 + FOMC tone (±15%) + guidance strength (±5%) + rate direction (±5%) + inst-feed stance (±5%). Clamped to 0.75 – 1.25. Applied to suggested position size and confidence at signal staging time, across all exchanges.")}

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>
            LLM provider: configured via LLM_PROVIDER env var (default: Ollama / mistral-small3.2:24b). Stance cached 4h · Fraser FOMC cached 1h.
          </div>
        </div>
      </div>
    </>
  );
}


// ── Stance panel component ────────────────────────────────────────────────────

const STANCE_COLOR: Record<string, string> = {
  hawkish: "#ef4444",
  dovish:  "#22c55e",
  neutral: "#94a3b8",
  mixed:   "#f59e0b",
};

function StancePanel({
  stance, scoring, open, onToggle, onScore, onForceScore,
}: {
  stance:       InstStance | null;
  scoring:      boolean;
  open:         boolean;
  onToggle:     () => void;
  onScore:      () => void;
  onForceScore: () => void;
}) {
  const s = stance;
  const color = s?.stance ? STANCE_COLOR[s.stance] ?? "var(--muted)" : "var(--muted)";

  // Score bar: -1 (left) to +1 (right), midpoint at 50%
  const barPct = s?.score != null ? ((s.score + 1) / 2) * 100 : 50;
  const confPct = s?.confidence != null ? s.confidence * 100 : 0;

  return (
    <div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
      {/* Collapsed header row */}
      <div
        onClick={onToggle}
        style={{
          padding: "8px 16px", display: "flex", alignItems: "center", gap: 10,
          cursor: "pointer", userSelect: "none",
        }}
      >
        <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono", textTransform: "uppercase", letterSpacing: 1 }}>
          Macro Stance
        </span>

        {s?.available ? (
          <>
            <span style={{
              fontSize: 9, padding: "1px 7px", borderRadius: 2, fontWeight: 700,
              fontFamily: "IBM Plex Mono", textTransform: "uppercase", letterSpacing: 1,
              background: `${color}18`, border: `1px solid ${color}44`, color,
            }}>
              {s.stance}
            </span>
            <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>
              score {s.score != null ? (s.score > 0 ? "+" : "") + s.score.toFixed(2) : "—"}
            </span>
            <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>
              conf {confPct.toFixed(0)}%
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>
              {s.generated_at ? fmtAge(s.generated_at) : ""}
            </span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 9, color: "var(--muted2)", fontFamily: "IBM Plex Mono" }}>No score yet</span>
            <span style={{ flex: 1 }} />
          </>
        )}

        <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* Expanded body */}
      {open && (
        <div style={{ padding: "0 16px 12px" }}>

          {/* Score bar */}
          {s?.available && s.score != null && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ position: "relative", height: 4, borderRadius: 2, background: "var(--surface2)", marginBottom: 4 }}>
                {/* Track */}
                <div style={{
                  position: "absolute", left: 0, right: 0, top: 0, bottom: 0,
                  borderRadius: 2,
                  background: `linear-gradient(to right, ${STANCE_COLOR.hawkish}33, var(--surface2) 50%, ${STANCE_COLOR.dovish}33)`,
                }} />
                {/* Center line */}
                <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "var(--border2)" }} />
                {/* Cursor */}
                <div style={{
                  position: "absolute", top: "50%", transform: "translate(-50%,-50%)",
                  left: `${barPct}%`,
                  width: 8, height: 8, borderRadius: "50%",
                  background: color, border: "2px solid var(--bg)",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>
                <span style={{ color: STANCE_COLOR.hawkish }}>Hawkish</span>
                <span>Neutral</span>
                <span style={{ color: STANCE_COLOR.dovish }}>Dovish</span>
              </div>
            </div>
          )}

          {/* Key factors */}
          {s?.available && s.key_factors.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 8, color: "var(--muted)", fontFamily: "IBM Plex Mono", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Key Factors</div>
              <ul style={{ margin: 0, paddingLeft: 14 }}>
                {s.key_factors.map((f, i) => (
                  <li key={i} style={{ fontSize: 10, color: "var(--muted2)", lineHeight: 1.5, marginBottom: 2 }}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Dissenting sources */}
          {s?.available && s.dissenting_sources.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 8, color: "var(--muted)", fontFamily: "IBM Plex Mono", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Dissenting</div>
              {s.dissenting_sources.map((src, i) => (
                <div key={i} style={{ fontSize: 9, color: "#f59e0b", fontFamily: "IBM Plex Mono", marginBottom: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{src}</div>
              ))}
            </div>
          )}

          {/* Controls */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
            <button
              onClick={onScore}
              disabled={scoring}
              style={{
                padding: "3px 10px", borderRadius: 3, cursor: scoring ? "wait" : "pointer", fontSize: 9,
                border: "1px solid rgba(0,212,168,0.3)", background: "rgba(0,212,168,0.07)",
                color: "var(--accent)", fontFamily: "IBM Plex Mono", fontWeight: 600,
                opacity: scoring ? 0.5 : 1,
              }}
            >
              {scoring ? "Scoring…" : stance?.available && stance.llm_provider ? `Score (${stance.llm_provider})` : "Score"}
            </button>
            {s?.available && (
              <button
                onClick={onForceScore}
                disabled={scoring}
                style={{
                  padding: "3px 10px", borderRadius: 3, cursor: scoring ? "wait" : "pointer", fontSize: 9,
                  border: "1px solid var(--border2)", background: "transparent",
                  color: "var(--muted)", fontFamily: "IBM Plex Mono",
                  opacity: scoring ? 0.5 : 1,
                }}
              >
                Force Rescore
              </button>
            )}
            <span style={{ flex: 1 }} />
            {scoring ? (
              <span style={{ fontSize: 9, color: "var(--accent)", fontFamily: "IBM Plex Mono", opacity: 0.8 }}>
                waiting for LLM…
              </span>
            ) : s?.available && s.llm_provider ? (
              <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>
                {s.llm_provider} / {s.llm_model} · {s.doc_count} docs
              </span>
            ) : s?.available ? (
              <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>
                {s.doc_count} docs analyzed
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}


// ── Feed row sub-component ─────────────────────────────────────────────────────

function FeedRow({ feed, selected, fetching, onSelect, onToggle, onFetch, onDelete }: {
  feed: InstFeed;
  selected: boolean;
  fetching: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onFetch: () => void;
  onDelete: () => void;
}) {
  const statusColor = feed.enabled ? "var(--accent)" : "var(--muted)";

  return (
    <div
      onClick={onSelect}
      style={{
        padding: "10px 14px", borderBottom: "1px solid var(--border)",
        cursor: "pointer", transition: "background 0.1s",
        background: selected ? "rgba(0,212,168,0.04)" : undefined,
        borderLeft: `2px solid ${selected ? "var(--accent)" : "transparent"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        {/* Status dot + toggle */}
        <button
          onClick={e => { e.stopPropagation(); onToggle(); }}
          title={feed.enabled ? "Disable" : "Enable"}
          style={{
            width: 10, height: 10, borderRadius: "50%", marginTop: 2, flexShrink: 0, cursor: "pointer",
            background: statusColor, border: `2px solid ${statusColor}`,
            opacity: feed.enabled ? 1 : 0.3, padding: 0,
            outline: "none", transition: "all 0.15s",
          }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {feed.name}
            </span>
            <TypeBadge type={feed.feed_type} />
          </div>
          <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono", display: "flex", gap: 10 }}>
            <span>{feed.doc_count} docs</span>
            <span>last: {fmtAge(feed.last_fetched)}</span>
            <span>{feed.scrape_interval_hours}h interval</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button
            onClick={e => { e.stopPropagation(); onFetch(); }}
            disabled={fetching}
            title="Fetch now"
            style={{
              padding: "2px 7px", borderRadius: 3, cursor: fetching ? "wait" : "pointer", fontSize: 9,
              border: "1px solid rgba(0,212,168,0.25)", background: "rgba(0,212,168,0.06)",
              color: "var(--accent)", fontFamily: "IBM Plex Mono", opacity: fetching ? 0.5 : 1,
            }}
          >
            {fetching ? "…" : "Fetch"}
          </button>
          {!feed.is_preset && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              title="Remove"
              style={{
                padding: "2px 6px", borderRadius: 3, cursor: "pointer", fontSize: 10,
                border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)",
                color: "#ef4444", fontFamily: "IBM Plex Mono",
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
