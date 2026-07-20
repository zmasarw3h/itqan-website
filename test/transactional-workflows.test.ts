import { describe, expect, it } from "vitest";
import { classifyTransactionalWorkflowError } from "@/lib/transactional-workflows";

describe("transactional workflow error classification", () => {
  it("recognizes the non-retryable stale-state contract", () => {
    expect(
      classifyTransactionalWorkflowError({
        code: "P0001",
        message: "access state changed; reload before saving."
      })
    ).toBe("stale");
  });

  it("separates authorization, validation, and constraint conflicts", () => {
    expect(classifyTransactionalWorkflowError({ code: "42501" })).toBe("denied");
    expect(classifyTransactionalWorkflowError({ code: "22023" })).toBe("invalid");
    expect(classifyTransactionalWorkflowError({ code: "23505" })).toBe("conflict");
    expect(classifyTransactionalWorkflowError({ code: "23P01" })).toBe("conflict");
  });

  it("does not misclassify unrelated application exceptions", () => {
    expect(classifyTransactionalWorkflowError({ code: "P0001", message: "another failure" })).toBe("unknown");
    expect(classifyTransactionalWorkflowError(null)).toBe("unknown");
  });
});
