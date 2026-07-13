---
name: sitecore-authoring
description: Read, write, and compare Sitecore XM Cloud / SitecoreAI content across MULTIPLE environments (DEV, UAT, PROD) at once via the Authoring & Management GraphQL API, plus the higher-level Agent API v2.0 (revertable jobs, pages/components). Use when asked to read or edit item field values, create/move/rename/delete items, compare a value across environments, audit drift, sync one environment's content to another, publish an item, or run authoring GraphQL outside a single-environment MCP. Triggers: "across environments", "compare dev/uat/prod", "authoring API", "all three envs", "audit this field everywhere".
---

# Sitecore Authoring API (multi-environment)

A standalone CLI that talks to the XM Cloud **Authoring & Management GraphQL API** for every
configured environment at once, and also wraps the **Agent API v2.0** (the REST API behind the
Marketer MCP). Use it when a task spans more than one environment, or when you want a
scriptable / CI-friendly path instead of a single-environment MCP session.

The whole tool lives in this skill folder. Run every command from here.

## Prerequisites (check before running)

1. **Node.js >= 20** on PATH.
2. **`npm install`** once in this folder (installs `tsx` + `typescript`; no runtime deps).
3. **Credentials in `.env`** (copy `.env.example`). For the GraphQL commands you need ONE
   **organization** automation client (`SC_CLIENT_ID` / `SC_CLIENT_SECRET`); its token
   (scope `xmcloud.cm:admin`) works against every CM in the org. Verify with
   `npm run sc -- token`.
4. **CM host per environment** in `.env` (`SC_DEV_CM_HOST` etc.). Without these the tool fails
   fast with a clear error.

If credentials are missing, stop and ask the user for them (or the `.env` location). Never echo
secrets back into the conversation or commit them.

## Run

```bash
npm run sc -- <command> [options]      # the -- is required so npm passes args through
```

## Commands

| Command | Purpose |
|---|---|
| `token` | Print token audience/scopes/expiry (no secret). Sanity-check auth. |
| `get --env <e> --path\|--id [--fields a,b] [--own]` | Read an item / specific fields. |
| `set --env <e> --path\|--id --set "F=V" [--set ...] [--version N]` | Update field values. |
| `create --env <e> --parent <id\|path> --template <guid> --name <n> [--set "F=V"]` | Create item. |
| `move --env <e> --path\|--id --to-path\|--to-id <t> [--sort N]` | Move item. |
| `rename --env <e> --path\|--id --name <newName>` | Rename item. |
| `delete --env <e> --path\|--id [--permanently]` | Recycle (or hard-delete) item. |
| `compare --env all --path\|--id --fields a,b` | Side-by-side field drift across envs. |
| `raw --env <e> --query-file <path> [--vars '<json>']` | Arbitrary GraphQL (escape hatch). |
| `agent <sub> ...` | Agent API v2.0 layer (see below). |

`--env` takes a single env, a comma list, or `all`; every command fans out concurrently.
Target an item with `--path "/sitecore/..."` or `--id <guid>`. Default `--language en` (many
sites author in `en-US` - pass `--language en-US` if a read comes back empty).

## Rules and gotchas (do not skip)

1. **Guarded writes.** Any write (`set`/`create`/`move`/`rename`/`delete`) to a guarded env
   (`uat`, `prod` by default - see `WRITE_GUARDED_ENVS` in `src/config.ts`) is refused without
   `--yes`. Confirm intent with the user before adding `--yes` to a prod write.
2. **Authoring is not publishing.** These edit the master DB. The change is NOT live until
   published. Publish via the `publishItem` mutation (`queries/publish-item.graphql` through
   `raw`), the MCP, or the editor. Tell the user a publish is still needed.
3. **Discover GUIDs with the tool itself.** Need a parent or template GUID? `get` the parent
   item (returns `itemId` + `template.templateId`) rather than guessing.
4. **`--set` splits on the first `=`.** Values may contain `=`; quote the whole `"Field=Value"`.
5. **Read before a cross-env write.** To promote a value: `get` it from the source env, then
   `set` it on the targets with `--yes`. Prefer `compare` first to see what actually differs.
6. **Safe verification pattern.** When proving a write works, do it on DEV and clean up
   (`create` -> `get` -> `delete --permanently`). Never test-write to prod.

## Common flows

```bash
# audit a field everywhere
npm run sc -- compare --env all --path "/sitecore/content/Home" --fields "Title,Text"

# promote dev's value to uat+prod
npm run sc -- get --env dev      --path "/sitecore/content/Home" --fields "Title"
npm run sc -- set --env uat,prod --path "/sitecore/content/Home" --set "Title=<value>" --yes

# same edit everywhere at once
npm run sc -- set --env all --path "/sitecore/content/Settings/Banner" --set "Message=..." --yes

# list children to build a work-list, then publish an item
npm run sc -- raw --env dev --query-file ./queries/children.graphql --vars '{"p":"/sitecore/content"}'
npm run sc -- raw --env dev --query-file ./queries/publish-item.graphql --vars '{"ids":["<item-guid>"]}'
```

## Agent API v2.0 (the `agent` command)

The same tool wraps the **Sitecore Agent API v2.0** - a higher-level layer than the GraphQL
commands above. Run `npm run sc -- agent <sub>`.

- **Auth is different:** the Agent API needs **environment-scoped** automation clients (org-level
  is rejected), one per env, in `.env` as `SC_<ENV>_AGENT_CLIENT_ID` / `_SECRET`. Verify with
  `agent token --env all`.
- **Use it for what GraphQL can't do as well:** pages with components/placeholders, datasources,
  personalization variants, A/B experiments, briefs, brand kits, and **revertable jobs**.
- **Revert:** every write prints a `jobId`; undo with `agent job-revert --env <e> --job <id>`.
- Subcommands: `token, sites, site, pages, page, page-search, components-on-page, content-get,
  insert-options, content-create, content-update, content-delete, page-create, languages, job,
  job-ops, job-revert, raw`. Writes to guarded envs still require `--yes`.

**Choosing between the two layers:** for plain multi-env content read/write/compare use the
GraphQL commands (`get`/`set`/`compare`) - one org token, lightest for concurrent multi-env. Use
`agent` for higher-level operations or when you want a revertable job.

## When NOT to use this

- The task needs **SPE PowerShell scripting** -> use the Marketer MCP, not this tool.
- A **bulk** audit/sync over many items would flood the conversation with JSON -> delegate to the
  `sitecore-content-audit` sub-agent (in `agents/`), which returns only a summary.

Full option table, recipes, auth deep-dive, and troubleshooting are in
[README.md](README.md). Deeper API notes are in [references/api-notes.md](references/api-notes.md).
