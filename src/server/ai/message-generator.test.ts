import { describe, expect, it } from "vitest";
import { draftContactMessageTemplate, type MessageDraftInput } from "./message-generator";

function input(overrides: Partial<MessageDraftInput> = {}): MessageDraftInput {
  return {
    type: "CONTACT_REQUEST",
    locale: "en",
    vesselName: "Aurora",
    sourceName: "Brilions",
    dateFrom: null,
    dateTo: null,
    guests: null,
    userNote: null,
    ...overrides,
  };
}

describe("draftContactMessageTemplate", () => {
  it("writes in Russian for locale ru, mentioning the vessel by name", () => {
    const draft = draftContactMessageTemplate(input({ locale: "ru" }));
    expect(draft.mode).toBe("TEMPLATE");
    expect(draft.body).toContain("Aurora");
  });

  it("writes in English for locale en", () => {
    const draft = draftContactMessageTemplate(input({ locale: "en" }));
    expect(draft.body).toMatch(/^Hello!/);
  });

  it("includes dates only when both from and to are given", () => {
    const withDates = draftContactMessageTemplate(input({ dateFrom: "2026-09-01", dateTo: "2026-09-10" }));
    expect(withDates.body).toContain("2026-09-01");
    expect(withDates.body).toContain("2026-09-10");

    const withoutDates = draftContactMessageTemplate(input({ dateFrom: "2026-09-01", dateTo: null }));
    expect(withoutDates.body).not.toContain("2026-09-01");
  });

  it("includes the guest count only when present", () => {
    const withGuests = draftContactMessageTemplate(input({ guests: 6 }));
    expect(withGuests.body).toContain("6");

    const withoutGuests = draftContactMessageTemplate(input({ guests: null }));
    expect(withoutGuests.body).not.toMatch(/Guests: \d/);
  });

  it("folds in the user's own note verbatim, never inventing one", () => {
    const withNote = draftContactMessageTemplate(input({ userNote: "нужен шкипер" }));
    expect(withNote.body).toContain("нужен шкипер");

    const withoutNote = draftContactMessageTemplate(input({ userNote: null }));
    expect(withoutNote.body).not.toContain("шкипер");
  });

  it("falls back to a generic name when the vessel has none", () => {
    const draft = draftContactMessageTemplate(input({ vesselName: null, locale: "en" }));
    expect(draft.body).toContain("this vessel");
  });
});
