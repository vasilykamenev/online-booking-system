-- Fix (found live, docs/AI_Federated_Search_Migration_Plan_v1.md's Э10/Э11 verification session):
-- `search_field_source` has no value distinguishing the background indexer's own breadcrumb→
-- vocabulary location resolution (`index/location-resolver.ts`'s `resolveLocationFromBreadcrumb`,
-- "a genuinely different question" from the live path's, per that module's own doc comment) from the
-- live path's per-query breadcrumb *confirmation* (`lib/search/structured-data.ts`'s
-- `matchBreadcrumbLocation`). Both used to get tagged the same generic 'JSON_LD' — the tier the
-- extraction happened to succeed at — which meant `registry/listing-index.ts`'s stale-JSON-LD guard
-- (added to fix the live path's real query-scoping bug: a Turkey-query's confirmation being served
-- as fact to a later, unrelated Estonia query) also nulled out the indexer's own resolved
-- country/city on every read, for every source whose location comes via structured data — the exact
-- opposite of query-scoped, but indistinguishable from it by source label alone. Observed effect:
-- any location-scoped search against such a source silently returned zero external candidates,
-- because `matchesKnownCriteria`'s hard "no location at all" filter saw a wiped-to-null location on
-- every single row.
--
-- `indexer.ts` now records a resolved breadcrumb location as this new, distinct source instead of
-- inheriting the tier's own — the guard checks for `'JSON_LD'` specifically, so a `'BREADCRUMB'`
-- value passes through unfiltered, exactly as a deterministic, non-query-scoped fact should.

alter type public.search_field_source add value 'BREADCRUMB';
