import { expect, test, type Page } from "@playwright/test";

async function fillLogin(page: Page) {
  await page.getByLabel("Phone Number", { exact: true }).fill("4165550100");
  await page.getByLabel("Password", { exact: true }).fill("assigned-password");
}

function loginAlert(page: Page) {
  return page.locator('form p[role="alert"]');
}

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

  test("shows the expired-session notice", async ({ page }) => {
    await page.goto("/login?status=session-expired");

    await expect(page.getByRole("status")).toHaveText(
      "Your previous session expired. Sign in again to continue."
    );
  });

  test("shows a stable invalid-credentials message and preserves entered values", async ({ page }) => {
    await page.route("**/api/login", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: { code: "invalid_credentials" } })
      });
    });
    await page.goto("/login");
    await fillLogin(page);

    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(loginAlert(page)).toHaveText("The phone number or password is incorrect.");
    await expect(page.getByLabel("Phone Number", { exact: true })).toHaveValue("(416) 555-0100");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("assigned-password");
  });

  test("handles edge throttling and non-JSON upstream failures", async ({ page }) => {
    let responseMode: "rate-limited" | "upstream-failure" = "rate-limited";
    await page.route("**/api/login", async (route) => {
      if (responseMode === "rate-limited") {
        await route.fulfill({ status: 429, contentType: "text/html", body: "Rate limited by edge" });
        return;
      }

      await route.fulfill({ status: 502, contentType: "text/html", body: "Upstream proxy error" });
    });
    await page.goto("/login");
    await fillLogin(page);

    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(loginAlert(page)).toHaveText(
      "Too many sign-in attempts. Wait a few minutes and try again."
    );

    responseMode = "upstream-failure";
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(loginAlert(page)).toHaveText(
      "Sign-in is temporarily unavailable. Please try again."
    );
  });

  test("disables the form and prevents duplicate submissions while signing in", async ({ page }) => {
    let requestCount = 0;
    let releaseResponse: () => void = () => undefined;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });

    await page.route("**/api/login", async (route) => {
      requestCount += 1;
      await responseGate;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: { code: "invalid_credentials" } })
      });
    });
    await page.goto("/login");
    await fillLogin(page);

    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("button", { name: "Signing in..." })).toBeDisabled();
    await expect(page.getByLabel("Phone Number", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Password", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Show password" })).toBeDisabled();

    await page.evaluate(() => {
      const form = document.querySelector("form");
      form?.requestSubmit();
      form?.requestSubmit();
    });
    await expect.poll(() => requestCount).toBe(1);

    releaseResponse();
    await expect(loginAlert(page)).toHaveText("The phone number or password is incorrect.");
  });
});
