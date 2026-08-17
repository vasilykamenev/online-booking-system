-- Per-vessel/per-initiative coordinates so the geo marker can point at the
-- real spot, not just the shared marina/region reference point.
-- Nullable: vessels fall back to their location's coordinates when unset
-- (owner "refines" the marina's default pin); initiatives have no dictionary
-- to fall back to, so an unset pin simply means no map is shown.
alter table public.vessels
  add column latitude numeric(8, 5),
  add column longitude numeric(8, 5);

alter table public.initiatives
  add column latitude numeric(8, 5),
  add column longitude numeric(8, 5);
