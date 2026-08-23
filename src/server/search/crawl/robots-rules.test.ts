import { describe, expect, it } from "vitest";
import { extractSitemapDirectives, isAllowedByRobots, parseRobotsTxt } from "./robots-rules";

// Modeled on the real robots.txt observed at brilions.com during integration research — a
// standard Yoast SEO block: disallow WordPress internals/search, allow uploads, no crawl-delay.
const BRILIONS_LIKE_ROBOTS = `
# START YOAST BLOCK
User-agent: *
Disallow: /cgi-bin
Disallow: /?
Disallow: /wp-
Disallow: /wp/
Disallow: *?s=
Disallow: /search/
Allow: */uploads

User-agent: GoogleBot
Disallow: /wp-
Allow: /wp-admin/admin-ajax.php

Sitemap: https://brilions.com/sitemap_index.xml
# END YOAST BLOCK
`;

describe("parseRobotsTxt", () => {
  it("extracts only the wildcard user-agent block's rules", () => {
    const { rules } = parseRobotsTxt(BRILIONS_LIKE_ROBOTS);
    // The GoogleBot-only "Allow: /wp-admin/admin-ajax.php" must not leak into the `*` rule set.
    expect(rules.some((rule) => rule.path === "/wp-admin/admin-ajax.php")).toBe(false);
    expect(rules).toEqual(
      expect.arrayContaining([
        { path: "/cgi-bin", allow: false },
        { path: "/wp-", allow: false },
        { path: "*/uploads", allow: true },
      ]),
    );
  });

  it("ignores comments and the Sitemap/Host directives", () => {
    const { rules } = parseRobotsTxt(BRILIONS_LIKE_ROBOTS);
    expect(rules.some((rule) => rule.path.includes("sitemap"))).toBe(false);
  });

  it("returns no rules for an empty file", () => {
    expect(parseRobotsTxt("").rules).toEqual([]);
  });
});

describe("isAllowedByRobots", () => {
  const rules = parseRobotsTxt(BRILIONS_LIKE_ROBOTS);

  it("allows a vessel detail page — nothing in the file targets /yacht/", () => {
    expect(isAllowedByRobots(rules, "/yacht/antalya-adelya/")).toBe(true);
  });

  it("disallows WordPress internals", () => {
    expect(isAllowedByRobots(rules, "/wp-admin/")).toBe(false);
  });

  it("disallows the search endpoint", () => {
    expect(isAllowedByRobots(rules, "/search/")).toBe(false);
  });

  it("lets a longer, more specific Allow win over a shorter Disallow", () => {
    const specific = parseRobotsTxt("User-agent: *\nDisallow: /\nAllow: /yacht/\n");
    expect(isAllowedByRobots(specific, "/yacht/antalya-adelya/")).toBe(true);
    expect(isAllowedByRobots(specific, "/other/")).toBe(false);
  });

  it("allows everything when there are no rules at all", () => {
    expect(isAllowedByRobots({ rules: [] }, "/anything/")).toBe(true);
  });
});

describe("extractSitemapDirectives", () => {
  it("extracts the Sitemap directive from the fixture", () => {
    expect(extractSitemapDirectives(BRILIONS_LIKE_ROBOTS)).toEqual([
      "https://brilions.com/sitemap_index.xml",
    ]);
  });

  it("returns an empty array when there is no Sitemap directive", () => {
    expect(extractSitemapDirectives("User-agent: *\nDisallow: /admin\n")).toEqual([]);
  });

  it("collects multiple Sitemap directives regardless of where they sit relative to a user-agent block", () => {
    const text =
      "Sitemap: https://a.com/s1.xml\nUser-agent: *\nDisallow: /\nSitemap: https://a.com/s2.xml\n";
    expect(extractSitemapDirectives(text)).toEqual([
      "https://a.com/s1.xml",
      "https://a.com/s2.xml",
    ]);
  });
});
