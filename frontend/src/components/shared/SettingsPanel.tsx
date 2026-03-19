import { useState, useEffect } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FieldStatus {
  configured: boolean;
  preview:    string | null;
}

interface ExchangeStatus {
  auth_level:   string;
  capabilities: { read_public: boolean; read_private: boolean; place_orders: boolean };
  fields:       Record<string, FieldStatus>;
  note?:        string;
}

interface AllSettings {
  coinbase:   ExchangeStatus;
  kalshi:     ExchangeStatus;
  manifold:   ExchangeStatus;
  polymarket: ExchangeStatus;
}

interface SettingsPanelProps {
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EXCHANGE_META = {
  coinbase: {
    name:   "Coinbase",
    color:  "#0052ff",
    logo:   "CB",
    desc:   "Primary live trading exchange — Advanced Trade API",
    docs:   "https://docs.cdp.coinbase.com/advanced-trade/docs/rest-api-auth",
    fields: [
      { key: "COINBASE_KEY_NAME",    label: "Key Name",    hint: "Full path: organizations/{org_id}/apiKeys/{key_id}" },
      { key: "COINBASE_PRIVATE_KEY", label: "Private Key", hint: "PEM-encoded EC private key (ES256)" },
    ],
  },
  kalshi: {
    name:   "Kalshi",
    color:  "#3b82f6",
    logo:   "KL",
    desc:   "CFTC-regulated US prediction market exchange",
    docs:   "https://kalshi.com/account/api",
    fields: [
      { key: "KALSHI_API_KEY",      label: "API Key",      hint: "From kalshi.com → Account → API" },
      { key: "KALSHI_PRIVATE_KEY",  label: "Private Key",  hint: "PEM RSA private key for order signing (RSA-PSS)" },
    ],
  },
  manifold: {
    name:   "Manifold",
    color:  "#f59e0b",
    logo:   "MF",
    desc:   "Open-source AMM — play money, no credentials required",
    docs:   "https://manifold.markets",
    fields: [] as { key: string; label: string; hint: string }[],
  },
  polymarket: {
    name:   "Polymarket",
    color:  "#606880",
    logo:   "PM",
    desc:   "Disabled — geoblocked for US users",
    docs:   "https://polymarket.com",
    fields: [] as { key: string; label: string; hint: string }[],
  },
} as const;

type ExchangeKey = keyof typeof EXCHANGE_META;

const CAPABILITY_LABELS: Record<string, string> = {
  read_public:  "Read public markets",
  read_private: "Read private/auth endpoints",
  place_orders: "Place & manage orders",
};

function AuthBadge({ level }: { level: string }) {
  const cfg: Record<string, { label: string; bg: string; color: string }> = {
    full:   { label: "Full Access",   bg: "rgba(34,197,94,0.12)",  color: "#22c55e" },
    api:    { label: "API Read",      bg: "rgba(0,212,168,0.1)",   color: "#00d4a8" },
    public: { label: "Public Only",   bg: "rgba(96,104,128,0.12)", color: "#8891aa" },
  };
  const s = cfg[level] ?? cfg.public;
  return (
    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: s.bg, color: s.color, border: `1px solid ${s.color}30`, fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

// ── Credential field row ──────────────────────────────────────────────────────

function CredField({
  fieldKey, label, hint, status, value, onChange, onClear,
}: {
  fieldKey: string; label: string; hint: string;
  status:   FieldStatus;
  value:    string;
  onChange: (v: string) => void;
  onClear:  () => void;
}) {
  const [show, setShow] = useState(false);
  const dirty = value !== "";

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <span style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {status.configured && !dirty && (
            <span style={{ fontSize: 9, color: "#8891aa", fontFamily: "IBM Plex Mono, monospace" }}>{status.preview}</span>
          )}
          <span style={{
            fontSize: 9, padding: "1px 6px", borderRadius: 3,
            background: status.configured ? "rgba(34,197,94,0.1)" : "rgba(96,104,128,0.1)",
            color: status.configured ? "#22c55e" : "#606880",
            border: `1px solid ${status.configured ? "rgba(34,197,94,0.2)" : "#252d3d"}`,
          }}>
            {status.configured ? "Configured" : "Not set"}
          </span>
          {status.configured && (
            <button
              onClick={onClear}
              title="Clear this credential"
              style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, cursor: "pointer", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#ef4444", fontFamily: "IBM Plex Mono, monospace" }}
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <div style={{ position: "relative" }}>
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={status.configured ? "Enter new value to replace…" : "Paste value here…"}
          style={{
            width: "100%", boxSizing: "border-box",
            background: "#0a0c0f", border: `1px solid ${dirty ? "#252d3d" : "#1e2330"}`,
            borderRadius: 5, padding: "8px 36px 8px 10px",
            color: "#e8eaf0", fontFamily: "IBM Plex Mono, monospace", fontSize: 11,
            outline: "none", transition: "border-color 0.12s",
          }}
          onFocus={e => { e.target.style.borderColor = "#252d3d"; }}
          onBlur={e  => { e.target.style.borderColor = dirty ? "#252d3d" : "#1e2330"; }}
        />
        <button
          onClick={() => setShow(s => !s)}
          style={{
            position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", cursor: "pointer",
            color: "#606880", fontSize: 12, padding: 2,
          }}
          title={show ? "Hide" : "Show"}
        >
          {show ? "○" : "●"}
        </button>
      </div>
      <div style={{ fontSize: 9, color: "#4a5568", marginTop: 3 }}>{hint}</div>
    </div>
  );
}

// ── Exchange section ──────────────────────────────────────────────────────────

function ExchangeSection({
  exKey, status, onSaved,
}: {
  exKey:   ExchangeKey;
  status:  ExchangeStatus;
  onSaved: (updated: ExchangeStatus) => void;
}) {
  const meta   = EXCHANGE_META[exKey];
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg,    setMsg]    = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = Object.values(vals).some(v => v !== "");

  const showMsg = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 3500);
  };

  const handleSave = async () => {
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(vals)) {
      if (v.trim()) payload[_fieldKeyToBodyKey(exKey, k)] = v.trim();
    }
    if (!Object.keys(payload).length) return;

    setSaving(true);
    try {
      const resp = await fetch(`/api/settings/${exKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setVals({});
      onSaved(data.status);
      showMsg(true, "Credentials saved — restart backend to apply.");
    } catch (e: any) {
      showMsg(false, `Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async (fieldEnvKey: string) => {
    try {
      const resp = await fetch(`/api/settings/${exKey}/${fieldEnvKey}`, { method: "DELETE" });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      onSaved(data.status);
      showMsg(true, `${fieldEnvKey} cleared.`);
    } catch (e: any) {
      showMsg(false, `Clear failed: ${e.message}`);
    }
  };

  return (
    <div style={{ background: "#111318", border: "1px solid #1e2330", borderRadius: 10, padding: 22, marginBottom: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: `linear-gradient(135deg, ${meta.color}30, ${meta.color}15)`, border: `1px solid ${meta.color}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: meta.color, fontFamily: "IBM Plex Mono, monospace", flexShrink: 0 }}>
          {meta.logo}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 14, color: "#e8eaf0" }}>{meta.name}</div>
          <div style={{ fontSize: 10, color: "#606880", marginTop: 1 }}>{meta.desc}</div>
        </div>
        <AuthBadge level={status.auth_level} />
      </div>

      {/* Capabilities */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {Object.entries(status.capabilities).map(([cap, enabled]) => (
          <div key={cap} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 4, background: enabled ? "rgba(34,197,94,0.06)" : "#0d1017", border: `1px solid ${enabled ? "rgba(34,197,94,0.18)" : "#1e2330"}` }}>
            <span style={{ fontSize: 11, color: enabled ? "#22c55e" : "#4a5568" }}>{enabled ? "✓" : "✕"}</span>
            <span style={{ fontSize: 10, color: enabled ? "#8891aa" : "#4a5568" }}>{CAPABILITY_LABELS[cap]}</span>
          </div>
        ))}
      </div>

      {/* Note (Manifold) */}
      {status.note && (
        <div style={{ fontSize: 11, color: "#8891aa", background: "#0d1017", border: "1px solid #1e2330", borderRadius: 6, padding: "10px 12px", marginBottom: 8 }}>
          {status.note}
        </div>
      )}

      {/* Credential fields */}
      {meta.fields.length > 0 && (
        <>
          {meta.fields.map(f => (
            <CredField
              key={f.key}
              fieldKey={f.key}
              label={f.label}
              hint={f.hint}
              status={status.fields[f.key] ?? { configured: false, preview: null }}
              value={vals[f.key] ?? ""}
              onChange={v => setVals(prev => ({ ...prev, [f.key]: v }))}
              onClear={() => handleClear(f.key)}
            />
          ))}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            {msg ? (
              <span style={{ fontSize: 11, color: msg.ok ? "#22c55e" : "#ef4444" }}>{msg.text}</span>
            ) : (
              <a
                href={meta.docs}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 10, color: meta.color, textDecoration: "none" }}
              >
                Get API keys →
              </a>
            )}
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              style={{
                padding: "7px 18px", borderRadius: 6, cursor: dirty ? "pointer" : "not-allowed",
                border: "none", fontFamily: "Syne, sans-serif", fontSize: 12, fontWeight: 700,
                background: dirty ? `linear-gradient(135deg, ${meta.color}, ${meta.color}bb)` : "#1e2330",
                color: dirty ? "#000" : "#4a5568",
                transition: "all 0.15s",
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Map env key format → JSON body key expected by the backend
function _fieldKeyToBodyKey(exchange: ExchangeKey, envKey: string): string {
  const maps: Record<ExchangeKey, Record<string, string>> = {
    coinbase: {
      COINBASE_KEY_NAME:    "key_name",
      COINBASE_PRIVATE_KEY: "private_key",
    },
    kalshi: {
      KALSHI_API_KEY:      "api_key",
      KALSHI_API_PASSWORD: "api_password",
      KALSHI_PRIVATE_KEY:  "private_key",
    },
    manifold:   {},
    polymarket: {},
  };
  return maps[exchange][envKey] ?? envKey.toLowerCase();
}

// ── Main SettingsPanel ────────────────────────────────────────────────────────

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AllSettings | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [section,  setSection]  = useState<"credentials" | "about">("credentials");

  useEffect(() => {
    fetch("/api/settings")
      .then(r => r.json())
      .then(setSettings)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const updateExchange = (ex: ExchangeKey, updated: ExchangeStatus) => {
    setSettings(prev => prev ? { ...prev, [ex]: updated } : prev);
  };

  return (
    // Backdrop
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 500, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }}
    >
      {/* Panel */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 560, height: "100vh", background: "#0a0c0f",
          borderLeft: "1px solid #1e2330",
          display: "flex", flexDirection: "column",
          fontFamily: "IBM Plex Mono, monospace",
          boxShadow: "-12px 0 40px rgba(0,0,0,0.6)",
          animation: "slideInRight 0.2s ease",
        }}
      >
        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #1e2330", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: "rgba(123,97,255,0.15)", border: "1px solid rgba(123,97,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⚙</div>
          <div>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 16, color: "#e8eaf0" }}>Settings</div>
            <div style={{ fontSize: 10, color: "#606880", marginTop: 1 }}>API keys · credentials · exchange config</div>
          </div>
          <button
            onClick={onClose}
            style={{ marginLeft: "auto", background: "none", border: "1px solid #252d3d", borderRadius: 5, color: "#606880", cursor: "pointer", padding: "4px 10px", fontSize: 12, fontFamily: "IBM Plex Mono, monospace" }}
          >
            ✕ Close
          </button>
        </div>

        {/* Sub-nav */}
        <div style={{ display: "flex", gap: 2, padding: "10px 24px", borderBottom: "1px solid #1e2330", flexShrink: 0 }}>
          {(["credentials", "about"] as const).map(s => (
            <button
              key={s}
              onClick={() => setSection(s)}
              style={{
                padding: "4px 14px", borderRadius: 5, cursor: "pointer",
                fontFamily: "IBM Plex Mono, monospace", fontSize: 11,
                border: `1px solid ${section === s ? "rgba(123,97,255,0.35)" : "transparent"}`,
                background: section === s ? "rgba(123,97,255,0.08)" : "transparent",
                color: section === s ? "#7b61ff" : "#8891aa",
                textTransform: "capitalize",
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {section === "credentials" && (
            <>
              <div style={{ fontSize: 11, color: "#606880", marginBottom: 20, lineHeight: 1.6, background: "rgba(123,97,255,0.05)", border: "1px solid rgba(123,97,255,0.15)", borderRadius: 7, padding: "10px 14px" }}>
                Credentials are stored in your local <code style={{ color: "#7b61ff" }}>.env</code> file and never transmitted outside your machine. Restart the backend after saving to apply changes.
              </div>

              {loading ? (
                <div style={{ color: "#606880", fontSize: 12, textAlign: "center", paddingTop: 40 }}>Loading settings…</div>
              ) : settings ? (
                (["coinbase", "kalshi", "manifold", "polymarket"] as ExchangeKey[]).map(ex => (
                  <ExchangeSection
                    key={ex}
                    exKey={ex}
                    status={settings[ex]}
                    onSaved={updated => updateExchange(ex, updated)}
                  />
                ))
              ) : (
                <div style={{ color: "#ef4444", fontSize: 12 }}>Failed to load settings — is the backend running?</div>
              )}
            </>
          )}

          {section === "about" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: "#111318", border: "1px solid #1e2330", borderRadius: 10, padding: 22 }}>
                <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 18, color: "#00d4a8", marginBottom: 4 }}>
                  Poly<span style={{ color: "#e8eaf0" }}>Back</span>
                </div>
                <div style={{ fontSize: 10, color: "#606880", marginBottom: 16 }}>Prediction Market Quant Platform</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    ["Version",   "0.1.0"],
                    ["Backend",   "FastAPI + Python"],
                    ["Frontend",  "React 18 + TypeScript"],
                    ["Exchanges", "Coinbase · Kalshi · Manifold"],
                  ].map(([k, v]) => (
                    <div key={k} style={{ background: "#0d1017", borderRadius: 6, padding: "10px 12px", border: "1px solid #1e2330" }}>
                      <div style={{ fontSize: 9, color: "#606880", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{k}</div>
                      <div style={{ fontSize: 11, color: "#8891aa" }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: "#111318", border: "1px solid #1e2330", borderRadius: 10, padding: 22 }}>
                <div style={{ fontSize: 10, color: "#606880", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>Security Notes</div>
                {[
                  "API credentials are stored only in your local .env file",
                  "The frontend never receives raw credential values",
                  "Private key is only required for order placement (AUTO mode)",
                  "Manifold Markets requires no credentials — play money only",
                ].map((note, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
                    <span style={{ color: "#00d4a8", flexShrink: 0, marginTop: 1 }}>›</span>
                    <span style={{ fontSize: 11, color: "#8891aa", lineHeight: 1.5 }}>{note}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(40px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
