-- Per-source, self-learning map of breadcrumb labels the generic provider has actually seen while
-- crawling (`providers/generic/provider.ts`), each paired with its own `item` URL and the label that
-- was its immediate parent in that same trail. Built up opportunistically from ordinary search
-- traffic — no separate crawl job, no site-specific code — and used to seed candidate selection for a
-- *later* search naming a place this source already has a known URL for (a country directly, or a
-- city resolved to its parent), instead of sampling the whole catalog blind every time.
--
-- Deliberately a flat label→url→parent-label table, not a tree: a breadcrumb trail's own order
-- already encodes the hierarchy (`registry/source-breadcrumbs.ts` walks consecutive pairs), and this
-- shape lets a query just look up "have we ever seen this label" without reconstructing trails.
create table public.search_source_breadcrumbs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.search_sources (id) on delete cascade,
  -- Comparable form (`normalizeForMatch`) — matching happens against this, `label` is display-only
  -- (whichever casing/spelling was last seen).
  normalized_label text not null,
  label text not null,
  url text not null,
  -- "" (never null) for a trail's first crumb (usually a site's own root, e.g. "Home") — never itself
  -- a useful seed, but harmless to keep for completeness. Kept non-null specifically so the unique
  -- constraint below can be a plain column list: Postgres never treats two NULLs as equal, which would
  -- otherwise let the same (source, label, no-parent) pair insert a fresh duplicate row on every crawl
  -- instead of upserting in place — and a plain column-list constraint is what `ON CONFLICT` (used by
  -- `registry/source-breadcrumbs.ts`'s upsert) can target directly, unlike an expression index.
  normalized_parent_label text not null default '',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_id, normalized_label, normalized_parent_label)
);

-- The same label legitimately recurring under a *different* parent on the same source is the exact
-- signal `registry/source-breadcrumbs.ts` uses to decline resolving an ambiguous city (more than one
-- stored parent for that label) rather than guessing — so the unique constraint above deliberately
-- allows multiple rows per label (one per distinct parent), never collapses them into one.

-- The provider's actual read pattern: "every stored row for this label on this source."
create index search_source_breadcrumbs_label_idx
  on public.search_source_breadcrumbs (source_id, normalized_label);

-- RLS ---------------------------------------------------------------------------------------------
-- Same reasoning as search_extracted_listings: normalized third-party navigation data, not user data.
-- The generic provider's write path already runs with the service-role client
-- (`recordFetchOutcome`/`recordExtraction`'s own pattern); nothing here is read by anything other than
-- that same server-side code today, so admin-only read is the correct default.
alter table public.search_source_breadcrumbs enable row level security;

create policy "search_source_breadcrumbs_admin_read" on public.search_source_breadcrumbs
  for select using (public.is_admin());

grant select, insert, update, delete on public.search_source_breadcrumbs to service_role;
