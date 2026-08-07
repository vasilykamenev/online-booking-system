create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

create index conversation_participants_profile_idx on public.conversation_participants (profile_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text not null,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_profile_idx on public.notifications (profile_id, created_at);

-- RLS -----------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;

create policy "conversations_participant_read" on public.conversations
  for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = conversations.id and cp.profile_id = auth.uid()
    )
  );

create policy "conversations_authenticated_insert" on public.conversations
  for insert
  with check (auth.uid() is not null);

create policy "conversation_participants_read" on public.conversation_participants
  for select
  using (
    profile_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = conversation_participants.conversation_id
        and cp.profile_id = auth.uid()
    )
  );

-- A participant may add themselves, or add someone else to a conversation
-- they already belong to (e.g. starting a chat they just created).
create policy "conversation_participants_insert" on public.conversation_participants
  for insert
  with check (
    profile_id = auth.uid()
    or exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = conversation_participants.conversation_id
        and cp.profile_id = auth.uid()
    )
  );

create policy "conversation_participants_delete" on public.conversation_participants
  for delete
  using (profile_id = auth.uid() or public.is_admin());

create policy "messages_participant_read" on public.messages
  for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id and cp.profile_id = auth.uid()
    )
  );

create policy "messages_participant_insert" on public.messages
  for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id and cp.profile_id = auth.uid()
    )
  );

-- Notifications are written server-side (service role) only; users may read
-- and mark their own as read.
create policy "notifications_owner_read" on public.notifications
  for select
  using (profile_id = auth.uid() or public.is_admin());

create policy "notifications_owner_update" on public.notifications
  for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
