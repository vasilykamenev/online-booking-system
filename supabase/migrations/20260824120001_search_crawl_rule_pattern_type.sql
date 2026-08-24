-- Lets an admin author a crawl rule's pattern as a regular expression instead of a plain path
-- prefix (docs/CLAUDE_SITEMAP_AI_CRAWLER_RULE.md §4 — still deterministic UrlClassifier logic,
-- not AI: only widens what a single rule can express).

create type public.search_crawl_rule_pattern_type as enum ('PREFIX', 'REGEX');

alter table public.search_source_crawl_rules
  add column pattern_type public.search_crawl_rule_pattern_type not null default 'PREFIX';
