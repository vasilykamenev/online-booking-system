-- bookings_update (20260807130005) only checks row ownership, not which
-- columns change or which status transitions are valid — a client or owner
-- could PATCH price_minor/currency/date_range directly via the Data API, or
-- set status to 'paid'/'completed' themselves, bypassing the Stripe webhook
-- (CLAUDE.md §8) and the "price fixed at booking time" invariant (CLAUDE.md §6.2).
-- Postgres RLS has no column-level grain for `for update`, so this is enforced
-- with a trigger instead, following the protect_profile_role pattern.
create function public.protect_booking_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_owner boolean;
begin
  -- service_role (Stripe webhook, manual-transfer confirmation) and admins
  -- are the only callers trusted to set any field to any value.
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if new.vessel_id <> old.vessel_id
    or new.client_id <> old.client_id
    or new.date_range <> old.date_range
    or new.guests_count <> old.guests_count
    or new.price_minor <> old.price_minor
    or new.currency <> old.currency
  then
    raise exception 'bookings: only status may be changed directly';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if old.client_id = auth.uid() then
    if not (old.status in ('pending', 'confirmed') and new.status = 'cancelled') then
      raise exception 'bookings: client may only cancel a pending or confirmed booking';
    end if;
    return new;
  end if;

  is_owner := exists (
    select 1 from public.vessels v where v.id = old.vessel_id and v.owner_id = auth.uid()
  );
  if is_owner then
    if not (
      (old.status = 'pending' and new.status = 'confirmed')
      or (old.status in ('pending', 'confirmed') and new.status = 'cancelled')
    ) then
      raise exception 'bookings: owner may only confirm a pending booking or cancel it';
    end if;
    return new;
  end if;

  raise exception 'bookings: not authorized to change this booking';
end;
$$;

create trigger bookings_protect_mutation
  before update on public.bookings
  for each row execute function public.protect_booking_mutation();
