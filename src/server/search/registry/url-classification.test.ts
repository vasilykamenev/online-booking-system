import { describe, expect, it } from "vitest";
import { classifyUrl, DEFAULT_CRAWL_RULES, type CrawlRule } from "./url-classification";

describe("classifyUrl", () => {
  it("classifies a listing path as HIGH using the default rules", () => {
    expect(classifyUrl("/yachts/aurora-explorer", DEFAULT_CRAWL_RULES)).toEqual({
      classification: "HIGH",
      priority: 0,
    });
  });

  it("classifies a destination hub as MEDIUM and a blog post as LOW", () => {
    expect(classifyUrl("/destinations/greece", DEFAULT_CRAWL_RULES).classification).toBe("MEDIUM");
    expect(classifyUrl("/blog/how-to-charter", DEFAULT_CRAWL_RULES).classification).toBe("LOW");
  });

  it("classifies account/legal/admin paths as SKIP", () => {
    expect(classifyUrl("/privacy", DEFAULT_CRAWL_RULES).classification).toBe("SKIP");
    expect(classifyUrl("/account/settings", DEFAULT_CRAWL_RULES).classification).toBe("SKIP");
    expect(classifyUrl("/admin/dashboard", DEFAULT_CRAWL_RULES).classification).toBe("SKIP");
  });

  it("falls back to MEDIUM/0 for a path no rule matches", () => {
    expect(classifyUrl("/completely/unrecognized/path", DEFAULT_CRAWL_RULES)).toEqual({
      classification: "MEDIUM",
      priority: 0,
    });
  });

  it("prefers the longest matching prefix over a shorter one", () => {
    const rules: CrawlRule[] = [
      { pattern: "/yachts/", classification: "MEDIUM", priority: 0, enabled: true },
      { pattern: "/yachts/premium/", classification: "HIGH", priority: 0, enabled: true },
    ];
    expect(classifyUrl("/yachts/premium/aurora", rules).classification).toBe("HIGH");
  });

  it("breaks a same-length-prefix tie by priority", () => {
    const rules: CrawlRule[] = [
      { pattern: "/yachts/", classification: "LOW", priority: 0, enabled: true },
      { pattern: "/yachts/", classification: "HIGH", priority: 10, enabled: true },
    ];
    expect(classifyUrl("/yachts/aurora", rules).classification).toBe("HIGH");
  });

  it("strips a trailing '*' before matching, same as the rule document's own example syntax", () => {
    const rules: CrawlRule[] = [{ pattern: "/yachts/*", classification: "HIGH", priority: 0, enabled: true }];
    expect(classifyUrl("/yachts/aurora", rules).classification).toBe("HIGH");
  });

  it("ignores a disabled rule", () => {
    const rules: CrawlRule[] = [{ pattern: "/yachts/", classification: "HIGH", priority: 0, enabled: false }];
    expect(classifyUrl("/yachts/aurora", rules).classification).toBe("MEDIUM");
  });

  it("a source's own rules fully replace the defaults, not merge with them", () => {
    const rules: CrawlRule[] = [{ pattern: "/boats/", classification: "HIGH", priority: 0, enabled: true }];
    // "/yachts/" would be HIGH under DEFAULT_CRAWL_RULES, but this source only declared "/boats/".
    expect(classifyUrl("/yachts/aurora", rules).classification).toBe("MEDIUM");
  });
});
