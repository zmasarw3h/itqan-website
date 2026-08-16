import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const enabled = process.env.E2E_STUDENT_REDESIGN_BATCH_2_ENABLED === "true";
const password = process.env.E2E_STUDENT_REDESIGN_PASSWORD ?? "";
const uploadedPhone = process.env.E2E_STUDENT_REDESIGN_PHONE ?? "";
const missingPhone = process.env.E2E_STUDENT_REDESIGN_MISSING_PHONE ?? "";
const completedPartnerPhone = process.env.E2E_STUDENT_REDESIGN_COMPLETED_PARTNER_PHONE ?? "";
const pdfPhone = process.env.E2E_STUDENT_REDESIGN_LONG_TEXT_PHONE ?? "";
const currentRound = process.env.E2E_STUDENT_REDESIGN_CURRENT_ROUND ?? "round_1";
const artifactRoot = path.join(process.cwd(), "artifacts/student-redesign-batch-2");
const imageFixture = path.join(process.cwd(), "e2e/fixtures/weekly-plan-fixture.png");
const pdfFixture = path.join(process.cwd(), "e2e/fixtures/weekly-plan-fixture.pdf");

async function signIn(page: Page, phone: string) {
  await page.goto("/login");
  await page.getByLabel(/phone number/i).fill(phone);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/student\/check-in/);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test.describe("student redesign Batch 2", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!enabled || !password || !uploadedPhone || !missingPhone || !completedPartnerPhone || !pdfPhone, "Requires disposable local Batch 2 fixtures.");

  test("shows both partner rounds and preserves open, upcoming/closed, completed, and duplicate behavior", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
    const first = await context.newPage();
    const second = await context.newPage();
    await signIn(first, uploadedPhone);
    await second.goto("/student/partner-recitation");
    await first.goto("/student/partner-recitation");

    await expect(first.getByRole("heading", { name: "Partner Recitation", exact: true })).toBeVisible();
    await expect(first.getByText("Complete two partner recitation rounds each week.")).toBeVisible();
    await expect(first.getByRole("article")).toHaveCount(2);
    await expect(first.getByText(currentRound === "round_1" ? "Round 1 is open" : "Round 2 is open")).toBeVisible();
    await expect(first.getByText(currentRound === "round_1" ? "Upcoming" : "Closed", { exact: true })).toBeVisible();
    await expect(first.getByRole("button", { name: "Confirm partner recitation" })).toBeVisible();
    await first.screenshot({ path: path.join(artifactRoot, "partner-desktop-1440x1024.png"), fullPage: false });
    await first.setViewportSize({ width: 768, height: 1024 });
    await first.screenshot({ path: path.join(artifactRoot, "partner-tablet-768x1024.png"), fullPage: false });
    await expectNoHorizontalOverflow(first);
    await first.setViewportSize({ width: 390, height: 844 });
    await first.screenshot({ path: path.join(artifactRoot, "partner-mobile-390x844.png"), fullPage: false });
    await expectNoHorizontalOverflow(first);
    await first.setViewportSize({ width: 1440, height: 1024 });

    const [firstResult, secondResult] = await Promise.all([
      first.getByRole("button", { name: "Confirm partner recitation" }).click().then(() => first.waitForURL(/status=/)),
      second.getByRole("button", { name: "Confirm partner recitation" }).click().then(() => second.waitForURL(/status=/))
    ]);
    void firstResult;
    void secondResult;
    const urls = [first.url(), second.url()];
    expect(urls.some((url) => url.includes("status=submitted"))).toBe(true);
    expect(urls.some((url) => url.includes("status=duplicate"))).toBe(true);

    const completed = urls.find((url) => url.includes("status=submitted")) === first.url() ? first : second;
    await expect(completed.getByText("Partner recitation confirmed.")).toBeVisible();
    await expect(completed.getByRole("button", { name: "Confirm partner recitation" })).toHaveCount(0);
    await context.close();

    const completeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const completePage = await completeContext.newPage();
    await signIn(completePage, completedPartnerPhone);
    await completePage.goto("/student/partner-recitation");
    await expect(completePage.getByText("Both rounds are complete for this week.")).toBeVisible();
    await expect(completePage.getByText("Completed", { exact: true })).toHaveCount(2);
    await completePage.screenshot({ path: path.join(artifactRoot, "partner-completed-mobile-390x844.png"), fullPage: false });
    await expectNoHorizontalOverflow(completePage);
    await completeContext.close();
  });

  test("renders uploaded image plan, secure preview, controls, focus trap, and tracked responsive evidence", async ({ page }) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1024 });
    await signIn(page, uploadedPhone);
    await page.goto("/student/weekly-plan");
    await expect(page.getByRole("heading", { name: "weekly-plan-fixture.png" })).toBeVisible();
    await expect(page.getByText("Mariam Hassan")).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(artifactRoot, "weekly-plan-uploaded-desktop-1440x1024.png"), fullPage: false });

    const view = page.getByRole("button", { name: "View plan" });
    await view.focus();
    const bodyOverflow = await page.locator("body").evaluate((body) => body.style.overflow);
    await view.click();
    const dialog = page.getByRole("dialog", { name: "weekly-plan-fixture.png" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByAltText("Preview of weekly-plan-fixture.png")).toBeVisible();
    expect(await page.locator("body").evaluate((body) => body.style.overflow)).toBe("hidden");
    expect(await page.locator("body > *").first().evaluate((root) => (root as HTMLElement).inert)).toBe(true);
    await page.screenshot({ path: path.join(artifactRoot, "weekly-plan-image-preview-desktop-1440x1024.png"), fullPage: false });
    await dialog.getByRole("button", { name: "Zoom in" }).click();
    await expect(dialog.locator(".plan-viewer-desktop-controls").getByText("125%")).toBeVisible();
    await dialog.getByRole("button", { name: "Fit to width" }).click();
    await expect(dialog.locator(".plan-viewer-desktop-controls").getByText("Fit", { exact: true })).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);

    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("link", { name: "Download weekly plan" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("weekly-plan-fixture.png");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(view).toBeFocused();
    expect(await page.locator("body").evaluate((body) => body.style.overflow)).toBe(bodyOverflow);

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.screenshot({ path: path.join(artifactRoot, "weekly-plan-uploaded-tablet-768x1024.png"), fullPage: false });
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(artifactRoot, "weekly-plan-uploaded-mobile-390x844.png"), fullPage: false });
    await view.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByAltText("Preview of weekly-plan-fixture.png")).toBeVisible();
    await page.screenshot({ path: path.join(artifactRoot, "weekly-plan-image-preview-mobile-390x844.png"), fullPage: false });
    await page.getByRole("button", { name: "Close plan preview" }).click();
    await expectNoHorizontalOverflow(page);
    expect(browserErrors).toEqual([]);
  });

  test("shows missing plan, exact validation, uploads successfully, and keeps actions clear of fixed navigation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 });
    await signIn(page, missingPhone);
    await page.goto("/student/weekly-plan");
    await expect(page.getByRole("heading", { name: "No weekly plan uploaded yet" })).toBeVisible();
    await expect(page.getByText("Your plan is private to you, your assigned teachers, and authorized admins.")).toBeVisible();
    await page.screenshot({ path: path.join(artifactRoot, "weekly-plan-missing-desktop-1440x1024.png"), fullPage: false });

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.screenshot({ path: path.join(artifactRoot, "weekly-plan-missing-tablet-768x1024.png"), fullPage: false });
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(artifactRoot, "weekly-plan-missing-mobile-390x844.png"), fullPage: false });
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 1440, height: 1024 });

    const input = page.locator('input[name="plan"]');
    await input.setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") });
    await expect(page.getByText("Upload a PNG, JPG, or PDF file.", { exact: true })).toBeVisible();
    await input.setInputFiles(imageFixture);
    await page.getByRole("button", { name: "Upload weekly plan" }).click();
    await expect(page).toHaveURL(/status=uploaded/);
    await expect(page.getByText("Weekly plan uploaded.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "weekly-plan-fixture.png" })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const replacement = page.getByRole("heading", { name: "Replace this week's plan" });
    await replacement.scrollIntoViewIfNeeded();
    const bottomNav = page.getByRole("navigation", { name: "Student navigation" });
    const replacementBox = await replacement.boundingBox();
    const navBox = await bottomNav.boundingBox();
    expect((replacementBox?.y ?? 0) + (replacementBox?.height ?? 0)).toBeLessThanOrEqual(navBox?.y ?? 0);
    await expectNoHorizontalOverflow(page);
  });

  test("preserves current plan through invalid and failed replacement, then replaces successfully", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, uploadedPhone);
    await page.goto("/student/weekly-plan");
    const currentName = page.getByRole("heading", { name: "weekly-plan-fixture.png" });
    await expect(currentName).toBeVisible();
    const input = page.locator('input[name="plan"]');

    await input.setInputFiles({ name: "bad.exe", mimeType: "application/octet-stream", buffer: Buffer.from("bad") });
    await expect(page.getByText("Upload a PNG, JPG, or PDF file.", { exact: true })).toBeVisible();
    await expect(currentName).toBeVisible();

    await input.setInputFiles(pdfFixture);
    await page.goto("/student/weekly-plan?status=upload-error");
    await expect(page.getByText(/Unable to upload the file.*current plan has not changed/i)).toBeVisible();
    await expect(currentName).toBeVisible();

    await page.locator('input[name="plan"]').setInputFiles(pdfFixture);
    await page.getByRole("button", { name: "Replace weekly plan" }).click();
    await expect(page).toHaveURL(/status=uploaded/);
    await expect(page.getByRole("heading", { name: "weekly-plan-fixture.pdf" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "weekly-plan-fixture.png" })).toHaveCount(0);
  });

  test("loads secure PDF preview with mobile and desktop controls and long context without overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 });
    await signIn(page, pdfPhone);
    await page.goto("/student/weekly-plan");
    const longName = "a-very-long-weekly-plan-filename-that-must-wrap-without-covering-actions-or-leaving-the-viewport.pdf";
    await expect(page.getByRole("heading", { name: longName })).toBeVisible();
    await page.getByRole("button", { name: "View plan" }).click();
    const desktopPdf = page.getByLabel("Page 1 of the weekly plan PDF");
    await expect(desktopPdf).toBeVisible();
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: path.join(artifactRoot, "weekly-plan-pdf-preview-desktop-1440x1024.png"), fullPage: false });
    await page.getByRole("button", { name: "Close plan preview" }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "View plan" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Page 1 of the weekly plan PDF")).toBeVisible();
    await expect(dialog.getByText("1 of 1")).toBeVisible();
    await dialog.getByRole("button", { name: "Zoom in" }).click();
    await dialog.getByRole("button", { name: "Fit", exact: true }).click();
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: path.join(artifactRoot, "weekly-plan-pdf-preview-mobile-390x844.png"), fullPage: false });
    await dialog.getByRole("button", { name: "Close plan preview" }).click();
    await expectNoHorizontalOverflow(page);
  });

  test("keeps loading stable and sanitizes denied preview failures", async ({ page }) => {
    const weeklyPlanRsc = /\/student\/weekly-plan\?_rsc=/;
    await page.route(weeklyPlanRsc, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      await route.continue().catch(() => undefined);
    });
    await signIn(page, pdfPhone);
    const wrongWeek = await page.request.get("/student/weekly-plan/preview?week=2000-01-02");
    expect(wrongWeek.status()).toBe(404);
    expect(await wrongWeek.text()).toBe("Weekly plan not found");

    await page.goto("/student/partner-recitation");
    const navigation = page.getByRole("link", { name: "Weekly Plan" }).click();
    await expect(page.locator(".student-loading")).toBeVisible({ timeout: 3_000 });
    await navigation;
    await page.unroute(weeklyPlanRsc);

    await page.route("**/student/weekly-plan/preview?*", (route) => route.fulfill({ status: 500, body: "private storage stack and student identity" }));
    await page.getByRole("button", { name: "View plan" }).click();
    await expect(page.getByRole("alert")).toContainText("We couldn't load this plan preview");
    await expect(page.locator("body")).not.toContainText(/private storage stack|student identity/i);
  });
});
