import { describe, expect, it } from "vitest";
import {
  buildAdminUserCreateInput,
  DEFAULT_USER_PASSWORD,
  preservedScopedUserSetupRequestId,
  scopedUserSetupFailureSearchParams
} from "@/lib/admin-users";

describe("admin user creation", () => {
  it("normalizes phone and builds a synthetic auth email for new students", () => {
    expect(buildAdminUserCreateInput({ name: "  Student   One  ", phone: "(416) 555-1234", role: "student" })).toEqual({
      name: "Student One",
      phone: "+14165551234",
      email: "14165551234@itqan.local",
      password: DEFAULT_USER_PASSWORD,
      role: "student",
      active: true
    });
  });

  it("normalizes phone and builds a synthetic auth email for new teachers", () => {
    expect(buildAdminUserCreateInput({ name: "Teacher One", phone: "4165552222", role: "teacher" })).toEqual({
      name: "Teacher One",
      phone: "+14165552222",
      email: "14165552222@itqan.local",
      password: DEFAULT_USER_PASSWORD,
      role: "teacher",
      active: true
    });
  });

  it("validates name, phone, and role server-side", () => {
    expect(() => buildAdminUserCreateInput({ name: "", phone: "4165551234", role: "student" })).toThrow("name");
    expect(() => buildAdminUserCreateInput({ name: "Student One", phone: "555", role: "student" })).toThrow("valid");
    expect(() => buildAdminUserCreateInput({ name: "Admin One", phone: "4165550000", role: "admin" })).toThrow("role");
    expect(() => buildAdminUserCreateInput({ name: "User One", phone: "4165551234", role: "super_admin" })).toThrow("role");
  });

  it("carries the exact trusted request and scope through an uncertain redirect and resubmission", () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const studentMasjidId = "22222222-2222-4222-8222-222222222222";
    const studentCohortId = "33333333-3333-4333-8333-333333333333";
    const studentGroupId = "44444444-4444-4444-8444-444444444444";
    const params = scopedUserSetupFailureSearchParams({
      status: "auth-uncertain",
      requestId,
      role: "student",
      studentMasjidId,
      studentCohortId,
      studentGroupId,
      scoreStartsOn: "2026-07-26"
    });

    expect(preservedScopedUserSetupRequestId(params.get("status") ?? undefined, params.get("request_id") ?? undefined))
      .toBe(requestId);
    expect(Object.fromEntries(params)).toMatchObject({
      status: "auth-uncertain",
      request_id: requestId,
      role: "student",
      student_masjid_id: studentMasjidId,
      student_cohort_id: studentCohortId,
      student_group_id: studentGroupId,
      score_starts_on: "2026-07-26"
    });

    const resubmitted = new FormData();
    resubmitted.set("request_id", preservedScopedUserSetupRequestId(
      params.get("status") ?? undefined,
      params.get("request_id") ?? undefined
    )!);
    resubmitted.set("name", "Test Student");
    resubmitted.set("phone", "+1 416 555 1234");
    resubmitted.set("role", params.get("role")!);
    resubmitted.set("student_masjid_id", params.get("student_masjid_id")!);
    resubmitted.set("student_cohort_id", params.get("student_cohort_id")!);
    resubmitted.set("student_group_id", params.get("student_group_id")!);

    expect(resubmitted.get("request_id")).toBe(requestId);
    expect(buildAdminUserCreateInput({
      name: resubmitted.get("name"),
      phone: resubmitted.get("phone"),
      role: resubmitted.get("role")
    })).toMatchObject({
      name: "Test Student",
      email: "14165551234@itqan.local",
      phone: "+14165551234",
      role: "student"
    });
  });

  it("does not trust request IDs outside the exact uncertain recovery path", () => {
    const requestId = "11111111-1111-4111-8111-111111111111";

    expect(preservedScopedUserSetupRequestId("auth-error", requestId)).toBeNull();
    expect(preservedScopedUserSetupRequestId("auth-uncertain", "not-a-uuid")).toBeNull();
    expect(scopedUserSetupFailureSearchParams({
      status: "auth-error",
      requestId,
      role: "teacher"
    }).has("request_id")).toBe(false);
  });
});
