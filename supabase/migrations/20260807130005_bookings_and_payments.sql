create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  vessel_id uuid not null references public.vessels (id),
  client_id uuid not null references public.profiles (id),
  date_range daterange not null,
  guests_count integer not null,
  status public.booking_status not null default 'pending',
  -- Price is locked in at booking time and never recalculated later (CLAUDE.md §6.2).
  price_minor integer not null,
  currency text not null default 'USD',
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_guests_positive check (guests_count > 0),
  constraint bookings_price_positive check (price_minor >= 0),
  -- Cancelled bookings free up the range; every other status still holds it.
  constraint bookings_no_overlap
    exclude using gist (vessel_id with =, date_range with &&)
    where (status <> 'cancelled')
);

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

create index bookings_vessel_idx on public.bookings (vessel_id);
create index bookings_client_idx on public.bookings (client_id);
create index bookings_status_idx on public.bookings (status);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  provider public.payment_provider not null,
  status public.payment_status not null default 'pending',
  amount_minor integer not null,
  currency text not null default 'USD',
  platform_fee_minor integer not null default 0,
  external_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_amount_positive check (amount_minor >= 0)
);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create index payments_booking_idx on public.payments (booking_id);

-- RLS -----------------------------------------------------------------

alter table public.bookings enable row level security;
alter table public.payments enable row level security;

create policy "bookings_read" on public.bookings
  for select
  using (
    client_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.vessels v
      where v.id = bookings.vessel_id and v.owner_id = auth.uid()
    )
  );

create policy "bookings_client_insert" on public.bookings
  for insert
  with check (client_id = auth.uid());

create policy "bookings_update" on public.bookings
  for update
  using (
    client_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.vessels v
      where v.id = bookings.vessel_id and v.owner_id = auth.uid()
    )
  )
  with check (
    client_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.vessels v
      where v.id = bookings.vessel_id and v.owner_id = auth.uid()
    )
  );

-- Payments are written server-side only (service role, via Stripe webhook
-- or manual-transfer confirmation) — no insert/update policy for end users.
create policy "payments_read" on public.payments
  for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id and b.client_id = auth.uid()
    )
    or exists (
      select 1 from public.bookings b
      join public.vessels v on v.id = b.vessel_id
      where b.id = payments.booking_id and v.owner_id = auth.uid()
    )
  );
