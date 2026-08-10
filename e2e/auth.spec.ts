import { test, expect } from "@playwright/test";

test.describe("auth pages", () => {
  test("login page renders email/password fields", async ({ page }) => {
    await page.goto("/en/auth/login");
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("login page links to register", async ({ page }) => {
    await page.goto("/en/auth/login");
    await page.getByRole("link", { name: /sign up|register|create account/i }).click();
    await expect(page).toHaveURL(/\/en\/auth\/register/);
  });

  test("register page renders its form", async ({ page }) => {
    await page.goto("/en/auth/register");
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
  });
});
