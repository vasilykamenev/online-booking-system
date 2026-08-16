-- Owner must confirm both the dates and the client's declared payment method
-- before payment can start (see CLAUDE.md booking flow update). `bookings.status`
-- keeps its existing values — `pending`/`confirmed` just gain a stricter meaning,
-- gated by whether a payment method has been declared.
alter table public.bookings
  add column payment_method public.payment_provider;

-- Client-initiated cancellation of an in-flight payment attempt, distinct from a
-- gateway-driven `failed` (Stripe webhook: session expired / payment_intent failed).
alter type public.payment_status add value 'cancelled';
