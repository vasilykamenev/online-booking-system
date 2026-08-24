-- CSS-selector-based field extraction for a search_sources row's HTML/HYBRID processing_type
-- (docs/search-source-processing-strategies.md §1.1). Consumed by
-- providers/generic/provider.ts's extractBySelectors() when there is no domain-specific
-- ExternalSearchProvider in provider-registry.ts's PROVIDERS_BY_DOMAIN — null means the generic
-- provider still cannot attempt HTML/HYBRID for this source (see provider-registry.ts's
-- isGenericEligible()).

alter table public.search_sources
  add column selector_config jsonb;
