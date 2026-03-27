import { useState, useEffect } from "react";
import { apiFetch } from "../../lib/apiFetch";

interface AuthInfo {
  auth_level:      "full" | "api" | "public";
  has_api_creds:   boolean;
  has_private_key: boolean;
  chain_id:        number;
  capabilities: {
    read_public:  boolean;
    read_private: boolean;
    place_orders: boolean;
  };
}

const LEVEL_STYLE: Record<string, { color: string; dot: string; label: string }> = {
  full:   { color: "#22c55e", dot: "#22c55e", label: "Full Auth" },
  api:    { color: "#f59e0b", dot: "#f59e0b", label: "API Only" },
  public: { color: "var(--muted)",  dot: "var(--border2)", label: "Public" },
};

export default function AuthStatus() {
  const [auth, setAuth]   = useState<AuthInfo | null>(null);
  const [open, setOpen]   = useState(false);

  useEffect(() => {
    apiFetch("/api/feed/auth/status")
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setAuth(d))
      .catch(() => {});
  }, []);

  if (!auth) return null;

  const lvl = LEVEL_STYLE[auth.auth_level];

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "3px 10px", borderRadius: 4, cursor: "pointer",
          border: `1px solid ${open ? lvl.color + "55" : "var(--border2)"}`,
          background: open ? lvl.color + "10" : "var(--surface2)",
          fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
          color: lvl.color,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: lvl.dot, flexShrink: 0 }} />
        {lvl.label}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 98 }} />
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 99,
            width: 280, background: "var(--surface)", border: "1px solid var(--border2)",
            borderRadius: 8, boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            fontFamily: "IBM Plex Mono, monospace",
          }}>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
                Polymarket Auth
              </div>
              <div style={{ fontSize: 13, color: lvl.color, fontWeight: 600 }}>{lvl.label}</div>
              <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 2 }}>
                Chain ID: {auth.chain_id === 137 ? "Polygon Mainnet" : auth.chain_id === 80002 ? "Amoy Testnet" : auth.chain_id}
              </div>
            </div>

            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
              {[
                { label: "Public read",   ok: auth.capabilities.read_public },
                { label: "Private read",  ok: auth.capabilities.read_private },
                { label: "Place orders",  ok: auth.capabilities.place_orders },
              ].map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0", fontSize: 11 }}>
                  <span style={{ color: c.ok ? "#22c55e" : "var(--muted)" }}>{c.ok ? "✓" : "○"}</span>
                  <span style={{ color: c.ok ? "var(--text)" : "var(--muted)" }}>{c.label}</span>
                </div>
              ))}
            </div>

            {auth.auth_level !== "full" && (
              <div style={{ padding: "10px 14px" }}>
                <div style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.7, marginBottom: 8 }}>
                  To enable order placement, add credentials to{" "}
                  <code style={{ color: "var(--accent)", fontSize: 9 }}>.env</code> in the project root:
                </div>
                <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 4, padding: "8px 10px", fontSize: 9, color: "var(--muted2)", lineHeight: 2 }}>
                  POLY_API_KEY=<br />
                  POLY_API_SECRET=<br />
                  POLY_API_PASSPHRASE=<br />
                  POLY_PRIVATE_KEY=
                </div>
                <a
                  href="https://polymarket.com/profile"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "block", marginTop: 8, fontSize: 10, color: "var(--accent)", textDecoration: "none" }}
                >
                  → Get API keys at polymarket.com/profile ↗
                </a>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
