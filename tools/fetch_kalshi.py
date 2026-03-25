#!/usr/bin/env python3
"""
Kalshi Market Fetcher
Fetches top markets by volume and writes CSV
"""

import csv
import sys
import time
from datetime import datetime
from typing import List, Dict

# Kalshi API base URL
BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"

def get_headers() -> Dict[str, str]:
    """Generate headers with timestamp and API key if available"""
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; PolyBack/1.0)"
    }
    return headers

def fetch_markets(volume_limit: int = 100) -> List[Dict]:
    """Fetch markets sorted by volume from Kalshi"""
    print(f"📡 Fetching markets from Kalshi API...")
    print(f"   Limit: {volume_limit} markets\n")

    all_markets = []
    cursor = ""
    page = 1

    max_retries = 3
    retry_delay = 2

    while page <= max_retries:
        try:
            from urllib.parse import urlencode

            url = f"{BASE_URL}/markets"
            api_params = {
                "active": "true",
                "closed": "false",
                "limit": 100
            }

            if cursor:
                api_params["cursor"] = cursor

            # Build URL with query string
            url += f"?{urlencode(api_params)}"

            import urllib.request
            import urllib.error
            import json

            # Use urlopen with parameters
            req = urllib.request.Request(url, headers=get_headers())

            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read())

            markets = data.get("markets", [])
            if not markets:
                print("   ✓ No more markets found")
                break

            all_markets.extend(markets)
            print(f"   Page {page}: Retrieved {len(markets)} markets")

            cursor = data.get("cursor")
            if not cursor or not data.get("continue", False):
                break

            page += 1
            time.sleep(1)  # Rate limiting

        except urllib.error.HTTPError as e:
            print(f"   ✗ API Error: {e.code} {e.reason}")
            if e.code == 429:  # Rate limited
                time.sleep(retry_delay)
                retry_delay *= 2
                continue
            break
        except Exception as e:
            print(f"   ✗ Error: {e}")
            break

    return all_markets[:volume_limit]

def filter_and_score_markets(markets: List[Dict]) -> List[Dict]:
    """Filter for significant liquidity and price history"""
    print("\n📊 Filtering and scoring markets...\n")

    scored = []
    volume_threshold = 0  # Minimum volume score

    for market in markets:
        market_id = market.get("id", "")
        title = market.get("title", market.get("ticker", ""))
        instrument_category = market.get("instrument_category", "")

        # Extract volume info
        volume_score = 0
        if "last_trade" in market:
            last_trade = market["last_trade"]
            if isinstance(last_trade, dict):
                volume = float(last_trade.get("volume", 0))
                size = float(last_trade.get("size", 0))
                volume_score = volume

        # Check for price history (must have multiple price points)
        has_price_history = False
        if "current_mid" in market:
            has_price_history = True

        # Score: higher volume = better, must have price history
        total_score = volume_score * 10 if has_price_history else 0

        if total_score >= volume_threshold:
            scored.append({
                "market_id": market_id,
                "title": title,
                "market_ticker": market.get("market_ticker", ""),
                "instrument_category": instrument_category,
                "volume_score": round(volume_score, 2),
                "has_price_history": has_price_history,
                "total_score": round(total_score, 2),
                "url": f"https://api.elections.kalshi.com/trade/{market_id}"
            })

    print(f"   ✓ Filtered down to {len(scored)} viable markets from {len(markets)} total")
    return scored

def write_markets_csv(markets: List[Dict], output_path: str):
    """Write markets to CSV file"""

    # Sort by volume score (descending)
    sorted_markets = sorted(markets, key=lambda x: x["volume_score"], reverse=True)

    fieldnames = [
        "market_id", "title", "market_ticker", "instrument_category",
        "volume_score", "has_price_history", "total_score", "url"
    ]

    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for market in sorted_markets:
            writer.writerow(market)

    print(f"\n✅ Markets written to: {output_path}")
    print(f"   Total markets: {len(sorted_markets)}")

    # Print top 10 by volume
    print("\n📈 Top 10 Markets by Volume:\n")
    print(f"{'Rank':<5} {'Volume':>15} {'Market':<40}")
    print("-" * 65)
    for i, market in enumerate(sorted_markets[:10], 1):
        print(f"{i:<5} ${market['volume_score']:>13,.0f} {market['title'][:38]}")

def main():
    """Main entry point"""

    # Read output path from args or use default
    output_path = sys.argv[1] if len(sys.argv) > 1 else "/home/robert-nichols/quant_project/Polymarket/kalshi_markets.csv"
    volume_limit = 100

    print("=" * 70)
    print("🎯 KALSHI MARKET FETCHER")
    print(f"   Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)
    print()

    # Fetch markets
    try:
        markets = fetch_markets(volume_limit=volume_limit)

        if not markets:
            print("✗ No markets found or API error")
            return

        # Filter and score
        scored_markets = filter_and_score_markets(markets)

        # Write output
        if scored_markets:
            write_markets_csv(scored_markets, output_path)
            print("\n✅ Successfully completed Kalshi market fetch")
            return 0
        else:
            print("⚠️  No markets passed volume threshold")
            return 1

    except Exception as e:
        print(f"✗ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())