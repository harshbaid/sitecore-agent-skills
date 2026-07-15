---
name: sitecore-xmcloud-config-review
description: Review a Sitecore XM Cloud platform project's App_Config patch files against XM-Cloud-appropriate best practices, and recommend safe additions (item-name limits, media guardrails, language fallback, GraphQL hardening, item buckets, URL settings). Use when asked to review or harden XM Cloud platform configuration, "what should we tweak via config", auditing App_Config include patches, or before adding a new config patch. Reminds you that XM Cloud is a managed CM where many settings are locked or ignored - so it verifies via showconfig rather than trusting a patch blindly.
---

# XM Cloud platform configuration review

Review the `App_Config/include/**` patch files a team deploys to the XM Cloud **Content Management**
role, and recommend XM-Cloud-appropriate hardening. The goal is a short, prioritized list of safe
additions - not a copy-paste dump of on-prem XP settings.

## Framing first: XM Cloud is a managed CM (do not skip)

XM Cloud is not on-prem XP. Sitecore controls a large portion of configuration through role-based
layers, and a meaningful set of settings are either **locked** or **silently ignored** if you patch
them. So the review is "recommend, then verify," never "patch and assume."

Two rules that apply to every recommendation:

1. **Verify effect via `/sitecore/admin/showconfig.aspx`** on a non-prod CM after deploy - it shows
   the merged, effective config. Treat anything not in Sitecore's "Manage configuration / supported
   customizations for XM Cloud" documentation as "test before trusting."
2. **Scope patches to the role** with `role:require="ContentManagement"` so they only apply where
   intended in XM Cloud's role model. Declaring the `role` namespace but not using it is a common
   miss.

## How to run the review

1. **Locate the patches.** Find the platform project's config includes (commonly under
   `App_Config/include/**`, organized by Helix layer - Foundation/Feature/Project). Also check the
   `.csproj` to see which config files are actually wired into the build.
2. **Enumerate what is already patched.** For each file, note the area and setting (server time
   zone, language fallback, lowercase URLs, GraphQL max depth/complexity, content-editor start item,
   query limits, etc.). Do not re-recommend what is already covered.
3. **Compare against the checklist** in `references/config-checklist.md` and flag gaps.
4. **Prioritize.** Rank gaps High / Medium / Situational / Low, with a one-line reason each. Prefer
   pure-config, low-risk wins (item-name length/validation) over "verify then tighten" items (media
   guardrails) and content-modeling decisions (item buckets).
5. **Report**, and for anything recommended, note the showconfig verification step and whether the
   setting may already be enforced by the managed platform.

## The high-value checklist (summary)

| Area | Setting(s) | Why it matters on XM Cloud | Priority |
|---|---|---|---|
| **Item naming** | `MaxItemNameLength`, `InvalidItemNameChars`, `ItemNameValidation` | Long SEO/PIM names hit the 100-char default; lock out chars that break Edge / front-end URLs | **High** |
| **Language fallback** | Edge + index + shell + site-level `enableItemLanguageFallback` / `enableFieldLanguageFallback` | The big correctness lever for multi-language/culture headless sites | **High** |
| **GraphQL hardening** | `maxDepth`, `maxComplexity` | Bound query cost on the public delivery/authoring surface | **High** |
| **Lowercase URLs** | LinkManager + urlBuilder `lowercaseUrls` | Consistent, canonical URLs for a headless front-end | **Medium** |
| **Media guardrails** | `Media.DisableFileMedia`, upload extension whitelist, `Media.MaxSizeInDatabase` | DB-only media matches XM Cloud's non-persistent filesystem; block executable uploads. Verify then tighten - some may already be enforced | **Med-High** |
| **Item buckets** | `BucketConfiguration` + bucket a large tree | Thousands of items (e.g. PIM-driven products) keep the tree and query limits sane | **Situational** |
| **Default language** | `DefaultLanguage` | If only one culture is authored, aligning avoids stray versions - but test; system items live in `en` | **Low / careful** |

Full rationale, honest caveats, and example patch XML (role-scoped, matching typical file
conventions) are in [references/config-checklist.md](references/config-checklist.md).

## Deliver

A scannable report: what is already patched (excluded), the prioritized gaps with one-line reasons,
and for the top pick(s) a ready-to-review example patch plus the showconfig verification step. The
cleanest first win is almost always **item-name length/validation** - pure config, directly
affecting content and Edge URLs.
