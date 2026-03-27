import { useState, FormEvent } from "react";
import { setToken } from "../../lib/apiFetch";

interface Props {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { detail?: string }).detail ?? "Login failed");
        return;
      }
      const data = await res.json() as { access_token: string };
      setToken(data.access_token);
      onLogin();
    } catch {
      setError("Could not reach server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", background: "var(--bg)",
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          background: "var(--surface)", border: "1px solid var(--border2)",
          borderRadius: 12, padding: "36px 40px", width: 320,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        <div style={{ marginBottom: 4 }}>
          <div style={{
            fontFamily: "IBM Plex Mono, monospace", fontSize: 18,
            color: "var(--accent)", fontWeight: 700, letterSpacing: "0.04em",
          }}>
            POLYBACK
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            Enter your password to continue
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
            style={{
              background: "var(--surface2)", border: "1px solid var(--border2)",
              borderRadius: 6, padding: "9px 12px", color: "var(--text)",
              fontSize: 14, outline: "none", fontFamily: "IBM Plex Mono, monospace",
            }}
          />
        </div>

        {error && (
          <div style={{ fontSize: 11, color: "#ef4444", padding: "6px 10px", background: "#ef444410", borderRadius: 4 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !password}
          style={{
            background: loading ? "var(--surface2)" : "var(--accent)",
            color: loading ? "var(--muted)" : "#000",
            border: "none", borderRadius: 6, padding: "10px 0",
            fontFamily: "IBM Plex Mono, monospace", fontSize: 13, fontWeight: 700,
            cursor: loading || !password ? "not-allowed" : "pointer",
            transition: "background 0.15s",
          }}
        >
          {loading ? "Verifying..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
