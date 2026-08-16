/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/student/grades", useRouter: () => ({ push: vi.fn() }) }));

import StudentRouteError from "@/app/student/error";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("student route error boundary", () => {
  it("keeps recovery actions visible and logs only a safe route identifier and digest", async () => {
    const reset = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("Supabase secret internal authorization failure"), {
      digest: "internal-id",
      privateContext: "student-identity-123"
    });
    error.stack = "Sensitive database stack and service-role context";

    render(<StudentRouteError error={error} reset={reset} />);
    expect(screen.getByRole("heading", { name: "We couldn’t load this page" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Today" })).toHaveAttribute("href", "/student/check-in");
    expect(document.body).not.toHaveTextContent(/Supabase secret|internal authorization|internal-id/i);
    await waitFor(() => expect(log).toHaveBeenCalledOnce());
    expect(log).toHaveBeenCalledWith({ route: "/student/*", digest: "internal-id" });
    const loggedContent = JSON.stringify(log.mock.calls);
    expect(loggedContent).not.toMatch(/Supabase secret|internal authorization|Sensitive database stack|service-role|student-identity/i);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("logs only once per boundary mount and omits an absent digest", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const firstError = new Error("first private route failure");
    const { rerender } = render(<StudentRouteError error={firstError} reset={vi.fn()} />);

    await waitFor(() => expect(log).toHaveBeenCalledOnce());
    expect(log).toHaveBeenCalledWith({ route: "/student/*" });

    rerender(<StudentRouteError error={new Error("second private route failure")} reset={vi.fn()} />);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/first private|second private/i);
  });
});
