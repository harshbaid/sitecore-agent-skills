# Authoring & Management API + Agent API v2.0 - field notes

Reference for the two APIs behind this skill. Read this when you need to call them directly
(via the `raw` command or your own script) instead of through the `get`/`set`/`compare` wrappers.

Official docs: [Authoring and Management API](https://doc.sitecore.com/xmc/en/developers/xm-cloud/the-authoring-and-management-api.html).
Browse the live schema per environment at `https://<cm-host>/sitecore/api/authoring/graphql/ide`.

## Auth (GraphQL side)

```
POST https://auth.sitecorecloud.io/oauth/token
Content-Type: application/x-www-form-urlencoded

client_id=...&client_secret=...&grant_type=client_credentials&audience=https://api.sitecorecloud.io
```

- Body MUST be form-urlencoded. A JSON body can return a token that silently fails authorization.
- The client must be an **organization** automation client. Its token scope includes
  `xmcloud.cm:admin` and is accepted by **every CM in the organization** - that is what enables
  multi-env fan-out from one credential.
- The JWT lasts ~24h. It is cached in `.token-cache.json` and refreshed ~1 min before expiry.

## Endpoint

```
https://<cm-host>/sitecore/api/authoring/graphql/v1
```

Send the bearer as `Authorization: Bearer <token>`. The CM host you call decides which environment
you touch.

## Reading items

```graphql
query($p: String!, $lang: String!) {
  item(where: { path: $p, language: $lang }) {
    itemId
    name
    path
    template { templateId name }
    fields(ownFields: false) {          # ownFields: true = exclude inherited
      nodes { name value }
    }
    children(first: 50) { nodes { name path hasChildren } }
  }
}
```

- Target by `path` OR `itemId` in the `where` clause.
- Language matters: many XM Cloud sites author in `en-US`. A read against `en` on such a site
  comes back with empty field values (no version), which looks like "missing content" but is not.

## Mutations (shapes the CLI uses)

| Mutation | Input essentials |
|---|---|
| `createItem` | `{ name, templateId, parent (id or path), language, fields: [{name, value}] }` |
| `updateItem` | `{ itemId/path, language, version?, fields: [{name, value}] }` |
| `moveItem` | `{ itemId/path, target parent id/path, sortOrder? }` |
| `renameItem` | `{ itemId/path, newName }` |
| `deleteItem` | `{ itemId/path, permanently? }` (default = recycle) |
| `publishItem` | see below |

## Publishing (authoring is not publishing)

Authoring writes land in the **master** database only. Nothing is live until published to
Experience Edge.

```graphql
mutation PublishItem($ids: [ID]!, $languages: [String] = ["en"]) {
  publishItem(input: {
    rootItemIds: $ids
    languages: $languages                # defaults to ["en"]; pass ["en-US"] etc. to match your content
    targetDatabases: ["experienceedge"]
    sourceDatabase: "master"
    publishItemMode: FULL                # FULL re-publishes even unchanged fields
    publishSubItems: false
    publishRelatedItems: false           # avoid on large/settings roots - can run away
  }) { operationId }
}
```

Poll with:

```graphql
query($op: String!) {
  publishingStatus(publishingOperationId: $op) { isDone isFailed state processed }
}
```

Publish gotchas worth knowing:
- A hidden version (`__Hide version = 1`) silently blocks an item from publishing while preview
  still shows it.
- An internal link field that points at an item published later needs a FULL (not smart)
  re-publish of the *referencing* item once the target is live.

## Agent API v2.0 (REST)

A higher-level API (pages, components, datasources, personalization, jobs). Powers the Marketer MCP.

- **Different auth:** it rejects the org client and requires an **environment-scoped** automation
  client, one per environment.
- **Single gateway:** `https://edge-platform.sitecorecloud.io/stream/ai-agent-api`. The environment
  is determined by the credential, not the URL.
- **Revertable jobs:** every write returns a `jobId`; `job-revert` undoes the whole job. Verified
  end-to-end: create -> `job-ops` shows the operation -> `job-revert` (`"status":"reverted"`) ->
  the item 404s.

## Which layer to use

| Need | Layer |
|---|---|
| Read/write/compare content across many envs at once | GraphQL (`get`/`set`/`compare`) - one org token |
| Item/template CRUD, publishing | GraphQL |
| Pages + components + placeholders, personalization, experiments | Agent API (`agent ...`) |
| Undoable write | Agent API (`job-revert`) |
| Arbitrary SPE PowerShell | neither - use the Marketer MCP |
