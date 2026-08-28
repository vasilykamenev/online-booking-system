import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SearchSourceForm, type SearchSourceFormDefaultValues } from "./search-source-form";

/**
 * Covers the one genuinely new piece of interactive UI logic this form gained
 * (docs/search-source-processing-strategies.md §1.1): the `selectorConfig` textarea only makes
 * sense for `HTML`/`HYBRID` and should stay out of the way otherwise. Doesn't drive the shadcn/Radix
 * `Select` itself (no test in this codebase does — see `vessel-form.test.tsx`'s equivalent
 * restraint), so visibility is exercised through `defaultValues.processingType`/edit-mode instead,
 * which is the same state the Select would otherwise update.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  Link: ({ href, children }: ComponentProps<"a"> & { href: unknown }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

// Never actually invoked (the form is never submitted) — "@/server/actions/admin" is a "use server"
// file pulling in the Supabase/Next server graph, same reasoning as vessel-form.test.tsx's mock of
// "@/server/actions/vessels".
vi.mock("@/server/actions/admin", () => ({
  createSearchSource: vi.fn(async () => ({})),
  updateSearchSource: vi.fn(async () => ({})),
  validateSearchSourceCandidate: vi.fn(async () => ({})),
  checkCandidateUrl: vi.fn(async () => ({})),
}));

const BASE_DEFAULTS: SearchSourceFormDefaultValues = {
  name: "Example",
  domain: "example.com",
  baseUrl: "https://example.com",
  sourceType: "WEBSITE",
  processingType: "HTML",
  priority: 50,
  notes: "",
  selectorConfig: "",
  imageDomains: "",
  autoSelectClassifications: ["HIGH"],
  detailedLogging: false,
  canDetails: false,
  canAvailability: false,
  canPricing: false,
  canContact: false,
  supportsDates: false,
  supportsPrice: false,
  supportsGuests: false,
  contactCapability: null,
  coverageWorldwide: false,
  coverageCountry: "",
  coverageRegion: "",
  coverageDestination: "",
  coverageLatitude: "",
  coverageLongitude: "",
  coverageRadiusKm: "",
  policies: "",
};

afterEach(() => {
  cleanup();
});

describe("SearchSourceForm — selectorConfig field visibility", () => {
  it("shows the selectorConfig textarea by default in create mode (defaults to HTML)", () => {
    const { queryByLabelText } = render(<SearchSourceForm mode="create" />);
    expect(queryByLabelText("selectorConfig")).not.toBeNull();
  });

  it("shows the textarea, pre-filled, when editing a HTML source", () => {
    const { getByLabelText } = render(
      <SearchSourceForm
        mode="edit"
        sourceId="s1"
        defaultValues={{ ...BASE_DEFAULTS, processingType: "HTML", selectorConfig: '{"fields":{}}' }}
      />,
    );
    expect((getByLabelText("selectorConfig") as HTMLTextAreaElement).value).toBe('{"fields":{}}');
  });

  it("shows the textarea when editing a HYBRID source", () => {
    const { queryByLabelText } = render(
      <SearchSourceForm
        mode="edit"
        sourceId="s1"
        defaultValues={{ ...BASE_DEFAULTS, processingType: "HYBRID" }}
      />,
    );
    expect(queryByLabelText("selectorConfig")).not.toBeNull();
  });

  it("hides the textarea for AI_EXTRACTION, STRUCTURED_DATA and API", () => {
    for (const processingType of ["AI_EXTRACTION", "STRUCTURED_DATA", "API"] as const) {
      const { queryByLabelText, unmount } = render(
        <SearchSourceForm
          mode="edit"
          sourceId="s1"
          defaultValues={{ ...BASE_DEFAULTS, processingType }}
        />,
      );
      expect(queryByLabelText("selectorConfig")).toBeNull();
      unmount();
    }
  });
});
