"""
FRASER document service — fetches Federal Reserve publications for NLP analysis.

Primary source: federalreserve.gov (clean HTML, recent documents)
  - FOMC Minutes  : /monetarypolicy/files/fomcminutes{YYYYMMDD}.htm
  - FOMC Statements: /newsevents/pressreleases/monetary{YYYYMMDD}a.htm
  - Beige Book    : /monetarypolicy/beige-book-{YYYY}{mon}.htm (8× per year)

Supplement: FRASER API (api.stlouisfed.org/fraser/v1)
  - Historical documents and speeches
  - Uses FRASER_API_KEY from .env

Text is stripped of HTML tags, normalised, and truncated to 12 000 tokens
before being sent to the NLP layer.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Optional

import httpx

from .db import get_cursor

log = logging.getLogger(__name__)

_FED_BASE    = "https://www.federalreserve.gov"
_FRASER_BASE = "https://api.stlouisfed.org/fraser/v1"

# FOMC meets roughly 8 times per year; we look at specific meeting dates
# pulled from the calendar page
_CALENDAR_URL = f"{_FED_BASE}/monetarypolicy/fomccalendars.htm"

# Max characters sent to NLP (≈ 12 000 words)
_MAX_TEXT_CHARS = 50_000


# ── HTML → plain text ─────────────────────────────────────────────────────────

def _strip_html(html: str) -> str:
    """Fast regex HTML-to-text. Good enough for structured Fed documents."""
    # Remove script/style blocks
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    # Remove remaining tags
    text = re.sub(r"<[^>]+>", " ", text)
    # Decode common entities
    text = (text
            .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&nbsp;", " ").replace("&#8212;", "—").replace("&#8211;", "–")
            .replace("&ldquo;", '"').replace("&rdquo;", '"')
            .replace("&lsquo;", "'").replace("&rsquo;", "'"))
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ── FOMC calendar parsing ─────────────────────────────────────────────────────

def _parse_fomc_dates(html: str) -> list[str]:
    """
    Extract FOMC meeting dates from the calendar HTML page.
    Reads the statement link hrefs (monetary{YYYYMMDD}a.htm) which are
    already embedded in the calendar and give us the exact date used in
    Fed URLs — no text parsing required.
    Returns ISO date strings (YYYY-MM-DD), most recent first.
    """
    compact_dates = re.findall(r"monetary(\d{8})a\.htm", html)
    dates = []
    for d in compact_dates:
        try:
            dates.append(date(int(d[:4]), int(d[4:6]), int(d[6:8])).isoformat())
        except ValueError:
            pass
    return sorted(set(dates), reverse=True)


# ── Main service ──────────────────────────────────────────────────────────────

class FraserService:
    def __init__(self, fraser_api_key: Optional[str] = None):
        self._key    = fraser_api_key
        self._client = httpx.AsyncClient(
            timeout=30.0,
            headers={"User-Agent": "PolyBack/1.0 (research; contact admin)"},
            follow_redirects=True,
        )

    async def close(self):
        await self._client.aclose()

    # ── Public API ────────────────────────────────────────────────────────────

    async def refresh_documents(self, n_recent: int = 12) -> list[dict]:
        """
        Fetch the most recent n_recent FOMC minutes and statements from the
        Fed website. Skips documents already in DB. Returns list of new docs.
        """
        existing = self._existing_source_urls()
        calendar_dates = await self._fomc_calendar_dates()
        new_docs: list[dict] = []

        for meeting_date in calendar_dates[:n_recent]:
            compact = meeting_date.replace("-", "")

            # ── Minutes
            minutes_url = f"{_FED_BASE}/monetarypolicy/files/fomcminutes{compact}.htm"
            if minutes_url not in existing:
                doc = await self._fetch_and_store(
                    url=minutes_url,
                    doc_type="minutes",
                    doc_date=meeting_date,
                    title=f"FOMC Minutes – {meeting_date}",
                )
                if doc:
                    new_docs.append(doc)
                    existing.add(minutes_url)

            # ── Statement (press release — letter 'a' suffix)
            stmt_url = f"{_FED_BASE}/newsevents/pressreleases/monetary{compact}a.htm"
            if stmt_url not in existing:
                doc = await self._fetch_and_store(
                    url=stmt_url,
                    doc_type="statement",
                    doc_date=meeting_date,
                    title=f"FOMC Statement – {meeting_date}",
                )
                if doc:
                    new_docs.append(doc)
                    existing.add(stmt_url)

        # ── Also fetch Beige Book for the current year (8 per year)
        beige_docs = await self._refresh_beige_book(existing)
        new_docs.extend(beige_docs)

        log.info("FRASER refresh: %d new documents fetched", len(new_docs))
        return new_docs

    async def list_documents(self, limit: int = 50, doc_type: Optional[str] = None) -> list[dict]:
        """Return stored documents ordered by date desc."""
        with get_cursor() as cur:
            if doc_type:
                cur.execute(
                    "SELECT id, document_type, doc_date::text, title, source_url, word_count, fetched_at::text "
                    "FROM fraser_documents WHERE document_type = %s ORDER BY doc_date DESC LIMIT %s",
                    (doc_type, limit),
                )
            else:
                cur.execute(
                    "SELECT id, document_type, doc_date::text, title, source_url, word_count, fetched_at::text "
                    "FROM fraser_documents ORDER BY doc_date DESC LIMIT %s",
                    (limit,),
                )
            return [dict(r) for r in cur.fetchall()]

    async def get_document_text(self, doc_id: str) -> Optional[str]:
        with get_cursor() as cur:
            cur.execute("SELECT text_content FROM fraser_documents WHERE id = %s", (doc_id,))
            row = cur.fetchone()
            return row["text_content"] if row else None

    def get_unanalyzed(self, limit: int = 5) -> list[dict]:
        """Return documents that have no analysis yet."""
        with get_cursor() as cur:
            cur.execute("""
                SELECT d.id, d.document_type, d.doc_date::text, d.title, d.text_content
                FROM fraser_documents d
                LEFT JOIN fraser_analysis a ON a.document_id = d.id
                WHERE a.id IS NULL AND d.text_content IS NOT NULL AND length(d.text_content) > 200
                ORDER BY d.doc_date DESC
                LIMIT %s
            """, (limit,))
            return [dict(r) for r in cur.fetchall()]

    # ── Private helpers ───────────────────────────────────────────────────────

    def _existing_source_urls(self) -> set[str]:
        with get_cursor() as cur:
            cur.execute("SELECT source_url FROM fraser_documents WHERE source_url IS NOT NULL")
            return {r["source_url"] for r in cur.fetchall()}

    async def _fomc_calendar_dates(self) -> list[str]:
        """Fetch FOMC meeting end-dates from the Fed calendar page."""
        try:
            resp = await self._client.get(_CALENDAR_URL)
            if resp.status_code == 200:
                dates = _parse_fomc_dates(resp.text)
                if dates:
                    return dates
        except Exception as exc:
            log.warning("Could not fetch FOMC calendar: %s", exc)

        # Fallback: generate approximate dates for current + prior 2 years
        # FOMC meets Jan, Mar, May, Jun, Jul, Sep, Nov, Dec (approx end dates)
        approx: list[str] = []
        today = date.today()
        for year in range(today.year, today.year - 3, -1):
            for month, day in [(12,18),(11,7),(9,18),(7,31),(6,12),(5,1),(3,20),(1,29)]:
                try:
                    approx.append(date(year, month, day).isoformat())
                except ValueError:
                    pass
        return sorted(approx, reverse=True)

    async def _fetch_and_store(
        self,
        url: str,
        doc_type: str,
        doc_date: str,
        title: str,
    ) -> Optional[dict]:
        """Fetch a URL, extract text, store in DB. Returns doc dict or None."""
        try:
            resp = await self._client.get(url)
            if resp.status_code == 404:
                # Document doesn't exist for this date — normal for future meetings
                return None
            resp.raise_for_status()
            text = _strip_html(resp.text)[:_MAX_TEXT_CHARS]
            word_count = len(text.split())
            if word_count < 50:
                log.debug("Skipping %s — too short (%d words)", url, word_count)
                return None
        except httpx.HTTPStatusError:
            return None
        except Exception as exc:
            log.warning("Failed to fetch %s: %s", url, exc)
            return None

        doc_id = str(uuid.uuid4())
        with get_cursor() as cur:
            cur.execute("""
                INSERT INTO fraser_documents
                    (id, document_type, doc_date, title, source_url, text_content, word_count)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (doc_id, doc_type, doc_date, title, url, text, word_count))

        log.info("Stored %s: %s (%d words)", doc_type, title, word_count)
        return {"id": doc_id, "document_type": doc_type, "doc_date": doc_date,
                "title": title, "word_count": word_count}

    async def _beige_book_summary_urls(self, year: int) -> list[tuple[str, str, str]]:
        """
        Scrape the Fed's year-index page for Beige Book summary URLs.

        Each <p> on the index page follows this pattern:
            <p>January 15: <a href="...summary.htm">HTML</a> | <a href="...BeigeBook_20250115.pdf">PDF</a></p>

        The PDF href contains the exact publication date (YYYYMMDD).
        Returns list of (url, title, doc_date) tuples, most recent first.
        """
        index_url = f"{_FED_BASE}/monetarypolicy/beigebook{year}.htm"
        try:
            resp = await self._client.get(index_url)
            if resp.status_code != 200:
                return []
        except Exception as exc:
            log.warning("Beige Book index fetch failed %s: %s", index_url, exc)
            return []

        # Match summary URL and exact date from the PDF URL in the same <p> block
        pattern = re.compile(
            r'href="(/monetarypolicy/beigebook\d{6}-summary\.htm)'
            r'.*?BeigeBook_(\d{8})\.pdf',
            re.DOTALL,
        )
        results = []
        for m in pattern.finditer(resp.text):
            href, compact_date = m.group(1), m.group(2)
            try:
                doc_date = date(
                    int(compact_date[:4]),
                    int(compact_date[4:6]),
                    int(compact_date[6:8]),
                ).isoformat()
            except ValueError:
                continue
            full_url = f"{_FED_BASE}{href}"
            title = f"Beige Book – {doc_date}"
            results.append((full_url, title, doc_date))

        results.sort(key=lambda x: x[2], reverse=True)
        return results

    async def _refresh_beige_book(self, existing: set[str]) -> list[dict]:
        """Fetch recent Beige Book publications by scraping the Fed year-index pages."""
        new_docs: list[dict] = []
        today = date.today()

        for year in [today.year, today.year - 1]:
            for url, title, doc_date in await self._beige_book_summary_urls(year):
                if url in existing:
                    continue
                doc = await self._fetch_and_store(
                    url=url,
                    doc_type="beige_book",
                    doc_date=doc_date,
                    title=title,
                )
                if doc:
                    new_docs.append(doc)
                    existing.add(url)

        return new_docs


# ── Singleton ─────────────────────────────────────────────────────────────────

_service: Optional[FraserService] = None


def get_fraser_service() -> FraserService:
    global _service
    if _service is None:
        from ..config import settings
        _service = FraserService(fraser_api_key=settings.fraser_api_key)
    return _service
