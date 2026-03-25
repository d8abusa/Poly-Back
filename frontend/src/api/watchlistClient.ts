/**
 * Watchlist API client for communicating with the backend watchlist endpoints
 */

interface WatchlistItem {
  id: string;
  market_id: string;
  market_title: string;
  category: string;
  added_at: string;
}

export interface AlertTrigger {
  price_type: 'entry' | 'target' | 'stop_loss';
  threshold: number;
  direction: 'above' | 'below';
}

interface Alert {
  id: string;
  watchlist_item_id?: string;
  market_id: string;
  market_title: string;
  trigger: AlertTrigger;
  triggered_at?: string;
  dismissed_at?: string;
  read: boolean;
  created_at: string;
}

// ── Watchlist API ──────────────────────────────────────────────────

export async function getWatchlist(): Promise<WatchlistItem[]> {
  const response = await fetch('/api/watchlist');
  if (!response.ok) {
    throw new Error(`Failed to fetch watchlist: ${response.statusText}`);
  }
  return response.json();
}

export async function addWatchlistItem(params: {
  market_id: string;
  market_title: string;
  category?: string;
}): Promise<WatchlistItem> {
  const response = await fetch('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error(`Failed to add watchlist item: ${response.statusText}`);
  }
  return response.json();
}

export async function removeWatchlistItem(item_id: string): Promise<void> {
  const response = await fetch(`/api/watchlist/item/${item_id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`Failed to remove watchlist item: ${response.statusText}`);
  }
}

// ── Alerts API ────────────────────────

export async function getAlerts(): Promise<Alert[]> {
  const response = await fetch('/api/watchlist/alerts');
  if (!response.ok) {
    throw new Error(`Failed to fetch alerts: ${response.statusText}`);
  }
  return response.json();
}

export async function getUnreadAlerts(): Promise<Alert[]> {
  const response = await fetch('/api/watchlist/alerts/unread');
  if (!response.ok) {
    throw new Error(`Failed to fetch unread alerts: ${response.statusText}`);
  }
  return response.json();
}

export async function createAlert(params: {
  market_id: string;
  trigger: AlertTrigger;
}): Promise<Alert> {
  const response = await fetch('/api/watchlist/alert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error(`Failed to create alert: ${response.statusText}`);
  }
  return response.json();
}

export async function dismissAlert(alert_id: string): Promise<void> {
  const response = await fetch(`/api/watchlist/alert/${alert_id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`Failed to dismiss alert: ${response.statusText}`);
  }
}

export async function markAlertRead(alert_id: string): Promise<void> {
  const response = await fetch(`/api/watchlist/alert/${alert_id}/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to read alert: ${response.statusText}`);
  }
}

// ── Alert Trigger Check (internal use) ──────────────────

export async function checkTriggers(market_id: string, price: number): Promise<Alert[]> {
  const response = await fetch(`/api/watchlist/check_triggers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ market_id, price }),
  });
  if (!response.ok) {
    throw new Error(`Failed to check triggers: ${response.statusText}`);
  }
  return response.json();
}