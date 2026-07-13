---
name: sitecore-publish-verify
description: Diagnose "I updated Sitecore content but it is not showing on the live site" for XM Cloud / SitecoreAI headless sites, and fix it. Walks the content pipeline - Master (CM) -> Experience Edge preview -> Experience Edge live -> your front-end/CDN cache - to find exactly which hop the change is stuck at, using an Edge live-vs-preview diff. Use when an editor reports a change is not reflecting live, when asked whether something is published, to check a publish gap, or to verify a publish reached the live Edge. Triggers: "not showing on live", "published but not visible", "is this published", "content not updating", "publish gap", "verify publish".
---

# Sitecore publish & verify (why isn't my content live?)

A CMS change is invisible if it is stuck at any hop in the delivery pipeline. This skill finds the
hop and fixes it. It applies to any XM Cloud / SitecoreAI **headless** site (content served from
Experience Edge to a front-end app).

## The pipeline (mental model)

```
Master (CM)  --publish-->  Edge PREVIEW  ==publish==>  Edge LIVE  --render+cache-->  Visitor
```

| Layer | What it is | How to read it |
|---|---|---|
| **Master (CM)** | What the editor edits in XM Cloud | `sitecore-authoring` skill: `get --env <env>` |
| **Edge - preview** | Latest content incl. unpublished; mirrors master | Edge GraphQL with the **preview** context id |
| **Edge - live** | Published content only - what the site reads | Edge GraphQL with the **live** context id |
| **Front-end / CDN cache** | The rendered HTML the visitor receives (e.g. Vercel ISR, another CDN, or the host's page cache) | Fetch the live URL; check its cache header |

The **decisive check is preview vs live** on Edge: it separates a *publish gap* (change never
reached live) from a *cache* problem (live Edge is correct, the front-end is serving stale HTML).

## Quick triage (60 seconds)

1. **Right host?** Confirm the reporter is on the real production host, not a legacy/staging one.
   This is the most common false alarm.
2. **Hard refresh** (Ctrl/Cmd+F5) to rule out the browser cache.
3. **Right language?** Many sites author in `en-US`; a read against `en` often has no version and
   comes back empty - which looks like missing content but is not.
4. **Identify the right item.** A visible block (hero, CTA, card) is almost always a **datasource**
   item under `<page>/Data/...`, not the page item itself. Diagnose the datasource.

## Step 1 - Read master (optional but useful)

Use the `sitecore-authoring` skill to confirm the editor's value actually saved, and to get the
item id you will need for publishing:

```bash
npm run sc -- get --env prod --path "/sitecore/content/MySite/Home/Data/<datasource>" --language en-US --own
```

## Step 2 - The decisive check: Edge live vs preview

Run the bundled diff. You need the environment's **live** and **preview** Experience Edge context
ids (from the XM Cloud Deploy portal, or your front-end app's env vars).

```bash
node scripts/edge-diff.mjs \
  --live-context <liveContextId> \
  --preview-context <previewContextId> \
  --path "/sitecore/content/MySite/Home/Data/<datasource>" \
  --language en-US \
  --fields "Title,Text"
```

The `sitecoreContextId` in the Edge URL is the auth - no token needed. The script prints a verdict
and a machine-readable summary. Interpret it:

| Verdict | Meaning | Do |
|---|---|---|
| `PUBLISH_GAP` | on preview, missing on live | **Fix A** (publish) then **Fix B** (refresh cache) |
| `FIELD_DRIFT` | preview has a newer value than live | **Fix A** then **Fix B** |
| `IN_SYNC` | live Edge already correct | **Fix B** only (or the layout-snapshot case below) |
| `BOTH_EXIST` (no `--fields`) | item on both; re-run with `--fields` to compare | narrow it down |
| `NOT_FOUND` | on neither context | wrong path/id or wrong language |

Add `--cache-bust` to bypass the CDN cache that sits in front of Edge and read origin directly
(useful to tell "stale CDN cache" from "stale Edge storage").

## Fixes

### Fix A - Publish the item (closes a publish gap)

Publish the **datasource** item itself - publishing the page does NOT publish its datasource (a
separate item). Use the `sitecore-authoring` skill's publish query:

```bash
npm run sc -- raw --env prod --query-file ./queries/publish-item.graphql --vars '{"ids":["<datasource-guid>"]}'
```

Re-run Step 2 against live until the field populates (a single-item publish usually lands in
~20-40s), then do Fix B.

### Fix B - Refresh the front-end / CDN cache

Even after live Edge is correct, the visitor sees cached HTML until the front-end refreshes. How
you trigger that depends on your hosting:

- **On-demand revalidation** (e.g. Next.js ISR on Vercel): call your app's revalidate endpoint for
  the affected route, or use the editor's "Revalidate Page" action if wired up.
- **A generic CDN**: purge the URL.
- **Timed revalidation**: if your app uses a background/ISR timer, the page self-heals after the
  interval - revalidating just makes it immediate.

Then re-fetch the live URL and confirm the new content appears (cache header should go MISS then HIT).

## The trap that neither publish nor cache-purge fixes

If `edge-diff` says `IN_SYNC` on the datasource but the **page** still renders the old value, the
stale value is baked into the **page layout snapshot**, not the datasource item and not your CDN
cache. A datasource edit does not regenerate dependent pages' layout, and a *Smart* page publish is
a no-op when the page item itself has not changed. Force it with a **FULL** page republish
(`publishItemMode: FULL` on the page route). See `references/publish-gotchas.md` for this and other
publish traps (internal links resolving empty, the `publishRelatedItems` cascade, the Edge CDN
cache, hidden versions).

## What to report back

State the verdict and the hop, in plain terms: e.g. "The content saved and is on preview, but it
was never published to live (publish gap). I published the datasource and refreshed the page cache;
it is live now." Always remind the user that authoring is not publishing, and that a publish still
needs a front-end cache refresh to be visible.
