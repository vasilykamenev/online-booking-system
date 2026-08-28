import { describe, expect, it, vi } from "vitest";
import type { SearchSource, SearchProcessingType } from "@/server/search/source-registry";
import type { SelectorConfig } from "@/lib/validation/admin";
import { emptyCriteria } from "@/lib/search/request";

const { listEnabledSources } = vi.hoisted(() => ({ listEnabledSources: vi.fn() }));
vi.mock("@/server/search/source-registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/search/source-registry")>()),
  listEnabledSources,
}));

const { getActiveExternalProviders } = await import("@/server/search/provider-registry");

const SOME_SELECTOR_CONFIG: SelectorConfig = { fields: { name: { selector: "h1" } } };

function source(
  domain: string,
  processingType: SearchProcessingType,
  selectorConfig: SelectorConfig | null = null,
): SearchSource {
  return {
    id: domain,
    name: domain,
    domain,
    baseUrl: `https://${domain}/`,
    enabled: true,
    sourceType: "WEBSITE",
    processingType,
    priority: 50,
    reliabilityScore: null,
    robotsAllows: null,
    lastCheckedAt: null,
    selectorConfig,
    imageDomains: [],
    detailedLogging: false,
    accessStrategy: "WEB_PARSER",
    fallbackStrategies: [],
    capabilities: {
      canSearch: true,
      canDetails: false,
      canAvailability: false,
      canPricing: false,
      canContact: false,
      supportsLocation: true,
      supportsDates: false,
      supportsPrice: false,
      supportsGuests: false,
    },
    contactCapability: null,
    coverage: [],
  };
}

const ALL_PROCESSING_TYPES: SearchProcessingType[] = [
  "API",
  "HTML",
  "STRUCTURED_DATA",
  "AI_EXTRACTION",
  "HYBRID",
];

describe("getActiveExternalProviders", () => {
  it("resolves brilions.com to the purpose-built provider regardless of its declared processingType", async () => {
    for (const processingType of ALL_PROCESSING_TYPES) {
      listEnabledSources.mockResolvedValueOnce([source("brilions.com", processingType)]);
      const { providers } = await getActiveExternalProviders();
      expect(providers.map((p) => p.id)).toEqual(["brilions"]);
    }
  });

  it("falls back to the generic provider for AI_EXTRACTION and STRUCTURED_DATA on any other domain", async () => {
    for (const processingType of ["AI_EXTRACTION", "STRUCTURED_DATA"] as const) {
      listEnabledSources.mockResolvedValueOnce([source("example.com", processingType)]);
      const { providers } = await getActiveExternalProviders();
      expect(providers.map((p) => p.id)).toEqual(["generic:example.com"]);
    }
  });

  it("wires up no provider at all for HTML, HYBRID or API on a domain with no purpose-built implementation and no selectorConfig", async () => {
    for (const processingType of ["HTML", "HYBRID", "API"] as const) {
      listEnabledSources.mockResolvedValueOnce([source("example.com", processingType)]);
      const { providers } = await getActiveExternalProviders();
      expect(providers).toEqual([]);
    }
  });

  it("falls back to the generic provider for HTML or HYBRID once a selectorConfig is set, but not for API", async () => {
    for (const processingType of ["HTML", "HYBRID"] as const) {
      listEnabledSources.mockResolvedValueOnce([
        source("example.com", processingType, SOME_SELECTOR_CONFIG),
      ]);
      const { providers } = await getActiveExternalProviders();
      expect(providers.map((p) => p.id)).toEqual(["generic:example.com"]);
    }

    listEnabledSources.mockResolvedValueOnce([source("example.com", "API", SOME_SELECTOR_CONFIG)]);
    expect((await getActiveExternalProviders()).providers).toEqual([]);
  });

  it("never throws for any declared processingType, wired or not", async () => {
    listEnabledSources.mockResolvedValueOnce(
      ALL_PROCESSING_TYPES.map((processingType, i) => source(`site-${i}.example`, processingType)),
    );
    const { providers } = await getActiveExternalProviders();
    // Only AI_EXTRACTION and STRUCTURED_DATA are wired to the generic provider (see comment above).
    expect(providers).toHaveLength(2);
  });

  it("excludes a source whose coverage doesn't include the request's location, and reports it as skipped", async () => {
    const balticSource = {
      ...source("baltic.example", "AI_EXTRACTION"),
      coverage: [{ worldwide: false, country: "Estonia", region: null, destination: null, latitude: null, longitude: null, radiusKm: null }],
    };
    listEnabledSources.mockResolvedValueOnce([balticSource]);

    const result = await getActiveExternalProviders({
      ...emptyCriteria,
      location: { country: "Greece", region: null, city: null, marina: null, latitude: null, longitude: null },
    });

    expect(result.providers).toEqual([]);
    expect(result.skippedByCoverage).toBe(1);
  });

  it("omitting the request never excludes anything by coverage", async () => {
    const balticSource = {
      ...source("baltic.example", "AI_EXTRACTION"),
      coverage: [{ worldwide: false, country: "Estonia", region: null, destination: null, latitude: null, longitude: null, radiusKm: null }],
    };
    listEnabledSources.mockResolvedValueOnce([balticSource]);

    const result = await getActiveExternalProviders();

    expect(result.providers.map((p) => p.id)).toEqual(["generic:baltic.example"]);
    expect(result.skippedByCoverage).toBe(0);
  });
});
