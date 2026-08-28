-- Э2 (docs/AI_Federated_Search_Migration_Plan_v1.md §6): `interpreted_criteria` stays schemaless
-- JSONB (no migration needed for the field additions themselves), but old rows were written under
-- the pre-Э2 `SearchCriteria` shape (`vesselType` singular, no `length`/`priceUnit`/`searchRadiusKm`/
-- `activities`, `features` instead of `amenities`). `request_version` lets anything reading search
-- history tell which shape a row is in, instead of guessing from which keys happen to be present.
alter table public.search_runs
  add column request_version integer not null default 1;

comment on column public.search_runs.request_version is
  'Shape version of interpreted_criteria: 1 = pre-Э2 (singular vesselType, features[]), 2 = current (vesselTypes[], amenities[]/activities[], length, priceUnit, searchRadiusKm).';
