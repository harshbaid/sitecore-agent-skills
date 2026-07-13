import { getAgentToken } from './agent-auth.js';
import { AGENT_BASE_URL, type EnvName } from './config.js';

export type AgentResponse<T = any> = {
  status: number;
  data: T;
  /** The x-sc-job-id sent with a write (echoed back so callers can revert via the jobs API). */
  jobId?: string;
};

export class AgentRequestError extends Error {
  constructor(
    public env: EnvName,
    public status: number,
    public body: unknown
  ) {
    super(`[${env}] Agent API ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.name = 'AgentRequestError';
  }
}

export type AgentRequestOpts = {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Tag a write with a job id so it can be reverted later. */
  jobId?: string;
};

/** Make a REST call to the Agent API for one environment. */
export async function agentRequest<T = any>(
  env: EnvName,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  opts: AgentRequestOpts = {}
): Promise<AgentResponse<T>> {
  const token = await getAgentToken(env);

  let url = `${AGENT_BASE_URL}${path}`;
  if (opts.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) qs.append(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (opts.jobId) headers['x-sc-job-id'] = opts.jobId;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* leave as text */
  }

  if (!res.ok) throw new AgentRequestError(env, res.status, data);
  return { status: res.status, data, jobId: opts.jobId };
}

/** Generate a job id for a revertable write. */
export function newJobId(): string {
  return crypto.randomUUID();
}
