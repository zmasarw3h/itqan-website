/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudentProgressNav from "@/app/student/progress-nav";
import {
  StandaloneStudentShell,
  StudentAssignmentPendingMarker,
  StudentShellFrame
} from "@/app/student/student-shell";

let pathname = "/student/check-in";
let query = new URLSearchParams();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
  useSearchParams: () => query
}));

beforeEach(() => {
  pathname = "/student/check-in";
  query = new URLSearchParams();
  push.mockReset();

  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(cleanup);

const placement = {
  cohortName: "Sisters",
  groupName: "Group 1",
  masjidName: "ITQAN Centre"
};

describe("student shell navigation", () => {
  it("renders the approved desktop and mobile primary navigation in order", () => {
    render(<StandaloneStudentShell name="Aaliyah Malik" placement={placement} signOutAction={vi.fn()} />);

    const [desktop, mobile] = screen.getAllByRole("navigation", { name: "Student navigation" });
    expect(within(desktop).getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "Today",
      "My Progress",
      "Weekly Plan",
      "Account"
    ]);
    expect(within(mobile).getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "Today",
      "My Progress",
      "Weekly Plan"
    ]);
    expect(within(desktop).getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  });

  it("opens and closes the accessible account sheet and restores trigger focus", () => {
    render(<StandaloneStudentShell name="Aaliyah Malik" placement={placement} signOutAction={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Open account menu for Aaliyah Malik" });
    fireEvent.click(trigger);
    const accountSheet = screen.getByRole("dialog", { name: "Aaliyah Malik" });
    expect(accountSheet).toHaveAttribute("open");
    expect(within(accountSheet).getByRole("link", { name: /Account & security/ })).toHaveAttribute(
      "href",
      "/account/change-password"
    );
    expect(within(accountSheet).getByRole("button", { name: "Sign out" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close account menu" }));
    expect(trigger).toHaveFocus();
  });

  it("subdues scoped destinations while keeping Account available", async () => {
    render(
      <StudentShellFrame name="Aaliyah Malik" placement={placement} signOutAction={vi.fn()}>
        <StudentAssignmentPendingMarker />
      </StudentShellFrame>
    );

    await waitFor(() => expect(screen.queryAllByRole("link", { name: "Today" })).toHaveLength(0));
    expect(screen.getAllByText("Today").every((item) => item.closest("[aria-disabled='true']"))).toBe(true);
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account/change-password");
  });
});

describe("student progress navigation", () => {
  it("uses the approved order and preserves the current query on routed links", () => {
    pathname = "/student/history";
    query = new URLSearchParams("week=2026-08-09&status=saved");
    render(<StudentProgressNav />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Partner Recitation",
      "Grades",
      "Check-In History",
      "Leaderboard",
      "Badge Awards"
    ]);
    expect(screen.getByRole("link", { name: "Check-In History" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Grades" })).toHaveAttribute(
      "href",
      "/student/grades?week=2026-08-09&status=saved"
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Progress view" }), {
      target: { value: "/student/rewards" }
    });
    expect(push).toHaveBeenCalledWith("/student/rewards?week=2026-08-09&status=saved");
  });

  it("does not render on a non-progress student route", () => {
    render(<StudentProgressNav />);
    expect(screen.queryByRole("navigation", { name: "Progress views" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Progress view" })).not.toBeInTheDocument();
  });
});
