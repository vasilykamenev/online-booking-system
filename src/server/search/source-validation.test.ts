import { describe, expect, it } from "vitest";
import { detectSearchForm } from "./source-validation";

describe("detectSearchForm", () => {
  it("finds a form with two or more vessel-search-shaped field names", () => {
    const html = `
      <html><body>
        <form action="/search" method="GET">
          <input name="destination" />
          <input name="checkin" type="date" />
          <input name="checkout" type="date" />
          <select name="guests"></select>
        </form>
      </body></html>
    `;
    const result = detectSearchForm(html);
    expect(result.found).toBe(true);
    expect(result.action).toBe("/search");
    expect(result.method).toBe("GET");
    expect(result.fieldNames).toEqual(
      expect.arrayContaining(["destination", "checkin", "checkout", "guests"]),
    );
  });

  it("ignores a form with fewer than two matching fields (e.g. a newsletter signup)", () => {
    const html = `
      <form action="/subscribe" method="POST">
        <input name="email" />
        <input name="city" />
      </form>
    `;
    const result = detectSearchForm(html);
    expect(result.found).toBe(false);
    expect(result.fieldNames).toEqual([]);
  });

  it("reports no form when the page has none", () => {
    const result = detectSearchForm("<html><body><p>No forms here.</p></body></html>");
    expect(result.found).toBe(false);
    expect(result.action).toBeNull();
  });

  it("defaults method to GET when the form omits it", () => {
    const html = `
      <form action="/yachts">
        <input name="marina" />
        <input name="cabins" />
      </form>
    `;
    const result = detectSearchForm(html);
    expect(result.found).toBe(true);
    expect(result.method).toBe("GET");
  });

  it("matches the first qualifying form when a page has several", () => {
    const html = `
      <form action="/login">
        <input name="username" />
        <input name="password" />
      </form>
      <form action="/charter-search">
        <input name="location" />
        <input name="adults" />
      </form>
    `;
    const result = detectSearchForm(html);
    expect(result.found).toBe(true);
    expect(result.action).toBe("/charter-search");
  });
});
