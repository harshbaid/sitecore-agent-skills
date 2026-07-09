# Content Transfer + Item Transfer API notes

Field-tested reference for the two APIs behind this skill (both GA since
July 2026). Read this when you need to call the APIs directly instead of via
`scripts/transfer.mjs` - e.g. to retry a failed source, inspect history, or
consume a hand-uploaded `.raif`.

Official docs: [Content Transfer API](https://api-docs.sitecore.com/sai/content-transfer)
and [Item Transfer API](https://api-docs.sitecore.com/sai/item-transfer).

## Auth

```
POST https://auth.sitecorecloud.io/oauth/token
Content-Type: application/x-www-form-urlencoded

client_id=...&client_secret=...&grant_type=client_credentials&audience=https://api.sitecorecloud.io
```

- Body MUST be form-urlencoded. A JSON body can return a token that silently
  fails authorization.
- The client must be an **organization** automation client (Org Admin/Owner).
- The JWT lasts 24 hours and works against every environment in the org - the
  CM host you call decides which environment you touch.

## Base URLs (per environment CM host)

| API | Base |
|---|---|
| Content Transfer | `https://{cm-host}/sitecore/api/content/transfer/v1` |
| Item Transfer | `https://{cm-host}/sitecore/shell/api/v3/ItemsTransfer` |

## Division of labor (differs from how the docs read)

The Content Transfer API is called on **both** environments: create + status +
chunk download on the SOURCE, chunk upload + chunk-set complete on the TARGET.
The `.raif` file is generated on the **target** (the `complete` call targets
the destination), and the Item Transfer API is called **only on the target** to
consume it.

## The 8-step workflow

| # | Env | Call | Notes |
|---|---|---|---|
| 1 | source | `POST /transfers` | Body: `{TransferId: <new uuid>, Configuration: {DataTrees: [{ItemPath, Scope, MergeStrategy}], Database: "master"}}`. Reusing a TransferId overwrites the earlier operation |
| 2 | source | `GET /transfers/{id}/status` | Poll until `State: "Completed"` (enum: Running, Completed, Failed, NotFound). Response carries `ChunkSetsMetadata[]: {ChunkSetId, ChunkCount, TotalItemCount}` - one chunk set per DataTree |
| 3 | source | `GET /transfers/{id}/chunksets/{csId}/chunks/{n}` | Chunks are 0-indexed. Binary body. `Content-Disposition` params: `IsMedia` (true = compressed media, false = encrypted content), `ItemsProcessed`, `ItemsSkipped` |
| 4 | target | `PUT /transfers/{id}/chunksets/{csId}/chunks/{n}?isMedia={bool}` | Forward the bytes EXACTLY as received - no decompression, no decryption, no re-encoding. `isMedia` query param is required |
| 5 | target | `POST /transfers/{id}/chunksets/{csId}/complete` | Returns `{ContentTransferFileName: "....raif"}` |
| 6 | target | `POST <ItemTransfer>/transfers/databases/{db}/sources?blobName={raif}` | MUST be `blobName`, not `fileName` - the `.raif` sits in Azure Blob storage; `fileName` returns `400 File does not exist` |
| 7 | target | `GET <ItemTransfer>/sources/blobs/{raif}` + `GET <ItemTransfer>/transfers` | Poll blob `BlobState` to Consumed/Transferred; then find the transfer entry whose `SourceName` equals the `.raif` name and list its items (below) for per-item truth |
| 8 | source | `DELETE /transfers/{id}` | Cleanup; also releases the TransferId for reuse |

## Enums

- `Scope`: `SingleItem` (default), `ItemAndDescendants`
- `MergeStrategy`: `OverrideExistingItem` (default), `KeepExistingItem`,
  `OverrideExistingTree`, `LatestWin` - **never use LatestWin**: not
  implemented server-side, known to crash CM environments
- Content transfer `State`: `Running`, `Completed`, `Failed`, `NotFound`
- Item transfer `TransferState`: `Unknown`, `InProgress`, `Finished`,
  `Failed`, `Queued`, `Discarded`
- `BlobState`: `Unknown`, `Uploading`, `Uploaded`, `Initializing`, `Error`,
  `Consumed`, `Transferred`, `TransferredWithErrors`, `Queued`, `Discarded`

## Item Transfer API - other useful endpoints

| Endpoint | Purpose |
|---|---|
| `GET /transfers?page=1&pageSize=50` | List active + completed transfers; entries: `{Id, SourceName, DatabaseName, ConsumedDate, TransferState, Strategy}`. `Id` looks like `consumed.20260622 123617 3195348.<guid>` |
| `GET /transfers/{Id}` | Details: `TotalItemsCount`, `TransferredItemsCount`, `ValidationErrors[]`. WARNING: known to under-report (shows Unknown/0 while items were actually written) - use per-item view |
| `GET /transfers/databases/{db}/sources/{Id}/items?page=1&pageSize=50` | Per-item truth: `Items[]: {Id, Name, ParentId, TemplateId, IsTransferred}` |
| `PUT /transfers/databases/{db}/sources/{raif}` | Retry a source whose TransferState is `Failed` |
| `POST /sources/blobs/{name}?gzip=true` | Upload a small (<50 MB) `.raif` directly, bypassing the Content Transfer API |
| `DELETE /sources/blobs/{name}` | Discard a blob source permanently |
| `GET /history?page=1&pageSize=50` | Timeline of consumed sources, newest first |

## Behavior worth knowing

- **Presentation transfers automatically.** A page's layout is just its
  `__Final Renderings` field, so replicating a page brings its full rendering -
  no separate layout or packaging step.
- **Transfers write to the target's master database only.** Publish on the
  target before expecting the delivery side (Experience Edge / head app) to
  change.
- **Sibling clobbering**: `ItemAndDescendants` + `OverrideExistingTree` on a
  shared parent (e.g. a Data folder) replaces the whole tree on the target,
  including siblings that were never part of your intent. Prefer `SingleItem`
  per path.
- Media chunks arrive compressed and content chunks encrypted; the relay must
  be byte-exact in both directions.
