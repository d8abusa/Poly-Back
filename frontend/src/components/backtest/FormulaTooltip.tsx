import { useState, useEffect } from "react";

interface FormulaTooltipProps {
  hoveredStrategy: string;
  formula?: string;
  logic?: { entry?: string; exit?: string; size?: string };
  accentColor: string;
}

export default function FormulaTooltip({ hoveredStrategy, formula, logic, accentColor }: FormulaTooltipProps) {
  const [showFull, setShowFull] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const showDelayMs = 800; // Delay before tooltip appears

  // Track mouse position on window and manage visibility delay
  useEffect(() => {
    if (!hoveredStrategy || showFull) return;

    let timeoutId: NodeJS.Timeout;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = (e.target as HTMLElement)?.getBoundingClientRect?.();
      if (rect) {
        setPosition({
          top: rect.top + rect.height + 12,
          left: rect.left + rect.width / 2 - 210, // center relative to button (420px width)
        });
      } else {
        setPosition({
          top: e.clientY + 16,
          left: e.clientX + 16,
        });
      }

      // Show tooltip after delay
      timeoutId = setTimeout(() => setIsVisible(true), showDelayMs);
    };

    window.addEventListener("mousemove", handleMouseMove);
    
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      clearTimeout(timeoutId);
      setIsVisible(false);
    };
  }, [hoveredStrategy, showFull, showDelayMs]);

  if (!formula && (!logic || (!logic.entry && !logic.exit && !logic.size))) {
    return null;
  }

  const hasFormula = !!formula;
  const hasLogic = logic && (logic.entry || logic.exit || logic.size);

  // Full-screen view mode
  if (showFull) {
    return (
      <div style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.98)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        backdropFilter: "blur(8px)",
      }}>
        <div style={{
          width: "100%",
          maxWidth: 700,
          background: "#0a0f1a",
          border: `1px solid ${accentColor}99`,
          borderRadius: 12,
          padding: 28,
          boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px ${accentColor}44`,
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 20,
          }}>
            <div>
              <h3 style={{ 
                margin: "0 0 6px", 
                fontSize: 18, 
                color: accentColor,
              }}>📘 Strategy Formula</h3>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
                Mathematical expression governing entry/exit signals
              </p>
            </div>
            <button onClick={() => setShowFull(false)} style={{
              width: 28,
              height: 28,
              background: "transparent",
              border: `1px solid ${accentColor}55`,
              color: accentColor,
              borderRadius: 6,
              fontSize: 14,
              cursor: "pointer",
            }}>✕</button>
          </div>

          {/* Simple formula display */}
          {hasFormula && (
            <div style={{ marginBottom: 24 }}>
              <code style={{
                display: "block",
                padding: "16px 18px",
                background: `${accentColor}12`,
                borderRadius: 8,
                fontSize: 15,
                color: accentColor,
                fontFamily: '"IBM Plex Mono", "Fira Code", monospace',
                lineHeight: 1.7,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                border: `1px solid ${accentColor}33`,
              }}>
                {formula}
              </code>
            </div>
          )}

          {/* Logic breakdown */}
          {hasLogic && logic && (
            <div style={{ marginBottom: 24 }}>
              <h4 style={{ 
                fontSize: 13, 
                color: accentColor, 
                marginBottom: 16, 
                textTransform: "uppercase",
                letterSpacing: 0.8,
                borderBottom: `1px solid ${accentColor}33`,
                paddingBottom: 8,
              }}>Trading Logic</h4>
              
              {logic.entry && (
                <div style={{ marginBottom: 16, padding: 14, background: "rgba(34, 197, 94, 0.08)", borderRadius: 8, borderLeft: `3px solid #22c55e` }}>
                  <span style={{ display: "block", fontSize: 11, color: "#22c55e", marginBottom: 6, fontWeight: 600 }}>◈ ENTRY SIGNAL</span>
                  <code style={{ 
                    display: "block",
                    padding: 8,
                    background: "rgba(34, 197, 94, 0.04)",
                    borderRadius: 4,
                    fontSize: 13,
                    color: "#d1fae5",
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}>
                    {logic.entry}
                  </code>
                </div>
              )}

              {logic.exit && (
                <div style={{ marginBottom: 16, padding: 14, background: "rgba(239, 68, 68, 0.08)", borderRadius: 8, borderLeft: `3px solid #ef4444` }}>
                  <span style={{ display: "block", fontSize: 11, color: "#ef4444", marginBottom: 6, fontWeight: 600 }}>◈ EXIT SIGNAL</span>
                  <code style={{ 
                    display: "block",
                    padding: 8,
                    background: "rgba(239, 68, 68, 0.04)",
                    borderRadius: 4,
                    fontSize: 13,
                    color: "#fee2e2",
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}>
                    {logic.exit}
                  </code>
                </div>
              )}

              {logic.size && (
                <div style={{ marginBottom: 0, padding: 14, background: "rgba(245, 158, 11, 0.08)", borderRadius: 8, borderLeft: `3px solid #f59e0b` }}>
                  <span style={{ display: "block", fontSize: 11, color: "#f59e0b", marginBottom: 6, fontWeight: 600 }}>◈ POSITION SIZE</span>
                  <code style={{ 
                    display: "block",
                    padding: 8,
                    background: "rgba(245, 158, 11, 0.04)",
                    borderRadius: 4,
                    fontSize: 13,
                    color: "#fef3c7",
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}>
                    {logic.size}
                  </code>
                </div>
              )}
            </div>
          )}

          <button onClick={() => setShowFull(false)} style={{
            width: "100%",
            padding: "12px 16px",
            background: accentColor,
            border: "none",
            color: "#0a0f1a",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            opacity: 0.9,
          }}>Close</button>
        </div>
      </div>
    );
  }

  // Hover tooltip (only show if we have position AND visibility timeout passed)
  return position && isVisible ? (
    <div style={{
      position: "fixed",
      top: position.top,
      left: Math.max(12, Math.min(position.left, window.innerWidth - 432)),
      width: 420,
      pointerEvents: "none",
      zIndex: 999,
    }}>
      <div style={{ 
        padding: 16,
        background: "#0a0f1a",
        border: `1px solid ${accentColor}99`,
        borderRadius: 8,
        boxShadow: `0 8px 24px rgba(0, 0, 0, 0.5)`,
        fontFamily: "IBM Plex Mono, monospace",
        transformOrigin: "top center",
      }}>
        {/* Simple formula preview */}
        {hasFormula && (
          <div style={{ marginBottom: 12 }}>
            <code style={{
              display: "block",
              padding: "8px 10px",
              background: `${accentColor}12`,
              borderRadius: 4,
              fontSize: 13,
              color: accentColor,
              overflowX: "auto",
            }}>
              {formula.length > 60 ? formula.substring(0, 60) + "..." : formula}
            </code>
          </div>
        )}

        {/* Logic preview */}
        {hasLogic && logic && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {logic.entry && (
              <span style={{
                fontSize: 10,
                padding: "2px 6px",
                background: "rgba(34, 197, 94, 0.15)",
                borderRadius: 3,
                color: "#22c55e",
              }}>Entry: {logic.entry.substring(0, 25)}...</span>
            )}
            {logic.exit && (
              <span style={{
                fontSize: 10,
                padding: "2px 6px",
                background: "rgba(239, 68, 68, 0.15)",
                borderRadius: 3,
                color: "#ef4444",
              }}>Exit: {logic.exit.substring(0, 25)}...</span>
            )}
            {logic.size && (
              <span style={{
                fontSize: 10,
                padding: "2px 6px",
                background: "rgba(245, 158, 11, 0.15)",
                borderRadius: 3,
                color: "#f59e0b",
              }}>Size: {logic.size.substring(0, 25)}...</span>
            )}
          </div>
        )}

        {/* Click to expand */}
        <button onClick={() => setShowFull(true)} style={{
          marginTop: 12,
          width: "100%",
          padding: "6px 8px",
          background: `${accentColor}33`,
          border: `1px solid ${accentColor}55`,
          color: accentColor,
          borderRadius: 4,
          fontSize: 10,
          cursor: "pointer",
          opacity: 0.8,
          pointerEvents: "auto",
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
        onMouseLeave={e => (e.currentTarget.style.opacity = "0.8")}>
          ⟳ Click for full formula
        </button>
      </div>
    </div>
  ) : null;
}
