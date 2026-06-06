import { describe, expect, it } from "vitest";
import {
  ACCOUNTABILITY_GATE_COPY,
  accountabilityObligationBlocksCheckIn,
  canStudentAttestAccountabilityPaid,
  findBlockingAccountabilityObligation,
  routeIsAccountabilityGated,
  type AccountabilityGateObligation
} from "@/lib/accountability";
import type { Profile } from "@/lib/types";

const student: Profile = {
  id: "student-1",
  name: "Student One",
  email: "student-1@itqan.local",
  phone: null,
  role: "student",
  active: true
};

const otherStudent: Profile = {
  ...student,
  id: "student-2",
  email: "student-2@itqan.local"
};

function obligation(overrides: Partial<AccountabilityGateObligation> = {}): AccountabilityGateObligation {
  return {
    id: "obligation-1",
    student_id: student.id,
    week_start: "2026-05-24",
    weekly_percentage: 69,
    amount_cents: 500,
    status: "pending",
    ...overrides
  };
}

describe("student accountability gate", () => {
  it("blocks check-in for pending prior-week obligations", () => {
    expect(accountabilityObligationBlocksCheckIn(obligation(), "2026-05-31")).toBe(true);
  });

  it("does not block check-in for current-week pending obligations", () => {
    expect(accountabilityObligationBlocksCheckIn(obligation({ week_start: "2026-05-31" }), "2026-05-31")).toBe(false);
  });

  it("uses the oldest pending prior-week obligation as the blocker", () => {
    expect(
      findBlockingAccountabilityObligation(
        [
          obligation({ id: "newer", week_start: "2026-05-24" }),
          obligation({ id: "current", week_start: "2026-05-31" }),
          obligation({ id: "older", week_start: "2026-05-17" })
        ],
        "2026-05-31"
      )?.id
    ).toBe("older");
  });

  it("allows students to attest their own pending obligation", () => {
    expect(canStudentAttestAccountabilityPaid(student, obligation())).toBe(true);
  });

  it("prevents students from attesting another student's obligation", () => {
    expect(canStudentAttestAccountabilityPaid(student, obligation({ student_id: otherStudent.id }))).toBe(false);
  });

  it("does not block after an obligation is attested paid", () => {
    expect(accountabilityObligationBlocksCheckIn(obligation({ status: "attested_paid" }), "2026-05-31")).toBe(false);
  });

  it("gates only the daily check-in route", () => {
    expect(routeIsAccountabilityGated("/student/check-in")).toBe(true);
    expect(routeIsAccountabilityGated("/student/grades")).toBe(false);
    expect(routeIsAccountabilityGated("/student/history")).toBe(false);
    expect(routeIsAccountabilityGated("/student/weekly-plan")).toBe(false);
    expect(routeIsAccountabilityGated("/student/partner-recitation")).toBe(false);
    expect(routeIsAccountabilityGated("/account/change-password")).toBe(false);
  });

  it("keeps the student gate copy focused on sadaqa confirmation", () => {
    expect(ACCOUNTABILITY_GATE_COPY.heading).toBe("Confirm your sadaqa to unlock today's checklist");
    expect(ACCOUNTABILITY_GATE_COPY.requiredLabel).toBe("Required sadaqa");
    expect(ACCOUNTABILITY_GATE_COPY.yesButton).toBe("Yes, I paid the sadaqa");
    expect(ACCOUNTABILITY_GATE_COPY.notYetButton).toBe("Not yet");
  });
});
