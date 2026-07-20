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

const teacherAuthEnvVars = [
  ...requiredSupabaseAuthEnvVars.slice(0, 3),
  "E2E_TEST_TEACHER_PHONE",
  "E2E_TEST_TEACHER_PASSWORD"
] as const;
const missingTeacherAuthEnvVars = teacherAuthEnvVars.filter((name) => !process.env[name]);
const teacherAuthTestsEnabled = authTestsRequested && missingTeacherAuthEnvVars.length === 0;
const teacherAuthSkipReason = authTestsRequested
  ? `Skipping teacher E2E tests. Provide: ${missingTeacherAuthEnvVars.join(", ")}.`
  : authSkipReason;

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

test.describe("authenticated teacher flow", () => {
  test.skip(!teacherAuthTestsEnabled, teacherAuthSkipReason);

  test("teacher can open the assigned group roster at desktop and mobile sizes", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel(/phone number/i).fill(process.env.E2E_TEST_TEACHER_PHONE ?? "");
    await page.getByLabel(/password/i).fill(process.env.E2E_TEST_TEACHER_PASSWORD ?? "");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/teacher(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Assigned groups" })).toBeVisible();

    const openGroup = page.getByRole("link", { name: "Open group" }).first();
    await expect(openGroup).toBeVisible();
    await openGroup.click();

    await expect(page).toHaveURL(/\/teacher\/groups\//);
    await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();
    await expect(page.getByText("Daily check-ins").first()).toBeVisible();
    await expect(page.getByText("Partner recitation").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save grade" }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
