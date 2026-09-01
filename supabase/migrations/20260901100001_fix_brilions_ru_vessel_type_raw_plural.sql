-- Bug found live (2026-09-01, see `translate-fields.ts`'s `FIELD_INSTRUCTIONS` doc comment):
-- brilions.com's Russian-language pages (the ~8% of vessels with no English sitemap page,
-- `brilions-indexer.ts`) label the type widget with a plural category name — "Тип: Моторные яхты"
-- ("Type: Motor Yachts") — where the English pages use a singular per-vessel descriptor
-- ("Type: Motor yacht") for the exact same vessel type. `extract.ts`'s `.yacht-meta-item`
-- extraction is verbatim-correct on both pages (they really do say that); `translateFieldsToEnglish`
-- then faithfully translated the plural Russian text into "Motor yachts", reintroducing the exact
-- cross-locale mismatch (`vessel-index.ts`'s exact-string filters) the whole translation feature
-- exists to remove. The prompt is fixed (pins `vesselTypeRaw` to singular regardless of the
-- source's own grammatical number) — this migration is the one-time data correction for rows
-- already indexed before that fix, plus the cache purge so a future reindex doesn't reproduce the
-- bug from `search_translation_cache`'s stale (pre-fix) cached output.

update public.external_vessel_index
set vessel_type_raw = 'Motor yacht'
where vessel_type_raw = 'Моторные яхты';

delete from public.search_translation_cache
where translated ->> 'vesselTypeRaw' = 'Motor yachts';
