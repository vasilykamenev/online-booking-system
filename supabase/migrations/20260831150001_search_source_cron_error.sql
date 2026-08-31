-- Surfaces a genuine reject inside `indexSource` during a cron run (not a clean stop by deadline or
-- manual Stop — those aren't errors) as a visible admin-UI badge, since the cron route's own
-- Promise.allSettled error branch previously only ended up in a JSON response nobody but Vercel's own
-- cron invocation log ever saw. Nullable, no default: absent until the first reject, cleared again on
-- the next run that completes without throwing (`clearCronError`).
alter table public.search_sources
  add column last_cron_error text,
  add column last_cron_error_at timestamptz;
