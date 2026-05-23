import { expect, test } from "@playwright/test";

const requiredSupabaseAuthEnvVars = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "E2E_TEST_STUDENT_PHONE",
  "E2E_TEST_STUDENT_PASSWORD"
] as const;

const missingAuthEnvVars = requiredSupabaseAuthEnvVars.filter((name) => !process.env[name]);
const authTestsRequested = process.env.E2E_AUTH_ENABLED === "true";
const authTestsEnabled = authTestsRequested && missingAuthEnvVars.length === 0;
const authSkipReason = authTestsRequested
  ? `Skipping Supabase-backed E2E tests. Provide: ${missingAuthEnvVars.join(", ")}.`
  : "Skipping Supabase-backed E2E tests. Set E2E_AUTH_ENABLED=true with local or staging Supabase test credentials.";

test.describe("authenticated student flow", () => {
  test.skip(!authTestsEnabled, authSkipReason);

  test("student can sign in and reach today's check-in page", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel(/phone number/i).fill(process.env.E2E_TEST_STUDENT_PHONE ?? "");
    await page.getByLabel(/password/i).fill(process.env.E2E_TEST_STUDENT_PASSWORD ?? "");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/student\/check-in/);
    await expect(page.getByRole("heading", { name: "Today's Check-In" })).toBeVisible();
  });
});
