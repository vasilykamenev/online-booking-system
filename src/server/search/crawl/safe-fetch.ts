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

export type SafeFetchResult =
  | { ok: true; status: number; finalUrl: string; body: string }
  | { ok: false; reason: "unsupported-scheme" | "private-address" | "dns-error" | "too-large" | "too-many-redirects" | "timeout" | "http-error" | "network-error"; status?: number; detail?: string };

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

/** Reads a response body up to `maxBytes`, aborting the stream rather than buffering past the cap. */
async function readBodyCapped(response: Response, maxBytes: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();

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
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf-8");
}

/**
 * Fetches one URL with SSRF protection, a manual (re-validated) redirect chain, and bounded time
 * and size. Never throws — every failure mode is a typed `{ ok: false }` result, since a single
 * unreachable or hostile page must never crash the search that triggered it.
 */
export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
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
        headers: { "User-Agent": opts.userAgent, Accept: "text/html,application/xhtml+xml" },
      });
    } catch (error) {
      clearTimeout(connectTimer);
      const isAbort = error instanceof Error && error.name === "AbortError";
      return { ok: false, reason: isAbort ? "timeout" : "network-error", detail: String(error) };
    }

    if (response.status >= 300 && response.status < 400) {
      clearTimeout(connectTimer);
      const location = response.headers.get("location");
      if (!location) return { ok: false, reason: "http-error", status: response.status };
      currentUrl = new URL(location, parsed).toString();
      continue; // Loop re-validates the new host before ever fetching it.
    }

    if (!response.ok) {
      clearTimeout(connectTimer);
      return { ok: false, reason: "http-error", status: response.status };
    }

    const body = await readBodyCapped(response, opts.maxBytes);
    clearTimeout(connectTimer);
    if (body === null) return { ok: false, reason: "too-large" };

    return { ok: true, status: response.status, finalUrl: parsed.toString(), body };
  }

  return { ok: false, reason: "too-many-redirects" };
}
