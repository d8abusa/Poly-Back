import { useState, useEffect } from "react";
import {
  getWatchlist, addWatchlistItem, removeWatchlistItem,
  getAlerts, createAlert, dismissAlert, markAlertRead,
} from "../../api/watchlistClient";
import type { AlertTrigger } from "../../api/watchlistClient";

interface WatchlistItem {
  id: string;
  market_id: string;
  market_title: string;
  category: string;
  added_at: string;
}

interface Alert {
  id: string;
  watchlist_item_id?: string;
  market_id: string;
  market_title: string;
  trigger: AlertTrigger;
  triggered_at?: string;
  dismissed_at?: string;
  read: boolean;
  created_at: string;
}

const CATEGORIES = ["All", "Political", "Economic", "Crypto", "Sports", "Other"];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Watchlist() {
  const [watchlist, setWatchlist]           = useState<WatchlistItem[]>([]);
  const [alerts, setAlerts]                 = useState<Alert[]>([]);
  const [category, setCategory]             = useState("All");
  const [loading, setLoading]               = useState(true);
  const [selectedItem, setSelectedItem]     = useState<WatchlistItem | null>(null);

  // Add dialog
  const [showAdd, setShowAdd]               = useState(false);
  const [newId, setNewId]                   = useState("");
  const [newTitle, setNewTitle]             = useState("");
  const [newCat, setNewCat]                 = useState("Other");

  // Alert dialog
  const [showAlert, setShowAlert]           = useState(false);
  const [alertThreshold, setAlertThreshold] = useState("");
  const [alertType, setAlertType]           = useState<"target" | "stop_loss">("target");
  const [alertDir, setAlertDir]             = useState<"above" | "below">("above");

  const [toast, setToast]                   = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function load() {
    setLoading(true);
    try {
      const [wl, al] = await Promise.all([getWatchlist(), getAlerts().catch(() => [])]);
      setWatchlist(wl);
      setAlerts(al);
    } catch {
      showToast("Failed to load watchlist");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleAdd() {
    if (!newId.trim() || !newTitle.trim()) return;
    try {
      await addWatchlistItem({ market_id: newId.trim(), market_title: newTitle.trim(), category: newCat });
      setShowAdd(false); setNewId(""); setNewTitle(""); setNewCat("Other");
      showToast("Added to watchlist");
      load();
    } catch { showToast("Failed to add"); }
  }

  async function handleRemove(item_id: string) {
    try {
      await removeWatchlistItem(item_id);
      if (selectedItem?.id === item_id) setSelectedItem(null);
      showToast("Removed");
      load();
    } catch { showToast("Failed to remove"); }
  }

  async function handleCreateAlert() {
    if (!selectedItem || !alertThreshold) return;
    const trigger: AlertTrigger = {
      price_type: alertType,
      threshold: parseFloat(alertThreshold),
      direction: alertDir,
    };
    try {
      await createAlert({ market_id: selectedItem.market_id, trigger });
      setShowAlert(false); setAlertThreshold(""); setSelectedItem(null);
      showToast("Alert created");
      load();
    } catch { showToast("Failed to create alert"); }
  }

  async function handleDismiss(id: string) {
    try { await dismissAlert(id); load(); } catch {}
  }

  async function handleMarkRead(id: string) {
    try { await markAlertRead(id); load(); } catch {}
  }

  const filtered = category === "All" ? watchlist : watchlist.filter(i => i.category === category);
  const activeAlerts = alerts.filter(a => !a.dismissed_at);
  const unreadCount = activeAlerts.filter(a => !a.read).length;

  const itemAlerts = (item_id: string) => alerts.filter(a => a.watchlist_item_id === item_id && !a.dismissed_at);

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

      {/* ── Left: watchlist ── */}
      <div style={{ width: 380, minWidth: 380, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>

        {/* Header */}
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13 }}>
            Watchlist
            <span style={{ marginLeft: 8, fontSize: 10, color: "var(--muted)", fontFamily: "IBM Plex Mono", fontWeight: 400 }}>
              {watchlist.length} market{watchlist.length !== 1 ? "s" : ""}
            </span>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              padding: "4px 10px", borderRadius: 4, cursor: "pointer",
              fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 600,
              border: "1px solid rgba(0,212,168,0.3)", background: "rgba(0,212,168,0.07)",
              color: "var(--accent)",
            }}
          >
            + Add
          </button>
        </div>

        {/* Category filter */}
        <div style={{ display: "flex", gap: 4, padding: "8px 14px", borderBottom: "1px solid var(--border)", flexWrap: "wrap", flexShrink: 0 }}>
          {CATEGORIES.map(c => {
            const on = category === c;
            return (
              <button key={c} onClick={() => setCategory(c)} style={{
                padding: "2px 8px", borderRadius: 3, cursor: "pointer", fontSize: 9,
                fontFamily: "IBM Plex Mono, monospace",
                border: `1px solid ${on ? "rgba(0,212,168,0.4)" : "var(--border2)"}`,
                background: on ? "rgba(0,212,168,0.08)" : "var(--surface2)",
                color: on ? "var(--accent)" : "var(--muted)",
              }}>{c}</button>
            );
          })}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: "20px 14px", color: "var(--muted)", fontSize: 10, fontFamily: "IBM Plex Mono" }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "40px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 28, opacity: 0.15, marginBottom: 10 }}>👁</div>
              <div style={{ fontSize: 11, color: "var(--muted2)" }}>
                {watchlist.length === 0 ? "No markets on watchlist" : "No markets in this category"}
              </div>
            </div>
          ) : (
            filtered.map(item => {
              const ia = itemAlerts(item.id);
              const hasNew = ia.some(a => !a.read);
              const isSelected = selectedItem?.id === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(isSelected ? null : item)}
                  style={{
                    padding: "10px 14px", borderBottom: "1px solid var(--border)",
                    cursor: "pointer", transition: "background 0.1s",
                    background: isSelected ? "rgba(0,212,168,0.04)" : undefined,
                    borderLeft: `2px solid ${isSelected ? "var(--accent)" : "transparent"}`,
                    display: "flex", alignItems: "flex-start", gap: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 11, color: "var(--text)", marginBottom: 3,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {item.market_title}
                    </div>
                    <div style={{ display: "flex", gap: 8, fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>
                      <span style={{
                        padding: "1px 5px", borderRadius: 2,
                        background: "var(--surface2)", border: "1px solid var(--border2)",
                      }}>{item.category}</span>
                      <span>{fmtDate(item.added_at)}</span>
                      {ia.length > 0 && (
                        <span style={{ color: hasNew ? "#f59e0b" : "var(--muted)" }}>
                          {ia.length} alert{ia.length !== 1 ? "s" : ""}{hasNew ? " ●" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={e => { e.stopPropagation(); setSelectedItem(item); setShowAlert(true); }}
                      title="Create alert"
                      style={{
                        padding: "2px 6px", borderRadius: 3, cursor: "pointer", fontSize: 9,
                        border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.06)",
                        color: "#f59e0b", fontFamily: "IBM Plex Mono",
                      }}
                    >
                      + Alert
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleRemove(item.id); }}
                      title="Remove"
                      style={{
                        padding: "2px 6px", borderRadius: 3, cursor: "pointer", fontSize: 10,
                        border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)",
                        color: "#ef4444", fontFamily: "IBM Plex Mono",
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right: alerts panel ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Alerts header */}
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13 }}>
            Alerts
            {unreadCount > 0 && (
              <span style={{
                marginLeft: 8, padding: "1px 6px", borderRadius: 10, fontSize: 9,
                background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.4)",
                color: "#f59e0b", fontFamily: "IBM Plex Mono",
              }}>
                {unreadCount} new
              </span>
            )}
          </div>
          <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono" }}>
            {activeAlerts.length} active
          </span>
        </div>

        {/* Alert list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px" }}>
          {activeAlerts.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center" }}>
              <div style={{ fontSize: 28, opacity: 0.15, marginBottom: 10 }}>🔔</div>
              <div style={{ fontSize: 11, color: "var(--muted2)" }}>No active alerts</div>
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
                Click + Alert on any watchlist item to create one
              </div>
            </div>
          ) : (
            activeAlerts.map(alert => {
              const isNew = !alert.read;
              const isSL = alert.trigger.price_type === "stop_loss";
              const accentCol = isSL ? "#ef4444" : "#f59e0b";
              return (
                <div key={alert.id} style={{
                  padding: "10px 12px", marginBottom: 6, borderRadius: 6,
                  background: isNew ? `${accentCol}0a` : "var(--surface2)",
                  border: `1px solid ${isNew ? `${accentCol}33` : "var(--border)"}`,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 5 }}>
                    <div style={{
                      fontSize: 10, color: "var(--text)", fontWeight: isNew ? 600 : 400,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 8,
                    }}>
                      {alert.market_title}
                    </div>
                    <span style={{
                      fontSize: 8, padding: "1px 5px", borderRadius: 2,
                      background: `${accentCol}18`, color: accentCol, flexShrink: 0,
                      fontFamily: "IBM Plex Mono", textTransform: "uppercase",
                    }}>
                      {isSL ? "Stop Loss" : "Target"}
                    </span>
                  </div>

                  <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Mono", marginBottom: 7 }}>
                    {alert.trigger.direction === "above" ? "▲ above" : "▼ below"}{" "}
                    <span style={{ color: accentCol, fontWeight: 700 }}>
                      {alert.trigger.threshold.toFixed(2)}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 5 }}>
                    {!alert.read && (
                      <button onClick={() => handleMarkRead(alert.id)} style={{
                        padding: "2px 7px", borderRadius: 3, cursor: "pointer", fontSize: 9,
                        border: "1px solid var(--border2)", background: "var(--surface)",
                        color: "var(--muted2)", fontFamily: "IBM Plex Mono",
                      }}>
                        Mark read
                      </button>
                    )}
                    <button onClick={() => handleDismiss(alert.id)} style={{
                      padding: "2px 7px", borderRadius: 3, cursor: "pointer", fontSize: 9,
                      border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)",
                      color: "#ef4444", fontFamily: "IBM Plex Mono",
                    }}>
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Add market dialog ── */}
      {showAdd && (
        <>
          <div onClick={() => setShowAdd(false)} style={{ position: "fixed", inset: 0, zIndex: 49, background: "rgba(0,0,0,0.5)" }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: 10,
            padding: "20px 22px", width: 360, zIndex: 50, boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          }}>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13, marginBottom: 14 }}>
              Add to Watchlist
            </div>
            {([
              { label: "Market ID", value: newId, set: setNewId, placeholder: "e.g. 0x1a2b…" },
              { label: "Title", value: newTitle, set: setNewTitle, placeholder: "e.g. Will BTC reach $100k?" },
            ] as const).map(f => (
              <div key={f.label} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{f.label}</div>
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
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Category</div>
              <select
                value={newCat}
                onChange={e => setNewCat(e.target.value)}
                style={{
                  width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)",
                  borderRadius: 5, padding: "7px 10px", color: "var(--text)",
                  fontFamily: "IBM Plex Mono, monospace", fontSize: 11, outline: "none",
                }}
              >
                {CATEGORIES.filter(c => c !== "All").map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowAdd(false)} style={{ padding: "6px 14px", borderRadius: 5, cursor: "pointer", border: "1px solid var(--border2)", background: "var(--surface2)", color: "var(--muted2)", fontFamily: "IBM Plex Mono", fontSize: 10 }}>Cancel</button>
              <button onClick={handleAdd} disabled={!newId.trim() || !newTitle.trim()} style={{ padding: "6px 14px", borderRadius: 5, cursor: "pointer", border: "1px solid rgba(0,212,168,0.35)", background: "rgba(0,212,168,0.1)", color: "var(--accent)", fontFamily: "IBM Plex Mono", fontSize: 10, fontWeight: 600 }}>Add</button>
            </div>
          </div>
        </>
      )}

      {/* ── Create alert dialog ── */}
      {showAlert && selectedItem && (
        <>
          <div onClick={() => { setShowAlert(false); setSelectedItem(null); }} style={{ position: "fixed", inset: 0, zIndex: 49, background: "rgba(0,0,0,0.5)" }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: 10,
            padding: "20px 22px", width: 340, zIndex: 50, boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          }}>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Create Alert</div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectedItem.market_title}
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Threshold</div>
              <input
                type="number"
                value={alertThreshold}
                onChange={e => setAlertThreshold(e.target.value)}
                placeholder="0.00"
                style={{
                  width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)",
                  borderRadius: 5, padding: "7px 10px", color: "var(--text)",
                  fontFamily: "IBM Plex Mono, monospace", fontSize: 11, outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              {([
                { label: "Type", value: alertType, set: setAlertType, options: [["target", "Target"], ["stop_loss", "Stop Loss"]] },
                { label: "Direction", value: alertDir, set: setAlertDir, options: [["above", "▲ Above"], ["below", "▼ Below"]] },
              ] as const).map(f => (
                <div key={f.label}>
                  <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{f.label}</div>
                  <select
                    value={f.value}
                    onChange={e => (f.set as any)(e.target.value)}
                    style={{
                      width: "100%", background: "var(--surface2)", border: "1px solid var(--border2)",
                      borderRadius: 5, padding: "6px 8px", color: "var(--text)",
                      fontFamily: "IBM Plex Mono, monospace", fontSize: 10, outline: "none",
                    }}
                  >
                    {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setShowAlert(false); setSelectedItem(null); }} style={{ padding: "6px 14px", borderRadius: 5, cursor: "pointer", border: "1px solid var(--border2)", background: "var(--surface2)", color: "var(--muted2)", fontFamily: "IBM Plex Mono", fontSize: 10 }}>Cancel</button>
              <button onClick={handleCreateAlert} disabled={!alertThreshold || parseFloat(alertThreshold) <= 0} style={{ padding: "6px 14px", borderRadius: 5, cursor: "pointer", border: "1px solid rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.1)", color: "#f59e0b", fontFamily: "IBM Plex Mono", fontSize: 10, fontWeight: 600 }}>Create</button>
            </div>
          </div>
        </>
      )}

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
