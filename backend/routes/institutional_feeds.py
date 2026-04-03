import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import institutional_feed_service as svc
from ..services import inst_feed_scorer as scorer

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/inst-feeds", tags=["institutional-feeds"])


class AddFeedRequest(BaseModel):
    name: str
    url: str
    feed_type: str = "rss"
    scrape_interval_hours: int = 24
    tags: list[str] = []


class UpdateFeedRequest(BaseModel):
    enabled: Optional[bool] = None
    scrape_interval_hours: Optional[int] = None


# ── Collection routes (no path param) ────────────────────────────────────────

@router.get("")
def list_feeds():
    return {"feeds": svc.get_feeds()}


@router.post("")
def add_feed(body: AddFeedRequest):
    feed = svc.add_feed(
        name=body.name,
        url=body.url,
        feed_type=body.feed_type,
        scrape_interval_hours=body.scrape_interval_hours,
        tags=body.tags,
    )
    return {"status": "added", "feed": feed}


# ── Stance routes — defined BEFORE /{feed_id} to avoid param capture ─────────

def _stance_payload(s: scorer.InstFeedStance | None) -> dict:
    if s is None:
        return {
            "available":          False,
            "stance":             None,
            "score":              None,
            "confidence":         None,
            "key_factors":        [],
            "dissenting_sources": [],
            "doc_count":          0,
            "generated_at":       None,
            "llm_provider":       "",
            "llm_model":          "",
        }
    return {
        "available":          True,
        "stance":             s.stance,
        "score":              s.score,
        "confidence":         s.confidence,
        "key_factors":        s.key_factors,
        "dissenting_sources": s.dissenting_sources,
        "doc_count":          s.doc_count,
        "generated_at":       s.generated_at,
        "llm_provider":       s.llm_provider,
        "llm_model":          s.llm_model,
    }


@router.get("/stance")
def get_stance():
    """Return the current cached LLM macro stance (instant, no LLM call)."""
    return _stance_payload(scorer.get_cached_stance())


@router.post("/score")
async def trigger_score(force: bool = False):
    """
    Run LLM macro stance scoring and return the result.
    Awaits the LLM response — may take 30–120s depending on the provider.
    Set ?force=true to bypass the 4-hour cache.
    """
    result = await scorer.score_inst_feeds(force=force)
    return _stance_payload(result)


# ── Per-feed routes ───────────────────────────────────────────────────────────

@router.patch("/{feed_id}")
def update_feed(feed_id: str, body: UpdateFeedRequest):
    feed = svc.update_feed(feed_id, enabled=body.enabled,
                           scrape_interval_hours=body.scrape_interval_hours)
    if feed is None:
        raise HTTPException(status_code=404, detail="Feed not found")
    return {"status": "updated", "feed": feed}


@router.delete("/{feed_id}")
def delete_feed(feed_id: str):
    ok = svc.delete_feed(feed_id)
    if not ok:
        raise HTTPException(status_code=400,
                            detail="Feed not found or is a preset (disable instead of deleting)")
    return {"status": "deleted"}


@router.post("/{feed_id}/fetch")
async def fetch_feed(feed_id: str):
    feed = svc.get_feed(feed_id)
    if feed is None:
        raise HTTPException(status_code=404, detail="Feed not found")
    try:
        result = await svc.fetch_feed(feed_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Fetch failed: {exc}")
    return result


@router.get("/{feed_id}/docs")
def get_docs(feed_id: str, limit: int = 20):
    feed = svc.get_feed(feed_id)
    if feed is None:
        raise HTTPException(status_code=404, detail="Feed not found")
    return {"docs": svc.get_feed_docs(feed_id, limit=limit)}
