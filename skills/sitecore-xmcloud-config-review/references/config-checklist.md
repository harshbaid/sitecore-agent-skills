# XM Cloud config checklist - detail, caveats, example patches

Companion to `SKILL.md`. Rationale for each recommended area, the honest caveats, and example patch
files. Every example is scoped with `role:require="ContentManagement"` and matches the usual Helix
`App_Config/include/<Layer>/<Name>.config` convention. Confirm each against Sitecore's "Manage
configuration for XM Cloud" docs and `/sitecore/admin/showconfig.aspx` before trusting it.

## Recommended additions

| Area | Setting(s) / mechanism | Why it is best practice here | Priority |
|---|---|---|---|
| **Item naming** | `MaxItemNameLength`, `InvalidItemNameChars`, `ItemNameValidation` | Long SEO/product names (often from a PIM) hit the 100-char default; lock out characters that break Edge / front-end URLs | **High** |
| **Media guardrails** | `Media.DisableFileMedia=true`, upload extension whitelist, `Media.MaxSizeInDatabase` | Keep media DB-only (matches XM Cloud's non-persistent filesystem, cleaner serialization) and block executable uploads. The size default is already generous, so this is about constraint + security, not raising a limit | **Med-High** |
| **Rich Text Editor profile** | Default HTML editor profile + `WebStylesheet` (mostly a core-DB profile item, not pure config) | Authors get brand styles in-editor and paste-cleanup so RTE fields do not leak messy markup into Edge | **Medium** |
| **Item Buckets** | `BucketConfiguration` + bucket the large tree | Thousands of items keep the content tree and `Query.MaxItems` sane at scale | **Situational** |
| **Delivery-site fallback** | `enableItemLanguageFallback` / `enableFieldLanguageFallback` on the site definitions | Edge + index fallback being on is not enough; confirm the actual content sites declare it too (often in the Sites collection, not config) | **Situational** |
| **Default content language** | `DefaultLanguage` (default `en`) | If only one culture is authored, aligning avoids stray versions - but test; system/standard-values items live in `en` | **Low / careful** |

## Baseline usually worth confirming is already present

Do not re-recommend these if the project already patches them - just confirm they exist:

- Server time zone (`ServerTimeZone`).
- Language fallback across **Edge** (`ExperienceEdge.EnableItemLanguageFallback`), the master/web
  **indexes** (`enableItemLanguageFallback`), and the **shell**.
- Lowercase URLs (LinkManager + urlBuilder `lowercaseUrls`).
- GraphQL security (`maxDepth` / `maxComplexity`).
- Content-editor start item and query limits (`Query.MaxItems`).

For a headless multi-brand/multi-language site the "big three" are language fallback (Edge + index +
shell), lowercase URLs, and GraphQL hardening. If those are in place, the baseline is solid.

## Example patches

### `Foundation.ItemNaming.config`

```xml
<configuration xmlns:patch="http://www.sitecore.net/xmlconfig/"
               xmlns:role="http://www.sitecore.net/xmlconfig/role/">
  <sitecore role:require="ContentManagement">
    <settings>
      <!-- raise if long product/SEO names get truncated; default 100 -->
      <setting name="MaxItemNameLength" value="150" />
      <!-- keep names URL-safe for Edge + the front-end router -->
      <setting name="InvalidItemNameChars" value="\/:?&quot;&lt;&gt;|[]" />
    </settings>
  </sitecore>
</configuration>
```

### `Foundation.Media.config`

```xml
<configuration xmlns:patch="http://www.sitecore.net/xmlconfig/"
               xmlns:role="http://www.sitecore.net/xmlconfig/role/">
  <sitecore role:require="ContentManagement">
    <settings>
      <!-- enforce DB-only media; XM Cloud has no persistent shared filesystem (verify - may already be enforced) -->
      <setting name="Media.DisableFileMedia" value="true" />
      <!-- Media.MaxSizeInDatabase default is already 500MB; patch ONLY to constrain, and keep it below httpRuntime.maxRequestLength -->
      <!-- <setting name="Media.MaxSizeInDatabase" value="100MB" /> -->
    </settings>
  </sitecore>
</configuration>
```

## Honest caveats (do not oversell these)

- **Media size default** - `Media.MaxSizeInDatabase` already defaults to 500MB on Sitecore 10 /
  XM Cloud, so there is no "raise the limit" win; only patch it to *constrain*, and keep any value
  below the managed `httpRuntime.maxRequestLength`.
- **Media DB-only** - `Media.DisableFileMedia` may already be enforced by the managed platform
  (XM Cloud has no persistent shared filesystem); confirm via showconfig before adding it.
- **Upload extension whitelist** - the exact setting/handler shifts between Sitecore versions, so
  confirm the version-correct name in showconfig rather than copying a stale setting.
- **Rich Text Editor profiles** - in XM Cloud these are usually edited as core-DB items under
  `/sitecore/system/Settings/Html Editor Profiles` and serialized, not patched via `App_Config`.

## Recommended sequencing

The cleanest, lowest-risk win is **item-name length/validation** - pure config, directly affecting
content and Edge URLs. **Media guardrails** are a "verify then tighten" hardening pass, not a
drop-in. **Item Buckets** is the bigger architectural lever if a content tree (e.g. products) is
getting heavy, but that is a content-modeling decision, not just a setting.

Before creating any config file, gather: the real max item-name length needed, whether to constrain
media size below its 500MB default, and (for the upload whitelist) the version-correct setting name
confirmed via showconfig. Then create the file, wire it into the platform `.csproj`, and
build-verify on a throwaway branch.
