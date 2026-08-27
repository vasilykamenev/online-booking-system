import { test, expect } from "@playwright/test";

test.describe("vessel search", () => {
  test("search page renders filters and results section", async ({ page }) => {
    await page.goto("/en/search");
    await expect(page.getByRole("heading", { name: "Find your vessel" })).toBeVisible();
    await expect(page.getByText("Destination", { exact: true })).toBeVisible();
    await expect(page.getByText("Vessel type", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Guests, at least")).toBeVisible();
    await expect(page.getByRole("button", { name: "Any dates" })).toBeVisible();
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

  test("advanced filters sheet applies a price filter and shows a removable chip", async ({ page }) => {
    await page.goto("/en/search");
    await page.getByRole("button", { name: "More filters" }).click();
    await page.getByLabel("Price per night, up to").fill("1000");
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/priceMax=1000/);

    await expect(page.getByText("Price: up to 1000")).toBeVisible();
    await page.getByRole("button", { name: "Remove filter" }).click();
    await expect(page).not.toHaveURL(/priceMax/);
  });

  test("changing sort order updates the URL and keeps other filters", async ({ page }) => {
    await page.goto("/en/search?guests=4");
    await page.getByRole("combobox").filter({ hasText: "Highest rated first" }).click();
    await page.getByRole("option", { name: "Price: low to high" }).click();
    await expect(page).toHaveURL(/sort=price_asc/);
    await expect(page).toHaveURL(/guests=4/);
  });

  test("visiting an unknown vessel slug shows a not-found state", async ({ page }) => {
    await page.goto("/en/vessels/does-not-exist-slug");
    await expect(page.getByRole("heading", { name: "Vessel not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse the fleet" })).toBeVisible();
  });
});
