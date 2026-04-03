"""
Institutional Feed Stance Scorer — Phase 3
==========================================
Reads recent documents from enabled institutional feeds, sends a batch
to the configured LLM (via llm_router), and caches a structured macro
stance assessment for use by the Fraser modifier and the UI.

Cache TTL: 4 hours.  The scorer never blocks the signal pipeline —
get_cached_stance() returns immediately from memory; actual LLM
scoring is triggered via the API route or by calling score_inst_feeds().
"""

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from .institutional_feed_service import get_recent_docs
from . import llm_router

log = logging.getLogger(__name__)

_CACHE_TTL = 4 * 3600   # 4 hours between LLM re-scores


@dataclass
class InstFeedStance:
    stance:             str         # hawkish | dovish | neutral | mixed
    score:              float       # -1.0 (strongly hawkish) → +1.0 (strongly dovish)
    confidence:         float       # 0.0 – 1.0
    key_factors:        list[str] = field(default_factory=list)
    dissenting_sources: list[str] = field(default_factory=list)
    doc_count:          int = 0
    generated_at:       str = ""    # ISO-8601 UTC
    llm_provider:       str = ""    # e.g. "ollama"
    llm_model:          str = ""    # e.g. "mistral-small3.2:24b"


_cached:    Optional[InstFeedStance] = None
_cached_at: float = 0.0
_scoring:   bool  = False
_lock = threading.Lock()


def get_cached_stance() -> Optional[InstFeedStance]:
    """Return the in-memory cached stance (no I/O). None if no score yet or expired."""
    if _cached is not None and (time.time() - _cached_at) < _CACHE_TTL:
        return _cached
    return None


async def score_inst_feeds(force: bool = False) -> Optional[InstFeedStance]:
    """
    Run LLM stance scoring on recent institutional feed docs.

    - Returns cached result if still fresh (unless force=True).
    - Skips the LLM call if no enabled feeds have recent docs.
    - Never raises — errors are logged and the stale cache is returned.
    """
    global _cached, _cached_at, _scoring

    now = time.time()
    if not force and _cached is not None and (now - _cached_at) < _CACHE_TTL:
        return _cached

    with _lock:
        if _scoring:
            return _cached   # another coroutine is already scoring
        _scoring = True

    try:
        docs = get_recent_docs(hours=72)
        if not docs:
            log.info("InstFeedScorer: no enabled feeds with recent docs — skipping LLM call")
            return _cached

        # Build a condensed digest — cap at 30 docs to stay within LLM context
        lines = []
        for d in docs[:30]:
            title   = (d.get("title") or "").strip()
            snippet = ((d.get("content") or "")[:300]).replace("\n", " ")
            source  = d.get("source_url", "")
            if title:
                lines.append(f"- [{title}] {snippet}  (src: {source})")

        digest = "\n".join(lines)

        system_prompt = (
            "You are a senior macro analyst. Assess the aggregate policy stance "
            "implied by recent publications from central banks, research institutions, "
            "and treasury departments.\n\n"
            "Definitions:\n"
            "  hawkish  — tighter policy, rate hikes, inflation concern\n"
            "  dovish   — looser policy, rate cuts, growth/employment support\n"
            "  neutral  — balanced, no clear lean\n"
            "  mixed    — meaningful divergence between sources\n\n"
            "Be concise and evidence-based. Quote specific document titles when possible."
        )

        user_prompt = (
            f"Below are {len(docs)} recent institutional publication headlines "
            f"and excerpts (last 72 hours):\n\n{digest}\n\n"
            "Assess the aggregate macro policy stance implied by these publications. "
            "Identify any sources or themes that diverge from the consensus."
        )

        schema = {
            "stance":             "one of: hawkish, dovish, neutral, mixed",
            "score":              "float from -1.0 (strongly hawkish) to 1.0 (strongly dovish)",
            "confidence":         "float 0.0-1.0 reflecting clarity and consistency of the signal",
            "key_factors":        ["3-5 specific evidence-based reasons; quote document titles where possible"],
            "dissenting_sources": ["source URLs or names that diverge from the consensus; empty array if none"],
        }

        provider = llm_router._PROVIDER()
        # Resolve the actual model: if blank, ask Ollama what's loaded
        model = llm_router._MODEL()
        if provider == "ollama" and not model:
            model = await llm_router._ollama_active_model(llm_router._BASE_URL())
        log.info("InstFeedScorer: calling %s / %s with %d docs", provider, model, len(docs))

        result = await llm_router.complete(
            user=user_prompt,
            system=system_prompt,
            json_schema=schema,
            temperature=0.15,
        )

        if "error" in result or "raw" in result:
            log.warning("InstFeedScorer: LLM returned unparseable output: %s", result)
            return _cached

        raw_stance = str(result.get("stance", "neutral")).lower().strip()
        if raw_stance not in ("hawkish", "dovish", "neutral", "mixed"):
            raw_stance = "neutral"

        stance = InstFeedStance(
            stance=raw_stance,
            score=max(-1.0, min(1.0, float(result.get("score", 0.0)))),
            confidence=max(0.0, min(1.0, float(result.get("confidence", 0.5)))),
            key_factors=list(result.get("key_factors", [])),
            dissenting_sources=list(result.get("dissenting_sources", [])),
            doc_count=len(docs),
            generated_at=datetime.now(timezone.utc).isoformat(),
            llm_provider=provider,
            llm_model=model,
        )

        _cached    = stance
        _cached_at = now
        log.info(
            "InstFeedScorer: stance=%s score=%.2f confidence=%.2f docs=%d",
            stance.stance, stance.score, stance.confidence, stance.doc_count,
        )
        return stance

    except Exception as exc:
        log.error("InstFeedScorer failed: %s", exc)
        return _cached
    finally:
        with _lock:
            _scoring = False
