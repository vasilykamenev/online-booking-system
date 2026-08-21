import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from "./session-draft";

const KEY = "vessel-form-draft:new";
const TTL_MS = 15 * 60 * 1000;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("writeSessionDraft / readSessionDraft", () => {
  it("round-trips whatever data is written", () => {
    const data = { name: "Adriatic Dream", cabins: 3 };
    writeSessionDraft(KEY, data);
    expect(readSessionDraft(KEY, TTL_MS)).toEqual(data);
  });

  it("returns null when nothing was ever written for that key", () => {
    expect(readSessionDraft("no-such-key", TTL_MS)).toBeNull();
  });

  it("returns null for a corrupted / non-JSON value under that key", () => {
    window.sessionStorage.setItem(KEY, "{not json");
    expect(readSessionDraft(KEY, TTL_MS)).toBeNull();
  });
});

describe("draft expiry", () => {
  it("returns the draft when read within the TTL", () => {
    const start = 1_000_000;
    writeSessionDraft(KEY, { name: "Adriatic Dream" }, start);
    const justUnderTtl = start + TTL_MS - 1;
    expect(readSessionDraft(KEY, TTL_MS, justUnderTtl)).toEqual({ name: "Adriatic Dream" });
  });

  it("discards a draft older than the TTL and removes it from storage", () => {
    const start = 1_000_000;
    writeSessionDraft(KEY, { name: "Adriatic Dream" }, start);
    const pastTtl = start + TTL_MS + 1;
    expect(readSessionDraft(KEY, TTL_MS, pastTtl)).toBeNull();
    // Expired entries are cleaned up, not just ignored, so they don't linger forever.
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });
});

describe("clearSessionDraft", () => {
  it("removes a previously written draft", () => {
    writeSessionDraft(KEY, { name: "Adriatic Dream" });
    clearSessionDraft(KEY);
    expect(readSessionDraft(KEY, TTL_MS)).toBeNull();
  });

  it("is a no-op when there was nothing to clear", () => {
    expect(() => clearSessionDraft("never-written")).not.toThrow();
  });
});

describe("resilience", () => {
  it("never throws when sessionStorage.setItem fails (e.g. quota exceeded)", () => {
    const setItemSpy = vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => writeSessionDraft(KEY, { name: "Adriatic Dream" })).not.toThrow();
    setItemSpy.mockRestore();
  });

  it("never throws when sessionStorage.getItem fails", () => {
    const getItemSpy = vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSessionDraft(KEY, TTL_MS)).toBeNull();
    getItemSpy.mockRestore();
  });

  it("degrades to a no-op instead of throwing when window is unavailable (SSR)", () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error simulating a server render, where `window` doesn't exist
    delete globalThis.window;
    try {
      expect(() => writeSessionDraft(KEY, { name: "Adriatic Dream" })).not.toThrow();
      expect(readSessionDraft(KEY, TTL_MS)).toBeNull();
      expect(() => clearSessionDraft(KEY)).not.toThrow();
    } finally {
      globalThis.window = originalWindow;
    }
  });
});

afterEach(() => {
  window.sessionStorage.clear();
});
