"""
Fetch Polymarket CLOB API credentials using L1 wallet signature.

Usage:
  python get_api_key.py --key 0xYOUR_PRIVATE_KEY [--chain-id 137]

Or set POLY_PRIVATE_KEY in .env and run without --key.

On success, prints the three values to paste into .env.
"""

import sys
import time
import json
import argparse
import httpx
from pathlib import Path
from dotenv import load_dotenv
import os

load_dotenv(Path(__file__).parent / ".env")

# ── EIP-712 signing ───────────────────────────────────────────────────────────

def build_auth_headers(private_key: str, chain_id: int, nonce: int = 0) -> dict:
    from eth_account import Account
    from eth_account.messages import encode_typed_data

    account  = Account.from_key(private_key)
    address  = account.address
    ts       = str(int(time.time()))

    structured_data = {
        "types": {
            "EIP712Domain": [
                {"name": "name",    "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
            ],
            "ClobAuth": [
                {"name": "address",   "type": "string"},
                {"name": "timestamp", "type": "string"},
                {"name": "nonce",     "type": "uint256"},
                {"name": "message",   "type": "string"},
            ],
        },
        "primaryType": "ClobAuth",
        "domain": {
            "name":    "ClobAuthDomain",
            "version": "1",
            "chainId": chain_id,
        },
        "message": {
            "address":   address,
            "timestamp": ts,
            "nonce":     nonce,
            "message":   "This message attests that I control the given wallet",
        },
    }

    signable  = encode_typed_data(full_message=structured_data)
    signed    = Account.sign_message(signable, private_key=private_key)
    signature = signed.signature.hex()

    return {
        "POLY_ADDRESS":   address,
        "POLY_SIGNATURE": signature,
        "POLY_TIMESTAMP": ts,
        "POLY_NONCE":     str(nonce),
    }, address


def create_api_key(private_key: str, chain_id: int = 137) -> dict:
    headers, address = build_auth_headers(private_key, chain_id)

    print(f"  Wallet : {address}")
    print(f"  Chain  : {chain_id} ({'Polygon Mainnet' if chain_id == 137 else 'Amoy Testnet'})")
    print(f"  Nonce  : 0")
    print()

    resp = httpx.post(
        "https://clob.polymarket.com/auth/api-key",
        headers=headers,
        timeout=20.0,
    )

    if not resp.is_success:
        print(f"[ERROR] HTTP {resp.status_code}")
        try:
            print(json.dumps(resp.json(), indent=2))
        except Exception:
            print(resp.text)
        sys.exit(1)

    return resp.json()


def main():
    parser = argparse.ArgumentParser(description="Fetch Polymarket CLOB API credentials")
    parser.add_argument("--key",      help="L1 private key (overrides .env)")
    parser.add_argument("--chain-id", type=int, default=None)
    args = parser.parse_args()

    private_key = args.key or os.getenv("POLY_PRIVATE_KEY")
    if not private_key:
        print("[ERROR] No private key found. Pass --key 0x... or set POLY_PRIVATE_KEY in .env")
        sys.exit(1)

    if not private_key.startswith("0x"):
        private_key = "0x" + private_key

    chain_id = args.chain_id or int(os.getenv("POLY_CHAIN_ID", "137"))

    print("Requesting Polymarket API credentials…")
    print()

    creds = create_api_key(private_key, chain_id)

    api_key        = creds.get("apiKey")        or creds.get("api_key")        or creds.get("key", "")
    api_secret     = creds.get("secret")        or creds.get("api_secret",     "")
    api_passphrase = creds.get("passphrase")    or creds.get("api_passphrase", "")

    print("=" * 60)
    print("SUCCESS — paste these into your .env file:")
    print("=" * 60)
    print(f"POLY_API_KEY={api_key}")
    print(f"POLY_API_SECRET={api_secret}")
    print(f"POLY_API_PASSPHRASE={api_passphrase}")
    print("=" * 60)
    print()
    print("Raw response:")
    print(json.dumps(creds, indent=2))


if __name__ == "__main__":
    main()
