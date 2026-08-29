-- Э6 (docs/AI_Federated_Search_Migration_Plan_v1.md §6, §8 п.3): Search Orchestrator v2 — Internal
-- First short-circuit + Candidate/Verification phases over `external_vessel_index` (Э5), replacing
-- `global-search-service.ts`'s always-run-every-live-adapter external phase.

-- `MIN_INTERNAL_RESULTS` (Арх §14) belongs in data, not a code constant, so ops can tune it without
-- a deploy. Plan §8 п.3's own resolution: start the threshold at 3, but don't let short-circuiting
-- actually engage yet — the seed catalog (a handful of published vessels) would make "internal
-- coverage is sufficient" true for almost no real query, so there's nothing to gain from flipping it
-- on before the catalog is large enough for the distinction to matter. `internal_first_enabled`
-- defaults to false for exactly that reason; an admin turns it on once the catalog justifies it.
alter table public.platform_settings
  add column internal_first_enabled boolean not null default false,
  add column min_internal_results integer not null default 3,
  add constraint platform_settings_min_internal_results_range check (min_internal_results >= 0);

-- New `search_runs` observability columns (plan §6's Э6 entry, verbatim):
--   candidates_from_index      — rows `candidate-phase.ts` pulled from `external_vessel_index`
--                                 before dedup/ranking/TOP-N (0 when internal-first short-circuited
--                                 or no source covers the request).
--   live_verifications         — `checkAvailability` calls `verification-phase.ts` actually attempted
--                                 for the TOP-N external candidates (only when the query names an
--                                 exact date window — see that module's own doc comment on why a
--                                 month-only or date-less query attempts none).
--   verification_failures      — of those, how many the adapter's own contract broke on (a rejected
--                                 promise, not an honest `UNKNOWN` result, which is not a failure).
--   internal_first_short_circuit — true when this run never touched the external phase at all
--                                 because internal coverage already met `min_internal_results`.
alter table public.search_runs
  add column candidates_from_index integer not null default 0,
  add column live_verifications integer not null default 0,
  add column verification_failures integer not null default 0,
  add column internal_first_short_circuit boolean not null default false;
