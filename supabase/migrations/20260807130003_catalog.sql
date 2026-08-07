-- Locations: a growing reference table, never a hardcoded list in components (CLAUDE.md §9).
-- country/city/marina are {locale: label} maps (e.g. {"ru": "Хорватия", "en": "Croatia"})
-- so new languages are added as data, not new columns or component code.
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  country jsonb not null,
  city jsonb not null,
  marina jsonb,
  latitude numeric(8, 5),
  longitude numeric(8, 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

create index locations_country_city_idx on public.locations using gin (country, city);

-- Amenities: a slug-keyed reference table. Labels are translated client-side
-- via next-intl (messages.vessels.amenities.<key>), never hardcoded in JSX.
create table public.amenities (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  created_at timestamptz not null default now()
);

create table public.vessels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  location_id uuid not null references public.locations (id),
  type public.vessel_type not null,
  status public.vessel_status not null default 'draft',
  name text not null,
  slug text not null unique,
  description text not null default '',
  length_meters numeric(5, 1) not null,
  cabins integer not null default 0,
  guests_capacity integer not null,
  year_built integer,
  base_price_minor integer not null,
  currency text not null default 'USD',
  rating_avg numeric(2, 1) not null default 0,
  rating_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vessels_capacity_positive check (guests_capacity > 0),
  constraint vessels_price_positive check (base_price_minor >= 0)
);

create trigger vessels_set_updated_at
  before update on public.vessels
  for each row execute function public.set_updated_at();

create index vessels_status_idx on public.vessels (status);
create index vessels_location_idx on public.vessels (location_id);
create index vessels_type_idx on public.vessels (type);
create index vessels_owner_idx on public.vessels (owner_id);

create table public.vessel_images (
  id uuid primary key default gen_random_uuid(),
  vessel_id uuid not null references public.vessels (id) on delete cascade,
  url text not null,
  -- {locale: label}, same convention as public.locations.
  alt_text jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index vessel_images_vessel_idx on public.vessel_images (vessel_id, sort_order);

create table public.vessel_amenities (
  vessel_id uuid not null references public.vessels (id) on delete cascade,
  amenity_id uuid not null references public.amenities (id) on delete cascade,
  primary key (vessel_id, amenity_id)
);

-- RLS -----------------------------------------------------------------

alter table public.locations enable row level security;
alter table public.amenities enable row level security;
alter table public.vessels enable row level security;
alter table public.vessel_images enable row level security;
alter table public.vessel_amenities enable row level security;

create policy "locations_public_read" on public.locations
  for select
  using (true);

create policy "locations_admin_write" on public.locations
  for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "amenities_public_read" on public.amenities
  for select
  using (true);

create policy "amenities_admin_write" on public.amenities
  for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "vessels_public_read_published" on public.vessels
  for select
  using (status = 'published' or owner_id = auth.uid() or public.is_admin());

create policy "vessels_owner_insert" on public.vessels
  for insert
  with check (owner_id = auth.uid());

create policy "vessels_owner_update" on public.vessels
  for update
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

create policy "vessels_owner_delete" on public.vessels
  for delete
  using (owner_id = auth.uid() or public.is_admin());

create policy "vessel_images_read" on public.vessel_images
  for select
  using (
    exists (
      select 1 from public.vessels v
      where v.id = vessel_images.vessel_id
        and (v.status = 'published' or v.owner_id = auth.uid() or public.is_admin())
    )
  );

create policy "vessel_images_owner_write" on public.vessel_images
  for all
  using (
    exists (
      select 1 from public.vessels v
      where v.id = vessel_images.vessel_id
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.vessels v
      where v.id = vessel_images.vessel_id
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  );

create policy "vessel_amenities_read" on public.vessel_amenities
  for select
  using (
    exists (
      select 1 from public.vessels v
      where v.id = vessel_amenities.vessel_id
        and (v.status = 'published' or v.owner_id = auth.uid() or public.is_admin())
    )
  );

create policy "vessel_amenities_owner_write" on public.vessel_amenities
  for all
  using (
    exists (
      select 1 from public.vessels v
      where v.id = vessel_amenities.vessel_id
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.vessels v
      where v.id = vessel_amenities.vessel_id
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  );
