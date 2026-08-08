-- bookings_read RLS only exposes a client's own rows (or the owner's), so the public
-- vessel page can't query public.bookings directly to know which dates are taken.
-- This function exposes only the date ranges of active bookings — nothing else — so
-- anonymous/other-client visitors can see availability without seeing whose booking it is.
create or replace function public.get_vessel_booked_ranges(p_vessel_id uuid)
returns setof daterange
language sql
security definer
set search_path = public
stable
as $$
  select b.date_range
  from public.bookings b
  join public.vessels v on v.id = b.vessel_id
  where b.vessel_id = p_vessel_id
    and b.status <> 'cancelled'
    and (v.status = 'published' or v.owner_id = auth.uid() or public.is_admin());
$$;

grant execute on function public.get_vessel_booked_ranges(uuid) to anon, authenticated;
