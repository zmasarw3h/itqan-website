import { describe, expect, it } from "vitest";
import {
  buildMasjidSetupWarnings,
  isValidMasjidSlug,
  normalizeMasjidSlug,
  parseCohortKind,
  parsePositiveInteger,
  parseStaffAccessGrant,
  staffRolesForGrant
} from "@/lib/super-admin-setup";

describe("super-admin setup helpers", () => {
  it("normalizes and validates masjid slugs", () => {
    expect(normalizeMasjidSlug(" Thunder Bay Masjid ")).toBe("thunder-bay-masjid");
    expect(normalizeMasjidSlug("TIC / Sisters")).toBe("tic-sisters");
    expect(isValidMasjidSlug("thunder-bay")).toBe(true);
    expect(isValidMasjidSlug("-thunder-bay")).toBe(false);
    expect(isValidMasjidSlug("Thunder Bay")).toBe(false);
  });

  it("parses setup select values conservatively", () => {
    expect(parseCohortKind("brothers")).toBe("brothers");
    expect(parseCohortKind("sisters")).toBe("sisters");
    expect(parseCohortKind("parents")).toBeNull();
    expect(parseStaffAccessGrant("admin")).toBe("admin");
    expect(parseStaffAccessGrant("admin_teacher")).toBe("admin_teacher");
    expect(parseStaffAccessGrant("teacher")).toBeNull();
  });

  it("maps first-admin grants to staff roles", () => {
    expect(staffRolesForGrant("admin")).toEqual(["admin"]);
    expect(staffRolesForGrant("admin_teacher")).toEqual(["admin", "teacher"]);
  });

  it("falls back on invalid sort orders", () => {
    expect(parsePositiveInteger("3", 1)).toBe(3);
    expect(parsePositiveInteger("0", 7)).toBe(7);
    expect(parsePositiveInteger("abc", 7)).toBe(7);
  });

  it("builds setup warnings only for active masajid", () => {
    expect(
      buildMasjidSetupWarnings({
        active: true,
        counts: { activeCohortCount: 0, activeGroupCount: 0, activeAdminCount: 0 }
      })
    ).toEqual([
      "Active masjid has no active cohorts.",
      "Active masjid has no active groups.",
      "Active masjid has no active admin."
    ]);

    expect(
      buildMasjidSetupWarnings({
        active: false,
        counts: { activeCohortCount: 0, activeGroupCount: 0, activeAdminCount: 0 }
      })
    ).toEqual([]);
  });
});
