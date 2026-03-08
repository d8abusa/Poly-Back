// ── Shared utility functions ───────────────────────────────────────────────────

/** Seeded synthetic probability curve — consistent per market id */
export function genCurve(id: string, finalProb: number, n = 90): number[] {
  let seed = id.charCodeAt(2) * 37 + id.charCodeAt(3) * 13;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  };
  const pts: number[] = [];
  let v = rand() * 0.3 + 0.15;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const target = finalProb * t + (rand() * 0.15 + 0.1) * (1 - t);
    v = v * 0.82 + target * 0.18 + (rand() - 0.5) * 0.06;
    pts.push(Math.min(0.97, Math.max(0.03, v)));
  }
  pts[pts.length - 1] = finalProb;
  return pts;
}

export function fmtVol(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}

/** Returns CSS class name: "hi" | "mid" | "lo" */
export function probColor(p: number): string {
  if (p >= 0.65) return "hi";
  if (p >= 0.35) return "mid";
  return "lo";
}

export function catColor(cat: string): string {
  const map: Record<string, string> = {
    Economics: "#00d4a8",
    Politics: "#7b61ff",
    Crypto: "#f59e0b",
    Sports: "#22c55e",
    "Science & Tech": "#3b82f6",
    "Pop Culture": "#ec4899",
  };
  return map[cat] ?? "#8891aa";
}
