-- conversation_participants_read/_insert queried conversation_participants from
-- inside their own USING/WITH CHECK clause. Postgres re-applies RLS to that inner
-- query too, which re-enters the same policy forever: SQLSTATE 42P17 "infinite
-- recursion detected in policy for relation conversation_participants".
--
-- Fix: move the membership check into a security-definer function (same pattern
-- as public.is_admin() in 20260807130002_profiles.sql). It runs as the function
-- owner, which bypasses RLS, so the inner lookup no longer re-triggers the policy.
create function public.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id and cp.profile_id = auth.uid()
  );
$$;

drop policy "conversation_participants_read" on public.conversation_participants;
create policy "conversation_participants_read" on public.conversation_participants
  for select
  using (
    profile_id = auth.uid()
    or public.is_admin()
    or public.is_conversation_participant(conversation_participants.conversation_id)
  );

drop policy "conversation_participants_insert" on public.conversation_participants;
create policy "conversation_participants_insert" on public.conversation_participants
  for insert
  with check (
    profile_id = auth.uid()
    or public.is_conversation_participant(conversation_participants.conversation_id)
  );
