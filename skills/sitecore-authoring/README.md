# sitecore-authoring

A standalone, multi-environment command-line client for the **Sitecore XM Cloud Authoring &
Management GraphQL API**. It reads and writes content in **every configured environment at the
same time** (e.g. DEV, UAT, PROD) from a single command.

- **What it is for:** cross-environment content work that a single-environment MCP session makes
  tedious - compare a field everywhere, promote a value from one env to another, apply one edit
  across all envs, audit drift.
- **Why it can hit all envs at once:** it authenticates with an org-level automation client; the
  resulting token (scope `xmcloud.cm:admin`) is accepted by every CM in the organization.
- **What it is not:** a PowerShell (SPE) script runner. It does item/template CRUD + search, plus
  the higher-level Agent API v2.0.

---

## Table of contents

1. [How it works](#how-it-works)
2. [One-time setup](#one-time-setup)
3. [Command reference](#command-reference)
4. [Options reference](#options-reference)
5. [Recipes](#recipes)
6. [Exploring the schema](#exploring-the-schema)
7. [Programmatic use](#programmatic-use)
8. [Safety model](#safety-model)
9. [Troubleshooting](#troubleshooting)
10. [How auth works (deep dive)](#how-auth-works-deep-dive)
11. [Agent API v2.0](#agent-api-v20-agent-command)
12. [Bulk work: the content-audit sub-agent](#bulk-work-the-content-audit-sub-agent)

---

## How it works

Each XM Cloud environment exposes its Content Management (CM) instance with an authoring GraphQL
endpoint:

```
https://<cm-host>/sitecore/api/authoring/graphql/v1     # query/mutation endpoint
https://<cm-host>/sitecore/api/authoring/graphql/ide    # interactive schema playground
```

You configure the CM host per environment in `.env` (`SC_DEV_CM_HOST`, `SC_UAT_CM_HOST`,
`SC_PROD_CM_HOST`, ...). Find each host in the **XM Cloud Deploy portal -> Project ->
Environment -> Details -> "Environment host name"** (or in your repo's `.sitecore/user.json`).
The environment labels (`dev`/`uat`/`prod`) are just what you type after `--env`; rename, add, or
remove them in `.env` / `src/config.ts` to match your project.

A single OAuth token from the org automation client works against all of them. Every command
accepts `--env dev,uat,prod` (or `all`) and fans the operation out **concurrently**.

---

## One-time setup

```bash
cd skills/sitecore-authoring   # wherever you copied this skill
npm install
cp .env.example .env           # then fill SC_CLIENT_ID / SC_CLIENT_SECRET + the CM hosts
```

Create the credential in the **XM Cloud Deploy portal -> org menu -> Credentials -> Automation
client** (choose the org-scoped automation client, not the per-environment / Edge one - org scope
is what lets one secret cover every environment).

`.env` and `.token-cache.json` are gitignored.

> **Quick verification:** `npm run sc -- token` should print the audience, scopes (look for
> `xmcloud.cm:admin`), and expiry.

---

## Command reference

All commands are invoked as:

```bash
npm run sc -- <command> [options]
```

> The `--` is required so npm passes the arguments through to the script.

### `token`
Fetch a token and print its metadata (audience, scopes, expiry). No secret is printed.
```bash
npm run sc -- token
```

### `get`
Read an item, optionally specific fields, across one or more envs.
```bash
# all own + inherited fields, one env
npm run sc -- get --env dev --path "/sitecore/content/Home"

# specific fields, all envs at once
npm run sc -- get --env all --path "/sitecore/content/Home" --fields "Title,Text"

# by GUID, own fields only
npm run sc -- get --env uat --id <item-guid> --own
```

### `set`
Update one or more field values on an existing item.
```bash
npm run sc -- set --env dev --path "/sitecore/content/Home" --set "Title=Welcome"

# multiple fields, specific language version
npm run sc -- set --env dev --id <item-guid> --set "Title=Hi" --set "Text=Body copy" --language en --version 1

# same edit to multiple guarded envs (requires --yes)
npm run sc -- set --env uat,prod --path "/sitecore/content/Home" --set "Title=Welcome" --yes
```

### `create`
Create a new item under a parent from a template.
```bash
npm run sc -- create --env dev \
  --parent "<parent-guid-or-path>" \
  --template "<template-guid>" \
  --name "My New Page" \
  --set "Title=Hello"
```
`--parent` accepts a GUID or a path. `--template` is the template GUID.

### `move`
Move an item to a new parent (and optionally set sort order).
```bash
npm run sc -- move --env dev --id <item-guid> --to-path "/sitecore/content/Archive"
npm run sc -- move --env dev --path "/sitecore/content/Old/Page" --to-id <parent-guid> --sort 100
```

### `rename`
Rename an item (changes the item name / URL segment, not the display name unless your template ties them).
```bash
npm run sc -- rename --env dev --id <item-guid> --name "new-name"
```

### `delete`
Recycle (default) or permanently delete an item.
```bash
npm run sc -- delete --env dev --id <item-guid>                 # to recycle bin
npm run sc -- delete --env dev --id <item-guid> --permanently   # hard delete
```

### `compare`
Compare named field values for the same item across environments and flag drift.
```bash
npm run sc -- compare --env all --path "/sitecore/content/Home" --fields "Title,Text,__Updated"
```
Output marks each field `=` (in sync) or `x` (differs):
```
  x __Updated
      dev   : 20260311T101804Z
      uat   : 20151109T083058Z
      prod  : 20151109T083058Z
  = Title
      dev   : Welcome
      uat   : Welcome
      prod  : Welcome
```

### `raw`
Run an arbitrary GraphQL query/mutation from a file against one or more envs. The escape hatch for
anything the wrappers don't cover. A few ready-made examples live in `queries/`.
```bash
npm run sc -- raw --env uat --query-file ./queries/children.graphql --vars '{"p":"/sitecore/content"}'
```

---

## Options reference

| Option | Applies to | Meaning |
|---|---|---|
| `--env <list>` | all | An env label, a comma list (`dev,uat`), or `all`. Fans out concurrently. |
| `--path <path>` | get/set/move/rename/delete/compare | Item by Sitecore path. |
| `--id <guid>` | get/set/move/rename/delete/compare | Item by GUID (alternative to `--path`). |
| `--fields <a,b>` | get/compare | Comma-separated field names to read. Omit on `get` to return all fields. |
| `--own` | get | Return only the item's own fields (no inherited). |
| `--set "F=V"` | set/create | Field assignment. Repeatable. Value may contain `=`. |
| `--language <lang>` | get/set/create | Language version (default `en`; many sites use `en-US`). |
| `--version <n>` | set | Specific numbered version. |
| `--parent <id\|path>` | create | Parent item. |
| `--template <guid>` | create | Template ID for the new item. |
| `--name <name>` | create/rename | Item name. |
| `--to-path <path>` / `--to-id <guid>` | move | Destination parent. |
| `--sort <n>` | move | Sort order at the destination. |
| `--permanently` | delete | Hard delete instead of recycle. |
| `--yes` | any write | Required to write to guarded envs (`uat`, `prod`). |
| `--query-file <path>` | raw | File containing the GraphQL document. |
| `--vars '<json>'` | raw | JSON variables for the query. |

---

## Recipes

### Audit a value across all environments
```bash
npm run sc -- compare --env all --path "/sitecore/content/Home" --fields "Title"
```

### Promote one env's value to the others
```bash
# 1. read the source
npm run sc -- get --env dev --path "/sitecore/content/Home" --fields "Title"
# 2. write it to the targets (guarded -> --yes)
npm run sc -- set --env uat,prod --path "/sitecore/content/Home" --set "Title=<value from step 1>" --yes
```

### Apply the same edit everywhere at once
```bash
npm run sc -- set --env all --path "/sitecore/content/Settings/Banner" --set "Message=Maintenance window Sat 2am" --yes
```

### Safe write test (create -> verify -> clean up) on DEV
```bash
npm run sc -- create --env dev --parent "<parent-guid>" --template "<template-guid>" --name "zz-test" --set "Title=x"
npm run sc -- get    --env dev --path "/sitecore/content/zz-test" --fields "Title"
npm run sc -- delete --env dev --path "/sitecore/content/zz-test" --permanently
```

### Publish an item (authoring is not publishing)
```bash
npm run sc -- raw --env dev --query-file ./queries/publish-item.graphql --vars '{"ids":["<item-guid>"]}'
npm run sc -- raw --env dev --query-file ./queries/publishing-status.graphql --vars '{"op":"<operationId>"}'
```

---

## Exploring the schema

The full Authoring API schema is browsable per environment at:

```
https://<cm-host>/sitecore/api/authoring/graphql/ide
```

Open it with a valid bearer token. Useful root types: `item`, `itemTemplate`, `search`; mutations
include `createItem`, `updateItem`, `deleteItem`, `moveItem`, `renameItem`, `copyItem`,
`publishItem`, `executeWorkflowCommand`, and template/site/role/user management.

---

## Programmatic use

The pieces are importable if you want to script something more elaborate:

- `src/client.ts` -> `gql(env, query, vars)` and `fanOut(envs, op)` (concurrent, never rejects;
  returns per-env `{ ok, value }` / `{ ok:false, error }`).
- `src/operations.ts` -> `getItem`, `updateItem`, `createItem`, `moveItem`, `renameItem`,
  `deleteItem`, `compareAcrossEnvs`.
- `src/auth.ts` -> `getAccessToken()` (cached, auto-refreshing).

```ts
import { fanOut } from './src/client.js';
import { getItem } from './src/operations.js';

const results = await fanOut(['dev', 'uat', 'prod'], (env) =>
  getItem(env, { path: '/sitecore/content/Home' }, { fieldNames: ['Title'] })
);
```

---

## Safety model

- **Guarded environments:** any write (`set`, `create`, `move`, `rename`, `delete`) targeting a
  guarded env is refused unless you pass `--yes`. DEV writes are not guarded. Adjust the set in
  `WRITE_GUARDED_ENVS` in `src/config.ts`.
- **Secrets:** `.env` (credentials) and `.token-cache.json` are gitignored.
- **No publishing side effects:** these are authoring (master DB) operations. To go live you still
  publish (via the `publishItem` mutation through `raw`, the MCP, or the editor).

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Missing SC_CLIENT_ID / SC_CLIENT_SECRET` | `.env` not created or not filled. Copy `.env.example` -> `.env`. |
| `Token request failed: 401` | Wrong client id/secret, or the client was deleted/rotated in the Deploy portal. |
| Token works but CM returns `401/403` | The automation client lacks `xmcloud.cm:admin`. Recreate it as an org automation client. |
| `Unknown environment "..."` | Typo in `--env`, or that env's `SC_<ENV>_CM_HOST` is not set in `.env`. |
| `[env] GraphQL error: ...` | Returned by the API (bad field name, item not found, validation). Passed through verbatim. |
| `get` returns `null` | Item doesn't exist in that env / language, or path/GUID is wrong. Try `--language en-US`. |
| `--set` value got split oddly | The first `=` splits name from value; values may contain `=`. Quote the whole pair in your shell. |
| Stale results after rotating creds | Delete `.token-cache.json` to force a fresh token. |
| On Windows Git Bash, `/sitecore/...` becomes `C:/Program Files/Git/...` | MSYS path mangling. Quote the path, or run from PowerShell. |

---

## How auth works (deep dive)

1. **Token request** - `client_credentials` grant:
   ```
   POST https://auth.sitecorecloud.io/oauth/token
   Content-Type: application/x-www-form-urlencoded
   grant_type=client_credentials
   client_id=<SC_CLIENT_ID>
   client_secret=<SC_CLIENT_SECRET>
   audience=https://api.sitecorecloud.io
   ```
   The body MUST be form-urlencoded. A JSON body can return a token that silently fails
   authorization.
2. **Token** - a ~24h bearer JWT whose scope includes `xmcloud.cm:admin`. It is cached in
   `.token-cache.json` and refreshed ~1 minute before expiry.
3. **API call** - the bearer is sent as `Authorization: Bearer <token>` to each environment's
   `/sitecore/api/authoring/graphql/v1`. The same token is valid for every CM in the organization,
   which is what enables true multi-env fan-out.

---

## Agent API v2.0 (`agent` command)

The tool also wraps the **Sitecore Agent API v2.0** (the REST API that powers the Marketer MCP).
This is a *higher-level* API than the GraphQL authoring layer: pages with components/placeholders,
datasources, assets, personalization, A/B experiments, briefs, brand kits, and - most usefully -
**job tracking with one-call revert**.

### Two APIs, one tool - when to use which

| | `get`/`set`/... (GraphQL) | `agent ...` (REST Agent API) |
|---|---|---|
| Level | low-level item/template CRUD | high-level pages/components/content + AI features |
| Auth | one **org** automation client | one **environment-scoped** client per env |
| Multi-env | one token, pick CM host | one client per env, fans out across configured envs |
| Revert | manual | built in - every write returns a `jobId`; `job-revert` undoes it |
| Powers the Marketer MCP | no | yes |

### Auth (different from the GraphQL side)

The Agent API rejects the org-level client. It needs **environment-scoped** automation clients
created in **Deploy portal -> Credentials -> Environment -> Create credentials -> Automation** -
one per env. Put them in `.env` as `SC_<ENV>_AGENT_CLIENT_ID` / `SC_<ENV>_AGENT_CLIENT_SECRET`.
The endpoint is a single global gateway (`SC_AGENT_BASE_URL`); the environment is determined by
which credential is used. Verify with `npm run sc -- agent token --env all`.

### Commands

```bash
npm run sc -- agent <subcommand> [options]
```

| Subcommand | Purpose |
|---|---|
| `token` | Print per-env token scope/expiry. |
| `sites` | List sites in the environment. |
| `site --id <siteId>` | Site details. |
| `pages --site <name> [--language en]` | List a site's pages. |
| `page --id <pageId>` | Page details. |
| `page-search --site <name> --term <q>` | Search pages. |
| `components-on-page --id <pageId>` | Components currently on a page. |
| `content-get --path <p>\|--id <itemId> [--language]` | Read a content item. |
| `insert-options --id <itemId>` | Templates insertable under an item. |
| `content-create --parent <id> --template <guid> --name <n> [--set "F=V"] [--language]` | Create content item. |
| `content-update --id <itemId> --set "F=V" [--new-version] [--language] [--site <name>]` | Update fields. |
| `content-delete --id <itemId> [--language]` | Delete content item. |
| `page-create --parent <id> --template <guid> --name <n> [--set "F=V"]` | Create a page. |
| `languages` | List environment languages. |
| `job --id <jobId>` / `job-ops --id <jobId>` | Inspect a job and its operations. |
| `job-revert --job <jobId>` | Undo everything a job did. |
| `raw --method <M> --path </api/v1/...> [--vars '<json>'] [--job <id>]` | Any endpoint (escape hatch). |

`--env` works the same as the GraphQL side; only envs with Agent creds are targetable.
**Writes to `uat`/`prod` require `--yes`.**

### Revertable write lifecycle

Every Agent API write is tagged with a generated `jobId` (printed after the call). To undo it:

```bash
npm run sc -- agent content-create --env dev --parent <id> --template <guid> --name "Foo" --set "Title=Bar"
#   -> 201  jobId=<uuid>
npm run sc -- agent job-ops    --env dev --job <uuid>     # what it did
npm run sc -- agent job-revert --env dev --job <uuid>     # undo it (status: reverted)
```

### Caveat

The Agent API is environment-bound per credential. For pure *concurrent multi-env* content
read/write/compare, the GraphQL side (`get`/`set`/`compare`) with its single org token is lighter.
Reach for `agent` when you need its higher-level operations (components, personalization,
experiments) or **revertable jobs**.

---

## Bulk work: the content-audit sub-agent

For a **bulk** audit or sync over many items, the raw per-item JSON can flood an agent
conversation. This skill ships a companion Claude Code sub-agent - `agents/sitecore-content-audit.md` -
that runs the CLI in an isolated context and hands back only a compact summary (a drift table or a
change log). Copy it into `.claude/agents/` and delegate large jobs to it. See that file for its
operating rules.
