/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/student/grades", useRouter: () => ({ push: vi.fn() }) }));

import StudentRouteError from "@/app/student/error";

afterEach(cleanup);

describe("student route error boundary", () => {
  it("keeps recovery actions visible and never renders raw error details", () => {
    const reset = vi.fn();
    render(<StudentRouteError error={Object.assign(new Error("Supabase secret internal authorization failure"), { digest: "internal-id" })} reset={reset} />);
    expect(screen.getByRole("heading", { name: "We couldn’t load this page" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Today" })).toHaveAttribute("href", "/student/check-in");
    expect(document.body).not.toHaveTextContent(/Supabase secret|internal authorization|internal-id/i);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
