---
name: sitecore-content-transfer
description: Move Sitecore content between XM Cloud / SitecoreAI environments via the Content Transfer + Item Transfer APIs. Use when asked to copy, migrate, replicate, promote, or sync items, pages, or content trees from one Sitecore environment to another (e.g. PROD to DEV, DEV to QA), or to "package" content the way Package Designer used to. Page presentation travels with the item automatically.
---

# Sitecore Content Transfer (environment to environment)

Move one or more item trees from a source SitecoreAI / XM Cloud environment to a
target environment by running `scripts/transfer.mjs`. This replaces the retired
Package Designer workflow - no UI, no manual chunk relaying, no Postman.

## Prerequisites (check before running)

1. **Node.js >= 20** on PATH.
2. **Credentials**: an *organization* automation client (created in SitecoreAI
   Deploy > Credentials > Environment > Automation by an Org Admin/Owner).
   One org client authorizes BOTH environments - the CM host in the URL decides
   which environment a call hits. Expected as env vars or a `.env` file next to
   where you run the script:
   - `SITECORE_CLIENT_ID` / `SITECORE_CLIENT_SECRET`
   - Cross-organization transfers only: `SITECORE_SOURCE_CLIENT_ID/SECRET` and
     `SITECORE_TARGET_CLIENT_ID/SECRET` overrides.
3. **CM host names** for source and target (Deploy portal > Project >
   Authoring environment > Details > Environment host name). Host only, no
   `https://` prefix.

If credentials are missing, stop and ask the user for them (or for the `.env`
location). Never echo secrets back into the conversation or commit them.

## Run

```bash
node scripts/transfer.mjs \
  --source-host <source-cm-host> \
  --target-host <target-cm-host> \
  --path "/sitecore/content/MySite/Home" \
  --scope SingleItem \
  --merge-strategy OverrideExistingItem
```

- `--path` is repeatable - each path becomes its own data tree / `.raif` file.
- On Windows Git Bash, quote paths or run from PowerShell: MSYS mangles
  `/sitecore/...` into a Windows path.
- The script logs each of the 8 steps, prints a final `=== TRANSFER SUMMARY ===`
  JSON block, and exits 0 (success), 2 (completed with skips/warnings), or
  1 (failed). Parse the JSON block to report results.

## Choosing scope and merge strategy

| Situation | Use |
|---|---|
| One page or one datasource item | `--scope SingleItem` (default) |
| A page plus everything under it | `--scope ItemAndDescendants` |
| Target item should be replaced | `--merge-strategy OverrideExistingItem` (default) |
| Never touch existing target items | `--merge-strategy KeepExistingItem` |
| Replace an entire existing tree | `--merge-strategy OverrideExistingTree` - dangerous, see below |

**Prefer `SingleItem` with multiple `--path` flags** over
`ItemAndDescendants` + `OverrideExistingTree` when items share a parent with
siblings you do not want to touch (e.g. one datasource under a shared Data
folder). Tree override clobbers siblings on the target.

**`LatestWin` is refused by the script on purpose** - it is not implemented
server-side and is known to crash CM environments. Do not work around this.

## Safety rules

- **Writing INTO a production environment**: confirm with the user first,
  restate exactly which paths and merge strategy will be used, and prefer
  `KeepExistingItem` or `SingleItem` scope unless told otherwise.
- Reading FROM production to seed a lower environment is the common, low-risk
  direction.
- Items land in the target **master database only**. The target's live site
  will not change until the items are published there. Remind the user of this
  after every successful transfer.
- Do not reuse a TransferId (the script generates a fresh UUID per run).

## Verifying success

Trust these, in order:

1. Per-item results in the summary (`itemsTransferred` / `itemsFailed`) - this
   is the source of truth.
2. Blob state `Consumed` / `Transferred`.
3. Do NOT trust the aggregate transfer status from `GET /transfers/{id}` on the
   Item Transfer API - it under-reports (can show `Unknown`/0 items while
   content was actually written).

For a belt-and-braces check, query the target's Authoring GraphQL for the
transferred item path afterwards.

## Parallel runs

Multiple transfers can run concurrently (separate terminal sessions or agent
sessions), because every run has its own TransferId. Keep the trees disjoint -
two concurrent runs writing into the same target path have no ordering
guarantee. Be considerate of CM load: chunk relay and consume are heavier than
normal API calls, so keep it to a handful of concurrent runs per environment.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `401 Unauthorized` mid-run | JWT expired (24h) or clock skew - rerun; token is fetched fresh each run |
| `403 Forbidden` | Client lacks Org Admin/Owner scope - recreate the automation client at organization level |
| `400 File does not exist` on consume | Something used `?fileName=` - the `.raif` is in Azure Blob storage, so it must be `?blobName=` (the script does this) |
| Consume succeeded but item not on target's live site | Expected - transfer writes to master only; publish on the target |
| Transferred page renders without layout changes | Presentation lives in `__Final Renderings` and DOES transfer; check the right site/language version, then publish |
| Aggregate status shows 0 items | Known under-reporting - check per-item results instead |

Deeper API details (endpoints, response schemas, state enums):
see [references/api-notes.md](references/api-notes.md).
