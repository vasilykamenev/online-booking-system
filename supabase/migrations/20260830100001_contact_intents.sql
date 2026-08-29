-- Э9 (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Арх §20): Contact / Booking Intent — the
-- "Запросить у поставщика" flow for external offers. Internal vessels never create a row here: they
-- already have a real booking flow plus `conversations`/`messages` for pre-booking questions (Арх
-- §20's own note, carried over verbatim in the plan) — `source_id`/`external_vessel_id` are
-- therefore required, not optional, and this table is external-offer-only by construction.

create type public.intent_type as enum ('CONTACT_REQUEST', 'BOOKING_REQUEST', 'INFO_REQUEST');

-- DRAFT: created, not yet shown to the user for confirmation (transient — every action that creates
--   one immediately returns it to the caller to show).
-- CONFIRMED: the user explicitly confirmed — Арх §20's one unconditional rule ("отправка только
--   после явного подтверждения") — and, for a capability with a real delivery channel, the send was
--   attempted. For REDIRECT_ONLY/EXTERNAL_BOOKING_URL this is the *terminal* state: opening a link
--   is not something we sent on the user's behalf, so it must never read SENT (see
--   `actions/contact-intents.ts`'s own doc comment).
-- SENT: delivered through a channel we actually dispatched (today: none — see that same doc comment
--   on why EMAIL/CONTACT_FORM/PROVIDER_API/PLATFORM_MESSAGE all honestly fail instead of pretending).
-- ANSWERED: reserved for a future inbound-reply signal; nothing currently writes it.
-- FAILED: delivery was attempted and could not be completed (no destination configured, adapter
--   error, etc.) — an honest outcome, not a bug.
-- CANCELLED: reserved for a future user-initiated withdrawal; nothing currently writes it.
create type public.intent_status as enum ('DRAFT', 'CONFIRMED', 'SENT', 'ANSWERED', 'FAILED', 'CANCELLED');

create table public.contact_intents (
  id uuid primary key default gen_random_uuid(),
  -- Not nullable: contacting a provider means we need a way to get back to the person who asked,
  -- which anonymous search traffic doesn't give us — same reasoning `conversations`/`messages`
  -- already assumes for internal contact.
  user_id uuid not null references public.profiles (id) on delete cascade,
  source_id uuid not null references public.search_sources (id) on delete cascade,
  -- The offer's id in the source's own id space (`VesselSearchResult.externalId`, Арх §11) — kept
  -- even after `index_id` below goes stale (a delisted row deleted by `index-retention.ts`'s
  -- cleanup), so the intent's own record of *what was asked about* survives independent of the
  -- index's retention policy.
  external_vessel_id text not null,
  -- The `external_vessel_index` row this was drafted against, if it still exists. `on delete set
  -- null`, not cascade: the intent is a record of a past request, not a live join that should
  -- disappear along with the listing.
  index_id uuid references public.external_vessel_index (id) on delete set null,
  type public.intent_type not null,
  status public.intent_status not null default 'DRAFT',
  date_from date,
  date_to date,
  guests integer,
  -- AI-drafted (`ai/message-generator.ts`) or template-drafted (no API key) — always populated for
  -- a message-based capability, always null for REDIRECT_ONLY/EXTERNAL_BOOKING_URL (nothing to
  -- draft for a plain link).
  message_draft text,
  -- What the user actually confirmed, which may differ from `message_draft` if they edited it —
  -- Арх §20 gives the user that edit, not just a take-it-or-leave-it AI draft.
  message_sent text,
  -- Resolved once, at draft creation, from the adapter's `getContactCapability()` (falls back to
  -- `REDIRECT_ONLY`, the same default every adapter itself already applies) — never re-resolved
  -- later, so a source's capability changing after the fact doesn't retroactively rewrite history.
  contact_capability public.search_contact_capability not null,
  -- Free text rather than an enum: today only ever `'REDIRECT'` (REDIRECT_ONLY/EXTERNAL_BOOKING_URL)
  -- or absent (every other capability currently fails before choosing one) — an enum would need a
  -- migration the moment a real EMAIL/CONTACT_FORM/PROVIDER_API integration is added, which a plain
  -- string doesn't.
  delivery_channel text,
  -- The URL actually opened (REDIRECT_ONLY/EXTERNAL_BOOKING_URL) or, for a future real channel, a
  -- provider message id — whatever "delivery_channel" identifies as its own reference.
  delivery_reference text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  sent_at timestamptz,
  constraint contact_intents_dates_order check (date_from is null or date_to is null or date_from <= date_to)
);

create index contact_intents_user_idx on public.contact_intents (user_id, created_at desc);
create index contact_intents_source_idx on public.contact_intents (source_id);

alter table public.contact_intents enable row level security;

-- A user sees and manages only their own intents; an admin sees everything (Арх §27: a lead on a
-- source worth onboarding is exactly the kind of aggregate signal an admin needs the full list for).
create policy "contact_intents_own_read" on public.contact_intents
  for select using (user_id = auth.uid() or public.is_admin());

create policy "contact_intents_own_insert" on public.contact_intents
  for insert with check (user_id = auth.uid());

-- Update, not delete: `status` moves forward (DRAFT → CONFIRMED → SENT/FAILED); a user who no
-- longer wants a pending request cancels it (`status = 'CANCELLED'`), never erases that they asked.
create policy "contact_intents_own_update" on public.contact_intents
  for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

grant select, insert, update on public.contact_intents to authenticated;
grant select, insert, update, delete on public.contact_intents to service_role;
