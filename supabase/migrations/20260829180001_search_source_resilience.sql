-- Э8 (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Арх §22, §23): Отказоустойчивость —
-- circuit breaker state per source + one new `search_runs` counter. Rate limiting itself needs no
-- schema change: `resilience/rate-limiter.ts` reads the same `search_source_policies.rate_limit_policy`
-- JSON the Э5 indexer already established the `requestsPerSecond` convention for (see that
-- migration's own comment anticipating "Э8's rate limiter" reading this same blob) — this migration
-- only adds the *breaker's* threshold/cooldown convention on top of it, in `resilience/circuit-breaker.ts`,
-- not a new column.

create type public.search_circuit_state as enum ('CLOSED', 'OPEN', 'HALF_OPEN');

-- One row per source, created lazily on first recorded outcome (no seed insert) — a source with no
-- row here has never had a call attempted through the resilience layer yet, which
-- `resilience/source-health.ts` treats identically to an explicit CLOSED/0-failures row.
create table public.search_source_health (
  source_id uuid primary key references public.search_sources (id) on delete cascade,
  state public.search_circuit_state not null default 'CLOSED',
  consecutive_failures integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  -- When the breaker last tripped OPEN — `null` while CLOSED. Drives the cooldown-elapsed check
  -- that lets a HALF_OPEN trial call through (Арх §23's closed → open → half-open ladder).
  opened_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger search_source_health_set_updated_at
  before update on public.search_source_health
  for each row execute function public.set_updated_at();

-- Э8's own "Готово когда" counterpart to Э3's `sources_skipped_by_coverage` (Арх §9) and Э6's
-- `candidates_from_index`/`live_verifications`: a live check this run *would* have attempted but
-- didn't, because that source's breaker was OPEN — distinct from `verification_failures` (a call
-- that was attempted and broke), so search_runs can tell "we didn't even try" from "we tried and it
-- failed".
alter table public.search_runs
  add column circuit_breaker_skips integer not null default 0;

alter table public.search_source_health enable row level security;

-- Same convention as every other search_* operational table (search_source_urls, search_runs'
-- siblings): admin-only read, service-role write — the live search/indexer paths that write this
-- always use the service-role client already (`createAdminClient()`), same as `recordExtraction`.
create policy "search_source_health_admin_read" on public.search_source_health
  for select using (public.is_admin());

grant select, insert, update, delete on public.search_source_health to service_role;
