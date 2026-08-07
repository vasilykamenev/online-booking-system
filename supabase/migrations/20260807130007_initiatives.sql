-- The platform only provides the technical environment for initiatives and
-- does not moderate their content (BRD §4, CLAUDE.md §1) — no review/approval
-- workflow here, only ownership checks.
create table public.initiatives (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text not null,
  topic text not null,
  region text not null,
  activity_type text not null,
  status public.initiative_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger initiatives_set_updated_at
  before update on public.initiatives
  for each row execute function public.set_updated_at();

create index initiatives_topic_idx on public.initiatives (topic);
create index initiatives_region_idx on public.initiatives (region);
create index initiatives_status_idx on public.initiatives (status);

create table public.initiative_responses (
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references public.initiatives (id) on delete cascade,
  responder_id uuid not null references public.profiles (id) on delete cascade,
  type public.initiative_response_type not null,
  message text,
  created_at timestamptz not null default now(),
  unique (initiative_id, responder_id)
);

create index initiative_responses_initiative_idx on public.initiative_responses (initiative_id);

-- RLS -----------------------------------------------------------------

alter table public.initiatives enable row level security;
alter table public.initiative_responses enable row level security;

create policy "initiatives_public_read" on public.initiatives
  for select
  using (true);

create policy "initiatives_author_insert" on public.initiatives
  for insert
  with check (author_id = auth.uid());

create policy "initiatives_author_update" on public.initiatives
  for update
  using (author_id = auth.uid() or public.is_admin())
  with check (author_id = auth.uid() or public.is_admin());

create policy "initiatives_author_delete" on public.initiatives
  for delete
  using (author_id = auth.uid() or public.is_admin());

-- Responses are a private exchange between the responder and the initiative's
-- author, not a public comment thread.
create policy "initiative_responses_read" on public.initiative_responses
  for select
  using (
    responder_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.initiatives i
      where i.id = initiative_responses.initiative_id and i.author_id = auth.uid()
    )
  );

create policy "initiative_responses_insert" on public.initiative_responses
  for insert
  with check (responder_id = auth.uid());

create policy "initiative_responses_delete" on public.initiative_responses
  for delete
  using (responder_id = auth.uid() or public.is_admin());
