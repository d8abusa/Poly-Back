/**
 * Thin fetch wrapper that injects the JWT Bearer token from localStorage.
 * Falls back to a plain fetch if no token is stored (so the login endpoint
 * itself never gets caught in a loop).
 *
 * On 401, clears the stored token so the login screen re-appears on next render.
 */

const TOKEN_KEY = "polyback_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers ?? {});

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(input, { ...init, headers });

  if (res.status === 401) {
    clearToken();
    // Dispatch a custom event so App.tsx can react without a full page reload
    window.dispatchEvent(new Event("polyback:logout"));
  }

  return res;
}
