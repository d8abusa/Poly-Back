"""
FRASER NLP — extracts Fed policy signals from FOMC documents via local Ollama.

Two extraction passes per document:
  1. Tone + structured fields  (sentiment, rate direction, guidance strength…)
  2. Policy decision detection  (rate change, stated goal, target metric)

Uses mistral-small3.2:24b via Ollama (http://localhost:11434).
Results stored in fraser_analysis and policy_decisions tables.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx

from .db import get_cursor

log = logging.getLogger(__name__)

OLLAMA_URL   = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "mistral-small3.2:24b"

# ── Prompts ───────────────────────────────────────────────────────────────────

_TONE_PROMPT = """\
You are an expert Federal Reserve analyst. Analyze the following Federal Reserve document
and extract the following information as valid JSON only — no explanation, no markdown.

{{
  "tone_score": <float -1.0 (strongly hawkish) to 1.0 (strongly dovish)>,
  "tone_label": <"hawkish" | "slightly_hawkish" | "neutral" | "slightly_dovish" | "dovish">,
  "rate_direction": <"hike" | "hold" | "cut" | "unknown">,
  "rate_signal_strength": <"strong" | "moderate" | "weak" | "none">,
  "bs_direction": <"expand" | "hold" | "shrink" | "unknown">,
  "guidance_strength": <"strong" | "moderate" | "weak" | "none">,
  "inflation_concern": <float 0.0 to 1.0 — how much the document emphasises inflation risk>,
  "employment_concern": <float 0.0 to 1.0 — how much it emphasises employment/labor>,
  "growth_concern": <float 0.0 to 1.0 — how much it emphasises GDP/growth risk>,
  "key_phrases": [<3 to 5 verbatim phrases that capture the key policy signals>],
  "policy_intent": <1–2 sentence statement of what the Fed is trying to achieve>,
  "target_metric": <"inflation" | "employment" | "both" | "financial_stability" | "growth" | "unknown">,
  "summary": <2–3 sentence plain English summary of the document's policy stance>
}}

Definitions:
- Hawkish = tightening bias, concerned about inflation, signalling hikes or maintaining tight policy
- Dovish  = easing bias, supporting growth/employment, signalling cuts or patience
- bs_direction = Federal Reserve balance sheet (QT = shrink, QE = expand)
- guidance_strength = how explicit and committed the forward guidance language is

DOCUMENT:
{text}
"""

_DECISION_PROMPT = """\
You are an expert Federal Reserve analyst. Given this Federal Reserve document,
identify if it contains an explicit policy decision. Return valid JSON only.

{{
  "has_decision": <true | false>,
  "decision_type": <"rate_hike" | "rate_cut" | "hold" | "qt_start" | "qt_end" | "qe_start" | "none">,
  "rate_change_bps": <integer basis points, negative = cut, 0 = hold/none>,
  "fed_funds_target_low": <float or null — new target lower bound>,
  "fed_funds_target_high": <float or null — new target upper bound>,
  "stated_goal": <string — what the Fed explicitly said they want to achieve>,
  "target_metric": <"cpi" | "pce" | "unemployment" | "gdp" | "financial_stability" | null>,
  "target_value": <float or null — the numeric target they stated, e.g. 2.0 for 2% inflation>,
  "target_horizon_months": <integer or null — months until they expect to hit target>
}}

DOCUMENT:
{text}
"""


# ── Ollama client ─────────────────────────────────────────────────────────────

async def _call_ollama(prompt: str, timeout: float = 120.0) -> Optional[dict]:
    """Call Ollama chat API and parse JSON response. Returns None on failure."""
    payload = {
        "model":  OLLAMA_MODEL,
        "stream": False,
        "format": "json",
        "messages": [{"role": "user", "content": prompt}],
        "options": {"temperature": 0.1, "num_predict": 1024},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(OLLAMA_URL, json=payload)
            resp.raise_for_status()
            data    = resp.json()
            content = data.get("message", {}).get("content", "") or data.get("response", "")
            # Strip any markdown code fences if present
            content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip())
            return json.loads(content)
    except json.JSONDecodeError as exc:
        log.warning("Ollama returned non-JSON: %s", exc)
        return None
    except Exception as exc:
        log.error("Ollama call failed: %s", exc)
        return None


# ── Validation / defaults ──────────────────────────────────────────────────────

def _clamp(val, lo, hi, default):
    try:
        return max(lo, min(hi, float(val)))
    except (TypeError, ValueError):
        return default

def _choice(val, choices, default):
    return val if val in choices else default

def _safe_list(val, default=None):
    if isinstance(val, list):
        return [str(x) for x in val[:5]]
    return default or []


# ── Main analysis entry point ─────────────────────────────────────────────────

async def analyze_document(doc_id: str, text: str) -> Optional[dict]:
    """
    Run two NLP passes on a document and store results.
    Returns the stored analysis dict, or None if both passes fail.
    """
    # Truncate to fit context window (≈ 12K words)
    working_text = text[:48_000]

    log.info("Analyzing document %s (%d chars)…", doc_id[:8], len(working_text))

    # Pass 1: tone + structured fields
    tone_result = await _call_ollama(_TONE_PROMPT.format(text=working_text))
    if tone_result is None:
        log.warning("Tone pass failed for document %s", doc_id[:8])
        return None

    # Pass 2: policy decision detection
    decision_result = await _call_ollama(_DECISION_PROMPT.format(text=working_text[:24_000]))

    # ── Build validated analysis record
    tone_score = _clamp(tone_result.get("tone_score"), -1.0, 1.0, 0.0)
    analysis = {
        "id":                   str(uuid.uuid4()),
        "document_id":          doc_id,
        "tone_score":           tone_score,
        "tone_label":           _choice(tone_result.get("tone_label"), [
                                    "hawkish","slightly_hawkish","neutral",
                                    "slightly_dovish","dovish"], "neutral"),
        "rate_direction":       _choice(tone_result.get("rate_direction"),
                                    ["hike","hold","cut","unknown"], "unknown"),
        "rate_signal_strength": _choice(tone_result.get("rate_signal_strength"),
                                    ["strong","moderate","weak","none"], "none"),
        "bs_direction":         _choice(tone_result.get("bs_direction"),
                                    ["expand","hold","shrink","unknown"], "unknown"),
        "guidance_strength":    _choice(tone_result.get("guidance_strength"),
                                    ["strong","moderate","weak","none"], "none"),
        "inflation_concern":    _clamp(tone_result.get("inflation_concern"), 0.0, 1.0, 0.5),
        "employment_concern":   _clamp(tone_result.get("employment_concern"), 0.0, 1.0, 0.5),
        "growth_concern":       _clamp(tone_result.get("growth_concern"), 0.0, 1.0, 0.5),
        "key_phrases":          json.dumps(_safe_list(tone_result.get("key_phrases"))),
        "policy_intent":        str(tone_result.get("policy_intent", ""))[:500],
        "target_metric":        tone_result.get("target_metric", "unknown"),
        "summary":              str(tone_result.get("summary", ""))[:1000],
        "model_used":           OLLAMA_MODEL,
    }

    # ── Persist analysis
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO fraser_analysis
                (id, document_id, tone_score, tone_label, rate_direction, rate_signal_strength,
                 bs_direction, guidance_strength, inflation_concern, employment_concern,
                 growth_concern, key_phrases, policy_intent, target_metric, summary, model_used)
            VALUES
                (%(id)s, %(document_id)s, %(tone_score)s, %(tone_label)s, %(rate_direction)s,
                 %(rate_signal_strength)s, %(bs_direction)s, %(guidance_strength)s,
                 %(inflation_concern)s, %(employment_concern)s, %(growth_concern)s,
                 %(key_phrases)s, %(policy_intent)s, %(target_metric)s, %(summary)s, %(model_used)s)
            ON CONFLICT DO NOTHING
        """, analysis)

    # ── Persist policy decision (if one was detected)
    if decision_result and decision_result.get("has_decision"):
        await _store_decision(doc_id, decision_result)

    log.info(
        "Analysis complete for %s: tone=%.2f (%s) rate_dir=%s",
        doc_id[:8], tone_score, analysis["tone_label"], analysis["rate_direction"],
    )
    return analysis


async def _store_decision(doc_id: str, d: dict) -> None:
    """Store a detected policy decision linked to its source document."""
    # Fetch document date
    with get_cursor() as cur:
        cur.execute("SELECT doc_date::text FROM fraser_documents WHERE id = %s", (doc_id,))
        row = cur.fetchone()
        if not row:
            return
        doc_date = row["doc_date"]

    decision = {
        "id":                str(uuid.uuid4()),
        "decision_date":     doc_date,
        "document_id":       doc_id,
        "decision_type":     _choice(d.get("decision_type"),
                                 ["rate_hike","rate_cut","hold","qt_start","qt_end","qe_start","none"],
                                 "hold"),
        "rate_change_bps":   int(_clamp(d.get("rate_change_bps"), -200, 200, 0)),
        "fed_funds_target":  d.get("fed_funds_target_high") or d.get("fed_funds_target_low"),
        "stated_goal":       str(d.get("stated_goal", ""))[:500],
        "target_metric":     d.get("target_metric"),
        "target_value":      d.get("target_value"),
        "target_date":       _target_date(doc_date, d.get("target_horizon_months")),
    }

    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO policy_decisions
                (id, decision_date, document_id, decision_type, rate_change_bps,
                 fed_funds_target, stated_goal, target_metric, target_value, target_date)
            VALUES
                (%(id)s, %(decision_date)s, %(document_id)s, %(decision_type)s, %(rate_change_bps)s,
                 %(fed_funds_target)s, %(stated_goal)s, %(target_metric)s, %(target_value)s, %(target_date)s)
            ON CONFLICT DO NOTHING
        """, decision)
    log.info("Stored policy decision: %s %d bps on %s",
             decision["decision_type"], decision["rate_change_bps"], doc_date)


def _target_date(doc_date: str, horizon_months: Optional[int]) -> Optional[str]:
    if not horizon_months:
        return None
    try:
        from datetime import date
        d = date.fromisoformat(doc_date)
        year  = d.year + (d.month + horizon_months - 1) // 12
        month = (d.month + horizon_months - 1) % 12 + 1
        return date(year, month, 1).isoformat()
    except Exception:
        return None
