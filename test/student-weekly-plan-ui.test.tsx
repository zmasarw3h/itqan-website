/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/student/weekly-plan/actions", () => ({ uploadWeeklyPlan: vi.fn() }));

import WeeklyPlanUploadForm from "@/app/student/weekly-plan/weekly-plan-upload-form";
import WeeklyPlanViewer from "@/app/student/weekly-plan/weekly-plan-viewer";

const previewUrl = "/student/weekly-plan/preview?week=2026-08-16";
const downloadUrl = "/student/weekly-plan/download?week=2026-08-16";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Blob(["plan"], { type: "image/png" }), { status: 200 })));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:weekly-plan");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
});

describe("student weekly plan upload", () => {
  it("uses exact validation copy and reveals replacement controls only for a valid file", () => {
    render(<WeeklyPlanUploadForm replacement />);
    const input = screen.getByLabelText(/replacement|choose a file/i, { selector: "input" });

    fireEvent.change(input, { target: { files: [new File(["bad"], "unsafe.txt", { type: "text/plain" })] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Upload a PNG, JPG, or PDF file.");
    expect(screen.queryByRole("button", { name: "Replace weekly plan" })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { files: [new File(["valid"], "long replacement plan name.pdf", { type: "application/pdf" })] } });
    expect(screen.getByText("long replacement plan name.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace weekly plan" })).toBeEnabled();
  });
});

describe("student weekly plan viewer", () => {
  it("loads through the secure route and supports zoom, fit, Escape, scroll lock, and focus restoration", async () => {
    const { container } = render(
      <WeeklyPlanViewer downloadUrl={downloadUrl} fileName="private-plan.png" fileType="image/png" previewUrl={previewUrl} weekLabel="Aug 16–22, 2026" />
    );
    const trigger = screen.getByRole("button", { name: "View plan" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "private-plan.png" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    expect(container.inert).toBe(true);
    await waitFor(() => expect(screen.getByAltText("Preview of private-plan.png")).toHaveAttribute("src", "blob:weekly-plan"));
    expect(fetch).toHaveBeenCalledWith(previewUrl, { cache: "no-store", credentials: "same-origin" });
    expect(screen.getAllByRole("link", { name: "Download weekly plan" })[0]).toHaveAttribute("href", downloadUrl);

    fireEvent.click(screen.getAllByRole("button", { name: "Zoom in" })[0]);
    expect(screen.getAllByText("125%")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Fit to width" }));
    expect(screen.getAllByText("Fit").length).toBeGreaterThan(0);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });

  it("shows a sanitized preview error without exposing response details", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("storage secret and student identity", { status: 404 }));
    render(<WeeklyPlanViewer downloadUrl={downloadUrl} fileName="plan.pdf" fileType="application/pdf" previewUrl={previewUrl} weekLabel="Aug 16–22, 2026" />);
    fireEvent.click(screen.getByRole("button", { name: "View plan" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load this plan preview"));
    expect(document.body).not.toHaveTextContent(/storage secret|student identity/i);
  });
});
