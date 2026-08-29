-- Э11 (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Арх §17): persistent vessel identity.
-- A vessel found on several external sources currently gets deduplicated fresh on every request
-- (`lib/search/dedupe.ts`'s `dedupeResults`, an O(n²) pairwise pass over whatever's in that one
-- request's small candidate set). Арх §17 wants the identity itself to persist across indexer runs
-- instead — this migration is that persistence layer.
--
-- Deviation from the plan's literal "vessel_identities + vessel_identity_offers": no separate
-- offers/bridge table. The relationship is genuinely 1:N (one `external_vessel_index` row belongs to
-- at most one identity — there is no case where an indexed listing needs to link to *several*
-- identities), so a bridge table would carry no relationship a plain FK on the "many" side can't
-- already express, at the cost of an extra join every read pays for nothing. Same reasoning this
-- codebase already applied to `search_source_coverage` (one row per source, Э3's own migration
-- comment) and to skipping a dedicated join table anywhere else a 1:N would suffice.
--
-- Internal vessels are deliberately out of scope here: `vessels.id` is already a stable, durable
-- identity (Арх §17's whole problem doesn't exist for them), and `dedupe.ts`'s `preferPrimary`
-- already always prefers an internal result as the merge's primary regardless of anything this table
-- tracks. This is purely about giving *external* offers the durable identity `offer.ts`'s own comment
-- on `VesselSearchResult.id` says they don't have yet ("external offers have no durable identity
-- yet") — see `lib/search/offer.ts`'s `vesselIdentityId` field, added alongside this migration.

create type public.vessel_identity_match_method as enum ('SEED', 'DETERMINISTIC', 'AI');

-- A representative snapshot used to match new candidates against (`server/search/identity/
-- vessel-identity.ts`'s `identityToComparable`) — not authoritative display data (each linked
-- `external_vessel_index` row keeps its own full extraction), just enough to score a new offer
-- against without re-reading every already-linked row. Filled gap-only as offers attach (never
-- overwritten once set), the same "own values always win, only fill gaps" discipline
-- `dedupe.ts`'s `mergeResults` already applies to a per-request merge.
create table public.vessel_identities (
  id uuid primary key default gen_random_uuid(),
  canonical_name text,
  vessel_type public.vessel_type,
  manufacturer text,
  model text,
  year integer,
  length_meters numeric,
  city text,
  marina text,
  representative_image text,
  -- Denormalized rather than `count(*)` on `external_vessel_index` — cheap to maintain (one extra
  -- increment on the same row `resolveVesselIdentity` already updates) and avoids a join-and-count
  -- for something as simple as "how many offers make up this identity".
  offer_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Blocking key for `findCandidateIdentities`'s `ilike` prefilter (Арх §17's identity matching is
-- otherwise an O(identities) scan per new offer, which the background indexer runs constantly) —
-- a plain btree still helps `ilike '%token%'` less than a trigram index would, but pg_trgm isn't a
-- dependency this project otherwise needs; revisit if the identity count ever makes this the
-- indexer's bottleneck.
create index vessel_identities_canonical_name_idx on public.vessel_identities (canonical_name);

create trigger vessel_identities_set_updated_at
  before update on public.vessel_identities
  for each row execute function public.set_updated_at();

alter table public.external_vessel_index
  add column vessel_identity_id uuid references public.vessel_identities (id) on delete set null,
  add column identity_match_method public.vessel_identity_match_method,
  add column identity_match_score numeric;

create index external_vessel_index_identity_idx on public.external_vessel_index (vessel_identity_id);

-- RLS ------------------------------------------------------------------------------------------
-- `resolveVesselIdentity` (indexer-only, service-role) is the only writer and the only reader today
-- — `queryIndexCandidates` reads `vessel_identity_id` straight off `external_vessel_index` with its
-- own already-service-role client, never through `vessel_identities` itself. Admin-only read/write
-- until a feature actually needs a caller's-own-client reader at request time, same reasoning
-- `search_source_policies`'s own migration comment already gives for the same shape of table.

alter table public.vessel_identities enable row level security;

create policy "vessel_identities_admin_all" on public.vessel_identities
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.vessel_identities to service_role;
