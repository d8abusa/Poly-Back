// ── Theme definitions ─────────────────────────────────────────────────────────

export interface Theme {
  id:      string;
  name:    string;
  desc:    string;
  swatch:  string[];   // preview colors [bg, accent, accent2]
  vars:    Record<string, string>;
}

export const THEMES: Theme[] = [
  {
    id:     "default",
    name:   "Terminal",
    desc:   "Teal on black — default quant terminal",
    swatch: ["#0a0c0f", "#00d4a8", "#ff6b35"],
    vars: {
      "--bg":       "#0a0c0f",
      "--surface":  "#111318",
      "--surface2": "#181c23",
      "--border":   "#1e2330",
      "--border2":  "#252d3d",
      "--accent":   "#00d4a8",
      "--accent2":  "#ff6b35",
      "--accent3":  "#7b61ff",
      "--yes":      "#22c55e",
      "--no":       "#ef4444",
      "--text":     "#e8eaf0",
      "--muted":    "#606880",
      "--muted2":   "#8891aa",
    },
  },
  {
    id:     "boeing",
    name:   "Boeing Blue",
    desc:   "Aerospace dark navy — Boeing brand palette",
    swatch: ["#000f2e", "#00a3e0", "#ff8c00"],
    vars: {
      "--bg":       "#000f2e",
      "--surface":  "#001233",
      "--surface2": "#001a44",
      "--border":   "#002a6e",
      "--border2":  "#003087",
      "--accent":   "#00a3e0",
      "--accent2":  "#ff8c00",
      "--accent3":  "#4fc3f7",
      "--yes":      "#00c853",
      "--no":       "#ff3d00",
      "--text":     "#e8eef7",
      "--muted":    "#5a7fa8",
      "--muted2":   "#8aafd0",
    },
  },
  {
    id:     "midnight",
    name:   "Midnight",
    desc:   "Pure black — Bloomberg terminal style",
    swatch: ["#000000", "#f0c040", "#ffffff"],
    vars: {
      "--bg":       "#000000",
      "--surface":  "#0a0a0a",
      "--surface2": "#111111",
      "--border":   "#1a1a1a",
      "--border2":  "#242424",
      "--accent":   "#f0c040",
      "--accent2":  "#ff4444",
      "--accent3":  "#4488ff",
      "--yes":      "#33cc66",
      "--no":       "#ff4444",
      "--text":     "#f0f0f0",
      "--muted":    "#555555",
      "--muted2":   "#888888",
    },
  },
];

const STORAGE_KEY = "polyback_theme";

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const [key, val] of Object.entries(theme.vars)) {
    root.style.setProperty(key, val);
  }
  localStorage.setItem(STORAGE_KEY, theme.id);
}

export function loadSavedTheme(): void {
  const saved = localStorage.getItem(STORAGE_KEY) ?? "boeing";
  const theme  = THEMES.find(t => t.id === saved) ?? THEMES[1];
  applyTheme(theme);
}

export function getActiveThemeId(): string {
  return localStorage.getItem(STORAGE_KEY) ?? "boeing";
}
