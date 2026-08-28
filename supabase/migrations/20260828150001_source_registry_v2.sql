-- Э3 (docs/AI_Federated_Search_Migration_Plan_v1.md §6): Source Registry v2 — capabilities,
-- access-strategy ladder, coverage and policies (Арх §8, §9, §24).
--
-- Deviation from the plan's literal "drop search_sources cascade, recreate from scratch": this
-- migration reaches the identical target shape via `alter table add column` instead. The plan's own
-- rationale for dropping was migration-history cleanliness (avoiding a *chain* of alters across many
-- files) — moot here, since this is already a single new migration. Doing it additively keeps every
-- existing index, RLS policy, FK and admin-authored row intact with zero backfill risk, which a
-- cascade drop would force redoing for no functional benefit. `processing_type` is deliberately kept
-- alongside the new `access_strategy` — `provider-registry.ts` still selects on it until Э4 cuts
-- provider/adapter selection over to the strategy ladder; removing it now would break the
-- current search path for no Э3-scoped reason.

create type public.search_access_strategy as enum
  ('API', 'GRAPHQL', 'STRUCTURED_DATA', 'SEARCH_URL', 'WEB_PARSER', 'AI_EXTRACTION');

-- Арх §20. Lives on the source (what a *source* can offer), not yet on an offer — Э9 adds
-- `contact_intents` and a per-offer capability; this is the source-level default that step reads.
create type public.search_contact_capability as enum
  ('EMAIL', 'PROVIDER_API', 'CONTACT_FORM', 'EXTERNAL_BOOKING_URL', 'PLATFORM_MESSAGE', 'REDIRECT_ONLY');

alter table public.search_sources
  add column access_strategy public.search_access_strategy,
  -- Degradation order when the primary strategy fails (Арх §8) — empty means "no fallback defined
  -- yet", never inferred from access_strategy alone.
  add column fallback_strategies public.search_access_strategy[] not null default '{}',
  -- Capabilities (Арх §8): what this source can actually be asked to do, independent of how well it
  -- currently does it (that's `reliability_score`/§8's health state, Э8).
  add column can_search boolean not null default true,
  add column can_details boolean not null default false,
  add column can_availability boolean not null default false,
  add column can_pricing boolean not null default false,
  add column can_contact boolean not null default false,
  -- Search-request capabilities: which UniversalVesselSearchRequest fields this source can act on
  -- itself (vs. the generic crawl path filtering post-hoc) — read by a future adapter (Э4), not yet
  -- consumed by the live search path.
  add column supports_location boolean not null default true,
  add column supports_dates boolean not null default false,
  add column supports_price boolean not null default false,
  add column supports_guests boolean not null default false,
  add column contact_capability public.search_contact_capability;

-- Backfill access_strategy from the existing processing_type so every row leaves this migration
-- with a value — 'HTML'/'HYBRID' both land on WEB_PARSER (Арх's ladder splits API-search-URL vs.
-- raw HTML parsing where the old model didn't). SEARCH_URL and GRAPHQL are new rungs with no legacy
-- equivalent; never inferred; only ever an explicit admin choice on a source that has one.
update public.search_sources set access_strategy = case processing_type::text
  when 'API' then 'API'
  when 'STRUCTURED_DATA' then 'STRUCTURED_DATA'
  when 'AI_EXTRACTION' then 'AI_EXTRACTION'
  when 'HTML' then 'WEB_PARSER'
  when 'HYBRID' then 'WEB_PARSER'
end::public.search_access_strategy;

alter table public.search_sources alter column access_strategy set not null;

-- Every source already searchable today can, by definition, `can_search` and act on a location
-- (the generic/brilions providers both require one) — preserve current behavior for existing rows.
-- `can_details`/`can_availability`/`can_pricing`/`can_contact` stay false for everything: Э4's
-- `VesselSourceAdapter.getDetails`/`checkAvailability` don't exist yet, so claiming a source can do
-- them would be a capability nothing currently honours.
update public.search_sources set can_search = true, supports_location = true;

-- Source Coverage (Арх §9) --------------------------------------------------------------------
-- One-to-many: a source can cover more than one distinct region ("Croatia" and "Montenegro", say).
-- The orchestrator (`coverage.ts`'s `sourceCovers`) asks this *before* consulting a source at all —
-- a source covering only the Baltic must never be spent crawl budget on for a query naming Greece.

create table public.search_source_coverage (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.search_sources (id) on delete cascade,
  -- True bypasses every other column on this row — a worldwide charter marketplace (vs. a single
  -- regional operator) legitimately has nothing more specific to state.
  worldwide boolean not null default false,
  country text,
  region text,
  -- City/marina-level free text (Арх §9's "destination") — matched the same normalized way
  -- `text.ts`'s `normalizeForMatch` compares everything else in this pipeline.
  destination text,
  latitude double precision,
  longitude double precision,
  radius_km numeric(8, 2),
  created_at timestamptz not null default now(),
  constraint search_source_coverage_lat_range check (latitude is null or (latitude between -90 and 90)),
  constraint search_source_coverage_lng_range check (longitude is null or (longitude between -180 and 180)),
  constraint search_source_coverage_radius_positive check (radius_km is null or radius_km > 0),
  -- A row must say *something*: worldwide, a named place, or a geo-circle — an all-null row would
  -- silently make `sourceCovers` treat "nothing configured" as "everywhere", which is exactly the
  -- ambiguity the coverage table exists to remove.
  constraint search_source_coverage_states_something check (
    worldwide
    or country is not null
    or region is not null
    or destination is not null
    or (latitude is not null and longitude is not null and radius_km is not null)
  )
);

create index search_source_coverage_source_idx on public.search_source_coverage (source_id);

-- Source Policies (Арх §24) --------------------------------------------------------------------
-- One row per source, all-jsonb: each policy's shape is still settling (rate-limit windows, TTL
-- units, attribution copy) and nothing outside the admin form + a future consumer (Э5's indexer,
-- Э7's cache-policy-driven TTLs, Э8's rate limiter) reads inside these blobs yet. A structured
-- table per policy is the natural follow-up once a second consumer needs to query into one instead
-- of just round-tripping it whole — premature now, with exactly one reader (the admin form itself).

create table public.search_source_policies (
  source_id uuid primary key references public.search_sources (id) on delete cascade,
  -- robots-respecting by construction, ToS acknowledgement, whether auth would be required (never
  -- to be bypassed if so) — Арх §24 is explicit this is filled in by a human, never inferred.
  access_policy jsonb not null default '{}'::jsonb,
  -- Separate TTLs for price/availability/metadata (Арх §22) — the single blunt cache freshness this
  -- pipeline has today (`search_page_cache`'s conditional-GET TTL) doesn't distinguish these.
  cache_policy jsonb not null default '{}'::jsonb,
  -- Required attribution text/link, if the source's terms demand more than the existing
  -- "source: domain, retrieved at" the UI already always shows.
  attribution_policy jsonb not null default '{}'::jsonb,
  rate_limit_policy jsonb not null default '{}'::jsonb,
  retention_policy jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create trigger search_source_policies_set_updated_at
  before update on public.search_source_policies
  for each row execute function public.set_updated_at();

-- search_runs: coverage-prefilter visibility ---------------------------------------------------
-- Э3's own "Готово когда": a source excluded by coverage must be *visible* as excluded, not just
-- silently absent from `sources_visited` (which only ever counted sources actually consulted).
alter table public.search_runs
  add column sources_skipped_by_coverage integer not null default 0;

-- RLS -------------------------------------------------------------------------------------------
-- Same reasoning as search_sources_public_read: coverage is public website metadata (which regions
-- a site serves), read by the live search path with the caller's own client, so it needs the same
-- public-when-active-and-enabled policy. Policies are operational/admin detail with exactly one
-- reader (the admin form) today — no live search path consumes them yet — so admin-only is correct
-- until Э5/Э7/Э8 give them a server-side reader that also needs this at request time.

alter table public.search_source_coverage enable row level security;
alter table public.search_source_policies enable row level security;

create policy "search_source_coverage_public_read" on public.search_source_coverage
  for select
  using (
    exists (
      select 1 from public.search_sources s
      where s.id = search_source_coverage.source_id
        and ((s.status = 'active' and s.enabled) or public.is_admin())
    )
  );

create policy "search_source_coverage_admin_write" on public.search_source_coverage
  for all using (public.is_admin()) with check (public.is_admin());

create policy "search_source_policies_admin_all" on public.search_source_policies
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.search_source_coverage to anon, authenticated;
grant select, insert, update, delete on public.search_source_coverage to service_role;
grant select, insert, update, delete on public.search_source_policies to service_role;
