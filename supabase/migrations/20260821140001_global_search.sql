-- Global AI Vessel Search: the Source Registry (spec §8) and the per-search observability log
-- (spec §26), plus a bulk booked-ranges RPC the internal provider needs to filter a page of
-- candidates by date without N+1 round trips.

create type public.search_source_type as enum ('WEBSITE', 'API');

-- Extraction strategy for a source (spec §8). Each value corresponds to a code path, so adding a
-- strategy is a migration plus an implementation — unlike countries or currencies, which are
-- pure data (CLAUDE.md §9).
create type public.search_processing_type as enum (
  'API',
  'HTML',
  'STRUCTURED_DATA',
  'AI_EXTRACTION',
  'HYBRID'
);

create type public.search_external_phase as enum ('SKIPPED', 'PENDING', 'COMPLETE', 'FAILED');

-- Source Registry -------------------------------------------------------
-- Spec §8's accepted recommendation: don't re-research the internet on every query. Known,
-- validated sources are searched first and fast; discovery only ever adds to this table.

create table public.search_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique,
  base_url text not null,
  enabled boolean not null default true,
  source_type public.search_source_type not null default 'WEBSITE',
  processing_type public.search_processing_type not null default 'HTML',
  -- Higher runs earlier when the crawl budget is limited.
  priority integer not null default 50,
  -- Null until measured from actual extraction outcomes; feeds SearchRankingService's
  -- "source reliability" factor (spec §18).
  reliability_score numeric(3, 2),
  -- Cached robots.txt verdict, refreshed by the crawler (spec §24). Null means "not yet checked",
  -- which the crawler must treat as "check before fetching", never as permission.
  robots_allows boolean,
  last_checked_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint search_sources_reliability_range
    check (reliability_score is null or (reliability_score >= 0 and reliability_score <= 1))
);

create trigger search_sources_set_updated_at
  before update on public.search_sources
  for each row execute function public.set_updated_at();

create index search_sources_enabled_priority_idx
  on public.search_sources (enabled, priority desc);

-- Search runs -----------------------------------------------------------
-- Spec §26: every field here exists to answer "why did this search return what it did", which is
-- what makes the quality of global search measurable rather than anecdotal.

create table public.search_runs (
  id uuid primary key default gen_random_uuid(),
  -- Null for anonymous visitors: search does not require an account.
  user_id uuid references public.profiles (id) on delete set null,
  locale text not null,
  original_query text not null,
  interpreted_criteria jsonb not null default '{}'::jsonb,
  -- 'AI' or 'DETERMINISTIC' — how the query was understood, so degraded searches are visible.
  interpretation_mode text not null default 'DETERMINISTIC',
  degraded_reason text,
  -- The query variants generated for external search (spec §21).
  generated_queries jsonb not null default '[]'::jsonb,
  sources_visited integer not null default 0,
  pages_visited integer not null default 0,
  pages_rejected integer not null default 0,
  offers_extracted integer not null default 0,
  offers_normalized integer not null default 0,
  duplicates_detected integer not null default 0,
  internal_results integer not null default 0,
  external_results integer not null default 0,
  ai_calls integer not null default 0,
  execution_ms integer,
  external_phase public.search_external_phase not null default 'SKIPPED',
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index search_runs_user_idx on public.search_runs (user_id, created_at desc);
create index search_runs_created_idx on public.search_runs (created_at desc);

-- Bulk booked ranges ----------------------------------------------------
-- The single-vessel get_vessel_booked_ranges (20260808090001) is right for a vessel page but
-- would be an N+1 across a page of search candidates. Same security rationale: bookings_read RLS
-- hides other people's bookings, yet *when* a published vessel is taken is public information, so
-- this security-definer function returns date ranges and nothing else.
create or replace function public.get_vessels_booked_ranges(p_vessel_ids uuid[])
returns table (vessel_id uuid, date_range daterange)
language sql
security definer
set search_path = public
stable
as $$
  select b.vessel_id, b.date_range
  from public.bookings b
  join public.vessels v on v.id = b.vessel_id
  where b.vessel_id = any (p_vessel_ids)
    and b.status <> 'cancelled'
    and (v.status = 'published' or v.owner_id = auth.uid() or public.is_admin());
$$;

grant execute on function public.get_vessels_booked_ranges(uuid[]) to anon, authenticated;

-- RLS -------------------------------------------------------------------

alter table public.search_sources enable row level security;
alter table public.search_runs enable row level security;

-- The registry lists public websites and holds no secrets; the orchestrator reads it with the
-- caller's own client, so a public read policy keeps that path free of service-role privileges.
create policy "search_sources_public_read" on public.search_sources
  for select
  using (enabled or public.is_admin());

create policy "search_sources_admin_write" on public.search_sources
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- Deliberately select-only. Runs are written server-side with the service-role client (the same
-- pattern as public.payments), so there is no insert/update policy for anon or authenticated:
-- a client must never be able to forge or edit its own audit trail.
create policy "search_runs_read_own" on public.search_runs
  for select
  using (user_id = auth.uid() or public.is_admin());

grant select on public.search_sources to anon, authenticated;
grant select on public.search_runs to anon, authenticated;
grant select, insert, update, delete on public.search_sources to service_role;
grant select, insert, update, delete on public.search_runs to service_role;
