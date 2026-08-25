import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SafeFetchResult } from "./safe-fetch";
import type { RobotsRules } from "./robots-rules";

const { safeFetch } = vi.hoisted(() => ({ safeFetch: vi.fn() }));
vi.mock("./safe-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./safe-fetch")>()),
  safeFetch,
}));

const { discoverUrlsByCrawling } = await import("./html-link-discovery");

function ok(body: string): SafeFetchResult {
  return { ok: true, status: 200, finalUrl: "irrelevant", body };
}

function page(links: string[]): string {
  return `<html><body>${links.map((href) => `<a href="${href}">link</a>`).join("")}</body></html>`;
}

const NO_ROBOTS_RULES: RobotsRules = { rules: [] };

describe("discoverUrlsByCrawling", () => {
  beforeEach(() => {
    safeFetch.mockReset();
  });

  it("follows same-origin links breadth-first, starting from the base URL itself", async () => {
    safeFetch.mockImplementation(async (url: string) => {
      if (url === "https://example.com/") return ok(page(["/a", "/b"]));
      return ok(page([])); // /a and /b have no further links
    });

    const result = await discoverUrlsByCrawling("https://example.com/", NO_ROBOTS_RULES);

    expect(result.entries.map((e) => e.loc).sort()).toEqual([
      "https://example.com/",
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(result.truncated).toBe(false);
  });

  it("never follows a link to a different origin", async () => {
    safeFetch.mockImplementation(async (url: string) => {
      if (url === "https://example.com/") {
        return ok(page(["https://other-domain.com/steal-me", "/a"]));
      }
      return ok(page([]));
    });

    const result = await discoverUrlsByCrawling("https://example.com/", NO_ROBOTS_RULES);

    expect(result.entries.map((e) => e.loc)).not.toContain("https://other-domain.com/steal-me");
    expect(result.entries.map((e) => e.loc)).toContain("https://example.com/a");
  });

  it("dedupes a URL reached through more than one link and only fetches it once", async () => {
    safeFetch.mockImplementation(async (url: string) => {
      if (url === "https://example.com/") return ok(page(["/a", "/b"]));
      if (url === "https://example.com/a") return ok(page(["/shared"]));
      if (url === "https://example.com/b") return ok(page(["/shared"]));
      return ok(page([]));
    });

    const result = await discoverUrlsByCrawling("https://example.com/", NO_ROBOTS_RULES);

    expect(result.entries.filter((e) => e.loc === "https://example.com/shared")).toHaveLength(1);
    expect(safeFetch).toHaveBeenCalledTimes(4); // /, /a, /b, /shared — never /shared twice
  });

  it("includes a robots-disallowed URL in the results but never fetches it", async () => {
    const robotsRules: RobotsRules = { rules: [{ path: "/private", allow: false }] };
    safeFetch.mockImplementation(async (url: string) => {
      if (url === "https://example.com/") return ok(page(["/private/secret", "/public"]));
      return ok(page([]));
    });

    const result = await discoverUrlsByCrawling("https://example.com/", robotsRules);

    expect(result.entries.map((e) => e.loc)).toContain("https://example.com/private/secret");
    expect(safeFetch).not.toHaveBeenCalledWith("https://example.com/private/secret", undefined);
    expect(safeFetch).toHaveBeenCalledWith("https://example.com/public", undefined);
  });

  it("stops recursing past MAX_DEPTH and marks the result truncated", async () => {
    let depth = 0;
    safeFetch.mockImplementation(async () => {
      depth += 1;
      return ok(page([`/page-${depth}`]));
    });

    const result = await discoverUrlsByCrawling("https://example.com/", NO_ROBOTS_RULES);

    expect(result.truncated).toBe(true);
  });

  it("treats an unfetchable page as a dead end without throwing", async () => {
    safeFetch.mockResolvedValueOnce({ ok: false, reason: "http-error", status: 500 });

    const result = await discoverUrlsByCrawling("https://example.com/", NO_ROBOTS_RULES);

    expect(result.entries.map((e) => e.loc)).toEqual(["https://example.com/"]);
    expect(result.pagesVisited).toBe(0);
  });
});
