-- URL Registry + crawl-rule classification (docs/CLAUDE_SITEMAP_AI_CRAWLER_RULE.md §3, §4).
--
-- Persists what `providers/generic/provider.ts` used to only discover live, per user search:
-- the full (recursively-resolved) sitemap of a registered source, classified deterministically by
-- admin-editable path-prefix rules, with an explicit "selected for fetching" flag per URL. Search
-- traffic then only ever fetches `selected` rows, not an ad-hoc live sample of the whole sitemap.

create type public.search_url_classification as enum ('HIGH', 'MEDIUM', 'LOW', 'SKIP');
create type public.search_url_crawl_status as enum ('PENDING', 'FETCHED', 'FAILED', 'SKIPPED');

-- Which classifications get auto-selected for fetching without a per-URL manual override. Lives on
-- search_sources (one setting per source), not on the registry rows themselves.
alter table public.search_sources
  add column auto_select_classifications public.search_url_classification[]
    not null default '{HIGH}';

-- URL Registry (spec §3) --------------------------------------------------

create table public.search_source_urls (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.search_sources (id) on delete cascade,
  url text not null,
  source_sitemap text,
  discovered_at timestamptz not null default now(),
  -- Bumped every time a sync still finds this URL in the source's sitemap. Rows a sync stops
  -- finding are left alone (not deleted) — a page can be transiently unreachable; a "gone for N
  -- syncs in a row" sweep is a deliberately deferred follow-up, not an oversight.
  last_seen_at timestamptz not null default now(),
  sitemap_lastmod timestamptz,
  last_fetched_at timestamptz,
  http_status integer,
  content_hash text,
  last_ai_processed_at timestamptz,
  crawl_status public.search_url_crawl_status not null default 'PENDING',
  classification public.search_url_classification not null default 'MEDIUM',
  priority integer not null default 0,
  -- null = follow the source's auto_select_classifications; true/false = admin pin ("by list"),
  -- never overwritten by a re-sync or re-classify.
  selection_override boolean,
  -- Denormalized effective selection: selection_override ?? (classification = any(auto_select)).
  -- Recomputed by classifyAndUpsertUrls/reclassifyStoredUrls, not a generated column, since it
  -- depends on the parent source's auto_select_classifications (cross-table).
  selected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, url)
);

create trigger search_source_urls_set_updated_at
  before update on public.search_source_urls
  for each row execute function public.set_updated_at();

create index search_source_urls_source_selected_idx
  on public.search_source_urls (source_id, selected);
create index search_source_urls_source_classification_idx
  on public.search_source_urls (source_id, classification);

-- Crawl rules (spec §4) ----------------------------------------------------
-- Deterministic, admin-editable path-prefix classification per source. An empty rule set for a
-- source falls back to DEFAULT_CRAWL_RULES (src/server/search/registry/url-classification.ts) —
-- these rows only exist once an admin customizes a source's classification.

create table public.search_source_crawl_rules (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.search_sources (id) on delete cascade,
  -- Path prefix, optional trailing '*' (e.g. "/yachts/*") — same literal-prefix convention as
  -- robots-rules.ts, not a full glob engine.
  pattern text not null,
  classification public.search_url_classification not null,
  -- Tie-break among same-length-prefix matches, higher wins.
  priority integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger search_source_crawl_rules_set_updated_at
  before update on public.search_source_crawl_rules
  for each row execute function public.set_updated_at();

create index search_source_crawl_rules_source_idx on public.search_source_crawl_rules (source_id);

-- RLS -----------------------------------------------------------------------

alter table public.search_source_urls enable row level security;
alter table public.search_source_crawl_rules enable row level security;

-- Live search (generic provider) reads selected URLs with the caller's own client — same
-- reasoning as search_sources_public_read: public website metadata, not a secret.
create policy "search_source_urls_public_read" on public.search_source_urls
  for select using (selected or public.is_admin());

create policy "search_source_urls_admin_write" on public.search_source_urls
  for all using (public.is_admin()) with check (public.is_admin());

-- Rules are only ever read/written by the admin sync/reclassify flow, never by live search.
create policy "search_source_crawl_rules_admin_all" on public.search_source_crawl_rules
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.search_source_urls to anon, authenticated;
-- service_role grants are for a future cron-driven sync (EXTERNAL_SEARCH_INDEXING_PLAN.md) — not
-- used yet, every write in this iteration goes through an admin-authenticated session client.
grant select, insert, update, delete on public.search_source_urls to service_role;
grant select, insert, update, delete on public.search_source_crawl_rules to service_role;
