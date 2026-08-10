import { test, expect } from "@playwright/test";

test.describe("vessel search", () => {
  test("search page renders filters and results section", async ({ page }) => {
    await page.goto("/en/search");
    await expect(page.getByRole("heading", { name: "Find your vessel" })).toBeVisible();
    await expect(page.getByText("Destination", { exact: true })).toBeVisible();
    await expect(page.getByText("Vessel type", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Guests, at least")).toBeVisible();
    await expect(page.getByLabel("Price per night, up to")).toBeVisible();
  });

  test("applying the vessel type filter updates the URL", async ({ page }) => {
    await page.goto("/en/search");
    await page.getByRole("combobox").filter({ hasText: "Any type" }).click();
    await page.getByRole("option", { name: "Catamaran" }).click();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/\/en\/search\?type=catamaran/);
  });

  test("applying a guests filter updates the URL", async ({ page }) => {
    await page.goto("/en/search");
    await page.getByLabel("Guests, at least").fill("4");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/guests=4/);
  });

  test("visiting an unknown vessel slug shows a not-found state", async ({ page }) => {
    await page.goto("/en/vessels/does-not-exist-slug");
    await expect(page.getByRole("heading", { name: "Vessel not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse the fleet" })).toBeVisible();
  });
});
