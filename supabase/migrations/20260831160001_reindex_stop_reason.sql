-- Distinguishes *why* a run stopped between batches: the admin's manual "Остановить" click
-- (`reindex_cancel_requested`) vs. the run's own `reindex_max_duration_seconds` deadline — both call
-- the same terminal write (`cancelReindexProgress`) and were previously indistinguishable in the DB.
-- The admin UI's auto-resume (manual testing's "keep scanning until 100% while the tab is open"
-- request) needs this: it should pick a deadline-stopped run back up on its own, but must never
-- override an admin's explicit Stop.
alter table public.search_sources
  add column last_stop_reason text check (last_stop_reason in ('cancelled', 'deadline'));
