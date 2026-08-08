-- `service_role` bypasses RLS but — like `anon`/`authenticated` in
-- 20260807130010_grants.sql — still needs the underlying table GRANTs, or
-- PostgREST/postgres-js fails with 42501 before RLS is even reached. This was
-- never needed until the payments feature: `payments` has intentionally no
-- insert/update policy for any authenticated role (written server-side only,
-- via the Stripe webhook or a manual-transfer confirmation using the
-- service-role client) — so those code paths were unusable without this grant.

grant usage on schema public to service_role;

grant select, insert, update, delete
  on all tables in schema public
  to service_role;

grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
