-- Manual "Resume"/"Stop" controls for the admin reindex flow (see reindex_progress migration's own
-- doc comment on why "running" stays derived, not stored) — cancellation needs one genuinely new
-- signal, since a click on "Stop" is a separate HTTP request from the already-running crawl loop and
-- the only channel between them is this table.
alter table public.search_sources
  add column reindex_cancel_requested boolean not null default false;
