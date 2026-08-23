-- Source registration lifecycle (spec §9: "a source must pass validation/classification before
-- being added to the registry"). `enabled` alone can't express this — it only ever meant "consult
-- this source during search", with no distinction between "brand new, unreviewed" and "reviewed
-- and deliberately paused". `status` adds that distinction; `enabled` keeps its existing meaning as
-- the pause/resume toggle, now only meaningful once status = 'active'.

create type public.search_source_status as enum ('draft', 'needs_review', 'active', 'rejected');

alter table public.search_sources
  add column status public.search_source_status not null default 'draft';

-- Backfill: anything already enabled was, in effect, already "active" under the old one-column
-- model — preserve current search behavior for it. Anything not enabled had no prior signal beyond
-- "not currently searched", which the new model treats as unreviewed (draft) rather than guessing
-- it was a deliberately-paused, already-vetted source.
update public.search_sources set status = 'active' where enabled;

create index search_sources_status_idx on public.search_sources (status);

-- Public read narrows to sources that are both reviewed (active) and switched on — draft/
-- needs_review/rejected rows stay admin-only until they clear review.
drop policy "search_sources_public_read" on public.search_sources;
create policy "search_sources_public_read" on public.search_sources
  for select
  using ((status = 'active' and enabled) or public.is_admin());
