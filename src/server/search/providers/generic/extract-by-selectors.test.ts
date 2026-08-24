import { describe, expect, it } from "vitest";
import type { SelectorConfig } from "@/lib/validation/admin";
import { extractBySelectors } from "./extract-by-selectors";

const FULL_FIXTURE = `<!doctype html><html><head>
  <meta property="og:image" content="https://example.com/photo.jpg" />
</head><body>
  <h1 class="title">Ocean Breeze</h1>
  <p class="summary">A 3-cabin motor yacht.</p>
  <span class="capacity">Гостей: 8 чел.</span>
  <span class="cabins">Каюты: 3</span>
  <span class="type">Motor Yacht</span>
  <span class="location">Antalya, Turkey</span>
</body></html>`;

const FULL_CONFIG: SelectorConfig = {
  fields: {
    name: { selector: "h1.title" },
    description: { selector: "p.summary" },
    image: { selector: 'meta[property="og:image"]', attr: "content" },
    guests: { selector: "span.capacity", regex: "(\\d+)" },
    cabins: { selector: "span.cabins", regex: "(\\d+)" },
    vesselTypeRaw: { selector: "span.type" },
    country: { selector: "span.location" },
  },
};

describe("extractBySelectors", () => {
  it("reads every configured field, including attr and regex extraction", () => {
    const result = extractBySelectors(FULL_FIXTURE, FULL_CONFIG);
    expect(result).toEqual({
      name: "Ocean Breeze",
      description: "A 3-cabin motor yacht.",
      image: "https://example.com/photo.jpg",
      guests: 8,
      cabins: 3,
      vesselTypeRaw: "Motor Yacht",
      country: "Antalya, Turkey",
      city: null,
    });
  });

  it("returns null when the name selector matches nothing", () => {
    const config: SelectorConfig = { fields: { name: { selector: "h1.does-not-exist" } } };
    expect(extractBySelectors(FULL_FIXTURE, config)).toBeNull();
  });

  it("returns null when there is no name selector configured at all", () => {
    const config: SelectorConfig = { fields: { description: { selector: "p.summary" } } };
    expect(extractBySelectors(FULL_FIXTURE, config)).toBeNull();
  });

  it("falls back to the unfiltered value when the regex is malformed, instead of dropping the field", () => {
    const config: SelectorConfig = {
      fields: {
        name: { selector: "h1.title" },
        guests: { selector: "span.capacity", regex: "(" }, // invalid pattern
      },
    };
    const result = extractBySelectors(FULL_FIXTURE, config);
    // "Гостей: 8 чел." isn't a finite number as a whole, so the numeric coercion still yields null —
    // the point of this test is that a bad regex doesn't throw, not that it produces a number.
    expect(result?.guests).toBeNull();
  });

  it("returns null for a numeric field whose extracted text isn't a number", () => {
    const config: SelectorConfig = {
      fields: {
        name: { selector: "h1.title" },
        guests: { selector: "span.type" }, // "Motor Yacht" — not numeric, no regex to isolate digits
      },
    };
    expect(extractBySelectors(FULL_FIXTURE, config)?.guests).toBeNull();
  });
});
