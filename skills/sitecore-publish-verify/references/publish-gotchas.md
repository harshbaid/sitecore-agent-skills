# XM Cloud / Experience Edge publish gotchas

Field-tested traps behind "I published but it is still not right." Every one of these has cost real
debugging time on production headless sites. They are all Sitecore-side and product-agnostic.

## Language: `en-US` vs `en`

Content usually lives in a specific culture (often `en-US`). The neutral `en` frequently has no
version and reads back empty. An empty read is almost always the wrong language, not missing
content. Always diff and publish in the language the content is actually authored in.

## Two Edge contexts: live vs preview

Each environment has a **live** context (published content, what the site serves) and a **preview**
context (latest, mirrors master). Querying the wrong one is misleading - a value can look "missing"
because you read the live context for content that is only on preview. The live-vs-preview diff is
the single most useful check; do not query just one context and draw conclusions.

## Publishing the page does NOT publish its datasources

A rendering's datasource is a separate item (typically under `<page>/Data/...`). Publishing the
page item alone does not publish the datasource unless you publish sub-items or publish the
datasource directly. If a hero/CTA/card is wrong on live but the page published "successfully,"
publish the datasource item.

## The layout `rendered` snapshot is resolved at publish time

The Edge layout response (`layout { item { rendered } }`) embeds each datasource's field values
**as they were when the page was published**. It does NOT re-resolve datasources at query time. So a
datasource field can be correct on the item endpoint (`item { field { jsonValue } }`) yet stale in
the page layout at the same instant. The site fetches the layout, so the layout is what the visitor
sees. This is the trap that neither a datasource publish nor a CDN purge fixes.

## A datasource change needs a FULL page republish

Because of the snapshot above: after editing a datasource, publishing only the datasource updates
the datasource's item record but does not regenerate dependent pages' layout snapshots. You must
publish the **page route**. And a **SMART** publish of the page is a **no-op** if the page item
itself has not changed since the last publish (only the datasource did) - it skips layout
regeneration. Use **FULL** (`publishItemMode: FULL`, the "Republish" action) on the page to force
it. `PublishItemMode` enum = `FULL | SMART`.

## Internal links resolve to an empty href until the target is published

An internal link field (`linktype="internal"`, referencing another item by id) resolves to a real
href **only if the target item is published to the same Edge context**. If the target is
unpublished on live, the live link field comes back with `href: ""`, and republishing the
*referencing* page bakes that empty href into its layout snapshot. Order matters: publish the
**link target** first, then republish the referencing item, then the page.

## `publishRelatedItems: true` can cascade to thousands of items

On a FULL publish, `publishRelatedItems: true` traverses the related-items graph and can pull in
tens of thousands of items, blocking the publish queue (a follow-up publish then sits `QUEUED`
behind it for minutes). For a targeted fix use `publishSubItems: false, publishRelatedItems: false`.
Watch a publish with `publishingStatus(publishingOperationId: $op) { isDone isFailed state processed }`
and cancel a stuck one with `cancelPublishing(publishingOperationId: $op) { success message }`.

## A hidden version silently blocks a publish

If an item's version has `__Hide version = 1`, it is silently excluded from publishing while the
preview/editing view still shows it. "Publish finished" plus "still not on live" plus "looks fine in
the editor" is the signature. Clear the hidden-version flag and republish.

## Edge fronts the layout with a CDN cache

The Edge GraphQL layout response is cacheable and is cached at a CDN in front of Edge (e.g. a
`Cache-Control: public, max-age=14400` / 4-hour window, `CF-Cache-Status: HIT`). A publish purges
it, but while diagnosing you may read a cached response and mistake stale cache for stale storage.
Append a throwaway query param (e.g. `&_cb=<timestamp>`) to miss the cache and hit origin - the
`edge-diff.mjs` script does this with `--cache-bust`.

## Encode literal characters, not HTML entities, in plain-text fields

A rich-text field decodes `&reg;` to the character. A **plain-text** field rendered through a JSS
`<Text>` (which encodes by default) will render a real character correctly, but double-encodes a
literal entity string like `&reg;` into `&amp;reg;`, so the visitor sees the text `&reg;`. Store the
actual character in plain-text fields, not the entity.

## Tooling notes

- On Windows **Git Bash**, `/sitecore/...` paths get mangled into `C:/Program Files/Git/sitecore/...`
  and the lookup silently returns null. Run authoring commands from PowerShell, or quote the path.
- Production hosts often rate-limit or bot-block raw server-side fetches (HTTP 429). If your host
  has a protection-bypass mechanism, use it for diagnostic fetches.
