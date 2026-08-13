// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) =>
    createElement("a", { href, ...props }, children)
}));

import AdminError from "@/app/admin/error";
import RoleErrorFallback from "@/app/error-fallback";
import StudentError from "@/app/student/error";
import SuperAdminError from "@/app/super-admin/error";
import TeacherError from "@/app/teacher/error";

const privateError = new Error("Private database connection details must never reach the screen.");

afterEach(cleanup);

function assertBoundary(
  Boundary: (props: { error: Error & { digest?: string }; reset: () => void }) => ReactNode,
  dashboardLabel: string,
  dashboardHref: string
) {
  const reset = vi.fn();
  render(createElement(Boundary, { error: privateError, reset }));

  expect(screen.getByRole("heading", { name: "This page could not be loaded" })).toBeInTheDocument();
  expect(screen.getByText("Please try again. If the problem continues, return to your dashboard.")).toBeInTheDocument();
  expect(screen.queryByText(privateError.message)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: dashboardLabel })).toHaveAttribute("href", dashboardHref);

  const retry = screen.getByRole("button", { name: "Try again" });
  fireEvent.click(retry);
  fireEvent.click(retry);

  expect(reset).toHaveBeenCalledTimes(1);
  expect(retry).toBeDisabled();
}

describe("role error boundaries", () => {
  it("renders the shared fallback with an accessible retry and safe role navigation", () => {
    assertBoundary(
      (props) => createElement(RoleErrorFallback, { ...props, dashboardHref: "/admin", dashboardLabel: "Return to admin dashboard", workspaceLabel: "Admin workspace" }),
      "Return to admin dashboard",
      "/admin"
    );
  });

  it("returns admins to the admin dashboard", () => {
    assertBoundary(AdminError, "Return to admin dashboard", "/admin");
  });

  it("returns students to today’s check-in", () => {
    assertBoundary(StudentError, "Return to today’s check-in", "/student/check-in");
  });

  it("returns teachers to the teaching dashboard", () => {
    assertBoundary(TeacherError, "Return to teaching dashboard", "/teacher");
  });

  it("returns super admins to their overview", () => {
    assertBoundary(SuperAdminError, "Return to super admin overview", "/super-admin");
  });
});

describe("global error boundary", () => {
  it("is self-contained and never shows technical error text", () => {
    const source = readFileSync(resolve(process.cwd(), "app/global-error.tsx"), "utf8");

    expect(source).toContain("<html lang=\"en\">");
    expect(source).toContain("<body>");
    expect(source).toContain("This page could not be loaded");
    expect(source).toContain("reset();");
    expect(source).toContain("href=\"/\"");
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("error.digest");
    expect(source).not.toContain("@/app/error-fallback");
  });
});
