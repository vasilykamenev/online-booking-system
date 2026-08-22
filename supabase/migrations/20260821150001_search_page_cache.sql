-- PageCache (spec §25): raw fetched pages, keyed by URL. Crawling a source's sitemap and
-- detail pages on every user search would be both slow (well past BRD §8's budget) and rude to
-- the source — this is what lets a search re-read yesterday's crawl instead of re-fetching
-- everything, and what `updated_at` (via the trigger) turns into "don't re-fetch, re-extract, or
-- re-run AI extraction on a page that hasn't changed".

create table public.search_page_cache (
  url text primary key,
  content_hash text not null,
  html text not null,
  http_status integer not null,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger search_page_cache_set_updated_at
  before update on public.search_page_cache
  for each row execute function public.set_updated_at();

create index search_page_cache_fetched_idx on public.search_page_cache (fetched_at);

alter table public.search_page_cache enable row level security;

-- Cached HTML is scraped third-party content, not user data — no client role has any business
-- reading or writing it directly. Only the crawler, running with the service-role client (same
-- pattern as `search_runs`), touches this table.
grant select, insert, update, delete on public.search_page_cache to service_role;

-- Seed: brilions.com (spec §8's Source Registry), first external provider (see
-- src/server/search/providers/brilions/). robots.txt was confirmed during integration research to
-- permit /yacht/ paths for a generic user-agent, with no Crawl-delay — but `robots_allows` starts
-- null regardless, since the crawler re-checks it live (spec §24: "not yet checked" must never be
-- read as "allowed").
insert into public.search_sources (name, domain, base_url, source_type, processing_type, priority, notes)
values (
  'Brilions',
  'brilions.com',
  'https://brilions.com',
  'WEBSITE',
  'HYBRID', -- deterministic HTML for structured fields (ACF), AI extraction for the free-text amenities list
  50,
  'Single-fleet charter operator (Turkey + UAE), day tours. No pricing published anywhere on the '
  || 'site — rental.priceMinor is always null for this source. Detail pages listed in '
  || 'yacht-sitemap.xml, localized under /yacht/{slug}/ and /en/yacht/{slug}/.'
)
on conflict (domain) do nothing;
