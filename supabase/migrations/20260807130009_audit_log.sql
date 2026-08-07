create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles (id),
  action text not null,
  target_table text not null,
  target_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_admin_idx on public.audit_log (admin_id, created_at);
create index audit_log_target_idx on public.audit_log (target_table, target_id);

alter table public.audit_log enable row level security;

-- Admin-only in both directions: written by admin server actions (using the
-- caller's session, not service role, so every entry keeps a real admin_id).
create policy "audit_log_admin_read" on public.audit_log
  for select
  using (public.is_admin());

create policy "audit_log_admin_insert" on public.audit_log
  for insert
  with check (public.is_admin() and admin_id = auth.uid());
