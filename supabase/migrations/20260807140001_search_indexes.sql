-- Supports the search/filter query (§9 CLAUDE.md: indexes by location, price,
-- type — status/location/type already exist from the catalog migration).
create index vessels_base_price_minor_idx on public.vessels (base_price_minor);
create index vessels_guests_capacity_idx on public.vessels (guests_capacity);

-- Cursor pagination orders by (rating_avg desc, id desc).
create index vessels_rating_id_idx on public.vessels (rating_avg desc, id desc);
