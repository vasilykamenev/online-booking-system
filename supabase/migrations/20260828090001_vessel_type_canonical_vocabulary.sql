-- Э1 (docs/AI_Federated_Search_Migration_Plan_v1.md §6): canonical vessel-type vocabulary
-- (Арх §7). Replaces the 5-value platform enum with the 9-value canonical list from the
-- architecture doc, extended with RESEARCH_VESSEL — BRD §5 treats research vessels as a
-- distinct product, and the base Арх list would otherwise collapse them into EXPEDITION_YACHT
-- (see plan §8 open question 2; this migration takes the plan's own recommendation).
--
-- SCREAMING_SNAKE_CASE is a deliberate break from this schema's usual lowercase enum values
-- (user_role, vessel_status, ...): this vocabulary is shared verbatim with external sources and
-- an LLM query parser (Арх §5, §7, §11), not just an internal UI label, and Арх's own examples
-- ("SAILING_YACHT") use this casing throughout.
--
-- price_unit is intentionally NOT introduced here even though the plan mentions it alongside
-- vessel_type: nothing in the schema would consume it yet (`vessels` has no per-unit pricing
-- column, only `base_price_minor` implicitly per day). It gets created together with whatever
-- column first needs it (Э2 request/offer model or Э5's external_vessel_index).

-- 1. Recreate the enum ------------------------------------------------------

alter type public.vessel_type rename to vessel_type_old;

create type public.vessel_type as enum (
  'MOTOR_YACHT',
  'SAILING_YACHT',
  'CATAMARAN',
  'TRIMARAN',
  'SUPERYACHT',
  'EXPEDITION_YACHT',
  'RESEARCH_VESSEL',
  'MOTOR_BOAT',
  'SAILING_BOAT',
  'OTHER'
);

alter table public.vessels add column type_new public.vessel_type;

-- Old → new mapping. Necessarily lossy in one direction only: 'research' now keeps its own
-- identity instead of folding into 'expedition' (see header comment), every other value maps
-- 1:1. Existing seed rows are the only data this touches locally.
update public.vessels
set type_new = case type::text
  when 'yacht' then 'MOTOR_YACHT'
  when 'catamaran' then 'CATAMARAN'
  when 'expedition' then 'EXPEDITION_YACHT'
  when 'research' then 'RESEARCH_VESSEL'
  when 'hybrid' then 'OTHER'
end::public.vessel_type;

alter table public.vessels drop column type;
alter table public.vessels rename column type_new to type;
alter table public.vessels alter column type set not null;

drop type public.vessel_type_old;

-- 2. Synonym dictionary (Арх §7: "Sailboat/Sailing/Sailing Yacht → SAILING_YACHT") -----------
--
-- Data, not code (CLAUDE.md §9) — `normalizeVesselType` (src/lib/search/vocabulary/vessel-types.ts)
-- takes this as a plain argument, so a new source's wording is a row here, never a code change.
-- `source_id null` = applies to every source; a row scoped to one source overrides/extends the
-- global list for that source only. Deliberately no aliases seeded for OTHER — it is never an
-- inferred value, only ever an explicit admin choice (same "absent beats invented" rule as
-- everywhere else in the search pipeline).

create table public.vessel_type_aliases (
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  vessel_type public.vessel_type not null,
  source_id uuid references public.search_sources (id) on delete cascade,
  -- 0.0-1.0, mirrors `FieldProvenance.confidence`; 1.0 for a hand-curated synonym like the seed
  -- rows below, lower for anything a future source-onboarding step (Э10) proposes automatically.
  confidence numeric(3, 2) not null default 1.0 check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger vessel_type_aliases_set_updated_at
  before update on public.vessel_type_aliases
  for each row execute function public.set_updated_at();

-- Case-insensitive uniqueness, scoped separately for the global list and per-source overrides
-- (a plain `unique (source_id, alias)` wouldn't dedupe two global rows since NULL <> NULL).
create unique index vessel_type_aliases_global_alias_uidx
  on public.vessel_type_aliases (lower(alias))
  where source_id is null;
create unique index vessel_type_aliases_source_alias_uidx
  on public.vessel_type_aliases (source_id, lower(alias))
  where source_id is not null;

create index vessel_type_aliases_vessel_type_idx on public.vessel_type_aliases (vessel_type);

alter table public.vessel_type_aliases enable row level security;

create policy "vessel_type_aliases_public_read" on public.vessel_type_aliases
  for select
  using (true);

create policy "vessel_type_aliases_admin_write" on public.vessel_type_aliases
  for all
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.vessel_type_aliases to anon, authenticated;
grant select, insert, update, delete on public.vessel_type_aliases to service_role;

insert into public.vessel_type_aliases (alias, vessel_type) values
  ('motor yacht', 'MOTOR_YACHT'),
  ('motoryacht', 'MOTOR_YACHT'),
  ('моторная яхта', 'MOTOR_YACHT'),
  ('моторные яхты', 'MOTOR_YACHT'),
  ('gulet', 'MOTOR_YACHT'),
  ('гулет', 'MOTOR_YACHT'),

  ('sailing yacht', 'SAILING_YACHT'),
  ('sailing', 'SAILING_YACHT'),
  ('sailboat', 'SAILING_YACHT'),
  ('парусная яхта', 'SAILING_YACHT'),
  ('парусник', 'SAILING_YACHT'),

  ('catamaran', 'CATAMARAN'),
  ('катамаран', 'CATAMARAN'),

  ('trimaran', 'TRIMARAN'),
  ('тримаран', 'TRIMARAN'),

  ('superyacht', 'SUPERYACHT'),
  ('super yacht', 'SUPERYACHT'),
  ('суперъяхта', 'SUPERYACHT'),

  ('expedition yacht', 'EXPEDITION_YACHT'),
  ('expedition vessel', 'EXPEDITION_YACHT'),
  ('экспедиционное судно', 'EXPEDITION_YACHT'),
  ('экспедиционная яхта', 'EXPEDITION_YACHT'),

  ('research vessel', 'RESEARCH_VESSEL'),
  ('исследовательское судно', 'RESEARCH_VESSEL'),
  ('научное судно', 'RESEARCH_VESSEL'),

  ('motor boat', 'MOTOR_BOAT'),
  ('motorboat', 'MOTOR_BOAT'),
  ('speedboat', 'MOTOR_BOAT'),
  ('катер', 'MOTOR_BOAT'),
  ('моторный катер', 'MOTOR_BOAT'),
  ('моторная лодка', 'MOTOR_BOAT'),

  ('sailing boat', 'SAILING_BOAT'),
  ('парусная лодка', 'SAILING_BOAT'),
  ('парусный катер', 'SAILING_BOAT');
