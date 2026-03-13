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
    # ── Polymarket CLOB credentials ───────────────────────────────────────────
    api_key:        str | None = os.getenv("POLY_API_KEY") or None
    api_secret:     str | None = os.getenv("POLY_API_SECRET") or None
    api_passphrase: str | None = os.getenv("POLY_API_PASSPHRASE") or None
    private_key:    str | None = os.getenv("POLY_PRIVATE_KEY") or None
    chain_id:       int        = int(os.getenv("POLY_CHAIN_ID", "137"))

    # ── Kalshi credentials (optional — public endpoints work without auth) ────
    kalshi_api_key:      str | None = os.getenv("KALSHI_API_KEY") or None
    kalshi_api_password: str | None = os.getenv("KALSHI_API_PASSWORD") or None

    # ── Derived auth status ────────────────────────────────────────────────────
    @property
    def has_api_creds(self) -> bool:
        """True when all three CLOB API credentials are present."""
        return bool(self.api_key and self.api_secret and self.api_passphrase)

    @property
    def has_private_key(self) -> bool:
        """True when a private key is set (required for order placement)."""
        return bool(self.private_key)

    @property
    def auth_level(self) -> str:
        """
        'full'    — private key + API creds (can place orders)
        'api'     — API creds only (can read auth endpoints, no order placement)
        'public'  — no credentials (read-only public APIs)
        """
        if self.has_private_key and self.has_api_creds:
            return "full"
        if self.has_api_creds:
            return "api"
        return "public"

    def status_dict(self) -> dict:
        """Safe status payload — never includes key values."""
        return {
            "auth_level":       self.auth_level,
            "has_api_creds":    self.has_api_creds,
            "has_private_key":  self.has_private_key,
            "chain_id":         self.chain_id,
            "capabilities": {
                "read_public":    True,
                "read_private":   self.has_api_creds,
                "place_orders":   self.auth_level == "full",
            },
        }


settings = Settings()
