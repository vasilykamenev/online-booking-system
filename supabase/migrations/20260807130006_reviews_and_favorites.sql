create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  vessel_id uuid not null references public.vessels (id) on delete cascade,
  client_id uuid not null references public.profiles (id),
  rating integer not null,
  comment text,
  created_at timestamptz not null default now(),
  constraint reviews_rating_range check (rating between 1 and 5)
);

create index reviews_vessel_idx on public.reviews (vessel_id);

create function public.refresh_vessel_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_vessel_id uuid := coalesce(new.vessel_id, old.vessel_id);
begin
  update public.vessels
  set
    rating_avg = coalesce((
      select round(avg(rating)::numeric, 1) from public.reviews where vessel_id = target_vessel_id
    ), 0),
    rating_count = (
      select count(*) from public.reviews where vessel_id = target_vessel_id
    )
  where id = target_vessel_id;
  return null;
end;
$$;

create trigger reviews_refresh_vessel_rating
  after insert or update or delete on public.reviews
  for each row execute function public.refresh_vessel_rating();

create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  vessel_id uuid not null references public.vessels (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profile_id, vessel_id)
);

create index favorites_profile_idx on public.favorites (profile_id);

-- RLS -----------------------------------------------------------------

alter table public.reviews enable row level security;
alter table public.favorites enable row level security;

create policy "reviews_public_read" on public.reviews
  for select
  using (true);

-- A review may only be left by the client on their own completed booking.
create policy "reviews_client_insert" on public.reviews
  for insert
  with check (
    client_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      where b.id = reviews.booking_id
        and b.client_id = auth.uid()
        and b.status = 'completed'
    )
  );

create policy "reviews_client_update" on public.reviews
  for update
  using (client_id = auth.uid() or public.is_admin())
  with check (client_id = auth.uid() or public.is_admin());

create policy "reviews_client_delete" on public.reviews
  for delete
  using (client_id = auth.uid() or public.is_admin());

create policy "favorites_owner_all" on public.favorites
  for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
