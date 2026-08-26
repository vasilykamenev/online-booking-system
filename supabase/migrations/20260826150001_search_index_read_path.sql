-- P3 (docs/data-merger-provenance-design.md §4): live search can now serve a candidate straight from
-- `search_extracted_listings` when a fresh-enough row exists, skipping the live HTTP fetch entirely.
-- Two small additions this needs:
--   1. `image` on the listing row -- the table (P1/P2) deliberately left images out of scope, but a
--      card served from the index with no photo is a real UX regression (CLAUDE.md §5's card layout
--      always shows one), so it's added here as a plain, unconflicted last-write-wins column -- no
--      provenance/conflict tracking, same treatment `last_extracted_at` already gets.
--   2. `pages_from_index` on `search_runs` -- so the win (fetches avoided) is measurable, the same way
--      every other extraction-path counter already is.

alter table public.search_extracted_listings
  add column if not exists image text;

alter table public.search_runs
  add column if not exists pages_from_index integer not null default 0;
