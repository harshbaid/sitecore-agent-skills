#!/usr/bin/env node
/**
 * sitecore-content-transfer
 *
 * Moves content items between two SitecoreAI / XM Cloud environments using the
 * Content Transfer API (chunked relay: source -> destination) and the
 * Item Transfer API (consume the resulting .raif file on the destination).
 *
 * Zero dependencies. Requires Node.js >= 20 (built-in fetch + util.parseArgs).
 *
 * Usage:
 *   node transfer.mjs \
 *     --source-host cm-source-env.sitecorecloud.io \
 *     --target-host cm-target-env.sitecorecloud.io \
 *     --path "/sitecore/content/MySite/Home" \
 *     [--path "/sitecore/content/MySite/Data/Hero"]  (repeatable) \
 *     [--scope SingleItem|ItemAndDescendants]        (default: SingleItem) \
 *     [--merge-strategy OverrideExistingItem|KeepExistingItem|OverrideExistingTree] \
 *                                                    (default: OverrideExistingItem) \
 *     [--database master]                            (default: master) \
 *     [--poll-interval 3]                            (seconds) \
 *     [--poll-timeout 600]                           (seconds, per phase) \
 *     [--keep-transfer]                              (skip source-side cleanup) \
 *     [--env-file path/to/.env]
 *
 * Credentials (environment variables, or a .env file in the working directory):
 *   SITECORE_CLIENT_ID / SITECORE_CLIENT_SECRET
 *     One organization automation client used for BOTH environments. The token
 *     is org-scoped; the CM host in the URL decides which environment you hit.
 *   SITECORE_SOURCE_CLIENT_ID / SITECORE_SOURCE_CLIENT_SECRET   (optional override)
 *   SITECORE_TARGET_CLIENT_ID / SITECORE_TARGET_CLIENT_SECRET   (optional override)
 *     Only needed when source and target live in different Sitecore organizations.
 *
 * Exit codes: 0 = all items transferred, 2 = completed with warnings/skips, 1 = failed.
 */

import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import process from "node:process";

const AUTH_URL = "https://auth.sitecorecloud.io/oauth/token";
const AUDIENCE = "https://api.sitecorecloud.io";

const SCOPES = ["SingleItem", "ItemAndDescendants"];
// LatestWin exists in the API spec but is intentionally not accepted here:
// it is not implemented server-side and is known to crash CM environments.
const MERGE_STRATEGIES = [
  "OverrideExistingItem",
  "KeepExistingItem",
  "OverrideExistingTree",
];

const ctBase = (host) => `https://${host}/sitecore/api/content/transfer/v1`;
const itBase = (host) => `https://${host}/sitecore/shell/api/v3/ItemsTransfer`;

// ---------------------------------------------------------------- utilities

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with retries on network errors / 429 / 5xx. Returns the raw Response. */
async function request(url, options = {}, { attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}: ${await res.text()}`);
      } else {
        return res;
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt < attempts) await sleep(2000 * attempt);
  }
  throw lastError;
}

async function expectOk(res, context) {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${context} failed (HTTP ${res.status}): ${body}`);
  }
  return res;
}

/** Parse `key=value` parameters out of a Content-Disposition header. */
function dispositionParams(header) {
  const params = {};
  for (const part of (header || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    params[key] = part.slice(eq + 1).trim().replace(/^"|"$/g, "");
  }
  return params;
}

async function poll({ label, fn, isDone, intervalMs, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await fn();
    if (isDone(last)) return last;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${timeoutMs / 1000}s waiting for ${label}. Last state: ${JSON.stringify(last)}`
      );
    }
    await sleep(intervalMs);
  }
}

// ---------------------------------------------------------------- auth

const tokenCache = new Map();

async function getToken(clientId, clientSecret) {
  const cacheKey = clientId;
  if (tokenCache.has(cacheKey)) return tokenCache.get(cacheKey);
  const res = await request(AUTH_URL, {
    method: "POST",
    // Must be form-urlencoded. A JSON body returns a token that silently fails.
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      audience: AUDIENCE,
    }),
  });
  await expectOk(res, "Token request");
  const token = (await res.json()).access_token;
  tokenCache.set(cacheKey, token);
  return token;
}

const authHeaders = (token, extra = {}) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
  ...extra,
});

// ---------------------------------------------------------------- main

async function main() {
  const { values: args } = parseArgs({
    options: {
      "source-host": { type: "string" },
      "target-host": { type: "string" },
      path: { type: "string", multiple: true },
      scope: { type: "string", default: "SingleItem" },
      "merge-strategy": { type: "string", default: "OverrideExistingItem" },
      database: { type: "string", default: "master" },
      "poll-interval": { type: "string", default: "3" },
      "poll-timeout": { type: "string", default: "600" },
      "keep-transfer": { type: "boolean", default: false },
      "env-file": { type: "string", default: ".env" },
      help: { type: "boolean", default: false },
    },
  });

  if (args.help) {
    console.log(
      readFileSync(new URL(import.meta.url), "utf8").split("*/")[0] + "*/"
    );
    return;
  }

  loadEnvFile(args["env-file"]);

  const sourceHost = args["source-host"];
  const targetHost = args["target-host"];
  const paths = args.path ?? [];
  const scope = args.scope;
  const mergeStrategy = args["merge-strategy"];
  const database = args.database;
  const intervalMs = Number(args["poll-interval"]) * 1000;
  const timeoutMs = Number(args["poll-timeout"]) * 1000;

  if (!sourceHost || !targetHost) fail("--source-host and --target-host are required.");
  if (sourceHost === targetHost) fail("Source and target host are identical - nothing to transfer.");
  if (paths.length === 0) fail("At least one --path is required.");
  if (!SCOPES.includes(scope)) fail(`--scope must be one of: ${SCOPES.join(", ")}`);
  if (!MERGE_STRATEGIES.includes(mergeStrategy)) {
    fail(
      `--merge-strategy must be one of: ${MERGE_STRATEGIES.join(", ")}. ` +
        `(LatestWin is refused on purpose - it is not implemented server-side and can crash the CM.)`
    );
  }

  const sourceClientId =
    process.env.SITECORE_SOURCE_CLIENT_ID || process.env.SITECORE_CLIENT_ID;
  const sourceClientSecret =
    process.env.SITECORE_SOURCE_CLIENT_SECRET || process.env.SITECORE_CLIENT_SECRET;
  const targetClientId =
    process.env.SITECORE_TARGET_CLIENT_ID || process.env.SITECORE_CLIENT_ID;
  const targetClientSecret =
    process.env.SITECORE_TARGET_CLIENT_SECRET || process.env.SITECORE_CLIENT_SECRET;
  if (!sourceClientId || !sourceClientSecret || !targetClientId || !targetClientSecret) {
    fail(
      "Missing credentials. Set SITECORE_CLIENT_ID and SITECORE_CLIENT_SECRET " +
        "(or the SOURCE_/TARGET_ specific variants) via environment or .env file."
    );
  }

  const transferId = randomUUID();
  const summary = {
    transferId,
    sourceHost,
    targetHost,
    database,
    scope,
    mergeStrategy,
    paths,
    chunkSets: [],
    consumed: [],
    result: "failed",
  };

  log(`Transfer plan: ${paths.length} tree(s), scope=${scope}, merge=${mergeStrategy}`);
  paths.forEach((p) => log(`  - ${p}`));
  log(`Source: ${sourceHost}  ->  Target: ${targetHost}  (database: ${database})`);

  const sourceToken = await getToken(sourceClientId, sourceClientSecret);
  const targetToken =
    targetClientId === sourceClientId
      ? sourceToken
      : await getToken(targetClientId, targetClientSecret);
  log(`[1/8] Authenticated.`);

  try {
    // -- 2. Create the transfer operation on the SOURCE ---------------------
    const createRes = await request(`${ctBase(sourceHost)}/transfers`, {
      method: "POST",
      headers: authHeaders(sourceToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        TransferId: transferId,
        Configuration: {
          DataTrees: paths.map((ItemPath) => ({
            ItemPath,
            Scope: scope,
            MergeStrategy: mergeStrategy,
          })),
          Database: database,
        },
      }),
    });
    await expectOk(createRes, "Create transfer");
    log(`[2/8] Transfer created on source (TransferId: ${transferId}).`);

    // -- 3. Poll source until chunking completes ----------------------------
    const status = await poll({
      label: "source transfer to complete",
      intervalMs,
      timeoutMs,
      fn: async () => {
        const res = await request(`${ctBase(sourceHost)}/transfers/${transferId}/status`, {
          headers: authHeaders(sourceToken),
        });
        await expectOk(res, "Get transfer status");
        return res.json();
      },
      isDone: (s) => {
        if (s.State === "Failed") throw new Error("Source transfer entered Failed state.");
        if (s.State === "NotFound") throw new Error("Source transfer not found - was the TransferId reused?");
        return s.State === "Completed";
      },
    });
    const chunkSets = status.ChunkSetsMetadata ?? [];
    log(
      `[3/8] Source chunking complete: ${chunkSets.length} chunk set(s), ` +
        `${chunkSets.reduce((n, cs) => n + (cs.TotalItemCount ?? 0), 0)} item(s) total.`
    );

    // -- 4+5. Relay every chunk, then complete each chunk set on the TARGET --
    const raifFiles = [];
    for (const cs of chunkSets) {
      let itemsProcessed = 0;
      let itemsSkipped = 0;
      for (let chunkId = 0; chunkId < cs.ChunkCount; chunkId++) {
        const chunkUrl = `/transfers/${transferId}/chunksets/${cs.ChunkSetId}/chunks/${chunkId}`;
        const getRes = await request(`${ctBase(sourceHost)}${chunkUrl}`, {
          headers: authHeaders(sourceToken),
        });
        await expectOk(getRes, `Download chunk ${chunkId} of set ${cs.ChunkSetId}`);
        const params = dispositionParams(getRes.headers.get("content-disposition"));
        const isMedia = params.ismedia === "true";
        itemsProcessed += Number(params.itemsprocessed ?? 0);
        itemsSkipped += Number(params.itemsskipped ?? 0);
        // Forward the stream exactly as received: media chunks stay compressed,
        // content chunks stay encrypted. Never transform the bytes.
        const bytes = Buffer.from(await getRes.arrayBuffer());
        const putRes = await request(
          `${ctBase(targetHost)}${chunkUrl}?isMedia=${isMedia}`,
          {
            method: "PUT",
            headers: authHeaders(targetToken, {
              "Content-Type": "application/octet-stream",
            }),
            body: bytes,
          }
        );
        await expectOk(putRes, `Upload chunk ${chunkId} of set ${cs.ChunkSetId}`);
        log(
          `[4/8] Relayed chunk ${chunkId + 1}/${cs.ChunkCount} of set ${cs.ChunkSetId} ` +
            `(${bytes.length} bytes, isMedia=${isMedia}).`
        );
      }

      const completeRes = await request(
        `${ctBase(targetHost)}/transfers/${transferId}/chunksets/${cs.ChunkSetId}/complete`,
        { method: "POST", headers: authHeaders(targetToken) }
      );
      await expectOk(completeRes, `Complete chunk set ${cs.ChunkSetId}`);
      const { ContentTransferFileName } = await completeRes.json();
      raifFiles.push(ContentTransferFileName);
      summary.chunkSets.push({
        chunkSetId: cs.ChunkSetId,
        chunkCount: cs.ChunkCount,
        totalItemCount: cs.TotalItemCount,
        itemsProcessed,
        itemsSkipped,
        raif: ContentTransferFileName,
      });
      log(`[5/8] Chunk set complete on target -> ${ContentTransferFileName}`);
    }

    // -- 6. Ask the TARGET to consume each .raif (Item Transfer API) --------
    // The .raif lands in the target's Azure Blob storage, so the consume call
    // must use ?blobName= (NOT ?fileName=, which returns "File does not exist").
    for (const raif of raifFiles) {
      const consumeRes = await request(
        `${itBase(targetHost)}/transfers/databases/${database}/sources?blobName=${encodeURIComponent(raif)}`,
        { method: "POST", headers: authHeaders(targetToken) }
      );
      await expectOk(consumeRes, `Start consuming ${raif}`);
      log(`[6/8] Consume started for ${raif}.`);

      // -- 7. Poll blob state, then verify per item -------------------------
      const blobResult = await poll({
        label: `blob ${raif} to be consumed`,
        intervalMs,
        timeoutMs,
        fn: async () => {
          const res = await request(
            `${itBase(targetHost)}/sources/blobs/${encodeURIComponent(raif)}`,
            { headers: authHeaders(targetToken) }
          );
          await expectOk(res, `Get blob state for ${raif}`);
          return res.json();
        },
        isDone: (b) => {
          if (b.BlobState === "Error" || b.BlobState === "Discarded") {
            throw new Error(`Blob ${raif} ended in state ${b.BlobState}.`);
          }
          return ["Consumed", "Transferred", "TransferredWithErrors"].includes(b.BlobState);
        },
      });

      // The aggregate transfer status is known to under-report (it can show
      // Unknown/0 while items were actually written). Per-item status is the
      // source of truth, so look the transfer up and inspect its items.
      const listRes = await request(`${itBase(targetHost)}/transfers?page=1&pageSize=50`, {
        headers: authHeaders(targetToken),
      });
      await expectOk(listRes, "List transfers on target");
      const listBody = await listRes.json();
      const transfers = Array.isArray(listBody) ? listBody : listBody.Transfers ?? listBody.Items ?? [];
      const entry = transfers.find((t) => t.SourceName === raif);

      let items = [];
      if (entry) {
        const itemsRes = await request(
          `${itBase(targetHost)}/transfers/databases/${database}/sources/${encodeURIComponent(entry.Id)}/items?page=1&pageSize=100`,
          { headers: authHeaders(targetToken) }
        );
        if (itemsRes.ok) {
          items = (await itemsRes.json()).Items ?? [];
        }
      }
      const transferred = items.filter((i) => i.IsTransferred).length;
      const failedItems = items.filter((i) => !i.IsTransferred);
      summary.consumed.push({
        raif,
        blobState: blobResult.BlobState,
        transferState: entry?.TransferState ?? "unknown",
        itemsSeen: items.length,
        itemsTransferred: transferred,
        itemsFailed: failedItems.map((i) => ({ id: i.Id, name: i.Name })),
      });
      log(
        `[7/8] ${raif}: BlobState=${blobResult.BlobState}, ` +
          `items transferred=${transferred}/${items.length || "?"}${
            failedItems.length ? `, FAILED: ${failedItems.map((i) => i.Name).join(", ")}` : ""
          }`
      );
    }
  } finally {
    // -- 8. Clean up the transfer operation on the SOURCE -------------------
    if (!args["keep-transfer"]) {
      try {
        await request(`${ctBase(sourceHost)}/transfers/${transferId}`, {
          method: "DELETE",
          headers: authHeaders(sourceToken),
        });
        log(`[8/8] Source transfer ${transferId} deleted (cleanup).`);
      } catch (err) {
        log(`[8/8] WARNING: cleanup failed (${err.message}). Delete transfer ${transferId} manually.`);
      }
    } else {
      log(`[8/8] Skipping cleanup (--keep-transfer). Remember to DELETE /transfers/${transferId} later.`);
    }
  }

  const anySkipped = summary.chunkSets.some((cs) => cs.itemsSkipped > 0);
  const anyFailed = summary.consumed.some(
    (c) => c.itemsFailed.length > 0 || c.blobState === "TransferredWithErrors"
  );
  summary.result = anyFailed || anySkipped ? "completed-with-warnings" : "success";

  console.log("\n=== TRANSFER SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(
    "\nReminder: transferred items land in the target MASTER database only. " +
      "Publish them (and any referencing items) before expecting changes on the delivery side."
  );
  process.exitCode = summary.result === "success" ? 0 : 2;
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
