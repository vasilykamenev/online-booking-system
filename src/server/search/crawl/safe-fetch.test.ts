import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => {
  const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
  return { lookup, default: { lookup } };
});

const { safeFetchConditional, safeFetch } = await import("./safe-fetch");

/**
 * Covers the conditional-GET / 304 handling added for design doc §5.4 — the trickiest part being
 * that `fetchValidated`'s 304 check had to be inserted *before* the pre-existing 3xx redirect-range
 * check (a 304 is itself a 3xx status), so a regression here would silently misroute every
 * conditional response as a failed redirect instead. Everything else in `safe-fetch.ts` is covered
 * indirectly through its consumers (`full-sitemap-discovery.test.ts`, `html-link-discovery.test.ts`),
 * but nothing else exercises this file's own control flow directly.
 */
describe("safeFetchConditional", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends If-None-Match / If-Modified-Since and reports notModified on a 304", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("if-none-match")).toBe('"abc123"');
      expect(headers.get("if-modified-since")).toBe("Wed, 21 Oct 2026 07:28:00 GMT");
      return new Response(null, { status: 304 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetchConditional("https://example.com/page", {
      ifNoneMatch: '"abc123"',
      ifModifiedSince: "Wed, 21 Oct 2026 07:28:00 GMT",
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.notModified) {
      expect(result.status).toBe(304);
    } else {
      throw new Error("expected notModified result");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the body and validators on a 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>fresh</html>", {
            status: 200,
            headers: { etag: '"new-etag"', "last-modified": "Thu, 22 Oct 2026 07:28:00 GMT" },
          }),
      ),
    );

    const result = await safeFetchConditional("https://example.com/page", { ifNoneMatch: '"old-etag"' });

    expect(result.ok).toBe(true);
    if (result.ok && !result.notModified) {
      expect(result.body).toBe("<html>fresh</html>");
      expect(result.etag).toBe('"new-etag"');
      expect(result.lastModified).toBe("Thu, 22 Oct 2026 07:28:00 GMT");
    } else {
      throw new Error("expected a changed (200) result");
    }
  });

  it("still follows a real redirect when conditional headers are set", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "https://example.com/moved" } }))
      .mockResolvedValueOnce(new Response("moved body", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetchConditional("https://example.com/old", { ifNoneMatch: '"etag"' });

    expect(result.ok).toBe(true);
    if (result.ok && !result.notModified) {
      expect(result.body).toBe("moved body");
      expect(result.finalUrl).toBe("https://example.com/moved");
    } else {
      throw new Error("expected the redirect to be followed to a 200");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a private-address host the same way an unconditional fetch would", async () => {
    const dns = await import("node:dns/promises");
    // `lookup`'s real (un-mocked) type is overloaded on its options argument, so `vi.mocked` picks
    // the single-address overload here rather than the `{ all: true }` array one this mock actually
    // implements — cast through `unknown` rather than fight the overload resolution for a test file.
    (dns.lookup as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    vi.stubGlobal("fetch", vi.fn());

    const result = await safeFetchConditional("https://internal.example/", { ifNoneMatch: '"etag"' });

    expect(result).toEqual({ ok: false, reason: "private-address" });
  });
});

describe("safeFetch (unconditional)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never sends conditional headers and treats an unsolicited 304 like any other unhandled status", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.has("if-none-match")).toBe(false);
      expect(headers.has("if-modified-since")).toBe(false);
      return new Response(null, { status: 304 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await safeFetch("https://example.com/page");

    // No `location` header on this 304, so the existing redirect-range branch (never bypassed for
    // a caller that passed no `conditional`) correctly reports it as a failure, same as before
    // conditional support existed.
    expect(result).toEqual({ ok: false, reason: "http-error", status: 304 });
  });
});
