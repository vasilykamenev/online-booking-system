-- Trusted image-CDN hostnames for a search_sources row, separate from its own `domain`
-- (src/app/api/external-image/route.ts's SSRF-protected proxy). Needed because a source's photos
-- are often served from a different host than the pages themselves — e.g. globesailor.ru's listing
-- pages link to images on static.theglobesailor.com, a host the domain-only allowlist previously
-- rejected outright, leaving every result from that source without a photo. Admin-set, mirroring
-- selector_config's precedent: not something the crawler can infer safely on its own.
alter table public.search_sources
  add column image_domains text[] not null default '{}';
