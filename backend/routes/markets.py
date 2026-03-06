import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..models.schemas import MarketSummary
from ..services.polymarket_client import PolymarketClient, get_client

router = APIRouter(prefix="/api/markets", tags=["markets"])


def _categorize_from_slug(slug: str) -> str:
    """Keyword fallback when API provides no category/tag data."""
    s = slug.lower()
    if any(k in s for k in ["election", "president", "politic", "congress", "senate", "vote", "trump", "biden", "harris", "democrat", "republican"]):
        return "Politics"
    if any(k in s for k in ["bitcoin", "btc", "eth", "crypto", "solana", "sol", "doge", "nft", "blockchain", "defi", "coin"]):
        return "Crypto"
    if any(k in s for k in ["nba", "nfl", "mlb", "nhl", "soccer", "football", "basketball", "baseball", "tennis", "golf", "ufc", "mma", "championship", "league", "world-cup", "superbowl", "super-bowl"]):
        return "Sports"
    if any(k in s for k in ["fed", "rate", "gdp", "inflation", "recession", "stock", "economy", "economic", "nasdaq", "s-p-500", "interest"]):
        return "Economics"
    if any(k in s for k in ["ai", "gpt", "openai", "spacex", "nasa", "tech", "apple", "google", "microsoft", "nvidia", "science"]):
        return "Science & Tech"
    if any(k in s for k in ["oscar", "grammy", "taylor", "celebrity", "movie", "music", "entertainment", "award"]):
        return "Pop Culture"
    return "Other"


def _normalize(m: dict) -> MarketSummary:
    """Map Gamma API market dict → MarketSummary."""
    # Probability (first outcome = YES)
    try:
        prices = json.loads(m["outcomePrices"]) if isinstance(m.get("outcomePrices"), str) else m.get("outcomePrices", [])
        prob = float(prices[0]) if prices else 0.5
    except (TypeError, ValueError, IndexError):
        prob = 0.5

    # Resolution outcome
    resolved = bool(m.get("closed") or m.get("resolved"))
    outcome = m.get("winningOutcome") or (
        "YES" if prob >= 0.99 else "NO" if prob <= 0.01 else None
    ) if resolved else None

    # Category + tags: prefer events[0].tags, fall back to slug keywords
    events = m.get("events") or []
    event_tags: list[str] = []
    category = "Other"

    if events and isinstance(events, list):
        ev = events[0]
        raw_tags = ev.get("tags") or []
        if raw_tags:
            event_tags = [t["label"] if isinstance(t, dict) else str(t) for t in raw_tags]
            category = event_tags[0]

    if category == "Other":
        # Fall back to slug-based keyword matching
        slug = m.get("slug") or ""
        for ev in events:
            slug = slug or (ev.get("slug") or ev.get("ticker") or "")
        category = _categorize_from_slug(slug)

    tags = event_tags  # use event tags as the tag list

    # YES token ID (for price history)
    token_id = None
    raw_ids = m.get("clobTokenIds")
    if raw_ids:
        try:
            ids = json.loads(raw_ids) if isinstance(raw_ids, str) else raw_ids
            token_id = ids[0] if ids else None
        except Exception:
            pass

    end_date = (m.get("endDate") or "")[:10]

    return MarketSummary(
        id=m.get("conditionId", str(m.get("id", ""))),
        condition_id=m.get("conditionId"),
        token_id=token_id,
        title=m.get("question", ""),
        category=category,
        prob=prob,
        volume=float(m.get("volumeNum") or m.get("volume") or 0),
        liquidity=float(m.get("liquidity") or 0),
        resolved=resolved,
        outcome=outcome,
        end_date=end_date,
        tags=tags,
    )


@router.get("")
async def search_markets(
    q: str = Query("", description="Text search (client-side filtered)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    active: Optional[bool] = Query(None),
    closed: Optional[bool] = Query(None),
    order: str = Query("volumeNum"),
    tag_slug: Optional[str] = Query(None),
    client: PolymarketClient = Depends(get_client),
):
    raw = await client.search_markets(
        limit=limit, offset=offset,
        active=active, closed=closed,
        order=order, tag_slug=tag_slug,
    )
    markets = [_normalize(m) for m in raw]

    if q:
        ql = q.lower()
        markets = [
            m for m in markets
            if ql in m.title.lower() or any(ql in t.lower() for t in m.tags)
        ]

    return {"markets": [m.model_dump() for m in markets], "count": len(markets)}


@router.get("/tags")
async def list_tags(client: PolymarketClient = Depends(get_client)):
    tags = await client.get_tags()
    return {"tags": tags}


@router.get("/{condition_id}")
async def get_market(
    condition_id: str,
    client: PolymarketClient = Depends(get_client),
):
    try:
        return await client.get_market(condition_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{condition_id}/history")
async def price_history(
    condition_id: str,
    token_id: str = Query(..., description="YES-outcome CLOB token ID"),
    interval: str = Query("max", description="1m | 1h | 6h | 1d | 1w | max"),
    client: PolymarketClient = Depends(get_client),
):
    try:
        history = await client.get_price_history(token_id, interval=interval)
        return {"history": history}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
