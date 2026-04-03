import { apiFetch } from "../lib/apiFetch";

export interface InstFeed {
  id: string;
  name: string;
  slug: string;
  url: string;
  feed_type: "rss" | "html" | "pdf_index";
  enabled: boolean;
  is_preset: boolean;
  scrape_interval_hours: number;
  last_fetched: string | null;
  doc_count: number;
  tags: string[];
}

export interface InstDoc {
  id: string;
  feed_id: string;
  title: string;
  source_url: string;
  published_at: string | null;
  content: string | null;
  relevance_tags: string[];
  fetched_at: string;
}

export async function getFeeds(): Promise<InstFeed[]> {
  const r = await apiFetch("/api/inst-feeds");
  const data = await r.json();
  return data.feeds ?? [];
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export async function addFeed(body: {
  name: string; url: string; feed_type?: string;
  scrape_interval_hours?: number; tags?: string[];
}): Promise<InstFeed> {
  const r = await apiFetch("/api/inst-feeds", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  const data = await r.json();
  return data.feed;
}

export async function updateFeed(id: string, patch: {
  enabled?: boolean; scrape_interval_hours?: number;
}): Promise<InstFeed> {
  const r = await apiFetch(`/api/inst-feeds/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(await r.text());
  const data = await r.json();
  return data.feed;
}

export async function deleteFeed(id: string): Promise<void> {
  await apiFetch(`/api/inst-feeds/${id}`, { method: "DELETE" });
}

export async function fetchFeed(id: string): Promise<{ added: number; skipped: number }> {
  const r = await apiFetch(`/api/inst-feeds/${id}/fetch`, { method: "POST" });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail ?? `HTTP ${r.status}`);
  }
  return r.json();
}

export async function getFeedDocs(id: string, limit = 20): Promise<InstDoc[]> {
  const r = await apiFetch(`/api/inst-feeds/${id}/docs?limit=${limit}`);
  const data = await r.json();
  return data.docs ?? [];
}

export interface InstStance {
  available: boolean;
  stance: "hawkish" | "dovish" | "neutral" | "mixed" | null;
  score: number | null;
  confidence: number | null;
  key_factors: string[];
  dissenting_sources: string[];
  doc_count: number;
  generated_at: string | null;
  llm_provider: string;
  llm_model: string;
}

export async function getStance(): Promise<InstStance> {
  const r = await apiFetch("/api/inst-feeds/stance");
  return r.json();
}

export async function triggerScore(force = false): Promise<InstStance> {
  const r = await apiFetch(`/api/inst-feeds/score?force=${force}`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
