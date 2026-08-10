import { test, expect } from "@playwright/test";

test.describe("marketing pages", () => {
  test("home page renders in English", async ({ page }) => {
    await page.goto("/en");
    await expect(page).toHaveTitle(/Maritime Booking Platform/);
    await expect(page.getByRole("banner").getByRole("link", { name: "Meridian" })).toBeVisible();
  });

  test("home page renders in Russian", async ({ page }) => {
    await page.goto("/ru");
    await expect(page).toHaveTitle(/Морская платформа бронирования/);
  });

  test("about page loads", async ({ page }) => {
    await page.goto("/en/about");
    await expect(page).toHaveTitle(/Meridian/);
  });

  test("contact page loads", async ({ page }) => {
    await page.goto("/en/contact");
    await expect(page.getByRole("heading", { name: "Get in touch" })).toBeVisible();
  });
});
