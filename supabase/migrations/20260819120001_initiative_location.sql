-- Optional link into the same locations dictionary vessels use, so an
-- initiative's venue can pull a curated, admin-vetted point instead of relying
-- solely on a free-hand map click or best-effort reverse geocoding. `locations`
-- already supports a marina-less entry (see Antarctica in seed.sql), so it's a
-- reasonable fit for non-marina venues too — nullable because most initiatives
-- won't match any existing entry, and region stays free text either way.
alter table public.initiatives
  add column location_id uuid references public.locations (id) on delete set null;

create index initiatives_location_idx on public.initiatives (location_id);
