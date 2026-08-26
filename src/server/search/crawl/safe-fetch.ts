import "server-only";
import { lookup } from "node:dns/promises";
import { isPrivateIp } from "@/server/search/crawl/ip-range";

/**
 * The single point every crawler request must go through (spec §24). A generic "fetch a URL from
 * the internet" primitive is exactly the shape of an SSRF vector: a malicious or compromised site
 * can redirect to `http://169.254.169.254/` or to an internal admin panel, and a naive `fetch`
 * would happily follow. This wrapper resolves and re-validates the target on every hop, never
 * trusting a redirect target without checking it the same way as the original URL.
 */

export interface SafeFetchOptions {
  /** Hard ceiling on time-to-first-byte. Separate from `readTimeoutMs` — a slow-loris response
   *  that connects instantly but trickles bytes forever must not hide behind a generous connect
   *  budget. */
  connectTimeoutMs?: number;
  /** Ceiling on total time spent reading the body once headers arrive. */
  readTimeoutMs?: number;
  /** Response bodies larger than this are aborted mid-stream, not buffered then rejected. */
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
}

type SafeFetchFailure = {
  ok: false;
  reason:
    | "unsupported-scheme"
    | "private-address"
    | "dns-error"
    | "too-large"
    | "too-many-redirects"
    | "timeout"
    | "http-error"
    | "network-error";
  status?: number;
  detail?: string;
};

export type SafeFetchResult =
  | { ok: true; status: number; finalUrl: string; body: string; etag: string | null; lastModified: string | null }
  | SafeFetchFailure;

export interface ConditionalFetchOptions extends SafeFetchOptions {
  /** RFC 9110 §13.1.1/§13.1.3 conditional-request headers — when either is set, a `304 Not
   *  Modified` response is a distinct success outcome (`notModified: true`), not an `http-error`
   *  failure. Both are optional and independent: a caller sends whichever validator it has stored
   *  from the prior fetch (a site may send only one, or neither). */
  ifNoneMatch?: string;
  ifModifiedSince?: string;
}

export type SafeFetchConditionalResult =
  | { ok: true; notModified: true; status: 304; finalUrl: string }
  | { ok: true; notModified: false; status: number; finalUrl: string; body: string; etag: string | null; lastModified: string | null }
  | SafeFetchFailure;

export type SafeFetchBinaryResult =
  | { ok: true; status: number; finalUrl: string; contentType: string | null; body: Buffer }
  | SafeFetchFailure;

const DEFAULT_OPTIONS: Required<SafeFetchOptions> = {
  connectTimeoutMs: 5_000,
  readTimeoutMs: 10_000,
  maxBytes: 5 * 1024 * 1024, // 5 MiB — generous for a listing/detail page, not for a video dump.
  maxRedirects: 5,
  userAgent: "MeridianSearchBot/0.1 (+https://meridian.example/bot)",
};

/** Resolves a hostname and rejects it if any answer lands in a private/reserved range (spec §24). */
async function assertPublicHost(hostname: string): Promise<{ ok: true } | { ok: false; reason: "dns-error" | "private-address" }> {
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return { ok: false, reason: "dns-error" };
  }
  if (addresses.length === 0) return { ok: false, reason: "dns-error" };

  // Every resolved address is checked, not just the first — a hostname that resolves to both a
  // public and a private address ("DNS rebinding") must still be rejected.
  for (const { address, family } of addresses) {
    if (isPrivateIp(address, family === 6 ? 6 : 4)) return { ok: false, reason: "private-address" };
  }
  return { ok: true };
}

type FetchValidatedResult =
  | { ok: true; response: Response; finalUrl: string; notModified: boolean }
  | SafeFetchFailure;

/**
 * The SSRF-safe connect + manual (re-validated) redirect chain, shared by the text (`safeFetch`),
 * binary (`safeFetchBinary`), and conditional (`safeFetchConditional`) readers below — everything up
 * to but not including consuming the response body, since callers need to read it differently
 * (decoded text vs. raw bytes vs. not at all for a 304).
 *
 * `conditional` is only ever passed by `safeFetchConditional` — every other caller gets byte-for-byte
 * the same behavior as before this existed: no conditional headers sent, and a spontaneous 304 from a
 * server that wasn't asked for one still falls through to the ordinary redirect-range check below
 * (where, lacking a `location` header, it correctly ends up an `http-error` — not a new success case
 * these callers never asked for).
 */
async function fetchValidated(
  url: string,
  opts: Required<SafeFetchOptions>,
  conditional?: { ifNoneMatch?: string; ifModifiedSince?: string },
): Promise<FetchValidatedResult> {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= opts.maxRedirects; redirectCount++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, reason: "network-error", detail: "malformed URL" };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, reason: "unsupported-scheme" };
    }

    const hostCheck = await assertPublicHost(parsed.hostname);
    if (!hostCheck.ok) return { ok: false, reason: hostCheck.reason };

    const controller = new AbortController();
    const connectTimer = setTimeout(() => controller.abort(), opts.connectTimeoutMs + opts.readTimeoutMs);

    let response: Response;
    try {
      response = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: "manual", // Redirects are followed by hand, below, so each hop gets re-validated.
        headers: {
          "User-Agent": opts.userAgent,
          Accept: "text/html,application/xhtml+xml,image/*",
          ...(conditional?.ifNoneMatch ? { "If-None-Match": conditional.ifNoneMatch } : {}),
          ...(conditional?.ifModifiedSince ? { "If-Modified-Since": conditional.ifModifiedSince } : {}),
        },
      });
    } catch (error) {
      clearTimeout(connectTimer);
      const isAbort = error instanceof Error && error.name === "AbortError";
      return { ok: false, reason: isAbort ? "timeout" : "network-error", detail: String(error) };
    }

    // Only reachable with a validator we actually sent -- an unsolicited 304 (no `conditional`
    // passed) falls through to the redirect-range check below like any other 3xx, same as before
    // conditional support existed.
    if (conditional && response.status === 304) {
      clearTimeout(connectTimer);
      return { ok: true, response, finalUrl: parsed.toString(), notModified: true };
    }

    if (response.status >= 300 && response.status < 400) {
      clearTimeout(connectTimer);
      const location = response.headers.get("location");
      if (!location) return { ok: false, reason: "http-error", status: response.status };
      currentUrl = new URL(location, parsed).toString();
      continue; // Loop re-validates the new host before ever fetching it.
    }

    clearTimeout(connectTimer);
    if (!response.ok) return { ok: false, reason: "http-error", status: response.status };

    return { ok: true, response, finalUrl: parsed.toString(), notModified: false };
  }

  return { ok: false, reason: "too-many-redirects" };
}

/** Reads a response body up to `maxBytes` as raw bytes, aborting the stream rather than buffering
 *  past the cap. Returns `null` on overflow, same contract for both readers below. */
async function readBodyCappedBuffer(response: Response, maxBytes: number): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.from(await response.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

/**
 * Fetches one URL with SSRF protection, a manual (re-validated) redirect chain, and bounded time
 * and size, decoding the body as UTF-8 text. Never throws — every failure mode is a typed
 * `{ ok: false }` result, since a single unreachable or hostile page must never crash the search
 * that triggered it.
 */
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const validated = await fetchValidated(url, opts);
  if (!validated.ok) return validated;

  const body = await readBodyCappedBuffer(validated.response, opts.maxBytes);
  if (body === null) return { ok: false, reason: "too-large" };

  return {
    ok: true,
    status: validated.response.status,
    finalUrl: validated.finalUrl,
    body: body.toString("utf-8"),
    etag: validated.response.headers.get("etag"),
    lastModified: validated.response.headers.get("last-modified"),
  };
}

/**
 * Same SSRF-safe fetch as `safeFetch`, but keeps the body as raw bytes instead of decoding it as
 * text — for binary content (e.g. `api/external-image`'s proxied vessel photos), where UTF-8
 * decoding would corrupt the data.
 */
export async function safeFetchBinary(
  url: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchBinaryResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const validated = await fetchValidated(url, opts);
  if (!validated.ok) return validated;

  const body = await readBodyCappedBuffer(validated.response, opts.maxBytes);
  if (body === null) return { ok: false, reason: "too-large" };

  return {
    ok: true,
    status: validated.response.status,
    finalUrl: validated.finalUrl,
    contentType: validated.response.headers.get("content-type"),
    body,
  };
}

/**
 * Same SSRF-safe fetch as `safeFetch`, but with RFC 9110 conditional-request headers — used only by
 * `crawl/cached-fetch.ts`'s revalidation path (design doc §5.4). A `304 Not Modified` response has
 * no body to read, so it short-circuits before `readBodyCappedBuffer` is ever called.
 */
export async function safeFetchConditional(
  url: string,
  options: ConditionalFetchOptions = {},
): Promise<SafeFetchConditionalResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const validated = await fetchValidated(url, opts, {
    ifNoneMatch: options.ifNoneMatch,
    ifModifiedSince: options.ifModifiedSince,
  });
  if (!validated.ok) return validated;
  if (validated.notModified) {
    return { ok: true, notModified: true, status: 304, finalUrl: validated.finalUrl };
  }

  const body = await readBodyCappedBuffer(validated.response, opts.maxBytes);
  if (body === null) return { ok: false, reason: "too-large" };

  return {
    ok: true,
    notModified: false,
    status: validated.response.status,
    finalUrl: validated.finalUrl,
    body: body.toString("utf-8"),
    etag: validated.response.headers.get("etag"),
    lastModified: validated.response.headers.get("last-modified"),
  };
}
