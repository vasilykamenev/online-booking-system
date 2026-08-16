import { describe, expect, it } from "vitest";
import { canOwnerConfirm, canSelectPaymentMethod, canStartPayment } from "./payment-flow";

describe("canSelectPaymentMethod", () => {
  it("allows selection while pending or confirmed", () => {
    expect(canSelectPaymentMethod("pending")).toBe(true);
    expect(canSelectPaymentMethod("confirmed")).toBe(true);
  });

  it("disallows selection once the deal is settled or dead", () => {
    expect(canSelectPaymentMethod("paid")).toBe(false);
    expect(canSelectPaymentMethod("completed")).toBe(false);
    expect(canSelectPaymentMethod("cancelled")).toBe(false);
  });
});

describe("canOwnerConfirm", () => {
  it("requires pending status and a declared payment method", () => {
    expect(canOwnerConfirm("pending", "stripe")).toBe(true);
    expect(canOwnerConfirm("pending", "bank_transfer")).toBe(true);
  });

  it("blocks confirmation without a declared payment method", () => {
    expect(canOwnerConfirm("pending", null)).toBe(false);
  });

  it("blocks confirmation outside pending", () => {
    expect(canOwnerConfirm("confirmed", "stripe")).toBe(false);
    expect(canOwnerConfirm("paid", "stripe")).toBe(false);
  });
});

describe("canStartPayment", () => {
  it("requires confirmed status and a matching provider", () => {
    expect(canStartPayment("confirmed", "stripe", "stripe")).toBe(true);
  });

  it("blocks a provider that doesn't match the declared method", () => {
    expect(canStartPayment("confirmed", "bank_transfer", "stripe")).toBe(false);
  });

  it("blocks payment before the owner has confirmed", () => {
    expect(canStartPayment("pending", "stripe", "stripe")).toBe(false);
  });

  it("blocks payment with no declared method", () => {
    expect(canStartPayment("confirmed", null, "stripe")).toBe(false);
  });
});
