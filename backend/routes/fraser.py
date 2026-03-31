"""
FRASER API routes — Fed document analysis and policy outcome tracking.

Endpoints:
  POST /api/fraser/refresh            — fetch new documents + queue NLP analysis
  GET  /api/fraser/documents          — list fetched documents
  GET  /api/fraser/analyses           — NLP results with tone + structured fields
  GET  /api/fraser/sentiment-trend    — tone score time series (for sparkline / 3D)
  GET  /api/fraser/policy-decisions   — list detected policy decisions
  GET  /api/fraser/policy-outcomes    — outcome scores vs FRED data
  GET  /api/fraser/credibility        — current Fed credibility score
  GET  /api/fraser/sentiment-surface  — 3D data: time × indicator × tone (for Plotly)
  POST /api/fraser/score-outcomes     — manually trigger outcome scoring pass
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..services.fraser_service import get_fraser_service
from ..services.fraser_nlp import analyze_document
from ..services import policy_tracker as pt
from ..services.db import get_cursor

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/api/fraser", tags=["fraser"])


# ── Document management ───────────────────────────────────────────────────────

@router.post("/refresh")
async def refresh_documents(n_recent: int = Query(12, ge=1, le=50)):
    """
    Fetch recent FOMC minutes, statements, and Beige Books not yet in DB.
    Then runs NLP analysis on any unanalyzed documents (up to 5 per call).
    Long-running — NLP calls can take 30–90s each via Ollama.
    """
    svc = get_fraser_service()

    # Step 1: fetch new documents
    new_docs = await svc.refresh_documents(n_recent=n_recent)

    # Step 2: analyze unanalyzed documents (run sequentially to avoid OOM on GPU)
    unanalyzed = svc.get_unanalyzed(limit=5)
    analyzed: list[dict] = []
    for doc in unanalyzed:
        text = doc.get("text_content", "")
        if text:
            result = await analyze_document(doc["id"], text)
            if result:
                analyzed.append({"doc_id": doc["id"], "tone_score": result["tone_score"],
                                  "tone_label": result["tone_label"]})

    # Step 3: score any pending policy outcomes
    new_outcomes = pt.score_pending_outcomes()

    return {
        "new_documents":    len(new_docs),
        "new_analyses":     len(analyzed),
        "new_outcomes":     len(new_outcomes),
        "documents":        new_docs,
        "analyses":         analyzed,
    }


@router.get("/documents")
async def list_documents(
    limit:    int = Query(50, ge=1, le=200),
    doc_type: Optional[str] = None,
):
    svc = get_fraser_service()
    docs = await svc.list_documents(limit=limit, doc_type=doc_type)
    return {"documents": docs, "count": len(docs)}


# ── NLP results ───────────────────────────────────────────────────────────────

@router.get("/analyses")
async def list_analyses(limit: int = Query(50, ge=1, le=200)):
    with get_cursor() as cur:
        cur.execute("""
            SELECT a.id, a.tone_score, a.tone_label, a.rate_direction,
                   a.rate_signal_strength, a.bs_direction, a.guidance_strength,
                   a.inflation_concern, a.employment_concern, a.growth_concern,
                   a.key_phrases, a.policy_intent, a.target_metric, a.summary,
                   a.model_used, a.analyzed_at::text,
                   d.document_type, d.doc_date::text, d.title, d.word_count
            FROM fraser_analysis a
            JOIN fraser_documents d ON d.id = a.document_id
            ORDER BY d.doc_date DESC
            LIMIT %s
        """, (limit,))
        rows = cur.fetchall()

    results = []
    for r in rows:
        row = dict(r)
        # Parse key_phrases from JSON string
        try:
            row["key_phrases"] = json.loads(row["key_phrases"] or "[]")
        except Exception:
            row["key_phrases"] = []
        results.append(row)
    return {"analyses": results, "count": len(results)}


@router.get("/sentiment-trend")
async def sentiment_trend(months: int = Query(24, ge=3, le=60)):
    """
    Monthly tone score time series — most recent first.
    Used for the sparkline and 3D surface chart.
    """
    with get_cursor() as cur:
        cur.execute("""
            SELECT d.doc_date::text AS date,
                   d.document_type,
                   d.title,
                   a.tone_score,
                   a.tone_label,
                   a.rate_direction,
                   a.inflation_concern,
                   a.employment_concern,
                   a.growth_concern,
                   a.guidance_strength
            FROM fraser_analysis a
            JOIN fraser_documents d ON d.id = a.document_id
            WHERE d.doc_date >= NOW() - INTERVAL '%s months'
            ORDER BY d.doc_date ASC
        """, (months,))
        rows = [dict(r) for r in cur.fetchall()]

    return {"trend": rows, "count": len(rows)}


# ── Policy decisions + outcomes ───────────────────────────────────────────────

@router.get("/policy-decisions")
async def policy_decisions(limit: int = Query(20, ge=1, le=100)):
    return {"decisions": pt.get_decisions(limit=limit)}


@router.get("/policy-outcomes")
async def policy_outcomes(limit: int = Query(30, ge=1, le=200)):
    outcomes = pt.get_outcomes(limit=limit)
    cred     = pt.credibility_score()
    return {
        "credibility_score": cred,
        "outcomes":          outcomes,
        "count":             len(outcomes),
    }


@router.get("/credibility")
async def credibility():
    score = pt.credibility_score()
    return {
        "score":   score,
        "label":   _cred_label(score),
        "color":   _cred_color(score),
    }


@router.post("/score-outcomes")
async def score_outcomes():
    """Manually trigger outcome scoring pass against FRED cache."""
    new = pt.score_pending_outcomes()
    return {"scored": len(new), "outcomes": new}


# ── 3D surface data ───────────────────────────────────────────────────────────

@router.get("/sentiment-surface")
async def sentiment_surface():
    """
    Return a 3D dataset for Plotly scatter3d:
      x = Fed tone score (-1 hawkish → +1 dovish)
      y = CPI YoY (from FRED cache)
      z = Unemployment rate
      color = time (months ago)
      text = document title + date

    Merges fraser_analysis dates with nearest FRED observations.
    """
    with get_cursor() as cur:
        # Tone time series
        cur.execute("""
            SELECT d.doc_date::text AS date, a.tone_score, a.tone_label,
                   a.rate_direction, d.title
            FROM fraser_analysis a
            JOIN fraser_documents d ON d.id = a.document_id
            WHERE d.document_type IN ('minutes', 'statement')
            ORDER BY d.doc_date ASC
        """)
        tone_rows = [dict(r) for r in cur.fetchall()]

        # CPI from cache (monthly)
        cur.execute("""
            SELECT obs_date::text AS date, value AS cpi
            FROM fred_cache WHERE series_id = 'CPIAUCSL'
            ORDER BY obs_date ASC
        """)
        cpi_map = {r["date"][:7]: r["cpi"] for r in cur.fetchall()}

        # Unemployment from cache
        cur.execute("""
            SELECT obs_date::text AS date, value AS unrate
            FROM fred_cache WHERE series_id = 'UNRATE'
            ORDER BY obs_date ASC
        """)
        unrate_map = {r["date"][:7]: r["unrate"] for r in cur.fetchall()}

        # Fed rate from cache
        cur.execute("""
            SELECT obs_date::text AS date, value AS rate
            FROM fred_cache WHERE series_id = 'DFEDTARU'
            ORDER BY obs_date ASC
        """)
        rate_map = {r["date"][:7]: r["rate"] for r in cur.fetchall()}

    points = []
    from datetime import date as _date
    today = _date.today()
    for row in tone_rows:
        month_key = row["date"][:7]
        cpi    = _nearest(cpi_map,    month_key)
        unrate = _nearest(unrate_map, month_key)
        rate   = _nearest(rate_map,   month_key)
        if cpi is None or unrate is None:
            continue
        try:
            d = _date.fromisoformat(row["date"])
            months_ago = (today.year - d.year) * 12 + (today.month - d.month)
        except Exception:
            months_ago = 0

        points.append({
            "date":         row["date"],
            "tone_score":   row["tone_score"],
            "tone_label":   row["tone_label"],
            "rate_direction": row["rate_direction"],
            "cpi":          cpi,
            "unrate":       unrate,
            "fed_rate":     rate,
            "months_ago":   months_ago,
            "title":        row["title"],
        })

    return {
        "points": points,
        "axes": {
            "x": "Fed Tone Score (hawkish → dovish)",
            "y": "CPI YoY %",
            "z": "Unemployment %",
            "color": "Months Ago",
        },
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cred_label(score: float) -> str:
    if score >= 0.8: return "High"
    if score >= 0.6: return "Moderate"
    if score >= 0.4: return "Low"
    return "Very Low"

def _cred_color(score: float) -> str:
    if score >= 0.8: return "#22c55e"
    if score >= 0.6: return "#f59e0b"
    return "#ef4444"

def _nearest(mapping: dict[str, float], month_key: str) -> Optional[float]:
    """Return the value for month_key, or the closest prior month within 3 months."""
    if month_key in mapping:
        return mapping[month_key]
    # search backwards up to 3 months
    try:
        from datetime import date
        y, m = int(month_key[:4]), int(month_key[5:7])
        for _ in range(3):
            m -= 1
            if m == 0:
                m = 12; y -= 1
            key = f"{y:04d}-{m:02d}"
            if key in mapping:
                return mapping[key]
    except Exception:
        pass
    return None
