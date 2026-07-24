import { expect, test, type Page } from "@playwright/test";

const sharedSupabaseEnvVars = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY"
] as const;
const authTestsRequested = process.env.E2E_AUTH_ENABLED === "true";
const targetEnvironment = process.env.E2E_TEST_ENVIRONMENT?.toLowerCase() ?? "";
const targetUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
const targetHostname = (() => {
  try {
    return new URL(targetUrl).hostname;
  } catch {
    return "";
  }
})();
const productionTargetRequested =
  targetEnvironment === "production" || /(^|\.)itqan\.(website|app)$/i.test(targetHostname);
const authenticatedTargetAllowed =
  ["local", "test", "staging"].includes(targetEnvironment) && !productionTargetRequested;

function authFixture(names: readonly string[], label: string) {
  const required = [...sharedSupabaseEnvVars, ...names];
  const missing = required.filter((name) => !process.env[name]);
  const enabled = authTestsRequested && authenticatedTargetAllowed && missing.length === 0;
  const reason = productionTargetRequested
    ? `Skipping ${label} E2E tests because authenticated tests must never target production.`
    : authTestsRequested && !authenticatedTargetAllowed
      ? `Skipping ${label} E2E tests. Set E2E_TEST_ENVIRONMENT=local, test, or staging.`
    : authTestsRequested
      ? `Skipping ${label} E2E tests. Provide: ${missing.join(", ")}.`
      : `Skipping ${label} E2E tests. Set E2E_AUTH_ENABLED=true with local or disposable staging credentials.`;

  return { enabled, reason };
}

async function signIn(page: Page, phone: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/phone number/i).fill(phone);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function revealResponsiveNavigation(page: Page) {
  const menuSummary = page.locator("summary").filter({ hasText: "Menu" });
  if (await menuSummary.isVisible()) {
    await menuSummary.click();
    await expect(menuSummary.locator("..")).toHaveAttribute("open", "");
  }
}

const studentFixture = authFixture(
  ["E2E_TEST_STUDENT_PHONE", "E2E_TEST_STUDENT_PASSWORD"],
  "student"
);
const teacherFixture = authFixture(
  ["E2E_TEST_TEACHER_PHONE", "E2E_TEST_TEACHER_PASSWORD"],
  "teacher"
);
const adminTeacherFixture = authFixture(
  ["E2E_TEST_ADMIN_TEACHER_PHONE", "E2E_TEST_ADMIN_TEACHER_PASSWORD"],
  "admin-teacher"
);
const pureAdminFixture = authFixture(
  ["E2E_TEST_PURE_ADMIN_PHONE", "E2E_TEST_PURE_ADMIN_PASSWORD"],
  "pure-admin"
);

test.describe("authenticated student flow", () => {
  test.skip(!studentFixture.enabled, studentFixture.reason);

  test("student can sign in and reach today's check-in page", async ({ page }) => {
    await signIn(
      page,
      process.env.E2E_TEST_STUDENT_PHONE ?? "",
      process.env.E2E_TEST_STUDENT_PASSWORD ?? ""
    );

    await expect(page).toHaveURL(/\/student\/check-in/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /Today's Check-In|Confirm your sadaqa to unlock today's checklist|Upload this week's plan to unlock today's checklist/
      })
    ).toBeVisible();
  });
});

test.describe("authenticated teacher flow", () => {
  test.skip(!teacherFixture.enabled, teacherFixture.reason);

  test("teacher can select an available week and complete assigned-group work", async ({ page }, testInfo) => {
    await signIn(
      page,
      process.env.E2E_TEST_TEACHER_PHONE ?? "",
      process.env.E2E_TEST_TEACHER_PASSWORD ?? ""
    );

    await expect(page).toHaveURL(/\/teacher(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Assigned groups" })).toBeVisible();

    await page.goto("/teacher?week=2000-01-02");
    await expect(page).toHaveURL((url) => url.pathname === "/teacher" && url.searchParams.get("week") !== "2000-01-02");

    const weekSelector = page.getByLabel("Tracker week");
    await expect(weekSelector).toBeVisible();
    const availableWeeks = await weekSelector.locator("option").evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value)
    );
    expect(availableWeeks.length).toBeGreaterThan(0);

    const initiallySelectedWeek = await weekSelector.inputValue();
    const alternateWeek = availableWeeks.find((week) => week !== initiallySelectedWeek);
    if (alternateWeek) {
      await weekSelector.selectOption(alternateWeek);
      await expect(page).toHaveURL((url) => url.searchParams.get("week") === alternateWeek);
    }

    let groupLinks = page.getByRole("link", { name: "Open group" });
    for (const week of availableWeeks) {
      if ((await groupLinks.count()) > 0) break;
      await weekSelector.selectOption(week);
      await expect(page).toHaveURL((url) => url.searchParams.get("week") === week);
      groupLinks = page.getByRole("link", { name: "Open group" });
    }

    if ((await groupLinks.count()) === 0) {
      await expect(
        page.getByRole("heading", {
          name: /No group assigned for this week|You are not in rotation this week/
        })
      ).toBeVisible();
      return;
    }

    const groupHrefs = await groupLinks.evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).getAttribute("href")).filter(Boolean) as string[]
    );
    expect(groupHrefs.length).toBeGreaterThan(0);

    await page.goto(groupHrefs[0]);
    await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();
    await expect(page.getByText("Daily check-ins").first()).toBeVisible();
    await expect(page.getByText("Partner recitation").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save grade" }).first()).toBeVisible();

    if (groupHrefs.length > 1) {
      await page.goto(groupHrefs[1]);
      await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();
      await page.goto(groupHrefs[0]);
    }

    const planLink = page.getByRole("link", { name: "View weekly plan" }).first();
    if ((await planLink.count()) > 0) {
      const downloadPromise = page.waitForEvent("download");
      await planLink.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename().length).toBeGreaterThan(0);
    } else {
      await expect(page.getByText("No weekly plan").first()).toBeVisible();
    }

    const mutationsEnabled =
      process.env.E2E_TEST_DATA_MUTATIONS_ENABLED === "true" &&
      ["local", "test", "staging"].includes(targetEnvironment) &&
      testInfo.project.name === "chromium";
    if (mutationsEnabled) {
      await page.getByRole("button", { name: "Save grade" }).first().click();
      await expect(page.getByRole("status")).toContainText("Halaqa grade saved.");
      await expect(page.getByText(/Last saved/).first()).toBeVisible();
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("authenticated admin-teacher flow", () => {
  test.skip(!adminTeacherFixture.enabled, adminTeacherFixture.reason);

  test("admin-teacher defaults to admin and can navigate to teaching", async ({ page }) => {
    await signIn(
      page,
      process.env.E2E_TEST_ADMIN_TEACHER_PHONE ?? "",
      process.env.E2E_TEST_ADMIN_TEACHER_PASSWORD ?? ""
    );

    await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/);
    await revealResponsiveNavigation(page);
    const teachingLink = page.getByRole("link", { name: "Teaching" });
    await expect(teachingLink).toBeVisible();
    const teachingHref = await teachingLink.getAttribute("href");
    expect(teachingHref).toBe("/teacher");
    await page.goto(teachingHref ?? "/teacher");
    await expect(page).toHaveURL(/\/teacher(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Assigned groups" })).toBeVisible();
  });
});

test.describe("authenticated pure-admin flow", () => {
  test.skip(!pureAdminFixture.enabled, pureAdminFixture.reason);

  test("pure admin has no teacher navigation or teacher-shell access", async ({ page }) => {
    await signIn(
      page,
      process.env.E2E_TEST_PURE_ADMIN_PHONE ?? "",
      process.env.E2E_TEST_PURE_ADMIN_PASSWORD ?? ""
    );

    await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/);
    await revealResponsiveNavigation(page);
    await expect(page.getByRole("link", { name: "Teaching" })).toHaveCount(0);
    await page.goto("/teacher");
    await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/);

    await page.goto("/admin/rotation");
    await expect(page.getByRole("heading", { name: "Weekly Rotation" })).toBeVisible();
    await expect(page.getByText(/^Saturday, /).first()).toBeVisible();
    await expect(page.getByLabel("Masjid")).toHaveCount(0);
    await expect(page.getByLabel("Cohort")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Halaqa week" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Rotation readiness" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Group setup" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Teacher availability" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Assignment preview" })).toBeVisible();

    const availabilityCheckboxes = page.getByRole("checkbox", {
      name: /@itqan\.local/
    });
    if ((await availabilityCheckboxes.count()) > 0) {
      const firstAvailability = availabilityCheckboxes.first();
      const initiallyChecked = await firstAvailability.isChecked();
      const publishAssignments = page.getByRole("button", { name: "Publish assignments" });

      await firstAvailability.setChecked(!initiallyChecked);
      await expect(
        page.getByText("Unsaved availability changes. Save to refresh the assignment preview.")
      ).toBeVisible();
      await expect(
        page.getByText(/Assignment preview paused\. Save teacher availability/)
      ).toBeVisible();
      await expect(publishAssignments).toBeDisabled();

      await firstAvailability.setChecked(initiallyChecked);
      await expect(
        page.getByText("Unsaved availability changes. Save to refresh the assignment preview.")
      ).toHaveCount(0);
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
