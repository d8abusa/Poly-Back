"""
models/schemas.py  — PATCH

Add these optional fields to your existing BacktestRequest model.
All have defaults so existing requests are fully backward-compatible.
"""

from pydantic import BaseModel, Field
from typing import Optional, List


# ── ADD these fields to your existing BacktestRequest ─────────────────────────
#
# class BacktestRequest(BaseModel):
#     # ... your existing fields ...
#
#     # ── Z-Score Reversion params ──────────────────────────────────────────
#     zscore_window: int   = Field(20,  ge=5,  le=100, description="Rolling window length for z-score calculation")
#     zscore_entry:  float = Field(1.5, ge=0.5, le=4.0, description="Z-score threshold to enter long (magnitude)")
#     zscore_exit:   float = Field(0.0, ge=-2.0, le=2.0, description="Z-score level to exit (0 = mean reversion)")
#     zscore_stop:   float = Field(3.0, ge=1.0, le=6.0, description="Z-score floor for stop-loss")
#
#     # ── Kelly Criterion params ────────────────────────────────────────────
#     kelly_fraction: float = Field(0.5, ge=0.1, le=1.0, description="Fraction of full Kelly to bet (0.5 = half-Kelly)")
#
#     # ── Market Making params ──────────────────────────────────────────────
#     mm_spread: float = Field(0.04, ge=0.01, le=0.20, description="Minimum spread to collect per round-trip")


# ── Full standalone definition (use this if you prefer to replace) ────────────

class BacktestRequest(BaseModel):
    condition_id:    str
    strategy:        str   = "threshold"
    initial_capital: float = Field(1000.0, gt=0)
    entry_threshold: float = Field(0.30, ge=0.01, le=0.99)
    exit_threshold:  float = Field(0.70, ge=0.01, le=0.99)
    stop_loss:       Optional[float] = Field(None, ge=0.01, le=0.99)
    interval:        str   = "1d"

    # Z-Score Reversion
    zscore_window: int   = Field(20,  ge=5,   le=100)
    zscore_entry:  float = Field(1.5, ge=0.5, le=4.0)
    zscore_exit:   float = Field(0.0, ge=-2.0, le=2.0)
    zscore_stop:   float = Field(3.0, ge=1.0, le=6.0)

    # Kelly Criterion
    kelly_fraction: float = Field(0.5, ge=0.1, le=1.0)

    # Market Making
    mm_spread: float = Field(0.04, ge=0.01, le=0.20)
