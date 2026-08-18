-- The vessel/initiative detail pages fall back to the location's coordinates
-- when there's no per-record pin (see 20260817120001_geo_coordinates.sql).
-- Every seeded location was missing coordinates except Split, which is why
-- the map only ever showed up there. Backfill real points for the existing
-- rows, then make the columns required so this can't regress: every future
-- location registered via the admin panel must define a point too (the
-- admin form/schema now reject an empty latitude/longitude as well).
update public.locations set latitude = 43.50848, longitude = 16.43965
  where id = '20000000-0000-0000-0000-000000000001'; -- Split, Croatia
update public.locations set latitude = 37.59280, longitude = 26.28360
  where id = '20000000-0000-0000-0000-000000000002'; -- Ikaria, Greece
update public.locations set latitude = -64.82480, longitude = -63.49700
  where id = '20000000-0000-0000-0000-000000000003'; -- Antarctica (Port Lockroy)
update public.locations set latitude = 35.44370, longitude = 139.63800
  where id = '20000000-0000-0000-0000-000000000004'; -- Yokohama, Japan

alter table public.locations
  alter column latitude set not null,
  alter column longitude set not null;
