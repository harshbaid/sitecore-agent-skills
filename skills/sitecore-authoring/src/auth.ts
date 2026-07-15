import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { AUTH, TOKEN_CACHE_PATH, assertCredentials } from './config.js';

type CachedToken = { accessToken: string; expiresAt: number };

let memoryToken: CachedToken | null = null;
const SKEW_MS = 60_000; // refresh a minute before expiry

function readCache(): CachedToken | null {
  if (memoryToken) return memoryToken;
  if (!existsSync(TOKEN_CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_CACHE_PATH, 'utf8')) as CachedToken;
  } catch {
    return null;
  }
}

function writeCache(t: CachedToken): void {
  memoryToken = t;
  try {
    writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(t), 'utf8');
  } catch {
    /* cache is best-effort */
  }
}

async function fetchToken(): Promise<CachedToken> {
  assertCredentials();
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: AUTH.clientId,
    client_secret: AUTH.clientSecret,
    audience: AUTH.audience,
  });
  const res = await fetch(AUTH.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${res.statusText} - ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}

/** Returns a valid bearer token, reusing the on-disk cache until ~1 min before expiry. */
export async function getAccessToken(): Promise<string> {
  const cached = readCache();
  if (cached && cached.expiresAt - SKEW_MS > Date.now()) return cached.accessToken;
  const fresh = await fetchToken();
  writeCache(fresh);
  return fresh.accessToken;
}
