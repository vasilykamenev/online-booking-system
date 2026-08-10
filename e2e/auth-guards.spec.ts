import { test, expect } from "@playwright/test";

test.describe("protected routes redirect anonymous users to login", () => {
  for (const path of ["/en/account", "/en/owner", "/en/admin", "/en/initiatives/new"]) {
    test(`${path} redirects to login when unauthenticated`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/en\/auth\/login/);
    });
  }
});

test.describe("login and registration flows", () => {
  test("login with wrong credentials shows an error message", async ({ page }) => {
    await page.goto("/en/auth/login");
    await page.locator("#email").fill("nobody@example.com");
    await page.locator("#password").fill("wrong-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  });

  test("register with a weak password shows a validation error", async ({ page }) => {
    await page.goto("/en/auth/register");
    await page.locator("#fullName").fill("Test Sailor");
    await page.locator("#email").fill(`e2e-${Date.now()}@example.com`);
    await page.locator("#password").fill("short");
    await page.locator("#password").evaluate((el) => {
      (el as HTMLInputElement).removeAttribute("minlength");
    });
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText("Something went wrong. Please try again.")).toBeVisible();
  });

  test("forgot password page submits and shows a success state", async ({ page }) => {
    await page.goto("/en/auth/forgot-password");
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    await page.locator("#email").fill("someone@example.com");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Link sent" })).toBeVisible();
    await expect(page.getByRole("link", { name: /back to sign in/i })).toBeVisible();
  });

  test("forgot password page links back to login", async ({ page }) => {
    await page.goto("/en/auth/forgot-password");
    await page.getByRole("link", { name: /back to sign in/i }).click();
    await expect(page).toHaveURL(/\/en\/auth\/login/);
  });
});
