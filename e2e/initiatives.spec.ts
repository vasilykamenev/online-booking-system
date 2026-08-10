import { test, expect } from "@playwright/test";

test.describe("initiatives feed", () => {
  test("initiatives page renders filters and heading", async ({ page }) => {
    await page.goto("/en/initiatives");
    await expect(page.getByRole("heading", { name: "Expeditions & initiatives" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Publish an initiative" })).toBeVisible();
    await expect(page.getByText("Status", { exact: true })).toBeVisible();
  });

  test("filtering by status updates the URL", async ({ page }) => {
    await page.goto("/en/initiatives");
    await page.getByRole("combobox").filter({ hasText: "Any status" }).click();
    await page.getByRole("option", { name: "Open", exact: true }).click();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/\/en\/initiatives\?status=open/);
  });

  test("visiting an unknown initiative id shows a not-found state", async ({ page }) => {
    await page.goto("/en/initiatives/00000000-0000-0000-0000-000000000000");
    await expect(page.getByRole("heading", { name: "Initiative not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to initiatives" })).toBeVisible();
  });
});
