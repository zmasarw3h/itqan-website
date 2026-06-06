import { describe, expect, it } from "vitest";
import { buildAdminUserCreateInput, DEFAULT_USER_PASSWORD } from "@/lib/admin-users";

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

  it("normalizes phone and builds a synthetic auth email for new admins", () => {
    expect(buildAdminUserCreateInput({ name: "Admin One", phone: "4165550000", role: "admin" })).toEqual({
      name: "Admin One",
      phone: "+14165550000",
      email: "14165550000@itqan.local",
      password: DEFAULT_USER_PASSWORD,
      role: "admin",
      active: true
    });
  });

  it("validates name, phone, and role server-side", () => {
    expect(() => buildAdminUserCreateInput({ name: "", phone: "4165551234", role: "student" })).toThrow("name");
    expect(() => buildAdminUserCreateInput({ name: "Student One", phone: "555", role: "student" })).toThrow("valid");
    expect(() => buildAdminUserCreateInput({ name: "User One", phone: "4165551234", role: "teacher" })).toThrow("role");
  });
});
