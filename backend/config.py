"""
Central config — reads from .env file or environment variables.
Never expose raw key values to the frontend.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root (one level above this file's package)
_env_path = Path(__file__).parent.parent / ".env"
load_dotenv(_env_path)


class Settings:
    # ── Coinbase Advanced Trade credentials (primary exchange) ────────────────
    coinbase_key_name:    str | None = os.getenv("COINBASE_KEY_NAME") or None
    coinbase_private_key: str | None = os.getenv("COINBASE_PRIVATE_KEY") or None

    # ── Kalshi credentials (secondary exchange) ───────────────────────────────
    kalshi_api_key:      str | None = os.getenv("KALSHI_API_KEY") or None
    kalshi_api_password: str | None = os.getenv("KALSHI_API_PASSWORD") or None
    kalshi_private_key:  str | None = os.getenv("KALSHI_PRIVATE_KEY") or None

    # ── FRASER / FRED API (St. Louis Fed) ────────────────────────────────────
    fraser_api_key: str | None = os.getenv("FRASER_API_KEY") or None

    # ── Polymarket (disabled — geoblocked for US users) ───────────────────────
    api_key:        str | None = os.getenv("POLY_API_KEY") or None
    api_secret:     str | None = os.getenv("POLY_API_SECRET") or None
    api_passphrase: str | None = os.getenv("POLY_API_PASSPHRASE") or None
    private_key:    str | None = os.getenv("POLY_PRIVATE_KEY") or None
    chain_id:       int        = int(os.getenv("POLY_CHAIN_ID", "137"))

    # ── Derived auth status ────────────────────────────────────────────────────
    @property
    def has_coinbase_creds(self) -> bool:
        return bool(self.coinbase_key_name and self.coinbase_private_key)

    @property
    def has_kalshi_creds(self) -> bool:
        return bool(self.kalshi_api_key)

    @property
    def has_api_creds(self) -> bool:
        return self.has_coinbase_creds

    @property
    def has_private_key(self) -> bool:
        return self.has_coinbase_creds

    @property
    def auth_level(self) -> str:
        """
        'full'    — Coinbase key + private key present (can place orders)
        'public'  — no credentials (read-only public APIs)
        """
        if self.has_coinbase_creds:
            return "full"
        return "public"

    def status_dict(self) -> dict:
        """Safe status payload — never includes key values."""
        return {
            "auth_level":          self.auth_level,
            "has_coinbase_creds":  self.has_coinbase_creds,
            "has_kalshi_creds":    self.has_kalshi_creds,
            "active_exchange":     "coinbase" if self.has_coinbase_creds else "none",
            "capabilities": {
                "read_public":  True,
                "place_orders": self.has_coinbase_creds,
            },
        }


settings = Settings()
