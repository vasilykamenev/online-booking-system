---
name: test-search-sources
description: QA pass for the external Search Source registry — registering a source with each processingType (STRUCTURED_DATA/AI_EXTRACTION/HTML/HYBRID/API), selector config, image domains, auto-select classifications, the draft→approve/reject→enable lifecycle, URL registry/crawl rules, field-conflict resolution, and a live search that actually exercises the registered source end to end. Use when the user asks to test/QA search source registration, the admin search-sources flow, crawl/extraction configuration, or before shipping a change to `src/server/search/` or `src/app/[locale]/admin/search-sources/`.
---

# Test Search Sources

Registering a source has two failure modes that matter differently: a broken **form**
(validation, save, status transitions) and a source that saves fine but **never
actually contributes a search result** (wrong `processingType`/`selectorConfig`
combination, robots.txt blocks it, not `enabled`, not `active`). Static checks catch
the first; only a real search against a real dev server + real local Postgres catches
the second. Do both — don't stop at "the form saved without an error".

Report findings as you go; don't silently fix things you find, unless the user has
asked you to also fix issues this pass turns up.

## 0. Static checks

```bash
npm run typecheck
npm run lint
```

Stop and report if either fails before continuing — a type error in
`src/lib/validation/admin.ts`, `src/server/actions/admin.ts`, or `src/server/search/`
makes every later step meaningless.

## 1. Environment

**Dev server** — check before starting your own (a leftover server from a prior
session is common in this project):

```bash
netstat -ano | grep ":3000" | grep LISTENING
```

Not running → `npm run dev`, wait for "Ready in". Remember whether you own it — you
kill it in step 8 only if you started it.

**Database access** — this project's local Supabase (Postgres, Studio, postgres-meta)
runs inside WSL Docker, not reachable via `npx supabase` from Windows (the installed
CLI resolves to the Windows-platform binary regardless of which shell invokes it, and
it looks for `docker` on the Windows PATH). Reach it by prefixing with `wsl.exe -e bash
-lc "..."`:

```bash
wsl.exe -e bash -lc "docker exec supabase_db_meridian psql -U postgres -d postgres -c \"select 1;\""
```

Every SQL verification step below uses this pattern. If it fails, check
`wsl.exe -e bash -lc "docker ps"` for the actual container names before assuming the
stack is down.

**Admin session** — seed admin credentials (`supabase/seed.sql`):
`admin@meridian.travel` / `password123`. Log in via
`mcp__claude-in-chrome__*` tools (`tabs_context_mcp` first, then `navigate` to
`/en/auth/login`) before touching `/admin/search-sources` — every mutation below
requires an authenticated admin session (`requireAdmin` in `server/actions/admin.ts`).

## 2. Registration form — validation and field combinations

Navigate to `/en/admin/search-sources` — the create form (`search-source-form.tsx`)
renders inline on this list page itself, there is no separate `/new` route; editing an
existing source (`[id]/edit`) reuses the same component with `defaultValues` filled
in. For each case below, submit and record pass/fail against the stated expectation.
Use a
domain you don't mind creating for real (`globesailor.ru`, already registered in most
dev DBs from prior sessions, is a good known-good reference for what a real response
looks like — pick an unused test domain, e.g. `example.com` or a scratch subdomain, for
the cases meant to fail or that you'll delete afterward, see step 8).

| Case | `sourceType` | `processingType` | `selectorConfig` | Expected |
|---|---|---|---|---|
| Structured data source | WEBSITE | STRUCTURED_DATA | (hidden — not asked) | Saves, generic provider will pick it up with no selectors (`isGenericEligible` — `provider-registry.ts`) |
| AI extraction source | WEBSITE | AI_EXTRACTION | (hidden) | Saves, same as above |
| HTML with no selectors | WEBSITE | HTML | empty | Saves — but `isGenericEligible` returns `false` for `HTML`/`HYBRID` with `selectorConfig === null`, so this source contributes nothing to search until selectors are added. Confirm this in step 5, not just that the form accepted it. |
| HTML with valid selectors | WEBSITE | HTML | see JSON below | Saves, now generic-eligible |
| HYBRID | WEBSITE | HYBRID | same JSON | Saves, generic-eligible once selectors present |
| Malformed selector JSON | WEBSITE | HTML | `{not valid json` | Form shows `selectorConfigInvalid` (or its translated message) — must not silently save an empty/null config |
| Valid JSON, wrong shape | WEBSITE | HTML | `{"fields":{"name":{"selector":123}}}` (selector must be a string) | Rejected — `selectorConfigSchema` in `lib/validation/admin.ts` |
| API processing type | WEBSITE | API | (hidden) | Saves — but is **never** generic-eligible (`provider-registry.ts`'s `isGenericEligible` returns `false` for `API` unconditionally, "deliberately never generalized"). Confirm in step 5 this source never contributes results even once approved+enabled, unless it's `brilions.com` (the one domain with a purpose-built provider). |
| Invalid domain | any | any | — | Rejected client/server-side against `DOMAIN_PATTERN` (`lib/validation/admin.ts`) — try `not a domain`, `http://has-scheme.com`, trailing dot |
| Duplicate domain | any | any | — | Second source with the same `domain` as an existing row → `domainTaken` error (`search_sources.domain` has a DB `unique` constraint, `createSearchSource` maps Postgres `23505` to this code) |
| `imageDomains` with entries | any | any | — | Comma/newline-separated list, each validated as its own domain (`parseImageDomains`) — feeds `api/external-image` route's proxy allowlist alongside the source's own `domain` |
| `autoSelectClassifications` empty | any | any | — | Valid — "nothing auto-selected, pick URLs by hand" is legitimate, not an error |

Valid `selectorConfig` JSON for the cases above — field keys are fixed
(`selectorConfigSchema` in `lib/validation/admin.ts`: `name`, `description`, `image`,
`guests`, `cabins`, `vesselTypeRaw`, `country`, `city` — no `price`, JSON-LD is the
only price source today, see `providers/generic/provider.ts`'s AI-tier doc comment):

```json
{
  "fields": {
    "name": { "selector": "h1" },
    "description": { "selector": ".description" },
    "guests": { "selector": ".guests", "regex": "(\\d+)" },
    "vesselTypeRaw": { "selector": ".vessel-type" }
  }
}
```

Also click **"Проверить"/"Validate"** (`validateSearchSourceCandidate` →
`source-validation.ts`) against a real, reachable domain before saving. It does live,
read-only probes (robots.txt, sitemap, homepage JSON-LD, up to 3 sampled candidate
pages) and suggests a `processingType` + selector config — confirm the report renders
(reachability, robots.txt found/allows, sitemap entry count, structured-data types,
suggestion) and that it never writes anything (`search_sources.robots_allows`/
`last_checked_at` must be unaffected — check via SQL if in doubt).

## 3. Status lifecycle

A freshly created source is `status: 'draft'`, `enabled: false` — invisible to search
regardless of `processingType` (`getActiveExternalProviders` in `provider-registry.ts`
only considers `enabled && status = 'active'` rows).

1. **Approve** (`approveSearchSource`) → confirm `status` becomes `'active'` and
   `enabled` becomes `true` in one step.
2. **Reject** (`rejectSearchSource`) on a different draft → confirm `status:
   'rejected'`, `enabled: false`.
3. **Disable** an active source (`setSearchSourceEnabled(..., false)`) → confirm it
   stops contributing to search (step 5) without changing `status`.
4. **Re-enable** → confirm it resumes contributing.

Verify directly rather than trusting the UI badge alone:

```bash
wsl.exe -e bash -lc "docker exec supabase_db_meridian psql -U postgres -d postgres -c \"select name, domain, status, enabled, processing_type from search_sources where domain = '<test-domain>';\""
```

## 4. URL registry and crawl rules

On `/admin/search-sources/[id]/urls` for an approved source with a real sitemap:

1. **Resync** (`resyncSearchSourceUrls`) — populates `search_source_urls` from the live
   sitemap. Confirm the classification counts (HIGH/MEDIUM/LOW/SKIP) render and sum to
   the total.
2. **Add a crawl rule** — one `PREFIX` (e.g. pattern `/yacht/*`, classification `HIGH`)
   and one `REGEX` (e.g. `^/yacht/[a-z0-9-]+$`). Confirm an invalid regex (`(unclosed`)
   is rejected at save time (`crawlRuleSchema`'s `superRefine`), not silently accepted.
3. **"Check against the real site"** (`previewSourceCrawlRules`) — confirm this is
   read-only (classifies a live sitemap sample against currently *saved* rules, writes
   nothing) and re-running resync/reclassify after adding a rule actually changes which
   URLs are HIGH vs SKIP.
4. **Manual URL entry** (`addManualSourceUrls`) — add one URL not from the sitemap on
   the same domain; confirm a cross-domain URL is rejected ("only URLs on the same
   domain as the source's base URL are accepted").
5. **Selection override** (`setUrlSelectionOverride`) — force-include one `LOW`/`SKIP`
   row and force-exclude one `HIGH` row; confirm `selected` flips independently of
   `classification`.
6. **Clear URLs** (`clearSourceUrlRegistry`) — confirm it empties the registry and
   requires the confirmation step, not a single accidental click.

## 5. Live search — does the source actually contribute results?

This is the step that catches what the form alone can't: a source that saved
successfully but produces nothing, or produces results with wrong/leaked
location/criteria data (the real bug class this skill exists to catch — see git
history for `src/lib/search/match-criteria.ts` and
`providers/brilions/select-candidates.ts`'s `matchingCitySlugs`, both hard-filter bugs
only visible from an actual query, never from the registration form).

1. Curl or navigate to `/en/discover?q=<something this source's catalog should match>`.
2. Check `search_runs` for the run (`created_at desc limit 1`):
   ```bash
   wsl.exe -e bash -lc "docker exec supabase_db_meridian psql -U postgres -d postgres -c \"select original_query, interpreted_criteria->'location' as location, sources_visited, pages_visited, pages_from_index, pages_revalidated_unchanged, offers_extracted, external_results, execution_ms from search_runs order by created_at desc limit 1;\""
   ```
   - `sources_visited` includes your test source only if it's `enabled`+`active` and
     `isGenericEligible` (or has a purpose-built provider).
   - A query naming both a city and its country should return **only that city** —
     verify the actual result cards/page text, not just that the query ran (grep the
     rendered HTML for other known cities of the same country, same technique as the
     Antalya/Turkey regression: `curl ... | grep -o "<OtherCity>" | wc -l` should be 0).
3. **Draft/disabled source**: repeat and confirm `sources_visited` does **not** include
   it, and no `search_extracted_listings` row gets created for its URLs.
4. **`HTML` with no selectors**: confirm it's genuinely silent (no fetch, no error) —
   `isGenericEligible` skips it before any request goes out.
5. **Robots.txt disallow**: if you control a test domain, block `/` in its
   `robots.txt` and confirm the search run's `errors` array contains a "robots.txt
   disallows" entry for that source (`resolveRobotsAllowed` in
   `providers/generic/provider.ts`) rather than the source silently returning zero
   with no explanation.

## 6. Data merger / P3 index (only matters for a real generic-provider source)

1. After step 5's first live search, confirm the extraction actually persisted:
   ```bash
   wsl.exe -e bash -lc "docker exec supabase_db_meridian psql -U postgres -d postgres -c \"select url, name, field_provenance, last_extracted_at from search_extracted_listings where source_id = (select id from search_sources where domain = '<test-domain>') limit 5;\""
   ```
2. **Repeat the identical search** within 24h — `pages_from_index` in the new
   `search_runs` row should be > 0 and total `execution_ms` should drop noticeably
   (this was ~5x on a real repeat query during development). If it's still 0, the index
   isn't being read — check `INDEX_FRESHNESS_MS` in `providers/generic/provider.ts` and
   that the source is still the same `source.id`.
3. **Field conflicts** (P2): to force one without waiting for a real site's content to
   change, insert a synthetic open conflict directly against a real listing row
   (mirrors what a real second crawl disagreeing would produce):
   ```bash
   wsl.exe -e bash -lc "docker exec supabase_db_meridian psql -U postgres -d postgres -c \"
   insert into search_field_conflicts (listing_id, field, previous_value, new_value, previous_source, new_source)
   values ('<listing-id-from-step-1>', 'name', '\\\"<current name>\\\"'::jsonb, '\\\"TEST CONFLICT\\\"'::jsonb, 'JSON_LD', 'JSON_LD');
   \""
   ```
   Then on `/admin/search-sources/[id]/urls`, click "Accept new" on one such conflict
   and confirm the listing's `name`/`field_provenance` (source becomes `MANUAL`,
   confidence `1.0`) updates; click "Keep previous" on another and confirm the listing
   value is untouched, only `search_field_conflicts.resolved_at`/`resolution` change.
   Always delete synthetic conflict rows and restore any listing field you overwrote
   afterward (step 8) — never leave fabricated listing data in a shared dev DB.
4. **ETag revalidation**: don't expect this to trigger against a real registered
   source — most real sites (confirmed for `globesailor.ru`: `Cloudflare` +
   `Cache-Control: no-store`, no `ETag`/`Last-Modified` at all) never send validators,
   so this path is exercised by `crawl/safe-fetch.test.ts`'s mocked tests, not live
   traffic. Don't burn time trying to force a live 304 — it's a documented,
   expected limitation (design doc §5.4), not something this skill should chase.

## 7. Report

Table of case × expected × actual, one row per case in steps 2–6. Call out anything
that saved when it should have been rejected, any source that silently contributed
zero results with no error surfaced, and any location/criteria leak in step 5.2 — that
class of bug is exactly what live search verification catches and the form/typecheck
never will.

## 8. Clean up

- Delete every test source you created (`deleteSearchSource` in the UI, or directly:
  `wsl.exe -e bash -lc "docker exec supabase_db_meridian psql -U postgres -d postgres -c \"delete from search_sources where domain = '<test-domain>';\""` —
  cascades to `search_source_urls`/`search_source_crawl_rules`/
  `search_extracted_listings`/`search_field_conflicts` via FK).
- Delete any synthetic `search_field_conflicts`/`search_extracted_listings` rows you
  inserted by hand for step 6.3 that weren't already covered by a source deletion
  above.
- If you started the dev server in step 1, kill it. If you reused an existing one,
  leave it running.
