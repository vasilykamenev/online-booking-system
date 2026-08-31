-- Global "how long a single reindex run is allowed to go before gracefully stopping itself" knob —
-- distinct from Vercel's own `maxDuration` (a hard platform ceiling, fixed at deploy time, see
-- `urls/page.tsx`'s own doc comment — genuinely not runtime-configurable). This setting lets an admin
-- tune a *soft*, self-imposed budget the indexer's own batch loop checks (same place it already
-- checks `reindex_cancel_requested`), so a long run stops itself cleanly — resumable, exactly like a
-- manual Stop — before Vercel's hard 300s cutoff would kill it mid-batch instead. The upper bound
-- (280) is deliberately below that 300s ceiling, so the soft stop always fires first.
alter table public.platform_settings
  add column reindex_max_duration_seconds integer not null default 250,
  add constraint platform_settings_reindex_max_duration_range
    check (reindex_max_duration_seconds >= 30 and reindex_max_duration_seconds <= 280);
