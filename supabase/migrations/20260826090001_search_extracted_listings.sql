-- Data Merger + per-field provenance/conflict persistence (docs/SEO_Web_Discovery_JSON_LD_Project_Rules.md
-- §24-27, docs/data-merger-provenance-design.md §3). Phases P1+P2 of that design: this migration adds the
-- storage the live extraction cascade (`providers/generic/provider.ts`) writes to *in addition to* its
-- existing ephemeral per-request path — live search still reads nothing from these tables (P3, not this
-- migration).
--
-- Why a separate model from `search_source_urls`: that table tracks *crawl* state for a URL (fetched?,
-- when, what HTTP status) — it was never meant to hold the *extracted business fields* themselves, and
-- doing so would conflate "did we visit this page" with "what does this page say", which is exactly the
-- distinction the rules document's "Промежуточная модель" (§24) draws between crawl bookkeeping and the
-- normalized domain candidate.

create type public.search_field_source as enum ('SELECTOR', 'JSON_LD', 'AI', 'MANUAL');

-- One row per (source, url) — the "last known best" normalized state of a listing, independent of any
-- single search request. `field_provenance` carries source/confidence/retrievedAt/sourceUrl per field,
-- keyed by field name (same jsonb-map shape as `VesselSearchResult.fieldProvenance` in
-- src/lib/search/result.ts, just persistent and — unlike that ephemeral convention — populated for every
-- field, deterministic or not, since comparing confidence across time requires every field to start with
-- one; see docs/data-merger-provenance-design.md §3.4).
create table public.search_extracted_listings (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.search_sources (id) on delete cascade,
  url text not null,

  name text,
  description text,
  price_minor integer,
  currency text,
  guests integer,
  cabins integer,
  vessel_type_raw text,
  country text,
  city text,

  field_provenance jsonb not null default '{}',

  last_extracted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, url)
);

create trigger search_extracted_listings_set_updated_at
  before update on public.search_extracted_listings
  for each row execute function public.set_updated_at();

create index search_extracted_listings_source_idx on public.search_extracted_listings (source_id);

-- Conflict log (rules doc §27: "не должна молча выбирать одно значение"). A conflict is never
-- auto-resolved in favor of either value at write time — `resolved_at`/`resolution` are set later, either
-- by a second extraction confirming the new value (`resolution = 'kept_new'`, written by the same merge
-- logic that detected the conflict) or by an admin (`resolution = 'manual'`).
create table public.search_field_conflicts (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.search_extracted_listings (id) on delete cascade,
  field text not null,
  previous_value jsonb not null,
  new_value jsonb not null,
  previous_source public.search_field_source not null,
  new_source public.search_field_source not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);

create index search_field_conflicts_listing_idx on public.search_field_conflicts (listing_id);
-- The merge logic's hot-path lookup is "open conflicts for this listing" (docs/data-merger-provenance-design.md
-- §3.2's "confirmed on next occurrence?" check) — partial index keeps that cheap as the log grows, since
-- resolved rows (the majority over time) never need to be scanned for it.
create index search_field_conflicts_open_idx on public.search_field_conflicts (listing_id) where resolved_at is null;

-- RLS -------------------------------------------------------------------------------------------------
-- Same reasoning as search_page_cache: this is normalized *third-party* data, not user data, and no
-- client role has any business reading or writing it directly. Unlike search_source_urls (which anon
-- search traffic reads directly for `selected` candidates), nothing here is read by live search yet
-- (P3 in the design doc) — admin-only read is the correct default until that changes, and the
-- generic-provider write path already runs with the service-role client (same as `recordFetchOutcome`).

alter table public.search_extracted_listings enable row level security;
alter table public.search_field_conflicts enable row level security;

create policy "search_extracted_listings_admin_read" on public.search_extracted_listings
  for select using (public.is_admin());

create policy "search_field_conflicts_admin_read" on public.search_field_conflicts
  for select using (public.is_admin());

grant select, insert, update, delete on public.search_extracted_listings to service_role;
grant select, insert, update, delete on public.search_field_conflicts to service_role;
-- Admin UI resolves conflicts (accept/dismiss) through a Server Action running with the caller's own
-- (admin) session, not the service-role client — same pattern as every other admin mutation in this
-- project (CLAUDE.md §7).
grant select on public.search_extracted_listings to authenticated;
grant select, update on public.search_field_conflicts to authenticated;

create policy "search_field_conflicts_admin_resolve" on public.search_field_conflicts
  for update using (public.is_admin()) with check (public.is_admin());
