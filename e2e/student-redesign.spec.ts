import { expect, test, type Page } from "@playwright/test";

const enabled = process.env.E2E_STUDENT_REDESIGN_ENABLED === "true";
const password = process.env.E2E_STUDENT_REDESIGN_PASSWORD ?? "";
const studentPhone = process.env.E2E_STUDENT_REDESIGN_PHONE ?? "";
const pendingPhone = process.env.E2E_STUDENT_REDESIGN_PENDING_PHONE ?? "";
const longTextPhone = process.env.E2E_STUDENT_REDESIGN_LONG_TEXT_PHONE ?? "";

async function signIn(page: Page, phone: string) {
  await page.goto("/login");
  await page.getByLabel(/phone number/i).fill(phone);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/student\/check-in/);
}

test.describe("student redesign Batch 1", () => {
  test.skip(!enabled || !password || !studentPhone, "Requires disposable local student redesign fixtures.");

  test("autosaves, handles rapid row changes, retries failure, and persists after reload", async ({ page }) => {
    await signIn(page, studentPhone);
    const checklist = page.getByRole("group", { name: "Today’s checklist" });
    const boxes = checklist.getByRole("checkbox");
    await expect(boxes.nth(1)).toBeVisible();
    expect(await boxes.count()).toBeGreaterThanOrEqual(2);

    const firstInitial = await boxes.first().isChecked();
    await boxes.first().click();
    await expect(page.getByText("Saved just now")).toBeVisible();
    const firstSaved = await boxes.first().isChecked();

    await Promise.all([boxes.nth(0).click(), boxes.nth(1).click()]);
    await expect(page.getByText("Saving…").first()).toBeVisible();
    await expect(page.getByText("Saved just now")).toBeVisible();
    const rapidState = [await boxes.nth(0).isChecked(), await boxes.nth(1).isChecked()];

    let failed = false;
    await page.route("**/student/check-in", async (route) => {
      if (!failed && route.request().method() === "POST") { failed = true; await route.abort("failed"); return; }
      await route.continue();
    });
    const target = boxes.nth(1);
    const persistedBeforeFailure = await target.isChecked();
    await target.click();
    await expect(page.getByText("Could not save this change.")).toBeVisible();
    await expect(target).toBeChecked({ checked: persistedBeforeFailure });
    await page.unroute("**/student/check-in");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Saved just now")).toBeVisible();
    const retriedState = await target.isChecked();

    await page.reload();
    const reloaded = page.getByRole("group", { name: "Today’s checklist" }).getByRole("checkbox");
    await expect(reloaded.nth(0)).toBeChecked({ checked: rapidState[0] });
    await expect(reloaded.nth(1)).toBeChecked({ checked: retriedState });
    expect(firstSaved).toBe(!firstInitial);
  });

  test("shows offline state, refreshes on reconnect, and keeps unrelated saved content", async ({ page, context }) => {
    await signIn(page, studentPhone);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByText("You’re offline")).toBeVisible();
    await expect(page.getByRole("group", { name: "Today’s checklist" }).getByRole("checkbox").first()).toBeDisabled();
    await context.setOffline(false);
    await expect(page.getByRole("heading", { name: /Assalamu alaykum/ })).toBeVisible();
    await expect(page.getByText("You’re offline")).toHaveCount(0);
  });

  test("supports keyboard account sheet behavior and exact responsive screenshots", async ({ page }) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1024 });
    await signIn(page, studentPhone);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Assalamu alaykum/ })).toBeVisible();
    await expect(page.getByRole("group", { name: "Today’s checklist" })).toBeVisible();
    await page.screenshot({ path: "output/student-redesign-batch-1/today-1440x1024.png", fullPage: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    const trigger = page.getByRole("button", { name: "Open account menu" });
    await page.screenshot({ path: "output/student-redesign-batch-1/today-390x844.png", fullPage: false });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Aaliyah Malik" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    const bottomNav = page.getByRole("navigation", { name: "Student navigation" });
    await expect(bottomNav.getByRole("link")).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const lastContent = page.locator(".today-progress-card");
    await lastContent.scrollIntoViewIfNeeded();
    const contentBox = await lastContent.boundingBox();
    const navBox = await bottomNav.boundingBox();
    expect((contentBox?.y ?? 0) + (contentBox?.height ?? 0)).toBeLessThanOrEqual(navBox?.y ?? 0);
    expect(await page.locator("nextjs-portal, [data-next-badge]").count()).toBe(0);
    expect(browserErrors).toEqual([]);
  });

  test("keeps loading hierarchy stable and page copy sanitized", async ({ page }) => {
    await signIn(page, studentPhone);
    await page.route("**/student/grades*", async (route) => { await new Promise((resolve) => setTimeout(resolve, 500)); await route.continue(); });
    await page.goto("/student/partner-recitation");
    const navigation = page.getByRole("link", { name: "Grades", exact: true }).click();
    await expect(page.locator(".student-loading")).toBeVisible({ timeout: 1500 });
    await navigation;
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page).toHaveURL(/\/student\/grades/);
    await page.unroute("**/student/grades*");
    await expect(page.locator("body")).not.toContainText(/supabase|stack trace|authorization id/i);
  });

  test("shows assignment pending without fabricated placement", async ({ page }) => {
    test.skip(!pendingPhone, "Pending fixture unavailable.");
    await signIn(page, pendingPhone);
    await expect(page.getByRole("heading", { name: "Assignment pending" })).toBeVisible();
    await expect(page.getByText("Not assigned", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open account & security" })).toBeVisible();
    await expect(page.getByText(/default masjid|default cohort|group 1/i)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Student navigation" }).getByRole("link")).toHaveCount(0);
  });

  test("wraps long identity and placement text without clipping", async ({ page }) => {
    test.skip(!longTextPhone, "Long-text fixture unavailable.");
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, longTextPhone);
    await page.getByRole("button", { name: "Open account menu" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const heading = page.getByRole("dialog").getByRole("heading");
    expect(await heading.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  });
});
