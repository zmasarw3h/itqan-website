import { describe, expect, it } from "vitest";
import { buildAdminStudentCreateInput, DEFAULT_STUDENT_PASSWORD } from "@/lib/admin-students";

describe("admin student creation", () => {
  it("normalizes phone and builds a synthetic auth email for new students", () => {
    expect(buildAdminStudentCreateInput({ name: "  Student   One  ", phone: "(416) 555-1234" })).toEqual({
      name: "Student One",
      phone: "+14165551234",
      email: "14165551234@itqan.local",
      password: DEFAULT_STUDENT_PASSWORD,
      role: "student",
      active: true
    });
  });

  it("validates name and phone server-side", () => {
    expect(() => buildAdminStudentCreateInput({ name: "", phone: "4165551234" })).toThrow("name");
    expect(() => buildAdminStudentCreateInput({ name: "Student One", phone: "555" })).toThrow("valid");
  });
});
