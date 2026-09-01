-- The user's decision: `external_vessel_index` free-text fields (name/description/vesselTypeRaw/
-- country/city) are stored in one language, English, regardless of the source page's own language —
-- reversing this codebase's previous documented stance (`location-resolver.ts`'s old "never a
-- translation, not a guess" comment, `candidate-classifier.ts`'s "verbatim — do not translate").
-- `index/translate-fields.ts` is the new translation step; this is its persistent cache, keyed by a
-- hash of the source-language input, mirroring `search_extraction_cache`'s own reasoning
-- (`20260828170001_external_vessel_index.sql`'s "Persistent extraction cache" section) almost
-- exactly: identical non-English text — the same page re-fetched, or boilerplate shared across two
-- listings on the same source — never re-pays for a second AI call. A separate table from
-- `search_extraction_cache` rather than a shared one: that table's key is a whole page's content
-- hash and its value a `CandidateClassification`; this one's key is a small set of already-extracted
-- field values (any tier: SELECTOR/JSON_LD/AI) and its value their English translations — same
-- "content-addressed, best-effort read-through" shape, different domain.
create table public.search_translation_cache (
  text_hash text primary key,
  translated jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.search_translation_cache enable row level security;

create policy "search_translation_cache_admin_read" on public.search_translation_cache
  for select using (public.is_admin());

grant select, insert, update, delete on public.search_translation_cache to service_role;
