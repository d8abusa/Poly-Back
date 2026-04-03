"""
Institutional Feed Service — registry CRUD + RSS/HTML fetching.

Phase 1: registry management + basic RSS fetch.
Phase 2: HTML index scraping, PDF extraction.
Phase 3: LLM relevance tagging via llm_router.
"""

import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx

from .db import get_cursor, row_to_dict

log = logging.getLogger(__name__)


# ── Registry CRUD ─────────────────────────────────────────────────────────────

def get_feeds() -> list[dict]:
    with get_cursor() as cur:
        cur.execute("SELECT * FROM institutional_feeds ORDER BY is_preset DESC, name ASC")
        return [row_to_dict(r) for r in cur.fetchall()]


def get_feed(feed_id: str) -> Optional[dict]:
    with get_cursor() as cur:
        cur.execute("SELECT * FROM institutional_feeds WHERE id=%s", (feed_id,))
        row = cur.fetchone()
        return row_to_dict(row) if row else None


def add_feed(name: str, url: str, feed_type: str = "rss", scrape_interval_hours: int = 24,
             tags: list[str] | None = None) -> dict:
    feed = {
        "id":                    str(uuid.uuid4()),
        "name":                  name,
        "slug":                  _slugify(name),
        "url":                   url,
        "feed_type":             feed_type,
        "enabled":               False,
        "is_preset":             False,
        "scrape_interval_hours": scrape_interval_hours,
        "last_fetched":          None,
        "doc_count":             0,
        "logo":                  None,
        "tags":                  tags or [],
        "created_at":            datetime.now(timezone.utc).isoformat(),
    }
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO institutional_feeds
                (id, name, slug, url, feed_type, enabled, is_preset,
                 scrape_interval_hours, last_fetched, doc_count, logo, tags, created_at)
            VALUES
                (%(id)s, %(name)s, %(slug)s, %(url)s, %(feed_type)s, %(enabled)s, %(is_preset)s,
                 %(scrape_interval_hours)s, %(last_fetched)s, %(doc_count)s, %(logo)s,
                 %(tags)s, %(created_at)s)
        """, feed)
    return feed


def update_feed(feed_id: str, enabled: Optional[bool] = None,
                scrape_interval_hours: Optional[int] = None) -> Optional[dict]:
    feed = get_feed(feed_id)
    if feed is None:
        return None
    if enabled is not None:
        feed["enabled"] = enabled
    if scrape_interval_hours is not None:
        feed["scrape_interval_hours"] = scrape_interval_hours
    with get_cursor() as cur:
        cur.execute("""
            UPDATE institutional_feeds
            SET enabled=%(enabled)s, scrape_interval_hours=%(scrape_interval_hours)s
            WHERE id=%(id)s
        """, feed)
    return feed


def delete_feed(feed_id: str) -> bool:
    """Delete a custom feed. Preset feeds cannot be deleted — disable instead."""
    feed = get_feed(feed_id)
    if feed is None:
        return False
    if feed.get("is_preset"):
        return False   # caller should disable, not delete
    with get_cursor() as cur:
        cur.execute("DELETE FROM institutional_feeds WHERE id=%s", (feed_id,))
    return True


# ── Document access ───────────────────────────────────────────────────────────

def get_feed_docs(feed_id: str, limit: int = 20) -> list[dict]:
    with get_cursor() as cur:
        cur.execute("""
            SELECT * FROM institutional_documents
            WHERE feed_id=%s
            ORDER BY fetched_at DESC
            LIMIT %s
        """, (feed_id, limit))
        return [row_to_dict(r) for r in cur.fetchall()]


def get_recent_docs(hours: int = 72, tags: list[str] | None = None) -> list[dict]:
    """Pull recent documents from all enabled feeds — used by Fraser modifier."""
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    with get_cursor() as cur:
        if tags:
            cur.execute("""
                SELECT d.* FROM institutional_documents d
                JOIN institutional_feeds f ON f.id = d.feed_id
                WHERE f.enabled = true AND d.fetched_at >= %s
                  AND d.relevance_tags && %s
                ORDER BY d.fetched_at DESC
                LIMIT 50
            """, (since, tags))
        else:
            cur.execute("""
                SELECT d.* FROM institutional_documents d
                JOIN institutional_feeds f ON f.id = d.feed_id
                WHERE f.enabled = true AND d.fetched_at >= %s
                ORDER BY d.fetched_at DESC
                LIMIT 50
            """, (since,))
        return [row_to_dict(r) for r in cur.fetchall()]


# ── Fetching ──────────────────────────────────────────────────────────────────

async def fetch_feed(feed_id: str) -> dict:
    """Fetch and ingest documents from a feed. Returns summary of what was added."""
    feed = get_feed(feed_id)
    if feed is None:
        raise ValueError(f"Feed {feed_id} not found")

    feed_type = feed.get("feed_type", "rss")
    if feed_type == "rss":
        added, skipped = await _fetch_rss(feed)
    else:
        return {"status": "unsupported", "feed_type": feed_type, "added": 0}

    # Update last_fetched + doc_count
    with get_cursor() as cur:
        cur.execute("""
            UPDATE institutional_feeds
            SET last_fetched=now(),
                doc_count=(SELECT COUNT(*) FROM institutional_documents WHERE feed_id=%s)
            WHERE id=%s
        """, (feed_id, feed_id))

    log.info("Fetched feed %s: +%d new, %d skipped", feed["name"], added, skipped)
    return {"status": "ok", "added": added, "skipped": skipped}


async def _fetch_rss(feed: dict) -> tuple[int, int]:
    """Fetch an RSS/Atom feed and upsert new entries. Returns (added, skipped)."""
    import feedparser  # installed in venv

    url = feed["url"]
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True,
                                     headers={"User-Agent": "PolyBack/1.0"}) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            raw = resp.text
    except Exception as exc:
        log.error("RSS fetch failed for %s: %s", url, exc)
        raise

    parsed = feedparser.parse(raw)
    entries = parsed.get("entries", [])

    added = skipped = 0
    for entry in entries[:50]:   # cap at 50 per fetch
        source_url = entry.get("link", "")
        if not source_url:
            continue

        title   = entry.get("title", "Untitled")
        content = _extract_content(entry)
        pub_raw = entry.get("published", entry.get("updated", ""))
        pub_at  = _parse_date(pub_raw)

        doc_id = str(uuid.uuid4())
        try:
            with get_cursor() as cur:
                cur.execute("""
                    INSERT INTO institutional_documents
                        (id, feed_id, title, source_url, published_at, content, relevance_tags, fetched_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, now())
                    ON CONFLICT (source_url) DO NOTHING
                """, (doc_id, feed["id"], title[:400], source_url, pub_at, content, []))
                if cur.rowcount > 0:
                    added += 1
                else:
                    skipped += 1
        except Exception as exc:
            log.warning("Failed to insert doc %s: %s", source_url[:80], exc)
            skipped += 1

    return added, skipped


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_content(entry: dict) -> str:
    """Extract the best available text content from a feedparser entry."""
    for field in ("content", "summary", "description"):
        raw = entry.get(field)
        if not raw:
            continue
        if isinstance(raw, list):
            raw = raw[0].get("value", "") if raw else ""
        if raw:
            # Strip HTML tags simply
            from html.parser import HTMLParser
            class _S(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.parts: list[str] = []
                def handle_data(self, d):
                    self.parts.append(d)
            p = _S()
            p.feed(raw)
            text = " ".join(p.parts).strip()
            if text:
                return text[:4000]
    return ""


def _parse_date(raw: str) -> Optional[datetime]:
    if not raw:
        return None
    import email.utils
    try:
        parsed = email.utils.parsedate_to_datetime(raw)
        return parsed.astimezone(timezone.utc)
    except Exception:
        pass
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


def _slugify(name: str) -> str:
    import re
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    # Ensure uniqueness by appending a short suffix
    suffix = uuid.uuid4().hex[:4]
    return f"{base}-{suffix}"
