-- Э10 (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Арх §19): Source Onboarding v2's only
-- schema need — ongoing structure-change detection on an already-registered source. The onboarding
-- analysis itself (API/GraphQL/search-form detection, §19's checklist) is a live, read-only probe
-- (`source-validation.ts`'s `validateSearchSource`) that never writes to the database, same as the
-- checks it already had before this migration — nothing new to persist for that half.
--
-- "При падении доли успешных извлечений ниже порога — пометить источник и предложить переанализ"
-- needs a place to land: `checkSourceStructureHealth` (`source-structure-health.ts`) recomputes
-- these three columns every time the indexer visits a source (Э5's `indexSource`, both the
-- scheduled cron and the admin's manual "Индексировать сейчас"), reading recently-revisited
-- `external_vessel_index` rows rather than a new outcome-tracking table — the ground truth of
-- "did this page's structure still yield a name and a price" already lives there.

alter table public.search_sources
  add column needs_reanalysis boolean not null default false,
  -- Null until the first structure-health check ever runs for this source (Э10 ships after sources
  -- already exist) — distinct from a check that ran and found a healthy 100% rate, which is `0`/`0`
  -- turning into a real sample, not this.
  add column reanalysis_sample_size integer,
  add column reanalysis_success_count integer,
  add column structure_checked_at timestamptz,
  add constraint search_sources_reanalysis_counts_valid check (
    (reanalysis_sample_size is null and reanalysis_success_count is null)
    or (
      reanalysis_sample_size is not null
      and reanalysis_success_count is not null
      and reanalysis_success_count >= 0
      and reanalysis_success_count <= reanalysis_sample_size
    )
  );
