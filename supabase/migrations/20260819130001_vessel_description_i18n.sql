-- Vessel description becomes a {locale: text} map, same convention as
-- locations.country/city/marina — new languages are added as data, not schema.
-- Existing free-text descriptions were authored in English; backfilled under "en".
alter table public.vessels
  alter column description drop default,
  alter column description type jsonb using
    case
      when description is null or description = '' then '{}'::jsonb
      else jsonb_build_object('en', description)
    end,
  alter column description set default '{}'::jsonb;
