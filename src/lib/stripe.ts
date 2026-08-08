import "server-only";
import Stripe from "stripe";

let client: Stripe | undefined;

/**
 * Lazily constructed so importing this module (e.g. transitively, via a page that only
 * ever reaches the bank-transfer path) doesn't require `STRIPE_SECRET_KEY` to be set —
 * the SDK throws at construction time if the key is missing, not just when it's used.
 */
export function getStripeClient(): Stripe {
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY!);
  return client;
}
