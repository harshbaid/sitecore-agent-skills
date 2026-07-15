import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  AGENT_CREDS,
  AGENT_TOKEN_CACHE_PATH,
  AUTH,
  assertAgentCredentials,
  type EnvName,
} from './config.js';

type CachedToken = { accessToken: string; expiresAt: number };
type Cache = Record<string, CachedToken>;

const SKEW_MS = 60_000;
const memory: Cache = {};

function readCache(): Cache {
  if (!existsSync(AGENT_TOKEN_CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(AGENT_TOKEN_CACHE_PATH, 'utf8')) as Cache;
  } catch {
    return {};
  }
}

function writeCache(cache: Cache): void {
  try {
    writeFileSync(AGENT_TOKEN_CACHE_PATH, JSON.stringify(cache), 'utf8');
  } catch {
    /* best-effort */
  }
}

async function fetchToken(env: EnvName): Promise<CachedToken> {
  assertAgentCredentials(env);
  const { clientId, clientSecret } = AGENT_CREDS[env];
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    audience: AUTH.audience,
  });
  const res = await fetch(AUTH.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`[${env}] Agent token request failed: ${res.status} - ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
}

/** Bearer token for one environment's Agent API client, cached on disk per env. */
export async function getAgentToken(env: EnvName): Promise<string> {
  const disk = readCache();
  const cached = memory[env] ?? disk[env];
  if (cached && cached.expiresAt - SKEW_MS > Date.now()) {
    memory[env] = cached;
    return cached.accessToken;
  }
  const fresh = await fetchToken(env);
  memory[env] = fresh;
  disk[env] = fresh;
  writeCache(disk);
  return fresh.accessToken;
}
