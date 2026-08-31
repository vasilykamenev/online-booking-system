-- Global "how many pages the reindexer processes at once" knob (manual testing's speed-up request)
-- — a single platform-wide setting, not per-source, since it governs how much post-fetch work
-- (extraction, AI classification, DB writes) overlaps, not how politely any one source is crawled
-- (that stays `search_source_policies.rate_limit_policy`, untouched by this).
alter table public.platform_settings
  add column reindex_concurrency integer not null default 3,
  add constraint platform_settings_reindex_concurrency_range
    check (reindex_concurrency >= 1 and reindex_concurrency <= 10);
