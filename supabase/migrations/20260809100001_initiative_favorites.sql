-- Extends favorites (currently vessel-only) to also cover initiatives (BRD §6:
-- "сохранение интересующих мероприятий в избранное"), instead of a parallel table.
alter table public.favorites
  alter column vessel_id drop not null,
  add column initiative_id uuid references public.initiatives (id) on delete cascade;

alter table public.favorites
  add constraint favorites_target_check check (
    (vessel_id is not null and initiative_id is null)
    or (vessel_id is null and initiative_id is not null)
  );

-- vessel_id already has a table-level unique(profile_id, vessel_id); NULLs there
-- are distinct in Postgres, so it never blocks multiple initiative-only rows.
create unique index favorites_profile_initiative_idx
  on public.favorites (profile_id, initiative_id)
  where initiative_id is not null;

create index favorites_initiative_idx on public.favorites (initiative_id);
