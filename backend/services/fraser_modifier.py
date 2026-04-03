"""
FRASER Confidence Modifier
==========================
Reads the most recent FOMC statement analysis and returns a sizing multiplier
that nudges signal sizes up (dovish) or down (hawkish).

Multiplier components:
  FOMC tone (primary):   ±15%  (-1.0 hawkish → +1.0 dovish)
  guidance_strength:     ±5%   (strong/moderate/weak/none)
  rate_direction:        ±5%   (cut/hold/hike)
  inst-feed stance:      ±5%   (LLM consensus from institutional feed docs)

Total range: 0.75 – 1.25

The multiplier is intentionally conservative — FRASER tone is macro context,
not a direct edge signal. It tilts sizing, it doesn't override strategy logic.

FRASER FOMC result is cached for 1 hour.
Inst-feed stance is cached for 4 hours in inst_feed_scorer (separate module).
"""

import logging
import threading
import time
from dataclasses import dataclass
from typing import Optional

from .db import get_cursor
from .inst_feed_scorer import get_cached_stance

log = logging.getLogger(__name__)

_CACHE_TTL = 3600  # 1 hour


@dataclass
class FraserContext:
    tone_score:        float
    tone_label:        str
    rate_direction:    str
    guidance_strength: str
    doc_date:          str
    multiplier:        float   # final sizing multiplier to apply
    summary:           str     # one-line human-readable description


_cached: Optional[FraserContext] = None
_cached_at: float = 0.0
_cache_lock = threading.Lock()


def get_fraser_context() -> Optional[FraserContext]:
    """Return the current FRASER modifier context, using a 1-hour cache."""
    global _cached, _cached_at

    now = time.time()
    if _cached is not None and (now - _cached_at) < _CACHE_TTL:
        return _cached

    with _cache_lock:
        # Re-check after acquiring lock — another thread may have refreshed already
        if _cached is not None and (now - _cached_at) < _CACHE_TTL:
            return _cached

    try:
        with get_cursor() as cur:
            cur.execute("""
                SELECT a.tone_score, a.tone_label, a.rate_direction,
                       a.guidance_strength, d.doc_date::text
                FROM fraser_analysis a
                JOIN fraser_documents d ON d.id = a.document_id
                ORDER BY d.doc_date DESC
                LIMIT 1
            """)
            row = cur.fetchone()
    except Exception as exc:
        log.warning("FRASER modifier: DB query failed: %s", exc)
        return None

    if row is None:
        return None

    tone       = float(row["tone_score"])
    tone_label = row["tone_label"]
    rate_dir   = row["rate_direction"]
    guidance   = row["guidance_strength"]
    doc_date   = row["doc_date"]

    # ── Build multiplier (FOMC components only — inst-feed applied at call site) ──
    mult = 1.0

    # Tone component: ±15% across the full -1 → +1 range
    mult += tone * 0.15

    # Guidance strength component
    gs_adj = {"strong": +0.05, "moderate": 0.0, "weak": -0.05, "none": -0.08}
    mult += gs_adj.get(guidance, 0.0)

    # Rate direction component
    rd_adj = {"cut": +0.05, "hold": 0.0, "hike": -0.05, "unknown": 0.0}
    mult += rd_adj.get(rate_dir, 0.0)

    mult = round(max(0.75, min(1.25, mult)), 3)

    direction = "↑" if mult > 1.0 else ("↓" if mult < 1.0 else "→")
    summary = (
        f"FRASER {doc_date}: {tone_label} · {rate_dir} · "
        f"guidance {guidance} → {direction} {mult:.2f}×"
    )

    ctx = FraserContext(
        tone_score=tone,
        tone_label=tone_label,
        rate_direction=rate_dir,
        guidance_strength=guidance,
        doc_date=doc_date,
        multiplier=mult,
        summary=summary,
    )

    with _cache_lock:
        _cached    = ctx
        _cached_at = now
    log.info("FRASER modifier updated: %s", summary)
    return ctx


def apply_fraser_modifier(
    size_usd: float,
    confidence: float,
    exchange: str = "",
) -> tuple[float, float, Optional[FraserContext]]:
    """
    Apply the FRASER multiplier to a signal's size and confidence.

    Applied universally across all exchanges. Macro conditions (FOMC tone,
    institutional stance) have mechanical, broad effects on equity valuations,
    crypto liquidity, and prediction market pricing alike. Prediction market
    contracts that happen to be macro-adjacent (rate decisions, CPI outcomes)
    get the most precise signal; other asset classes still benefit from the
    directional tilt.

    Returns: (adjusted_size, adjusted_confidence, context_or_None)
    """

    ctx = get_fraser_context()
    if ctx is None:
        return size_usd, confidence, None

    # Blend inst-feed stance on top of FOMC multiplier — fresh on every call
    # (get_cached_stance() is a pure memory read, no I/O, negligible cost)
    combined_mult = ctx.multiplier
    inst_label    = ""
    inst_stance   = get_cached_stance()
    if inst_stance is not None:
        weighted      = inst_stance.score * inst_stance.confidence
        combined_mult = round(max(0.75, min(1.25, combined_mult + weighted * 0.05)), 3)
        inst_label    = f" · inst:{inst_stance.stance}"

    if inst_label:
        direction = "↑" if combined_mult > 1.0 else ("↓" if combined_mult < 1.0 else "→")
        combined_summary = (
            f"FRASER {ctx.doc_date}: {ctx.tone_label} · {ctx.rate_direction} · "
            f"guidance {ctx.guidance_strength}{inst_label} → {direction} {combined_mult:.2f}×"
        )
        import dataclasses
        ctx = dataclasses.replace(ctx, multiplier=combined_mult, summary=combined_summary)

    adj_size = round(size_usd * ctx.multiplier, 2)
    # Confidence nudge is smaller — ±3% of its range
    conf_nudge = (ctx.multiplier - 1.0) * 0.2
    adj_conf = round(min(0.95, max(0.05, confidence + conf_nudge)), 3)

    return adj_size, adj_conf, ctx
