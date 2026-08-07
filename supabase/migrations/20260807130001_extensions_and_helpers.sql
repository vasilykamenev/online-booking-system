-- Extensions
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- Enums
create type public.user_role as enum ('client', 'owner', 'admin');
create type public.vessel_type as enum ('yacht', 'catamaran', 'expedition', 'research', 'hybrid');
create type public.vessel_status as enum ('draft', 'published', 'archived');
create type public.booking_status as enum ('pending', 'confirmed', 'paid', 'cancelled', 'completed');
create type public.payment_provider as enum ('stripe', 'bank_transfer');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'refunded');
create type public.initiative_status as enum ('open', 'closed');
create type public.initiative_response_type as enum ('participation', 'collaboration', 'info_request');

-- updated_at trigger, reused by every table that has the column
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- current_role()/is_admin() live in the profiles migration (20260807130002):
-- as `language sql` functions their body is validated against real objects
-- at CREATE time, so they can't reference public.profiles before it exists.
