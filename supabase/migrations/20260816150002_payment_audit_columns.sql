-- Every payment attempt (success or failure) must trace to both the payer and
-- the payee even if the booking/vessel rows are joined away later — denormalize
-- both ids directly onto `payments`, which already accumulates one row per
-- attempt (never overwritten), so the table itself doubles as the audit trail.
alter table public.payments
  add column payer_id uuid references public.profiles (id),
  add column payee_id uuid references public.profiles (id),
  add column failure_code text,
  add column failure_reason text;

update public.payments p
set payer_id = b.client_id,
    payee_id = v.owner_id
from public.bookings b
join public.vessels v on v.id = b.vessel_id
where b.id = p.booking_id
  and p.payer_id is null;

alter table public.payments
  alter column payer_id set not null,
  alter column payee_id set not null;

create index payments_payer_idx on public.payments (payer_id);
create index payments_payee_idx on public.payments (payee_id);

-- Owner can only move a booking pending -> confirmed once the client has
-- declared a payment method (bookings.payment_method) — confirming now means
-- accepting both the dates and the payment method in one step.
create or replace function public.protect_booking_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_owner boolean;
begin
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
    if old.status = 'pending' and new.status = 'confirmed' then
      if old.payment_method is null then
        raise exception 'bookings: cannot confirm before the client declares a payment method';
      end if;
      return new;
    end if;
    if old.status in ('pending', 'confirmed') and new.status = 'cancelled' then
      return new;
    end if;
    raise exception 'bookings: owner may only confirm a pending booking or cancel it';
  end if;

  raise exception 'bookings: not authorized to change this booking';
end;
$$;
