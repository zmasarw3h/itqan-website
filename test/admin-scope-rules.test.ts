import { describe, expect, it } from "vitest";
import {
  AdminScopeError,
  adminScopeStatusForError,
  assertSelectedStudentScopeMatchesResolved,
  isScopeWindowEffectiveOn
} from "@/lib/admin-scope-rules";

describe("admin scope rules", () => {
  it("treats membership windows as active only inside their inclusive date range", () => {
    expect(isScopeWindowEffectiveOn({ starts_on: "2026-07-01", ends_on: null }, "2026-07-07")).toBe(true);
    expect(isScopeWindowEffectiveOn({ starts_on: "2026-07-07", ends_on: "2026-07-07" }, "2026-07-07")).toBe(true);
    expect(isScopeWindowEffectiveOn({ starts_on: "2026-07-08", ends_on: null }, "2026-07-07")).toBe(false);
    expect(isScopeWindowEffectiveOn({ starts_on: "2026-07-01", ends_on: "2026-07-06" }, "2026-07-07")).toBe(false);
  });

  it("accepts a selected student scope only when all derived ids match", () => {
    expect(() =>
      assertSelectedStudentScopeMatchesResolved(
        {
          masjidId: "masjid-a",
          cohortId: "cohort-a",
          groupId: "group-a"
        },
        {
          masjidId: "masjid-a",
          cohortId: "cohort-a",
          groupId: "group-a"
        }
      )
    ).not.toThrow();
  });

  it("rejects missing or mismatched selected student scope ids", () => {
    expect(() =>
      assertSelectedStudentScopeMatchesResolved(
        {
          masjidId: "masjid-a",
          cohortId: null,
          groupId: "group-a"
        },
        {
          masjidId: "masjid-a",
          cohortId: "cohort-a",
          groupId: "group-a"
        }
      )
    ).toThrow(AdminScopeError);

    expect(() =>
      assertSelectedStudentScopeMatchesResolved(
        {
          masjidId: "masjid-a",
          cohortId: "cohort-a",
          groupId: "group-b"
        },
        {
          masjidId: "masjid-a",
          cohortId: "cohort-a",
          groupId: "group-a"
        }
      )
    ).toThrow(AdminScopeError);
  });

  it("maps scope errors to add-user status codes", () => {
    expect(adminScopeStatusForError(new AdminScopeError("missing-scope", "Missing scope."))).toBe("missing-scope");
    expect(adminScopeStatusForError(new AdminScopeError("scope-denied", "Denied."))).toBe("invalid-scope");
    expect(adminScopeStatusForError(new Error("Other failure."))).toBe("assignment-error");
  });
});
