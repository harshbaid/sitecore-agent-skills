import { getAccessToken } from './auth.js';
import { authoringEndpoint, type EnvName } from './config.js';

export type GqlError = { message: string; [k: string]: unknown };

export class GraphQLRequestError extends Error {
  constructor(
    public env: EnvName,
    public errors: GqlError[],
    public data: unknown
  ) {
    super(`[${env}] GraphQL error: ${errors.map((e) => e.message).join('; ')}`);
    this.name = 'GraphQLRequestError';
  }
}

/** Run a GraphQL operation against one environment's Authoring API. Returns data, throws on errors. */
export async function gql<T = any>(
  env: EnvName,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(authoringEndpoint(env), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`[${env}] HTTP ${res.status} ${res.statusText} - ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: T; errors?: GqlError[] };
  if (json.errors?.length) throw new GraphQLRequestError(env, json.errors, json.data);
  return json.data as T;
}

export type FanOutResult<T> =
  | { env: EnvName; ok: true; value: T }
  | { env: EnvName; ok: false; error: string };

/** Run the same async op across many envs concurrently; never rejects - failures are captured per-env. */
export async function fanOut<T>(
  envs: EnvName[],
  op: (env: EnvName) => Promise<T>
): Promise<FanOutResult<T>[]> {
  return Promise.all(
    envs.map(async (env): Promise<FanOutResult<T>> => {
      try {
        return { env, ok: true, value: await op(env) };
      } catch (err) {
        return { env, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );
}
