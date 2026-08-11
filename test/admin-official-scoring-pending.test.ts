import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-dom", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-dom")>(),
  useFormStatus: () => ({ pending: true, data: null, method: null, action: null })
}));
vi.mock("@/app/admin/students/[id]/official-scoring/actions", () => ({ applyOfficialScoringStart: vi.fn() }));

import { ConfirmScoringButton } from "@/app/admin/students/[id]/official-scoring/submit-buttons";

describe("official scoring pending state", () => {
  it("stays disabled and exposes the pending label", () => {
    const html = renderToStaticMarkup(createElement(ConfirmScoringButton, { ready: true }));
    expect(html).toContain("disabled");
    expect(html).toContain("Saving change…");
  });
});
