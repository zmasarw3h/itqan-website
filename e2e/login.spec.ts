import { expect, test } from "@playwright/test";

test.describe("login", () => {
  test("renders the login form", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText("وَرَتِّلِ ٱلْقُرْءَانَ تَرْتِيلًا")).toBeVisible();
    await expect(page.getByText("And recite the Quran properly in a measured way.")).toBeVisible();
    await expect(page.getByLabel("Phone Number", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("formats phone numbers and toggles password visibility", async ({ page }) => {
    await page.goto("/login");

    const phoneInput = page.getByLabel("Phone Number", { exact: true });
    await phoneInput.fill("4165550100");
    await expect(phoneInput).toHaveValue("(416) 555-0100");

    await phoneInput.fill("+442079460958");
    await expect(phoneInput).toHaveValue("+44 20 7946 0958");

    const passwordInput = page.getByLabel("Password", { exact: true });
    await passwordInput.fill("assigned-password");
    await expect(passwordInput).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "Show password" }).click();
    await expect(passwordInput).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Hide password" })).toBeVisible();
  });
});
