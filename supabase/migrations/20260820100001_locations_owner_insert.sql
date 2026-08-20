-- Vessel registration lets an owner type a brand-new location (not yet in the
-- admin-curated catalog) and drop a pin for it; the server geocodes the pin and
-- inserts a new public.locations row before attaching it to the vessel. Owners
-- may only INSERT new catalog entries this way — editing or deleting existing
-- rows stays admin-only via the existing locations_admin_write policy.
create policy "locations_owner_insert" on public.locations
  for insert
  to authenticated
  with check (true);
