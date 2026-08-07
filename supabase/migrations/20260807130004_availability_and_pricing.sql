-- Owner-declared blackout periods (maintenance, personal use, etc.).
-- Booked date ranges are tracked separately on public.bookings; a vessel's
-- true availability is "not blocked here AND not booked there".
create table public.availability (
  id uuid primary key default gen_random_uuid(),
  vessel_id uuid not null references public.vessels (id) on delete cascade,
  date_range daterange not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint availability_no_overlap
    exclude using gist (vessel_id with =, date_range with &&)
);

create index availability_vessel_idx on public.availability (vessel_id);

create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  vessel_id uuid not null references public.vessels (id) on delete cascade,
  label text not null,
  date_range daterange not null,
  price_minor integer not null,
  currency text not null default 'USD',
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_rules_price_positive check (price_minor >= 0)
);

create trigger pricing_rules_set_updated_at
  before update on public.pricing_rules
  for each row execute function public.set_updated_at();

create index pricing_rules_vessel_idx on public.pricing_rules (vessel_id, date_range);

-- RLS -----------------------------------------------------------------

alter table public.availability enable row level security;
alter table public.pricing_rules enable row level security;

create policy "availability_read" on public.availability
  for select
  using (
    exists (
      select 1 from public.vessels v
      where v.id = availability.vessel_id
        and (v.status = 'published' or v.owner_id = auth.uid() or public.is_admin())
    )
  );

create policy "availability_owner_write" on public.availability
  for all
  using (
    exists (
      select 1 from public.vessels v
      where v.id = availability.vessel_id
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.vessels v
      where v.id = availability.vessel_id
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  );

create policy "pricing_rules_read" on public.pricing_rules
  for select
  using (
    exists (
      select 1 from public.vessels v
      where v.id = pricing_rules.vessel_id
        and (v.status = 'published' or v.owner_id = auth.uid() or public.is_admin())
    )
  );

create policy "pricing_rules_owner_write" on public.pricing_rules
  for all
  using (
    exists (
      select 1 from public.vessels v
      where v.id = pricing_rules.vessel_id
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.vessels v
      where v.id = pricing_rules.vessel_id
        and (v.owner_id = auth.uid() or public.is_admin())
    )
  );
