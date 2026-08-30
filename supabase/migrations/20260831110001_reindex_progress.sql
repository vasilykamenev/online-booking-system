-- Live reindex progress for the admin "Индексировать сейчас" flow: `reindexSearchSource` currently
-- just awaits `indexSource` to completion with nothing observable in between, which for a large
-- source (e.g. sailica.com's ~2000 catalog pages) is minutes of a blank/spinning button with no
-- feedback. `indexGenericSource`/`indexBrilionsSource` already loop over a known-upfront candidate
-- list one page at a time — this just gives that loop somewhere to report "how far in" as it goes,
-- so the admin UI can show a progress bar/percentage instead of only a before/after result.

alter table public.search_sources
  add column reindex_started_at timestamptz,
  add column reindex_finished_at timestamptz,
  add column reindex_total integer,
  add column reindex_processed integer,
  add constraint search_sources_reindex_counts_valid check (
    (reindex_total is null and reindex_processed is null)
    or (
      reindex_total is not null
      and reindex_processed is not null
      and reindex_processed >= 0
      and reindex_processed <= reindex_total
    )
  );

-- "Currently running" is derived, not a separate boolean, to avoid a status flag going stale if a
-- run ever crashes without reaching its own finish write: `reindex_started_at is not null and
-- (reindex_finished_at is null or reindex_finished_at < reindex_started_at)` — the same "last start
-- beats last finish" comparison every polling reader below uses.
