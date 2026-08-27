-- Per-source opt-in for step-by-step diagnostic logging of the generic provider's live search runs
-- (robots check, candidate selection — registry vs sitemap fallback, per-candidate fetch/extraction
-- outcome, location confirmation, final result count) — read via Vercel runtime logs
-- (src/server/search/providers/generic/provider.ts). Off by default: this is meaningfully more log
-- volume per search than the rest of the pipeline produces, meant for actively debugging one
-- misbehaving source (e.g. "why does this source return zero results"), not standing observability
-- every source should carry all the time.
alter table public.search_sources
  add column detailed_logging boolean not null default false;
