import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { VesselForm } from "./vessel-form";

/**
 * Covers the "Try again" recovery path: when a Server Action throws unexpectedly, the nearest
 * `owner/error.tsx` boundary unmounts this form entirely, and its "Try again" button remounts it
 * from scratch as a brand new component instance with no memory of anything the owner typed.
 * `VesselForm` guards against that by mirroring its field state into `sessionStorage` (see
 * `src/lib/storage/session-draft.ts`), which survives the remount. These tests simulate that
 * remount directly via `unmount()` + a fresh `render()`, rather than actually triggering an
 * error boundary.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    onClick,
    ...props
  }: ComponentProps<"a"> & { href: unknown; children?: ReactNode }) => (
    <a
      href={typeof href === "string" ? href : "#"}
      // jsdom logs "Not implemented: navigation" for a real href click — this is a test double
      // for Next's Link, not real navigation, so the click is only used to run `onClick` (e.g.
      // clearing the draft on Cancel).
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// The map widget dynamically imports Leaflet and drives real DOM/canvas APIs jsdom doesn't
// provide — irrelevant to draft persistence, so it's stubbed out.
vi.mock("@/components/map/location-picker", () => ({
  LocationPicker: () => null,
}));

// Never actually invoked in these tests (the form is never submitted), but the real modules are
// either "use server" files pulling in the Supabase/Next server graph, or hit real browser
// storage APIs — mocked to keep the test isolated.
vi.mock("@/server/actions/vessels", () => ({
  createVessel: vi.fn(async () => ({})),
  updateVessel: vi.fn(async () => ({})),
  addVesselImage: vi.fn(async () => ({})),
}));

vi.mock("@/lib/images/upload-raw", () => ({
  uploadAndAttachVesselPhotos: vi.fn(async () => ({})),
  validateVesselImageFile: () => null,
}));

const NEW_VESSEL_DRAFT_KEY = "vessel-form-draft:new";
const EDIT_VESSEL_DRAFT_KEY = "vessel-form-draft:vessel-1";
const DRAFT_TTL_MS = 15 * 60 * 1000;

function renderCreateForm() {
  return render(<VesselForm mode="create" locations={[]} />);
}

function nameInput(utils: ReturnType<typeof renderCreateForm>): HTMLInputElement {
  return utils.getByLabelText("name") as HTMLInputElement;
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("VesselForm draft persistence across a remount", () => {
  it("restores a typed field after the component remounts (simulating error.tsx's 'Try again')", () => {
    const first = renderCreateForm();
    fireEvent.change(nameInput(first), { target: { value: "Adriatic Dream" } });
    expect(nameInput(first).value).toBe("Adriatic Dream");

    // The draft is written as the owner types, independent of whether a submission ever
    // happens or fails — this is what makes it recoverable even mid-fill-in.
    expect(window.sessionStorage.getItem(NEW_VESSEL_DRAFT_KEY)).not.toBeNull();

    // Simulate owner/error.tsx unmounting the whole segment and "Try again" remounting it.
    first.unmount();
    const second = renderCreateForm();
    expect(nameInput(second).value).toBe("Adriatic Dream");
  });

  it("restores several fields at once, not just the last one touched", () => {
    const first = renderCreateForm();
    fireEvent.change(nameInput(first), { target: { value: "Adriatic Dream" } });
    fireEvent.change(first.getByLabelText("slug"), { target: { value: "adriatic-dream" } });
    fireEvent.change(first.getByLabelText("lengthMeters"), { target: { value: "14.5" } });
    fireEvent.change(first.getByLabelText("cabins"), { target: { value: "3" } });
    first.unmount();

    const second = renderCreateForm();
    expect(nameInput(second).value).toBe("Adriatic Dream");
    expect((second.getByLabelText("slug") as HTMLInputElement).value).toBe("adriatic-dream");
    expect((second.getByLabelText("lengthMeters") as HTMLInputElement).value).toBe("14.5");
    expect((second.getByLabelText("cabins") as HTMLInputElement).value).toBe("3");
  });

  it("starts blank when there is no draft in sessionStorage", () => {
    const first = renderCreateForm();
    expect(nameInput(first).value).toBe("");
  });

  it("keeps 'new vessel' and 'edit vessel <id>' drafts in separate storage keys", () => {
    const createForm = renderCreateForm();
    fireEvent.change(nameInput(createForm), { target: { value: "Adriatic Dream" } });
    createForm.unmount();

    expect(window.sessionStorage.getItem(NEW_VESSEL_DRAFT_KEY)).not.toBeNull();
    expect(window.sessionStorage.getItem(EDIT_VESSEL_DRAFT_KEY)).toBeNull();
  });

  it("clears the draft on Cancel, so a later visit starts blank again", () => {
    const first = renderCreateForm();
    fireEvent.change(nameInput(first), { target: { value: "Adriatic Dream" } });
    expect(window.sessionStorage.getItem(NEW_VESSEL_DRAFT_KEY)).not.toBeNull();

    fireEvent.click(first.getByText("cancel"));
    expect(window.sessionStorage.getItem(NEW_VESSEL_DRAFT_KEY)).toBeNull();

    first.unmount();
    const second = renderCreateForm();
    expect(nameInput(second).value).toBe("");
  });

  it("ignores a draft older than the recovery window and starts blank", () => {
    const staleDraft = {
      savedAt: Date.now() - (DRAFT_TTL_MS + 60_000),
      data: {
        fields: {
          name: "Stale Boat",
          slug: "stale-boat",
          type: "",
          newLocationName: "",
          descriptionRu: "",
          descriptionEn: "",
          lengthMeters: "",
          yearBuilt: "",
          cabins: "",
          guestsCapacity: "",
          basePrice: "",
          currency: "USD",
          status: "draft",
        },
        locationId: undefined,
        pinOverride: null,
        mainPhotoName: null,
        additionalPhotoNames: [],
      },
    };
    window.sessionStorage.setItem(NEW_VESSEL_DRAFT_KEY, JSON.stringify(staleDraft));

    const first = renderCreateForm();
    expect(nameInput(first).value).toBe("");
    // The stale entry is discarded on read (not restored) — the sync effect then re-persists
    // the form's actual (blank) current state under the same key, so storage isn't literally
    // empty afterwards, but it no longer holds the expired "Stale Boat" draft.
    const stored = window.sessionStorage.getItem(NEW_VESSEL_DRAFT_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).data.fields.name).toBe("");
  });
});
