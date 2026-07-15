import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = join(__dirname, '..');

/** Minimal .env loader (no dotenv dependency). Existing process.env wins. */
function loadDotEnv(): void {
  const envPath = join(TOOL_ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

export const TOKEN_CACHE_PATH = join(TOOL_ROOT, '.token-cache.json');
export const AGENT_TOKEN_CACHE_PATH = join(TOOL_ROOT, '.agent-token-cache.json');

export type EnvName = string;

/**
 * CM hosts per environment. Set these via .env (SC_<ENV>_CM_HOST) - see .env.example.
 * Find each host in the XM Cloud Deploy portal: Project > Environment > Details >
 * "Environment host name" (or in your repo's .sitecore/user.json). Include the https:// prefix.
 *
 * The keys below (dev/uat/prod) are just the labels you type after --env; rename, add, or
 * remove environments freely. A key falls back to its placeholder only if the matching
 * SC_<ENV>_CM_HOST is unset, and the placeholder is not a real host - so the tool fails fast
 * with a clear error until you configure .env.
 */
export const ENV_HOSTS: Record<string, string> = {
  dev: process.env.SC_DEV_CM_HOST ?? 'https://<your-dev-cm-host>.sitecorecloud.io',
  uat: process.env.SC_UAT_CM_HOST ?? 'https://<your-uat-cm-host>.sitecorecloud.io',
  prod: process.env.SC_PROD_CM_HOST ?? 'https://<your-prod-cm-host>.sitecorecloud.io',
};

export const AUTH = {
  tokenUrl: process.env.SC_AUTH_URL ?? 'https://auth.sitecorecloud.io/oauth/token',
  audience: process.env.SC_AUTH_AUDIENCE ?? 'https://api.sitecorecloud.io',
  clientId: process.env.SC_CLIENT_ID ?? '',
  clientSecret: process.env.SC_CLIENT_SECRET ?? '',
};

/** Envs that are allowed to receive writes without an explicit --yes confirmation. */
export const WRITE_GUARDED_ENVS = new Set(['prod', 'uat']);

export function authoringEndpoint(env: EnvName): string {
  const host = ENV_HOSTS[env];
  if (!host) {
    throw new Error(
      `Unknown environment "${env}". Known: ${Object.keys(ENV_HOSTS).join(', ')}`
    );
  }
  return `${host.replace(/\/+$/, '')}/sitecore/api/authoring/graphql/v1`;
}

/** "dev,uat,prod" | "all" -> ["dev","uat","prod"] */
export function parseEnvs(value?: string): EnvName[] {
  if (!value || value === 'all') return Object.keys(ENV_HOSTS);
  const envs = value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const e of envs) authoringEndpoint(e); // validate
  return envs;
}

export function assertCredentials(): void {
  if (!AUTH.clientId || !AUTH.clientSecret) {
    throw new Error(
      'Missing SC_CLIENT_ID / SC_CLIENT_SECRET. Copy .env.example to .env and fill them in.'
    );
  }
}

// ---------- Agent API v2.0 (REST) ----------

/** Single global Agent API gateway. Environment is determined by the credential, not the URL. */
export const AGENT_BASE_URL =
  process.env.SC_AGENT_BASE_URL ?? 'https://edge-platform.sitecorecloud.io/stream/ai-agent-api';

/** Per-environment automation clients (org-level clients are rejected by the Agent API). */
export const AGENT_CREDS: Record<string, { clientId: string; clientSecret: string }> = {
  dev: {
    clientId: process.env.SC_DEV_AGENT_CLIENT_ID ?? '',
    clientSecret: process.env.SC_DEV_AGENT_CLIENT_SECRET ?? '',
  },
  uat: {
    clientId: process.env.SC_UAT_AGENT_CLIENT_ID ?? '',
    clientSecret: process.env.SC_UAT_AGENT_CLIENT_SECRET ?? '',
  },
  prod: {
    clientId: process.env.SC_PROD_AGENT_CLIENT_ID ?? '',
    clientSecret: process.env.SC_PROD_AGENT_CLIENT_SECRET ?? '',
  },
};

export function assertAgentCredentials(env: EnvName): void {
  const c = AGENT_CREDS[env];
  if (!c || !c.clientId || !c.clientSecret) {
    throw new Error(
      `Missing Agent API credentials for "${env}". Set SC_${env.toUpperCase()}_AGENT_CLIENT_ID / _SECRET in .env.`
    );
  }
}

/** Agent API is environment-bound per credential; only envs with creds configured can be targeted. */
export function parseAgentEnvs(value?: string): EnvName[] {
  const all = Object.keys(AGENT_CREDS);
  const envs = !value || value === 'all' ? all : value.split(',').map((s) => s.trim().toLowerCase());
  for (const e of envs) assertAgentCredentials(e);
  return envs;
}
