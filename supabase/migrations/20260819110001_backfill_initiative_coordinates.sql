-- Initiatives have no location dictionary to fall back to (unlike vessels),
-- so a map only ever shows when the author drops a pin at creation time
-- (see 20260817120001_geo_coordinates.sql). None of the seeded initiatives
-- had one set, so the detail page's map/active-link never showed for any of
-- them. Backfill a representative point per initiative from its description.
update public.initiatives set latitude = 78.22320, longitude = 15.62670
  where id = '50000000-0000-0000-0000-000000000001'; -- Svalbard polar expedition (Longyearbyen)
update public.initiatives set latitude = 4.17550, longitude = 73.50930
  where id = '50000000-0000-0000-0000-000000000002'; -- Coral reef monitoring (Malé, Maldives)
update public.initiatives set latitude = 36.14080, longitude = -5.35360
  where id = '50000000-0000-0000-0000-000000000003'; -- Transatlantic crossing (departs Gibraltar)
