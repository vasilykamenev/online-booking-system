-- Recent Supabase defaults no longer auto-expose new public-schema tables to
-- the Data API roles (see [api] auto_expose_new_tables in config.toml). RLS
-- policies only filter rows; the roles also need the underlying GRANTs, or
-- PostgREST fails with 42501 before RLS is even evaluated.
--
-- GRANT stays intentionally coarse here — row-level access control is what
-- every policy in the preceding migrations already enforces.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete
  on all tables in schema public
  to authenticated;

grant select on all tables in schema public to anon;

grant usage, select on all sequences in schema public to anon, authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
  grant select on tables to anon;
