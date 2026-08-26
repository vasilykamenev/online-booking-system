-- ETag/If-Modified-Since revalidation (docs/data-merger-provenance-design.md §5.4) -- replaces
-- P3's fixed-TTL-only freshness model with a real conditional-GET check when the origin supports
-- it: a stale `search_page_cache` row with a stored validator gets a cheap conditional request
-- instead of an unconditional re-fetch, and a `304 Not Modified` lets the generic provider skip
-- re-extraction (and its AI call) entirely for a `search_extracted_listings` row whose page provably
-- hasn't changed.

alter table public.search_page_cache
  add column if not exists etag text,
  add column if not exists last_modified text;

alter table public.search_runs
  add column if not exists pages_revalidated_unchanged integer not null default 0;
