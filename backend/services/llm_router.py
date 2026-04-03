"""
LLM Router — provider-agnostic interface for all LLM calls in PolyBack.

Provider and model are controlled entirely via environment variables:
    LLM_PROVIDER = ollama | openai | anthropic | gemini   (default: ollama)
    LLM_MODEL    = <model name>                            (default: mistral-small3.2:24b)
    LLM_BASE_URL = override base URL (optional; useful for proxies or local endpoints)

All callers use:
    result = await llm_router.complete(system=..., user=..., json_schema=...)

The router always attempts to return a parsed dict. If the model output cannot be
parsed as JSON, the raw string is returned under {"raw": ...} so callers can degrade
gracefully rather than crash.
"""

import json
import logging
import os
from typing import Any, Optional

import httpx

log = logging.getLogger(__name__)

# ── Defaults ──────────────────────────────────────────────────────────────────

_PROVIDER    = lambda: os.getenv("LLM_PROVIDER", "ollama").lower()
_MODEL       = lambda: os.getenv("LLM_MODEL", "")          # empty = auto-detect for ollama
_BASE_URL    = lambda: os.getenv("LLM_BASE_URL", "")
_TIMEOUT     = 120.0   # seconds — macro docs can be long

_OLLAMA_URL  = "http://localhost:11434"
_OPENAI_URL  = "https://api.openai.com/v1"
_ANTHROPIC_URL = "https://api.anthropic.com/v1"
_GEMINI_URL  = "https://generativelanguage.googleapis.com/v1beta"


# ── Public interface ──────────────────────────────────────────────────────────

async def complete(
    user: str,
    system: str = "",
    json_schema: Optional[dict] = None,   # hint for structured output (best-effort)
    temperature: float = 0.2,
    model: Optional[str] = None,
    provider: Optional[str] = None,
) -> dict:
    """
    Send a prompt to the configured LLM and return a parsed dict.

    Args:
        user:        The user-facing prompt (the main content).
        system:      System prompt / persona instructions.
        json_schema: Optional schema hint. When provided, the router instructs the
                     model to return JSON matching this shape. Not enforced — callers
                     should validate the result themselves.
        temperature: Sampling temperature (lower = more deterministic).
        model:       Override LLM_MODEL for this call.
        provider:    Override LLM_PROVIDER for this call.

    Returns:
        Parsed dict from model output, or {"raw": <str>} if JSON parsing fails.
    """
    _provider = (provider or _PROVIDER()).lower()
    _model    = model or _MODEL()
    _base     = _BASE_URL()

    # For Ollama with no explicit model, use whatever is currently loaded
    if _provider == "ollama" and not _model:
        _model = await _ollama_active_model(_base)
        log.info("Ollama active model: %s", _model)

    schema_hint = ""
    if json_schema:
        schema_hint = f"\n\nRespond ONLY with valid JSON matching this schema:\n{json.dumps(json_schema, indent=2)}"

    full_system = (system + schema_hint).strip()

    try:
        if _provider == "ollama":
            raw = await _ollama(full_system, user, _model, temperature, _base)
        elif _provider == "openai":
            raw = await _openai(full_system, user, _model, temperature, _base)
        elif _provider == "anthropic":
            raw = await _anthropic(full_system, user, _model, temperature)
        elif _provider == "gemini":
            raw = await _gemini(full_system, user, _model, temperature)
        else:
            raise ValueError(f"Unknown LLM_PROVIDER: {_provider!r}")
    except Exception as exc:
        log.error("LLM call failed (provider=%s model=%s): %s", _provider, _model, exc)
        return {"error": str(exc)}

    return _parse(raw)


# ── Provider implementations ──────────────────────────────────────────────────

async def _ollama_active_model(base_url: str) -> str:
    """
    Resolve the Ollama model to use — no hardcoded names.

    1. /api/ps  — whatever is currently loaded in VRAM (ideal)
    2. /api/tags — first model available on disk (fallback if nothing warm)
    3. Raises RuntimeError if Ollama is unreachable or has no models at all.
    """
    base = base_url or _OLLAMA_URL
    async with httpx.AsyncClient(timeout=4.0) as client:
        # Step 1: currently loaded
        try:
            r = await client.get(base + "/api/ps")
            r.raise_for_status()
            loaded = r.json().get("models", [])
            if loaded:
                return loaded[0]["name"]
        except Exception as exc:
            log.warning("Ollama /api/ps failed: %s", exc)

        # Step 2: any model available on disk
        try:
            r = await client.get(base + "/api/tags")
            r.raise_for_status()
            available = r.json().get("models", [])
            if available:
                name = available[0]["name"]
                log.info("No model loaded in VRAM — using first available: %s", name)
                return name
        except Exception as exc:
            log.warning("Ollama /api/tags failed: %s", exc)

    raise RuntimeError(
        "Ollama is unreachable or has no models installed. "
        "Start Ollama and pull a model, or set LLM_MODEL in .env."
    )


async def _ollama(system: str, user: str, model: str, temperature: float, base_url: str) -> str:
    url = (base_url or _OLLAMA_URL) + "/api/chat"
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(url, json={
            "model":   model,
            "messages": messages,
            "stream":  False,
            "options": {"temperature": temperature},
            "format":  "json",   # Ollama JSON mode
        })
        resp.raise_for_status()
        data = resp.json()
        return data["message"]["content"]


async def _openai(system: str, user: str, model: str, temperature: float, base_url: str) -> str:
    api_key = os.getenv("OPENAI_API_KEY", "")
    url = (base_url or _OPENAI_URL) + "/chat/completions"
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model":       model,
                "messages":    messages,
                "temperature": temperature,
                "response_format": {"type": "json_object"},
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


async def _anthropic(system: str, user: str, model: str, temperature: float) -> str:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    url = _ANTHROPIC_URL + "/messages"

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            url,
            headers={
                "x-api-key":         api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type":      "application/json",
            },
            json={
                "model":       model,
                "max_tokens":  1024,
                "temperature": temperature,
                "system":      system,
                "messages":    [{"role": "user", "content": user}],
            },
        )
        resp.raise_for_status()
        return resp.json()["content"][0]["text"]


async def _gemini(system: str, user: str, model: str, temperature: float) -> str:
    api_key = os.getenv("GEMINI_API_KEY", "")
    url = f"{_GEMINI_URL}/models/{model}:generateContent?key={api_key}"
    contents = []
    if system:
        # Gemini uses a system_instruction field
        pass
    contents.append({"role": "user", "parts": [{"text": user}]})

    body: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {
            "temperature":    temperature,
            "responseMimeType": "application/json",
        },
    }
    if system:
        body["system_instruction"] = {"parts": [{"text": system}]}

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(url, json=body)
        resp.raise_for_status()
        return resp.json()["candidates"][0]["content"]["parts"][0]["text"]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse(raw: str) -> dict:
    """Best-effort JSON parse. Falls back to {"raw": ...} rather than raising."""
    text = raw.strip()
    # Strip markdown code fences if the model wrapped its JSON
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    try:
        result = json.loads(text)
        if isinstance(result, dict):
            return result
        return {"value": result}
    except json.JSONDecodeError:
        log.warning("LLM output could not be parsed as JSON: %s…", text[:120])
        return {"raw": raw}
