-- Э5 (docs/AI_Federated_Search_Migration_Plan_v1.md §6): External Vessel Index — the table a
-- background indexer fills, replacing live-crawl-per-request with select-by-index (Арх §12, §13).
--
-- `search_extracted_listings` (P1/P2's "opportunistic cache written by live search") becomes this
-- table via `alter table ... rename`, not a drop+recreate: every existing row, its `id` (which
-- `search_field_conflicts.listing_id` already points to), and the live P1/P2/P3 write/read path all
-- keep working unchanged — the FK never needs repointing, and `registry/extracted-listings.ts`/
-- `registry/listing-index.ts` only need their `.from(...)` table-name string updated (see that
-- commit). `url` is deliberately NOT renamed to the plan's own `source_url` — every existing
-- `.eq("url", ...)`/`.select("...url...")` call site (admin conflict resolution included) would need
-- touching for a purely cosmetic gain; the column still means exactly what the plan calls
-- `source_url`.
--
-- `price_minor`/`guests` (not `price_from_minor`/`capacity`) are kept for the same reason — nothing
-- in this codebase produces a price *range* or a capacity distinct from guest count yet, so renaming
-- would only cost every dependent file a touch for a name the data doesn't yet justify.
-- `price_to_minor` is added alongside `price_minor` for whenever a source-provided range shows up.

create type public.price_unit as enum ('HOUR', 'DAY', 'WEEK', 'MONTH', 'TRIP');

alter table public.search_extracted_listings rename to external_vessel_index;

alter table public.external_vessel_index
  -- The source's own identifier for this offer (Арх §11's `externalId`) — no source this project
  -- talks to exposes one distinct from its own listing URL yet, so this defaults to `url` for every
  -- pre-Э5 row and every row the indexer writes today. A source with a real native ID can populate
  -- this properly without a schema change once one exists.
  add column external_id text,
  add column vessel_type public.vessel_type,
  add column manufacturer text,
  add column model text,
  add column year integer,
  add column length_meters numeric,
  add column region text,
  add column marina text,
  add column latitude double precision,
  add column longitude double precision,
  add column price_to_minor integer,
  add column price_unit public.price_unit,
  add column available_from date,
  add column available_to date,
  add column images jsonb not null default '[]'::jsonb,
  add column amenities text[] not null default '{}',
  -- Full `UniversalVesselOffer` snapshot (Арх §12), indexer-written only — deliberately separate
  -- from the pre-existing flat `field_provenance` column above, which P1/P2's live path still owns
  -- and writes in its own (different, per-field-map) shape. Two shapes in two columns, not one
  -- column with two conventions.
  add column extracted jsonb not null default '{}'::jsonb,
  add column content_hash text,
  add column indexed_at timestamptz,
  add column last_checked_at timestamptz,
  -- "Gone from the source" tracking (Э5's own retention note): bumped only when a run actually still
  -- finds this URL among `search_source_urls where selected` — never touched for a row the indexer
  -- didn't see this pass, so age-since-last-seen is a real signal, not reset by an unrelated update.
  add column last_seen_at timestamptz;

update public.external_vessel_index
set
  external_id = coalesce(external_id, url),
  indexed_at = coalesce(indexed_at, last_extracted_at),
  last_checked_at = coalesce(last_checked_at, last_extracted_at),
  last_seen_at = coalesce(last_seen_at, last_extracted_at)
where external_id is null or indexed_at is null;

alter table public.external_vessel_index
  alter column external_id set not null,
  alter column indexed_at set not null,
  alter column last_checked_at set not null,
  alter column last_seen_at set not null;

alter table public.external_vessel_index
  add constraint external_vessel_index_source_external_unique unique (source_id, external_id);

-- Indexes for Арх §13's strict search-time filters. Geo is a plain (latitude, longitude) btree, not
-- PostGIS (plan §8 п.4's already-made call) — `boundingBox` (`lib/search/geo.ts`) narrows a range
-- query on these two columns before `isWithinRadiusKm` does the exact circle check in application
-- code.
create index external_vessel_index_country_city_idx on public.external_vessel_index (country, city);
create index external_vessel_index_vessel_type_idx on public.external_vessel_index (vessel_type);
create index external_vessel_index_guests_idx on public.external_vessel_index (guests);
create index external_vessel_index_price_idx on public.external_vessel_index (price_minor);
create index external_vessel_index_last_seen_idx on public.external_vessel_index (last_seen_at);
create index external_vessel_index_geo_idx on public.external_vessel_index (latitude, longitude);

alter policy "search_extracted_listings_admin_read" on public.external_vessel_index
  rename to "external_vessel_index_admin_read";

-- Persistent extraction cache (Э5) --------------------------------------------------------------
-- `providers/generic/provider.ts`'s `classifyCached` has kept an in-memory `Map` since it was
-- written — real within one request, gone the next (`src/server/search/README.md`'s own "не
-- реализован" note on this exact gap). Keyed by content hash so identical HTML — the same page
-- re-fetched, or byte-identical boilerplate across two listings — never re-pays for a second AI call,
-- independent of which URL or source it came from.
create table public.search_extraction_cache (
  content_hash text primary key,
  classification jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.search_extraction_cache enable row level security;

create policy "search_extraction_cache_admin_read" on public.search_extraction_cache
  for select using (public.is_admin());

grant select, insert, update, delete on public.search_extraction_cache to service_role;
