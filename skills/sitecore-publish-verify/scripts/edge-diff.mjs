#!/usr/bin/env node
/**
 * edge-diff.mjs - Locate where a content change is stuck by comparing an item on the
 * Experience Edge LIVE context (published only) vs the PREVIEW context (latest, mirrors master).
 *
 *   node scripts/edge-diff.mjs \
 *     --live-context <liveContextId> \
 *     --preview-context <previewContextId> \
 *     --path "/sitecore/content/MySite/Home" \
 *     --fields "Title,Text"
 *
 * The sitecoreContextId in the Edge URL IS the auth - no bearer token needed. Get the live and
 * preview context ids from your XM Cloud environment (Deploy portal, or your app's env vars:
 * the "live" one serves the site; the "preview" one is used by editing/preview).
 *
 * --language defaults to "en". Many sites author in another culture (often "en-US"); pass
 * --language en-US (or set SC_EDGE_LANGUAGE) if a read comes back empty.
 * --path accepts a content path OR an item ID (Edge treats both interchangeably in `path`).
 * Omit --fields to just check existence on each context. --cache-bust appends a throwaway query
 * param so the request skips the CDN cache in front of Edge and hits origin.
 *
 * Env-var fallbacks: SC_EDGE_LIVE_CONTEXT, SC_EDGE_PREVIEW_CONTEXT, SC_EDGE_ENDPOINT, SC_EDGE_LANGUAGE.
 *
 * Exit codes: 0 = live and preview agree (no publish gap); 2 = publish gap / field drift found;
 * 1 = error or item not found on either context.
 */
import process from 'node:process';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);

const liveCtx = opt('live-context') ?? process.env.SC_EDGE_LIVE_CONTEXT;
const prevCtx = opt('preview-context') ?? process.env.SC_EDGE_PREVIEW_CONTEXT;
const target = opt('path');
const language = opt('language') ?? process.env.SC_EDGE_LANGUAGE ?? 'en';
const fields = (opt('fields') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const cacheBust = flag('cache-bust');
const endpoint =
  opt('endpoint') ??
  process.env.SC_EDGE_ENDPOINT ??
  'https://edge-platform.sitecorecloud.io/v1/content/api/graphql/v1';

if (!liveCtx || !prevCtx || !target) {
  console.error(
    'Usage: node scripts/edge-diff.mjs --live-context <id> --preview-context <id> ' +
      '--path "<path-or-item-id>" [--language en] [--fields "A,B"] [--cache-bust]\n' +
      '(context ids may also come from SC_EDGE_LIVE_CONTEXT / SC_EDGE_PREVIEW_CONTEXT)'
  );
  process.exit(1);
}

const fieldSelections = fields
  .map((f, i) => `f${i}: field(name: ${JSON.stringify(f)}) { name value }`)
  .join('\n      ');

const query = `query {
  item(path: ${JSON.stringify(target)}, language: ${JSON.stringify(language)}) {
    id
    name
    path
    ${fieldSelections}
  }
}`;

async function queryEdge(ctx, label) {
  let url = `${endpoint}?sitecoreContextId=${encodeURIComponent(ctx)}`;
  if (cacheBust) url += `&_cb=${Date.now()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  if (json.errors) throw new Error(`${label}: ${JSON.stringify(json.errors)}`);
  return json.data?.item ?? null;
}

function fieldMap(item) {
  const out = {};
  if (!item) return out;
  for (const key of Object.keys(item)) {
    if (/^f\d+$/.test(key) && item[key]) out[item[key].name] = item[key].value ?? '';
  }
  return out;
}

try {
  const [live, preview] = await Promise.all([
    queryEdge(liveCtx, 'LIVE'),
    queryEdge(prevCtx, 'PREVIEW'),
  ]);

  let verdict, exitCode;
  const drift = [];

  if (!live && !preview) {
    verdict = 'NOT_FOUND: item is on neither context. Check the path/id and language (many sites author in en-US, not en).';
    exitCode = 1;
  } else if (preview && !live) {
    verdict = 'PUBLISH_GAP: item exists on PREVIEW but not on LIVE. It was never published to the live Edge. Publish it, then refresh your front-end cache.';
    exitCode = 2;
  } else if (live && !preview) {
    verdict = 'LIVE_ONLY: item is on LIVE but not PREVIEW. Unusual - likely deleted/moved in master since last publish, or a path/language mismatch.';
    exitCode = 2;
  } else {
    const lf = fieldMap(live);
    const pf = fieldMap(preview);
    for (const f of fields) {
      if ((lf[f] ?? '') !== (pf[f] ?? '')) drift.push({ field: f, live: lf[f] ?? '', preview: pf[f] ?? '' });
    }
    if (!fields.length) {
      verdict = 'BOTH_EXIST: item is on both contexts. Pass --fields to compare values. If the page still looks wrong, the change is stuck in your front-end/CDN cache (revalidate/purge) or you are on the wrong host.';
      exitCode = 0;
    } else if (drift.length) {
      verdict = `FIELD_DRIFT: ${drift.length} field(s) differ between PREVIEW and LIVE - an unpublished change. Publish the item (SMART), then refresh your front-end cache.`;
      exitCode = 2;
    } else {
      verdict = 'IN_SYNC: every compared field matches on LIVE and PREVIEW. Edge is not the problem - look at your front-end/CDN cache (revalidate/purge), the layout snapshot (a datasource edit needs a FULL page republish - see references/publish-gotchas.md), or the host.';
      exitCode = 0;
    }
  }

  console.log(`\nItem   : ${target}  (language: ${language})`);
  console.log(`LIVE   : ${live ? `${live.name} [${live.id}]` : '(not found)'}`);
  console.log(`PREVIEW: ${preview ? `${preview.name} [${preview.id}]` : '(not found)'}`);
  if (drift.length) {
    console.log('\nField drift (PREVIEW has the newer value):');
    for (const d of drift) {
      console.log(`  x ${d.field}`);
      console.log(`      live    : ${JSON.stringify(d.live)}`);
      console.log(`      preview : ${JSON.stringify(d.preview)}`);
    }
  }
  console.log(`\n${verdict}`);
  console.log('\n=== EDGE DIFF SUMMARY ===');
  console.log(
    JSON.stringify(
      {
        item: target,
        language,
        liveExists: !!live,
        previewExists: !!preview,
        fieldsCompared: fields,
        drift,
        verdict: verdict.split(':')[0],
      },
      null,
      2
    )
  );
  process.exit(exitCode);
} catch (err) {
  console.error('ERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
}
