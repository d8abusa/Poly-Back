import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..models.schemas import MarketSummary
from ..services.polymarket_client import PolymarketClient, get_client

router = APIRouter(prefix="/api/markets", tags=["markets"])


# ── Tag-label → canonical category ────────────────────────────────────────────
_TAG_MAP: dict[str, str] = {
    # Politics
    "politics": "Politics", "elections": "Politics", "election": "Politics",
    "us elections": "Politics", "2024 elections": "Politics", "2026 elections": "Politics",
    "donald trump": "Politics", "joe biden": "Politics", "kamala harris": "Politics",
    "republican": "Politics", "democrat": "Politics", "democrats": "Politics",
    "congress": "Politics", "senate": "Politics", "house": "Politics",
    "government": "Politics", "geopolitics": "Politics", "world leaders": "Politics",
    "uk politics": "Politics", "eu politics": "Politics", "nato": "Politics",
    "supreme court": "Politics", "white house": "Politics",
    # Crypto
    "bitcoin": "Crypto", "ethereum": "Crypto", "crypto": "Crypto",
    "cryptocurrency": "Crypto", "defi": "Crypto", "nft": "Crypto",
    "blockchain": "Crypto", "solana": "Crypto", "dogecoin": "Crypto",
    "xrp": "Crypto", "altcoins": "Crypto", "web3": "Crypto", "stablecoins": "Crypto",
    # Sports
    "sports": "Sports", "nba": "Sports", "nfl": "Sports", "mlb": "Sports",
    "nhl": "Sports", "soccer": "Sports", "football": "Sports", "basketball": "Sports",
    "baseball": "Sports", "tennis": "Sports", "golf": "Sports",
    "ufc": "Sports", "mma": "Sports", "boxing": "Sports",
    "world cup": "Sports", "super bowl": "Sports", "superbowl": "Sports",
    "formula 1": "Sports", "f1": "Sports", "esports": "Sports",
    "olympics": "Sports", "ncaa": "Sports", "premier league": "Sports",
    "champions league": "Sports", "la liga": "Sports", "march madness": "Sports",
    # Economics
    "economics": "Economics", "economy": "Economics", "finance": "Economics",
    "federal reserve": "Economics", "fed": "Economics", "inflation": "Economics",
    "gdp": "Economics", "stocks": "Economics", "markets": "Economics",
    "recession": "Economics", "interest rates": "Economics",
    "forex": "Economics", "commodities": "Economics", "oil": "Economics",
    "gold": "Economics", "real estate": "Economics",
    # Science & Tech
    "science": "Science & Tech", "technology": "Science & Tech", "tech": "Science & Tech",
    "ai": "Science & Tech", "artificial intelligence": "Science & Tech",
    "spacex": "Science & Tech", "nasa": "Science & Tech", "space": "Science & Tech",
    "climate": "Science & Tech", "climate change": "Science & Tech",
    "health": "Science & Tech", "covid": "Science & Tech", "biotech": "Science & Tech",
    "openai": "Science & Tech", "chatgpt": "Science & Tech",
    # Pop Culture
    "entertainment": "Pop Culture", "pop culture": "Pop Culture",
    "movies": "Pop Culture", "film": "Pop Culture", "music": "Pop Culture",
    "awards": "Pop Culture", "oscars": "Pop Culture", "grammys": "Pop Culture",
    "celebrity": "Pop Culture", "tv": "Pop Culture", "television": "Pop Culture",
    "gaming": "Pop Culture", "streaming": "Pop Culture",
}


def _category_from_tags(tags: list[str]) -> str:
    """Map raw API tag labels to canonical category via TAG_MAP."""
    for tag in tags:
        hit = _TAG_MAP.get(tag.lower().strip())
        if hit:
            return hit
    return "Other"


def _categorize_from_text(text: str) -> str:
    """Keyword matching against freeform text (title / question / slug)."""
    s = text.lower()
    if any(k in s for k in [
        "election", "president", "politic", "congress", "senate", "vote",
        "trump", "biden", "harris", "democrat", "republican", "white house",
        "supreme court", "nato", "geopolit",
    ]):
        return "Politics"
    if any(k in s for k in [
        "bitcoin", "btc", "ethereum", "eth", "crypto", "solana", "sol",
        "doge", "nft", "blockchain", "defi", "coin", "xrp", "web3",
    ]):
        return "Crypto"
    if any(k in s for k in [
        "nba", "nfl", "mlb", "nhl", "soccer", "football", "basketball",
        "baseball", "tennis", "golf", "ufc", "mma", "boxing",
        "championship", "world cup", "super bowl", "formula 1", " f1 ",
        "premier league", "champions league", "olympics", "ncaa", "esport",
    ]):
        return "Sports"
    if any(k in s for k in [
        "federal reserve", " fed ", "gdp", "inflation", "recession",
        "stock market", "interest rate", "nasdaq", "s&p", "s&p 500",
        "economy", "economic", "tariff", "trade war", "oil price", "gold price",
    ]):
        return "Economics"
    if any(k in s for k in [
        " ai ", "artificial intelligence", "chatgpt", "openai", "gpt",
        "spacex", "nasa", "spaceship", "tech ", "apple ", "google ", "microsoft ",
        "nvidia ", "climate change", "vaccine", "biotech", "drug approval",
    ]):
        return "Science & Tech"
    if any(k in s for k in [
        "oscar", "grammy", "emmy", "celebrity", "movie ", "film ", "music ",
        "entertainment", "award", "taylor swift", "beyoncé", "box office",
        "television", "streaming", "gaming", "esport",
    ]):
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

    # Category + tags
    events = m.get("events") or []
    event_tags: list[str] = []

    if events and isinstance(events, list):
        ev = events[0]
        raw_tags = ev.get("tags") or []
        if raw_tags:
            event_tags = [t["label"] if isinstance(t, dict) else str(t) for t in raw_tags]

    # Layer 1: normalize raw API tag labels via TAG_MAP
    category = _category_from_tags(event_tags)

    # Layer 2: keyword match against the market question (richest signal)
    if category == "Other":
        question = m.get("question") or ""
        category = _categorize_from_text(question)

    # Layer 3: keyword match against slug / event slug
    if category == "Other":
        slug = m.get("slug") or ""
        for ev in events:
            slug = slug or (ev.get("slug") or ev.get("ticker") or "")
        category = _categorize_from_text(slug)

    tags = event_tags

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
