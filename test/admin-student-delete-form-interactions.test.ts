// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/actions", () => ({ deleteStudent: vi.fn() }));

import StudentDeleteForm from "@/app/admin/students/[id]/student-delete-form";

describe("student delete confirmation", () => {
  afterEach(cleanup);

  it("requires the exact student name and supports cancelling safely", () => {
    render(createElement(StudentDeleteForm, {
      redirectView: "settings",
      redirectWeek: "2026-08-09",
      studentId: "11111111-1111-4111-8111-111111111111",
      studentName: "Student One"
    }));
    const open = screen.getByRole("button", { name: "Delete student" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");

    const submit = screen.getByRole("button", { name: "Permanently delete" });
    const input = screen.getByLabelText("Student name");
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: "Wrong" } });
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: "Student One" } });
    expect(submit).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Confirm permanent deletion")).not.toBeInTheDocument();
  });
});
