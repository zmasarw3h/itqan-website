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
  await page.getByRole("textbox", { name: "Password" }).fill(password);
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
const superAdminFixture = authFixture(
  ["E2E_TEST_SUPER_ADMIN_PHONE", "E2E_TEST_SUPER_ADMIN_PASSWORD"],
  "super-admin"
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
    await expect(page.getByRole("heading", { name: "Published teaching groups" })).toBeVisible();

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

    let groupLinks = page.getByRole("link", { name: "Open grading workspace" });
    for (const week of availableWeeks) {
      if ((await groupLinks.count()) > 0) break;
      await weekSelector.selectOption(week);
      await expect(page).toHaveURL((url) => url.searchParams.get("week") === week);
      groupLinks = page.getByRole("link", { name: "Open grading workspace" });
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
    await expect(page.getByText("Grading workspace").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Checklist" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true }).first()).toBeVisible();

    const checklistTrigger = page.getByRole("button", { name: "Checklist" }).first();
    await checklistTrigger.focus();
    await checklistTrigger.click();
    const checklistDialog = page.getByRole("dialog", { name: /.+/ });
    await expect(checklistDialog).toBeVisible();
    await expect(checklistDialog.getByText("Private notes are never shown.").first()).toBeVisible();
    await expect(checklistDialog.getByText(/raw check-ins|correction actor|audit metadata|submission timestamp/i)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(checklistDialog).toBeHidden();
    await expect(checklistTrigger).toBeFocused();

    if (groupHrefs.length > 1) {
      await page.goto(groupHrefs[1]);
      await expect(page.getByText("Grading workspace").first()).toBeVisible();
      await page.goto(groupHrefs[0]);
    }

    const planLink = page.getByRole("link", { name: "Weekly plan" }).first();
    if ((await planLink.count()) > 0) {
      const downloadPromise = page.waitForEvent("download");
      await planLink.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename().length).toBeGreaterThan(0);
    } else {
      await expect(page.getByText("No plan").first()).toBeVisible();
    }

    const mutationsEnabled =
      process.env.E2E_TEST_DATA_MUTATIONS_ENABLED === "true" &&
      ["local", "test", "staging"].includes(targetEnvironment) &&
      testInfo.project.name === "chromium";
    if (mutationsEnabled) {
      await page.getByRole("button", { name: "Save", exact: true }).first().click();
      await expect(page.getByRole("status")).toContainText("Halaqa grade saved.");
      await expect(page.getByText("Saved").first()).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Published teaching groups" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Weekly rotation" })).toBeVisible();
    await expect(page).toHaveURL((url) => url.searchParams.get("step") === "students");
    await expect(page.getByLabel("Masjid")).toHaveCount(0);
    await expect(page.getByLabel("Cohort")).toBeVisible();
    await expect(page.getByLabel("Week")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Rotation progress" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Student availability" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Teacher availability" })).toHaveCount(0);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("admin completes the authoritative four-step rotation journey through publish readiness", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const mutationsEnabled =
      process.env.E2E_TEST_DATA_MUTATIONS_ENABLED === "true" &&
      ["local", "test", "staging"].includes(targetEnvironment) &&
      testInfo.project.name === "chromium";
    test.skip(!mutationsEnabled, "Rotation journey writes only to explicitly enabled disposable data.");

    await signIn(page, process.env.E2E_TEST_PURE_ADMIN_PHONE ?? "", process.env.E2E_TEST_PURE_ADMIN_PASSWORD ?? "");
    await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/);
    const week = process.env.E2E_TEST_ROTATION_WEEK;
    await page.goto(week ? `/admin/rotation?week=${week}&step=students` : "/admin/rotation?step=students");
    await expect(page.getByRole("heading", { name: "Student availability" })).toBeVisible();

    await page.getByRole("button", { name: /Confirm availability|Re-confirm availability|Save availability/ }).click();
    await expect(page.getByText("Student availability saved.")).toBeVisible();
    const staleReviewUrl = new URL(page.url());
    staleReviewUrl.searchParams.set("step", "review");
    staleReviewUrl.searchParams.delete("status");
    await page.goto(staleReviewUrl.toString());
    await expect(page).toHaveURL((url) => url.searchParams.get("step") === "groups");
    await expect(page.getByText(/This draft is stale/)).toBeVisible();
    const studentsStepUrl = new URL(page.url());
    studentsStepUrl.searchParams.set("step", "students");
    await page.goto(studentsStepUrl.toString());
    await page.getByRole("button", { name: "Continue to teacher availability" }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("step") === "teachers");
    await expect(page.getByPlaceholder("Search teachers…")).toBeVisible();
    await page.getByRole("button", { name: "Clear all" }).click();
    await page.getByRole("button", { name: /Confirm availability|Re-confirm availability|Save availability/ }).click();
    await expect(page.getByText("Teacher availability saved.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue to session groups" })).toBeDisabled();
    const groupsUrl = new URL(page.url());
    groupsUrl.searchParams.set("step", "groups");
    groupsUrl.searchParams.delete("status");
    await page.goto(groupsUrl.toString());
    await expect(page).toHaveURL((url) => url.searchParams.get("step") === "teachers");
    await expect(page.getByRole("heading", { name: "Teacher availability" })).toBeVisible();
    const teacherAvailabilityGroups = page.getByRole("group", { name: /Availability for/ });
    expect(await teacherAvailabilityGroups.count()).toBeGreaterThan(1);
    const anchoredTeacherGroups = [
      page.getByRole("group", { name: "Availability for Hassan Youssef" }),
      page.getByRole("group", { name: "Availability for teacherA" })
    ];
    const useAnchoredFixture = await anchoredTeacherGroups[0].count() > 0 && await anchoredTeacherGroups[1].count() > 0;
    await (useAnchoredFixture ? anchoredTeacherGroups[0] : teacherAvailabilityGroups.nth(0)).getByText("Available", { exact: true }).click();
    await (useAnchoredFixture ? anchoredTeacherGroups[1] : teacherAvailabilityGroups.nth(1)).getByText("Available", { exact: true }).click();
    await page.getByRole("button", { name: /Confirm availability|Re-confirm availability|Save availability/ }).click();
    await expect(page.getByText("Teacher availability saved.")).toBeVisible();
    await page.getByRole("button", { name: "Continue to session groups" }).click();
    await expect(page.getByRole("heading", { name: "Session groups" })).toBeVisible();

    await generateOrRegenerateGroups(page);
    await page.getByRole("button", { name: "Continue to review" }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("step") === "review");
    await expect(page.getByRole("link", { name: "Edit students" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit teachers" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit groups" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: /Review & publish|Review revision/ })).toBeVisible();
    await page.getByRole("link", { name: "Edit teachers" }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("step") === "teachers");
    const studentsUrl = new URL(page.url());
    studentsUrl.searchParams.set("step", "students");
    await page.goto(studentsUrl.toString());
    await page.goBack();
    await expect(page).toHaveURL((url) => url.searchParams.get("step") === "teachers");
    await page.goForward();
    await expect(page).toHaveURL((url) => url.searchParams.get("step") === "students");
    const teachersUrl = new URL(page.url());
    teachersUrl.searchParams.set("step", "teachers");
    await page.goto(teachersUrl.toString());

    await page.getByRole("button", { name: "Re-confirm availability" }).click();
    const reviewUrl = new URL(page.url());
    reviewUrl.searchParams.set("step", "review");
    reviewUrl.searchParams.delete("status");
    await page.goto(reviewUrl.toString());
    await expect(page).toHaveURL((url) => url.searchParams.get("step") === "groups");
    await expect(page.getByText(/This draft is stale/)).toBeVisible();
    await generateOrRegenerateGroups(page);

    await page.getByRole("button", { name: "Open detailed placement controls" }).click();
    const placementSelects = page.getByRole("combobox", { name: /Session group for/ });
    await expect(placementSelects.first()).toBeVisible();
    const options = await placementSelects.first().locator("option").evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value).filter(Boolean));
    expect(options.length).toBeGreaterThan(1);
    const currentSlot = await placementSelects.first().inputValue();
    await placementSelects.first().selectOption(options.find((option) => option !== currentSlot)!);
    await expect(page.getByText("Moved for Saturday").first()).toBeVisible();
    await page.getByRole("button", { name: "Continue to review" }).click();
    await expect(page.getByText(/1 moved/).first()).toBeVisible();

    const prepareReview = page.getByRole("button", { name: /Prepare review|Review again/ });
    await prepareReview.click();
    await page.getByLabel("I reviewed availability, teacher responsibilities, and all Saturday placements.").check();
    await expect(page.getByRole("button", { name: "Publish Saturday roster" })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

async function generateOrRegenerateGroups(page: Page) {
  const generate = page.getByRole("button", { name: /Generate groups|Regenerate groups/ });
  const label = await generate.textContent();
  await generate.click();
  if (label?.includes("Regenerate")) {
    await page.getByRole("button", { name: "Confirm regeneration" }).click();
  }
  await expect(page.getByRole("status")).toContainText(/Session groups (generated|regenerated)/);
}

test.describe("authenticated super-admin flow", () => {
  test.skip(!superAdminFixture.enabled, superAdminFixture.reason);

  test("super admin signs in to the guarded super-admin console", async ({ page }) => {
    await signIn(
      page,
      process.env.E2E_TEST_SUPER_ADMIN_PHONE ?? "",
      process.env.E2E_TEST_SUPER_ADMIN_PASSWORD ?? ""
    );

    await expect(page).toHaveURL(/\/super-admin(?:\/|\?|$)/);
    await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
  });
});
