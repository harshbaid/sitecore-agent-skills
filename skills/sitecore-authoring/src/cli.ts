/**
 * Multi-environment XM Cloud Authoring API CLI.
 *
 *   npm run sc -- <command> [options]
 *
 * Commands:
 *   token                                   Fetch & print token metadata (scopes, expiry). No secrets printed.
 *   get      --env <e>   --path|--id  [--fields a,b] [--language en] [--own]
 *   set      --env <e>   --path|--id  --set "Field=Value" [--set ...] [--language en] [--version N] [--yes]
 *   create   --env <e>   --parent <id|path> --template <guid> --name <n> [--set "F=V"] [--language en] [--yes]
 *   move     --env <e>   --path|--id  --to-path|--to-id <t> [--sort N] [--yes]
 *   rename   --env <e>   --path|--id  --name <newName> [--yes]
 *   delete   --env <e>   --path|--id  [--permanently] [--yes]
 *   compare              --path|--id  --fields a,b [--env dev,uat,prod] [--language en]
 *   raw      --env <e>   --query-file <path> [--vars '{"k":1}']
 *
 * --env accepts a single env (dev|uat|prod) or a comma list / "all" (get & raw fan out; writes too).
 * Writes to guarded envs (uat, prod) require --yes.
 */
import { readFileSync } from 'node:fs';
import { parseEnvs, parseAgentEnvs, WRITE_GUARDED_ENVS, type EnvName } from './config.js';
import { gql, fanOut, type FanOutResult } from './client.js';
import { getAccessToken } from './auth.js';
import {
  getItem,
  updateItem,
  createItem,
  moveItem,
  renameItem,
  deleteItem,
  compareAcrossEnvs,
  type FieldValue,
} from './operations.js';
import { agentRequest } from './agent-client.js';
import * as agent from './agent-operations.js';

// ---- tiny arg parser ----
type Args = { _: string[]; flags: Record<string, boolean>; opts: Record<string, string[]> };
function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {}, opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out.flags[key] = true;
      } else {
        (out.opts[key] ??= []).push(next);
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}
const one = (a: Args, k: string): string | undefined => a.opts[k]?.[0];
const many = (a: Args, k: string): string[] => a.opts[k] ?? [];
const has = (a: Args, k: string): boolean => !!a.flags[k] || (a.opts[k]?.length ?? 0) > 0;

function refFrom(a: Args) {
  return { path: one(a, 'path'), itemId: one(a, 'id') };
}
function parseSetPairs(a: Args): FieldValue[] {
  return many(a, 'set').map((pair) => {
    const eq = pair.indexOf('=');
    if (eq === -1) throw new Error(`--set must be "Field=Value", got: ${pair}`);
    return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1) };
  });
}
/** --set pairs as an object map (Agent API field shape). */
function parseSetMap(a: Args): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { name, value } of parseSetPairs(a)) out[name] = value ?? '';
  return out;
}
function envsFor(a: Args): EnvName[] {
  return parseEnvs(one(a, 'env'));
}
function guardWrites(envs: EnvName[], a: Args) {
  const guarded = envs.filter((e) => WRITE_GUARDED_ENVS.has(e));
  if (guarded.length && !has(a, 'yes')) {
    throw new Error(
      `Refusing to write to guarded env(s) [${guarded.join(', ')}] without --yes. Re-run with --yes to confirm.`
    );
  }
}
function printFanOut<T>(results: FanOutResult<T>[]) {
  for (const r of results) {
    if (r.ok) {
      console.log(`\n[${r.env}] OK`);
      console.log(JSON.stringify(r.value, null, 2));
    } else {
      console.log(`\n[${r.env}] ERROR: ${r.error}`);
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const a = parseArgs(argv);
  const cmd = a._[0];

  switch (cmd) {
    case 'token': {
      // Decode the JWT payload locally (no secret printed) to show scope/expiry.
      const token = await getAccessToken();
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
      console.log('Token acquired. Audience:', payload.aud);
      console.log('Scopes:', payload.scope);
      console.log('Expires:', new Date(payload.exp * 1000).toISOString());
      break;
    }

    case 'get': {
      const envs = envsFor(a);
      const ref = refFrom(a);
      const fieldNames = one(a, 'fields')?.split(',').map((s) => s.trim());
      const results = await fanOut(envs, (env) =>
        getItem(env, ref, { language: one(a, 'language'), fieldNames, ownFieldsOnly: has(a, 'own') })
      );
      printFanOut(results);
      break;
    }

    case 'set': {
      const envs = envsFor(a);
      guardWrites(envs, a);
      const ref = refFrom(a);
      const fields = parseSetPairs(a);
      if (!fields.length) throw new Error('Provide at least one --set "Field=Value"');
      const version = one(a, 'version') ? Number(one(a, 'version')) : undefined;
      const results = await fanOut(envs, (env) =>
        updateItem(env, ref, fields, { language: one(a, 'language'), version })
      );
      printFanOut(results);
      break;
    }

    case 'create': {
      const envs = envsFor(a);
      guardWrites(envs, a);
      const parent = one(a, 'parent');
      const template = one(a, 'template');
      const name = one(a, 'name');
      if (!parent || !template || !name)
        throw new Error('create requires --parent, --template and --name');
      const fields = parseSetPairs(a);
      const results = await fanOut(envs, (env) =>
        createItem(env, { parent, templateId: template, name, language: one(a, 'language'), fields })
      );
      printFanOut(results);
      break;
    }

    case 'move': {
      const envs = envsFor(a);
      guardWrites(envs, a);
      const ref = refFrom(a);
      const sort = one(a, 'sort') ? Number(one(a, 'sort')) : undefined;
      const results = await fanOut(envs, (env) =>
        moveItem(env, ref, {
          targetParentPath: one(a, 'to-path'),
          targetParentId: one(a, 'to-id'),
          sortOrder: sort,
        })
      );
      printFanOut(results);
      break;
    }

    case 'rename': {
      const envs = envsFor(a);
      guardWrites(envs, a);
      const newName = one(a, 'name');
      if (!newName) throw new Error('rename requires --name');
      const ref = refFrom(a);
      const results = await fanOut(envs, (env) => renameItem(env, ref, newName));
      printFanOut(results);
      break;
    }

    case 'delete': {
      const envs = envsFor(a);
      guardWrites(envs, a);
      const ref = refFrom(a);
      const results = await fanOut(envs, (env) =>
        deleteItem(env, ref, has(a, 'permanently'))
      );
      printFanOut(results);
      break;
    }

    case 'compare': {
      const envs = envsFor(a);
      const ref = refFrom(a);
      const fieldNames = one(a, 'fields')?.split(',').map((s) => s.trim());
      if (!fieldNames?.length) throw new Error('compare requires --fields a,b');
      const { rows } = await compareAcrossEnvs(envs, ref, fieldNames, one(a, 'language'));
      console.log(`\nComparing ${one(a, 'path') ?? one(a, 'id')} across [${envs.join(', ')}]\n`);
      for (const row of rows) {
        console.log(`${row.inSync ? '  =' : '  ✗'} ${row.field}`);
        for (const env of envs) console.log(`      ${env.padEnd(5)} : ${row.values[env]}`);
      }
      const drift = rows.filter((r) => !r.inSync);
      console.log(`\n${drift.length ? `${drift.length} field(s) differ.` : 'All compared fields in sync.'}`);
      break;
    }

    case 'raw': {
      const envs = envsFor(a);
      const qf = one(a, 'query-file');
      if (!qf) throw new Error('raw requires --query-file <path>');
      const query = readFileSync(qf, 'utf8');
      const vars = one(a, 'vars') ? JSON.parse(one(a, 'vars')!) : {};
      const results = await fanOut(envs, (env) => gql(env, query, vars));
      printFanOut(results);
      break;
    }

    case 'agent': {
      await runAgent(a);
      break;
    }

    default:
      console.log(readFileSync(new URL('./cli.ts', import.meta.url), 'utf8').split('*/')[0].replace('/**', '').trim());
      process.exit(cmd ? 1 : 0);
  }
}

// ---------------- Agent API v2.0 (REST) ----------------

function agentEnvsFor(a: Args): EnvName[] {
  return parseAgentEnvs(one(a, 'env'));
}

function printAgentResults(results: FanOutResult<{ status: number; data: any; jobId?: string }>[]) {
  for (const r of results) {
    if (r.ok) {
      console.log(`\n[${r.env}] ${r.value.status}${r.value.jobId ? `  jobId=${r.value.jobId}` : ''}`);
      console.log(JSON.stringify(r.value.data, null, 2));
    } else {
      console.log(`\n[${r.env}] ERROR: ${r.error}`);
    }
  }
  // Surface job ids for writes so they can be reverted.
  const jobs = results.filter((r) => r.ok && r.value.jobId).map((r: any) => `${r.env}=${r.value.jobId}`);
  if (jobs.length) console.log(`\nRevert with:  npm run sc -- agent job-revert --env <env> --job <jobId>  (${jobs.join(', ')})`);
}

async function runAgent(a: Args): Promise<void> {
  const sub = a._[1];
  const envs = agentEnvsFor(a);
  const run = (op: (env: EnvName) => Promise<any>) => fanOut(envs, op).then(printAgentResults);

  switch (sub) {
    case 'token': {
      const { getAgentToken } = await import('./agent-auth.js');
      for (const env of envs) {
        const t = await getAgentToken(env);
        const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString('utf8'));
        console.log(`[${env}] token OK  expires=${new Date(p.exp * 1000).toISOString()}`);
        console.log(`  scope: ${p.scope}`);
      }
      return;
    }
    case 'sites':
      return run((env) => agent.listSites(env));
    case 'site':
      return run((env) => agent.getSite(env, req(one(a, 'id'), '--id <siteId>')));
    case 'pages':
      return run((env) => agent.listSitePages(env, req(one(a, 'site'), '--site <siteName>'), one(a, 'language')));
    case 'page':
      return run((env) => agent.getPage(env, req(one(a, 'id'), '--id <pageId>')));
    case 'page-search':
      return run((env) => agent.searchPages(env, req(one(a, 'site'), '--site'), req(one(a, 'term'), '--term')));
    case 'components-on-page':
      return run((env) => agent.getComponentsOnPage(env, req(one(a, 'id'), '--id <pageId>')));
    case 'content-get':
      return run((env) =>
        one(a, 'id')
          ? agent.getContentById(env, one(a, 'id')!)
          : agent.getContentByPath(env, req(one(a, 'path'), '--path or --id'), one(a, 'language'))
      );
    case 'insert-options':
      return run((env) => agent.listInsertOptions(env, req(one(a, 'id'), '--id <itemId>')));
    case 'languages':
      return run((env) => agent.listLanguages(env));

    case 'content-create': {
      guardWrites(envs, a);
      const parent = req(one(a, 'parent'), '--parent');
      const template = req(one(a, 'template'), '--template');
      const name = req(one(a, 'name'), '--name');
      const fields = parseSetMap(a);
      return run((env) =>
        agent.createContent(env, { parentId: parent, templateId: template, name, language: one(a, 'language'), fields })
      );
    }
    case 'content-update': {
      guardWrites(envs, a);
      const id = req(one(a, 'id'), '--id <itemId>');
      const fields = parseSetMap(a);
      if (!Object.keys(fields).length) throw new Error('content-update needs at least one --set "F=V"');
      return run((env) =>
        agent.updateContent(env, id, {
          fields,
          language: one(a, 'language'),
          createNewVersion: has(a, 'new-version'),
          siteName: one(a, 'site'),
        })
      );
    }
    case 'content-delete': {
      guardWrites(envs, a);
      const id = req(one(a, 'id'), '--id <itemId>');
      return run((env) => agent.deleteContent(env, id, one(a, 'language')));
    }
    case 'page-create': {
      guardWrites(envs, a);
      const parent = req(one(a, 'parent'), '--parent');
      const template = req(one(a, 'template'), '--template');
      const name = req(one(a, 'name'), '--name');
      const fields = parseSetMap(a);
      return run((env) =>
        agent.createPage(env, { parentId: parent, templateId: template, name, language: one(a, 'language'), fields })
      );
    }

    case 'job':
      return run((env) => agent.getJob(env, req(one(a, 'id') ?? one(a, 'job'), '--id <jobId>')));
    case 'job-ops':
      return run((env) => agent.listJobOperations(env, req(one(a, 'id') ?? one(a, 'job'), '--id <jobId>')));
    case 'job-revert': {
      guardWrites(envs, a);
      const jobId = req(one(a, 'job') ?? one(a, 'id'), '--job <jobId>');
      return run((env) => agent.revertJob(env, jobId));
    }

    case 'raw': {
      const method = (one(a, 'method') ?? 'GET').toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE';
      const path = req(one(a, 'path'), '--path </api/v1/...>');
      if (method !== 'GET') guardWrites(envs, a);
      const body = one(a, 'vars') ? JSON.parse(one(a, 'vars')!) : undefined;
      return run((env) => agentRequest(env, method, path, { body, jobId: one(a, 'job') }));
    }

    default:
      throw new Error(
        `Unknown agent subcommand "${sub ?? ''}". Try: token, sites, site, pages, page, page-search, ` +
          `components-on-page, content-get, insert-options, content-create, content-update, content-delete, ` +
          `page-create, languages, job, job-ops, job-revert, raw.`
      );
  }
}

function req<T>(v: T | undefined, what: string): T {
  if (v === undefined || v === null || v === '') throw new Error(`Missing required ${what}`);
  return v;
}

main().catch((err) => {
  console.error('ERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
