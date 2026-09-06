-- Per-source opt-out of manual field-conflict review (admin UI request): when set, a fresh
-- disagreement `listing-merge.ts` detects for this source's listings is accepted immediately
-- (the freshest crawl wins) instead of being logged as an open `search_field_conflicts` row that
-- waits on an admin's "Accept new"/"Keep previous" click. Off by default — same conservative
-- default as `detailed_logging`, since silently overwriting a disputed value is a behavior change
-- an admin should opt into per source, not get for free.
alter table public.search_sources
  add column auto_resolve_conflicts boolean not null default false;
