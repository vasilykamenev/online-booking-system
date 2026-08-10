import { test, expect } from "@playwright/test";

test.describe("navigation", () => {
  test("locale switcher swaps locale while keeping the path", async ({ page }) => {
    await page.goto("/en/about");
    await page.getByRole("button", { name: "English" }).click();
    await page.getByRole("menuitem", { name: "Русский" }).click();
    await expect(page).toHaveURL(/\/ru\/about/);
  });

  test("header sign-in link goes to the login page", async ({ page }) => {
    await page.goto("/en");
    await page.getByRole("link", { name: /sign in/i }).first().click();
    await expect(page).toHaveURL(/\/en\/auth\/login/);
  });

  test("initiatives nav link loads the initiatives feed", async ({ page }) => {
    await page.goto("/en");
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "Initiatives", exact: true })
      .click();
    await expect(page).toHaveURL(/\/en\/initiatives/);
  });
});
