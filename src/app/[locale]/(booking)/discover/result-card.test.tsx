import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GlobalResultCard } from "./result-card";
import { emptyResult } from "@/lib/search/offer";
import type { ResultSource } from "@/lib/search/offer";

/**
 * Covers the gap fixed here: a vessel deduplicated from an internal DB row plus an external
 * listing (spec §17) keeps the external listing in `alternateSources`, but the primary card is
 * `origin: "INTERNAL"` (internal results always win as primary, see `dedupe.ts`'s
 * `preferPrimary`). The card must surface that alternate source regardless of which origin ended
 * up primary — that's the "inform the user a vessel appeared more than once" requirement.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useLocale: () => "en",
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: ComponentProps<"a"> & { href: unknown }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

// jsdom has no IntersectionObserver, which `motion`'s `whileInView` relies on to mount at all —
// irrelevant to the dedup/attribution logic under test, so the animated wrapper is stubbed to a
// plain element.
vi.mock("motion/react", () => ({
  motion: {
    article: ({ children, ...props }: ComponentProps<"article">) => <article {...props}>{children}</article>,
  },
}));

function makeSource(overrides: Partial<ResultSource>): ResultSource {
  return {
    type: "WEBSITE",
    name: "Charter Co",
    domain: "charter.example",
    url: "https://charter.example/listing/1",
    retrievedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("GlobalResultCard", () => {
  it("shows alternate sources for an internal-origin result absorbed from a duplicate", () => {
    const result = {
      ...emptyResult("r1", "INTERNAL", makeSource({ type: "INTERNAL", name: "Наша база", url: "/vessels/adriatic-breeze" })),
      name: "Adriatic Breeze",
      alternateSources: [makeSource({ name: "Brilions", url: "https://brilions.example/adriatic-breeze" })],
    };

    render(<GlobalResultCard result={result} />);

    expect(screen.getByText(/alsoListedOn/)).not.toBeNull();
    expect(screen.getByRole("link", { name: "Brilions" }).getAttribute("href")).toBe(
      "https://brilions.example/adriatic-breeze",
    );
  });

  it("renders nothing extra for an internal-origin result with no duplicates", () => {
    const result = {
      ...emptyResult("r2", "INTERNAL", makeSource({ type: "INTERNAL", name: "Наша база", url: "/vessels/aegean-horizon" })),
      name: "Aegean Horizon",
    };

    render(<GlobalResultCard result={result} />);

    expect(screen.queryByText(/alsoListedOn/)).toBeNull();
    expect(screen.queryByText(/sourceLabel/)).toBeNull();
  });

  it("never shows an availability caveat for an internal result — the DB read already is the verification", () => {
    const result = {
      ...emptyResult("r4", "INTERNAL", makeSource({ type: "INTERNAL", name: "Наша база", url: "/vessels/nordic-star" })),
      name: "Nordic Star",
      availabilityStatus: "VERIFIED" as const,
    };

    render(<GlobalResultCard result={result} />);

    expect(screen.queryByText(/^availability\./)).toBeNull();
  });

  it("shows the freshness-dated caveat for a LIKELY_AVAILABLE external result with no live verification", () => {
    const result = {
      ...emptyResult("r5", "EXTERNAL", makeSource({})),
      name: "Polar Frontier",
      availabilityStatus: "LIKELY_AVAILABLE" as const,
      indexedAt: "2026-08-20T00:00:00.000Z",
      verifiedAt: null,
    };

    render(<GlobalResultCard result={result} />);

    expect(screen.getByText(/availability\.perCatalog/)).not.toBeNull();
  });

  it("shows the just-verified caveat once a live check ran this request", () => {
    const result = {
      ...emptyResult("r6", "EXTERNAL", makeSource({})),
      name: "Polar Frontier",
      availabilityStatus: "LIKELY_AVAILABLE" as const,
      indexedAt: "2026-08-20T00:00:00.000Z",
      verifiedAt: "2026-08-29T07:00:00.000Z",
    };

    render(<GlobalResultCard result={result} />);

    expect(screen.getByText(/availability\.verifiedNow/)).not.toBeNull();
  });

  it("shows the unknown caveat for an external result with no availability signal at all", () => {
    const result = { ...emptyResult("r7", "EXTERNAL", makeSource({})), name: "Polar Frontier" };

    render(<GlobalResultCard result={result} />);

    expect(screen.getByText(/availability\.unknown/)).not.toBeNull();
  });

  it("still shows the primary source label plus alternates for an external-origin result", () => {
    const result = {
      ...emptyResult("r3", "EXTERNAL", makeSource({ name: "Charter Co" })),
      name: "Polar Frontier",
      alternateSources: [makeSource({ name: "Yacht World", url: "https://yachtworld.example/polar-frontier" })],
    };

    render(<GlobalResultCard result={result} />);

    expect(screen.getByText(/sourceLabel/)).not.toBeNull();
    expect(screen.getByRole("link", { name: "Yacht World" }).getAttribute("href")).toBe(
      "https://yachtworld.example/polar-frontier",
    );
  });
});
