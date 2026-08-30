/**
 * Pure JSON-LD sniffing: detects whether a page publishes schema.org structured data at all, and
 * which `@type`s it declares — without claiming to know whether those types describe vessel
 * offers. That semantic judgment is a separate, AI-driven classification step for a later
 * iteration; this only feeds the STRUCTURED_DATA vs. HTML processing-type suggestion shown during
 * source registration (`src/server/search/source-validation.ts`).
 */

import { normalizeForMatch } from "@/lib/search/text";

function collectTypes(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, into);
    return;
  }
  if (node === null || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") into.add(type);
  else if (Array.isArray(type)) {
    for (const entry of type) if (typeof entry === "string") into.add(entry);
  }

  // `@graph` is JSON-LD's way of packing multiple entities into one script block.
  if ("@graph" in record) collectTypes(record["@graph"], into);
}

export interface BreadcrumbEntry {
  name: string;
  /** `null` when this crumb's `item` is missing or isn't a plain URL string — the label is still
   *  collected (still useful for `matchBreadcrumbLocation`), just not usable as a seed URL. */
  url: string | null;
}

/** schema.org's `item` is usually a bare URL string, but occasionally an `{"@id": "..."}` reference
 *  — same shape `resolveOffers`/`collectNodesById` already deal with elsewhere in this file. */
function breadcrumbItemUrl(item: unknown): string | null {
  if (typeof item === "string" && item.trim()) return item.trim();
  if (item && typeof item === "object") {
    const id = (item as Record<string, unknown>)["@id"];
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

/** Walks every node looking for `BreadcrumbList` blocks and collects each `itemListElement`'s
 *  `name`/`item`, in document order — a page can carry more than one breadcrumb trail (rare, but
 *  cheaper to collect from all of them than to assume there's exactly one). */
function collectBreadcrumbTrail(node: unknown, into: BreadcrumbEntry[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectBreadcrumbTrail(item, into);
    return;
  }
  if (node === null || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  if (record["@type"] === "BreadcrumbList" && Array.isArray(record.itemListElement)) {
    for (const entry of record.itemListElement) {
      if (entry && typeof entry === "object") {
        const name = (entry as Record<string, unknown>).name;
        if (typeof name === "string" && name.trim()) {
          into.push({ name: name.trim(), url: breadcrumbItemUrl((entry as Record<string, unknown>).item) });
        }
      }
    }
  }

  if ("@graph" in record) collectBreadcrumbTrail(record["@graph"], into);
}

const SCRIPT_PATTERN = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Extracts every `@type` declared across a page's `<script type="application/ld+json">` blocks.
 * A malformed block is skipped, not fatal — one broken script tag must not hide data in the others.
 */
export function extractJsonLdTypes(html: string): string[] {
  const types = new Set<string>();
  for (const match of html.matchAll(SCRIPT_PATTERN)) {
    try {
      collectTypes(JSON.parse(match[1]), types);
    } catch {
      continue;
    }
  }
  return [...types];
}

/**
 * Every `BreadcrumbList` entry across a page's JSON-LD, independent of whether the page also has a
 * recognized listing node (unlike `extractJsonLdFields`, which returns `null` entirely for a page
 * `NON_LISTING_TYPES` excludes — e.g. sailica.com's category/hub pages, `/catalog/turkey`). Those
 * pages are exactly the ones `registry/source-breadcrumbs.ts` most wants to learn a country/city's
 * own URL from, so this reads independently of listing detection.
 */
export function extractBreadcrumbTrail(html: string): BreadcrumbEntry[] {
  const trail: BreadcrumbEntry[] = [];
  for (const match of html.matchAll(SCRIPT_PATTERN)) {
    try {
      collectBreadcrumbTrail(JSON.parse(match[1]), trail);
    } catch {
      continue;
    }
  }
  return trail;
}

export interface JsonLdFields {
  name: string | null;
  description: string | null;
  image: string | null;
  /** Major units (e.g. `9500` for "9500 EUR") — the cheapest currently-available offer attached to
   *  the listing node, not just whichever `offers` entry happens to come first. `null` when there's
   *  no `offers`, no parseable price, every offer is declared out of stock, or `priceConflict` is
   *  true (never guess which of two disagreeing prices is right). */
  price: number | null;
  currency: string | null;
  /** True when this page's own JSON-LD disagrees with itself about price across more than one named
   *  listing node — a real failure mode sites produce (duplicated/stale `Product` blocks). `price`
   *  and `currency` are `null` whenever this is true. */
  priceConflict: boolean;
  /** Every item name from any `BreadcrumbList` block(s) on the page, in trail order. Schema.org has
   *  no standard mapping from breadcrumb position to admin level (country vs. region vs. city), so
   *  this is raw material, not a location field — `matchBreadcrumbLocation` below confirms a
   *  *specific* wanted value against it rather than guessing which crumb means what. Many charter/
   *  travel sites publish a geographic drill-down here even when the listing's own JSON-LD node
   *  (e.g. a plain `Product`) carries no address at all — observed live on sailica.com, whose
   *  per-yacht `Product` block has no location, but whose `BreadcrumbList` reads
   *  Home → All yachts → Croatia → Split → Kastel Gomilica → Marina Kastela. */
  breadcrumbLabels: string[];
  /** The same trail as `breadcrumbLabels`, paired with each crumb's own `item` URL when the page
   *  stated one — `registry/source-breadcrumbs.ts` persists these (label → url → parent label) so a
   *  *later* search on this source can seed candidate selection from a place it already knows a URL
   *  for, instead of sampling the whole catalog blind. `null` per-entry `url` (not the whole array)
   *  when a crumb had a name but no usable `item` — still worth keeping for `breadcrumbLabels`-style
   *  matching, just not usable as a seed. */
  breadcrumbTrail: BreadcrumbEntry[];
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) return item.trim();
      // schema.org `image` is sometimes an ImageObject rather than a bare URL string.
      if (item && typeof item === "object" && typeof (item as Record<string, unknown>).url === "string") {
        return (item as Record<string, unknown>).url as string;
      }
    }
    return null;
  }
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).url === "string") {
    return (value as Record<string, unknown>).url as string;
  }
  return null;
}

/** Lower rank = smaller/blurrier, higher = sharper — schema.org gives no ordering guarantee for a
 *  bare array of image URLs, and a CDN listing several resolutions of the same photo commonly names
 *  them with exactly these path segments (observed live on sailica.com: `.../thumbnail/<hash>.jpg`,
 *  `.../medium/<hash>.jpg`, `.../large/<hash>.jpg`, `.../original/<hash>.jpg` — same photo, thumbnail
 *  listed first). Deliberately just this one recognizable vocabulary, not a guess at every CDN's own
 *  convention — a URL with none of these words simply ties at rank 0 with every other untagged one,
 *  which keeps `pickBestImageUrl` falling back to "first" exactly like before for a source that
 *  doesn't tag sizes this way. */
const IMAGE_SIZE_RANK: Record<string, number> = {
  thumb: 0,
  thumbnail: 0,
  icon: 0,
  small: 1,
  medium: 2,
  mid: 2,
  large: 3,
  big: 3,
  xl: 4,
  original: 4,
  orig: 4,
  full: 4,
  huge: 4,
};

function imageSizeRank(url: string): number {
  const segments = url.toLowerCase().split(/[/_.\-?=&]/);
  let rank = 0;
  for (const segment of segments) rank = Math.max(rank, IMAGE_SIZE_RANK[segment] ?? 0);
  return rank;
}

/**
 * Like `firstString`, but for `image` specifically: picks the sharpest-looking candidate among
 * several rather than always the first. Without this, a page that lists its thumbnail before its
 * full-size photo (schema.org's `image` array has no ordering rule) would have every result from
 * that source render visibly blurry — found live on sailica.com, whose `Product.image` array is
 * `[thumbnail, medium, large, original]` in that fixed order on every single listing.
 */
function pickBestImageUrl(value: unknown): string | null {
  const candidates: string[] = [];
  if (typeof value === "string" && value.trim()) {
    candidates.push(value.trim());
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) candidates.push(item.trim());
      else if (item && typeof item === "object" && typeof (item as Record<string, unknown>).url === "string") {
        candidates.push((item as Record<string, unknown>).url as string);
      }
    }
  } else if (value && typeof value === "object" && typeof (value as Record<string, unknown>).url === "string") {
    candidates.push((value as Record<string, unknown>).url as string);
  }
  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestRank = imageSizeRank(candidates[0]);
  for (const candidate of candidates.slice(1)) {
    const rank = imageSizeRank(candidate);
    if (rank > bestRank) {
      best = candidate;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Site-wide/organizational schema types, never the listing a page is actually about. Almost every
 * commercial site injects one of these on every page (nav header, footer, or site-level SEO
 * boilerplate) — usually *before* any page-specific JSON-LD in document order — so without this
 * exclusion `findFirstNamedNode` locks onto the site's own name/logo on every page of a source
 * (observed live on globesailor.ru: a page-wide `TravelAgency` block named "GlobeSailor" precedes
 * the page's actual `Product` block in every listing page's HTML). Not a positive `@type` allowlist
 * (see this file's other doc comment for why) — just the types that are structurally never the
 * page's showcased item, regardless of what that item's own type turns out to be.
 *
 * `CreativeWorkSeries` joins this list for the same reason: observed live on sailica.com, whose
 * category/destination hub pages (`/catalog/turkey/sailing-yacht`, `/destinations/turkey` — a list
 * of many boats or a country guide, not one vessel) carry a page-wide `CreativeWorkSeries` block
 * (just a `name` and an `aggregateRating`, no vessel fields at all) and nothing else with a `name`.
 * Before this exclusion those hub pages were misread as single-vessel listings with every field but
 * `name` null — which then leaked into results for *any* query with no location filter to catch
 * them (a hub page has no location either), and were the reverse case for a query that did name a
 * place: the "listing" they produced had no location field, so `matchesKnownCriteria` — right to be
 * suspicious of an admittedly-locationless result — rejected it, silently costing the source a slot
 * it never should have occupied in the first place.
 */
const NON_LISTING_TYPES = new Set([
  "Organization",
  "TravelAgency",
  "LocalBusiness",
  "Corporation",
  "WebSite",
  "WebPage",
  "BreadcrumbList",
  "SiteNavigationElement",
  "CreativeWorkSeries",
]);

function isNonListingNode(record: Record<string, unknown>): boolean {
  const type = record["@type"];
  const types = typeof type === "string" ? [type] : Array.isArray(type) ? type : [];
  return types.some((entry) => typeof entry === "string" && NON_LISTING_TYPES.has(entry));
}

function findFirstNamedNode(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirstNamedNode(item);
      if (found) return found;
    }
    return null;
  }
  if (node === null || typeof node !== "object") return null;

  const record = node as Record<string, unknown>;
  if (!isNonListingNode(record) && typeof record.name === "string" && record.name.trim()) {
    return record;
  }
  if ("@graph" in record) return findFirstNamedNode(record["@graph"]);
  return null;
}

/**
 * Indexes every node in a parsed JSON-LD document by its `@id`, so a bare reference like
 * `{"@id": "https://example.com/#offer-1"}` can be resolved to the node it actually points at.
 * `@graph` documents commonly declare an `Offer`/`Organization` node once and reference it from
 * several places rather than repeating it inline — see rules doc §20.5.
 */
function collectNodesById(node: unknown, into: Map<string, Record<string, unknown>>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectNodesById(item, into);
    return;
  }
  if (node === null || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  const id = record["@id"];
  if (typeof id === "string") into.set(id, record);
  for (const value of Object.values(record)) collectNodesById(value, into);
}

/** A bare `{"@id": "..."}` reference has nothing useful of its own besides that key (and maybe
 *  `@type`) — an inline offer object already carries its own `price`/`priceCurrency` and needs no
 *  lookup at all. */
function resolveReference(
  value: unknown,
  idIndex: Map<string, Record<string, unknown>>,
): Record<string, unknown> | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = record["@id"];
  if (typeof id === "string" && !("price" in record) && !("priceCurrency" in record)) {
    return idIndex.get(id) ?? null;
  }
  return record;
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** schema.org `availability` is a full URL (`https://schema.org/OutOfStock`) — only the trailing
 *  segment is the actual enum value worth comparing. */
function availabilityTail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const segment = value.trim().split("/").pop();
  return segment ? segment : null;
}

const UNAVAILABLE = new Set(["OutOfStock", "Discontinued", "SoldOut"]);

/**
 * Resolves a listing node's `offers` — one inline `Offer`, an array of them (real sites commonly
 * list several rate/cabin variants this way), or a bare `@id` reference — down to a single "starting
 * from" figure: the cheapest offer that isn't declared out of stock. Never the first offer blindly,
 * and never one schema.org itself says isn't currently bookable (rules doc §28: "старые цены;
 * устаревшие Offer").
 */
function resolveOffers(
  node: Record<string, unknown>,
  idIndex: Map<string, Record<string, unknown>>,
): { price: number | null; currency: string | null } {
  const raw = node.offers;
  if (raw === undefined || raw === null) return { price: null, currency: null };

  const available = (Array.isArray(raw) ? raw : [raw])
    .map((entry) => resolveReference(entry, idIndex))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) => ({
      // `Offer.price` is the common case, but a site quoting a range across cabin/rate variants
      // publishes `AggregateOffer` instead, which has no `price` field at all — only `lowPrice`/
      // `highPrice` (observed live on sailica.com: every listing's only offer node is an
      // `AggregateOffer` with `lowPrice`/`highPrice` and no `price`). `lowPrice` matches this
      // function's own "starting from" framing (its doc comment above), same as picking the
      // cheapest of several plain `Offer`s already does.
      price: parsePrice(entry.price ?? entry.lowPrice),
      currency: typeof entry.priceCurrency === "string" ? entry.priceCurrency.toUpperCase() : null,
      available: !UNAVAILABLE.has(availabilityTail(entry.availability) ?? ""),
    }))
    .filter((offer): offer is { price: number; currency: string | null; available: boolean } => {
      return offer.price !== null && offer.available;
    });

  if (available.length === 0) return { price: null, currency: null };
  const cheapest = available.reduce((min, offer) => (offer.price < min.price ? offer : min));
  return { price: cheapest.price, currency: cheapest.currency };
}

/**
 * Every named, non-site-wide node in the document that resolves to a usable price — walked with the
 * same shape as `findFirstNamedNode` (array / object / `@graph`), but collecting every match instead
 * of stopping at the first. Used only to detect the case rules doc §28 calls out: two different
 * `Product`-like blocks (duplicated markup, a stale cached fragment) stating different prices for
 * what looks like the same listing.
 */
function collectPricedListingPrices(
  node: unknown,
  idIndex: Map<string, Record<string, unknown>>,
  into: { price: number; currency: string | null }[],
): void {
  if (Array.isArray(node)) {
    for (const item of node) collectPricedListingPrices(item, idIndex, into);
    return;
  }
  if (node === null || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  if (!isNonListingNode(record) && typeof record.name === "string" && record.name.trim()) {
    const offer = resolveOffers(record, idIndex);
    if (offer.price !== null) into.push({ price: offer.price, currency: offer.currency });
  }
  if ("@graph" in record) collectPricedListingPrices(record["@graph"], idIndex, into);
}

/**
 * Pulls basic listing fields (name/description/image/price) off the first JSON-LD node that
 * declares a `name` and isn't a known site-wide/organizational type (`NON_LISTING_TYPES`) —
 * deliberately not filtered to a positive `@type` allowlist (schema.org has no dedicated "boat"
 * type, and site owners rarely tag charter listings precisely as `Product`), so this trusts "has a
 * name, and isn't clearly about the site itself" as the signal that a node describes the thing the
 * page is about. Returns `null` when no page-wide JSON-LD carries such a name at all, which is a
 * fact about the page, not a failure.
 */
export function extractJsonLdFields(html: string): JsonLdFields | null {
  // Parsed up front, across every block on the page — `@id` references and the price-conflict scan
  // below must see the whole page's JSON-LD, not just whichever single `<script>` tag happens to
  // contain the primary listing node (real sites routinely split Organization/Product/Offer across
  // several separate blocks, as the "skips a site-wide Organization" test above already relies on).
  const parsedBlocks: unknown[] = [];
  for (const match of html.matchAll(SCRIPT_PATTERN)) {
    try {
      parsedBlocks.push(JSON.parse(match[1]));
    } catch {
      continue;
    }
  }
  if (parsedBlocks.length === 0) return null;

  let primaryNode: Record<string, unknown> | null = null;
  for (const parsed of parsedBlocks) {
    primaryNode = findFirstNamedNode(parsed);
    if (primaryNode) break;
  }
  if (!primaryNode) return null;

  const idIndex = new Map<string, Record<string, unknown>>();
  for (const parsed of parsedBlocks) collectNodesById(parsed, idIndex);

  const allPrices: { price: number; currency: string | null }[] = [];
  for (const parsed of parsedBlocks) collectPricedListingPrices(parsed, idIndex, allPrices);
  const distinctPrices = new Set(allPrices.map((offer) => `${offer.price}:${offer.currency ?? ""}`));
  const priceConflict = distinctPrices.size > 1;

  const offer = priceConflict ? { price: null, currency: null } : resolveOffers(primaryNode, idIndex);

  const breadcrumbTrail: BreadcrumbEntry[] = [];
  for (const parsed of parsedBlocks) collectBreadcrumbTrail(parsed, breadcrumbTrail);

  return {
    name: firstString(primaryNode.name),
    description: firstString(primaryNode.description),
    image: pickBestImageUrl(primaryNode.image),
    price: offer.price,
    currency: offer.currency,
    priceConflict,
    breadcrumbTrail,
    breadcrumbLabels: breadcrumbTrail.map((entry) => entry.name),
  };
}

/**
 * Confirms — never invents — a wanted country/city against a page's own breadcrumb trail: a field
 * comes back non-null only when the trail literally states that exact name somewhere (compared via
 * `normalizeForMatch`, so case/diacritics/punctuation don't matter). Deliberately does not attempt
 * to guess which crumb *is* "the country" in general — breadcrumb position has no standard meaning
 * across sites — so a page whose trail doesn't mention the wanted place at all yields `null` rather
 * than a wrong guess, same as if the page had published no location data.
 *
 * Exists for `providers/generic/provider.ts`'s JSON-LD extraction tier: without this, any source
 * whose listing pages lack a structured address (no `PostalAddress`, common — see
 * `JsonLdFields.breadcrumbLabels`'s doc comment) always yields `location.country`/`location.city:
 * null`, which `matchesKnownCriteria` then hard-filters out of every location-qualified search —
 * silently zeroing out a source's results the moment a query names a place, even though the page
 * itself does state that place in its breadcrumb.
 */
export function matchBreadcrumbLocation(
  breadcrumbLabels: string[],
  wanted: { country: string | null; city: string | null },
): { country: string | null; city: string | null } {
  const normalizedLabels = breadcrumbLabels.map(normalizeForMatch);
  const confirms = (value: string | null) =>
    value !== null && normalizedLabels.includes(normalizeForMatch(value)) ? value : null;

  return { country: confirms(wanted.country), city: confirms(wanted.city) };
}
