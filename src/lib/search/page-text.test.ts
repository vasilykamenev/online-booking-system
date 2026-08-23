import { describe, expect, it } from "vitest";
import { extractPageSummary } from "./page-text";

describe("extractPageSummary", () => {
  it("extracts title, description, heading and visible body text", () => {
    const html = `
      <html>
        <head>
          <title>Blue Paradise Charter</title>
          <meta name="description" content="Yacht charters in Antalya" />
        </head>
        <body>
          <nav>Home | About | Contact</nav>
          <h1>Blue Paradise Gulet</h1>
          <p>A 24-meter gulet with 6 cabins, perfect for a week in the Turkish Riviera.</p>
          <script>console.log("tracking");</script>
          <footer>Copyright 2026</footer>
        </body>
      </html>
    `;
    const summary = extractPageSummary(html);
    expect(summary.title).toBe("Blue Paradise Charter");
    expect(summary.description).toBe("Yacht charters in Antalya");
    expect(summary.heading).toBe("Blue Paradise Gulet");
    expect(summary.bodyText).toContain("24-meter gulet with 6 cabins");
    expect(summary.bodyText).not.toContain("tracking");
    expect(summary.bodyText).not.toContain("Copyright");
    expect(summary.bodyText).not.toContain("Home | About | Contact");
  });

  it("falls back to og:description when there is no meta description", () => {
    const html = `<html><head><meta property="og:description" content="Fallback description" /></head><body></body></html>`;
    expect(extractPageSummary(html).description).toBe("Fallback description");
  });

  it("returns nulls, not throws, for a page with none of these elements", () => {
    const summary = extractPageSummary("<html><body>just text</body></html>");
    expect(summary.title).toBeNull();
    expect(summary.description).toBeNull();
    expect(summary.heading).toBeNull();
    expect(summary.bodyText).toBe("just text");
  });

  it("caps body text length", () => {
    const html = `<html><body>${"a".repeat(5_000)}</body></html>`;
    expect(extractPageSummary(html).bodyText.length).toBe(2_000);
  });
});
