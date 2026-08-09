-- Singleton config row (CLAUDE.md §10 step 10 / BRD admin "комиссии") — the
-- `id boolean primary key default true` + check(id) trick guarantees exactly
-- one row can ever exist, so admin writes are always a plain update.
create table public.platform_settings (
  id boolean primary key default true,
  commission_rate numeric(5, 4) not null default 0.12,
  updated_at timestamptz not null default now(),
  constraint platform_settings_singleton check (id),
  constraint platform_settings_rate_range check (commission_rate >= 0 and commission_rate <= 1)
);

create trigger platform_settings_set_updated_at
  before update on public.platform_settings
  for each row execute function public.set_updated_at();

insert into public.platform_settings (id, commission_rate) values (true, 0.12);

alter table public.platform_settings enable row level security;

-- Admin-only: the fee itself is always computed server-side (webhook / payment
-- confirmation action), so no other role ever needs to read this table directly.
create policy "platform_settings_admin_all" on public.platform_settings
  for all
  using (public.is_admin())
  with check (public.is_admin());
