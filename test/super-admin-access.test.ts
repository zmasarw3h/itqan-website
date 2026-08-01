import { describe, expect, it } from "vitest";
import {
  adminMasjidConfirmationNamesForPlan,
  adminMasjidConfirmationText,
  buildSuperAdminAccessChangePlan,
  previewAdditiveStaffGrant,
  staffAccessLabel,
  SuperAdminAccessPlanError,
  type StaffMembershipWindow,
  type StudentMembershipWindow
} from "@/lib/super-admin-access";

const studentMemberships: StudentMembershipWindow[] = [
  {
    id: "student-membership-1",
    group_id: "group-old",
    starts_on: "2026-06-01",
    ends_on: null
  }
];

const staffMemberships: StaffMembershipWindow[] = [
  {
    id: "teacher-thunder-bay",
    masjid_id: "thunder-bay",
    masjid_name: "Thunder Bay Masjid",
    staff_role: "teacher",
    active: true,
    starts_on: "2026-06-01",
    ends_on: null
  },
  {
    id: "admin-tic",
    masjid_id: "tic",
    masjid_name: "Toronto Islamic Centre (TIC)",
    staff_role: "admin",
    active: true,
    starts_on: "2026-06-01",
    ends_on: null
  }
];

describe("super-admin access planning", () => {
  it("labels staff access states", () => {
    expect(staffAccessLabel({ hasAdmin: true, hasTeacher: true })).toBe("Admin + Teacher");
    expect(staffAccessLabel({ hasAdmin: true, hasTeacher: false })).toBe("Admin only");
    expect(staffAccessLabel({ hasAdmin: false, hasTeacher: true })).toBe("Teacher only");
    expect(staffAccessLabel({ hasAdmin: false, hasTeacher: false })).toBe("No staff access");
  });

  it("promotes a teacher-only user to admin-teacher without closing teacher access", () => {
    expect(
      buildSuperAdminAccessChangePlan({
        targetRole: "teacher",
        targetActive: true,
        preset: "admin_teacher",
        selectedMasjidId: "thunder-bay",
        startsOn: "2026-07-07",
        studentMemberships: [],
        staffMemberships
      })
    ).toMatchObject({
      nextRole: "admin",
      nextActive: true,
      staffMembershipCloses: [],
      staffMembershipInserts: [{ masjidId: "thunder-bay", staffRole: "admin", startsOn: "2026-07-07" }],
      requiresAdminMasjidConfirmation: true
    });
  });

  it("keeps cross-masjid staff history untouched unless explicitly targeted", () => {
    expect(
      buildSuperAdminAccessChangePlan({
        targetRole: "admin",
        targetActive: true,
        preset: "teacher",
        selectedMasjidId: "thunder-bay",
        startsOn: "2026-07-07",
        studentMemberships: [],
        staffMemberships
      }).staffMembershipCloses
    ).toEqual([]);

    expect(
      buildSuperAdminAccessChangePlan({
        targetRole: "admin",
        targetActive: true,
        preset: "teacher",
        selectedMasjidId: "thunder-bay",
        startsOn: "2026-07-07",
        studentMemberships: [],
        staffMemberships
      }).nextRole
    ).toBe("admin");

    expect(
      buildSuperAdminAccessChangePlan({
        targetRole: "admin",
        targetActive: true,
        preset: "teacher",
        selectedMasjidId: "tic",
        startsOn: "2026-07-07",
        studentMemberships: [],
        staffMemberships
      }).staffMembershipCloses
    ).toEqual([{ id: "admin-tic", endsOn: "2026-07-06" }]);
  });

  it("moves a student by closing the old open membership and inserting the selected group", () => {
    expect(
      buildSuperAdminAccessChangePlan({
        targetRole: "student",
        targetActive: true,
        preset: "student",
        selectedGroupId: "group-new",
        startsOn: "2026-07-07",
        studentMemberships,
        staffMemberships: []
      })
    ).toMatchObject({
      nextRole: "student",
      nextActive: true,
      studentMembershipCloses: [{ id: "student-membership-1", endsOn: "2026-07-06" }],
      studentMembershipInsert: { groupId: "group-new", startsOn: "2026-07-07" }
    });
  });

  it("deactivates without changing the profile role and closes open access the day before", () => {
    expect(
      buildSuperAdminAccessChangePlan({
        targetRole: "admin",
        targetActive: true,
        preset: "inactive",
        startsOn: "2026-07-07",
        studentMemberships,
        staffMemberships
      })
    ).toMatchObject({
      nextRole: "admin",
      nextActive: false,
      studentMembershipCloses: [{ id: "student-membership-1", endsOn: "2026-07-06" }],
      staffMembershipCloses: [
        { id: "teacher-thunder-bay", endsOn: "2026-07-06" },
        { id: "admin-tic", endsOn: "2026-07-06" }
      ],
      requiresAdminMasjidConfirmation: true
    });
  });

  it("previews additive grants without ending existing capabilities", () => {
    const adminAtThunderBay: StaffMembershipWindow = {
      id: "admin-thunder-bay",
      masjid_id: "thunder-bay",
      masjid_name: "Thunder Bay Masjid",
      staff_role: "admin",
      active: true,
      starts_on: "2026-06-01",
      ends_on: null
    };
    const preview = previewAdditiveStaffGrant({
      targetRole: "admin",
      targetActive: true,
      masjidId: "thunder-bay",
      grant: "teacher",
      startsOn: "2026-07-07",
      currentDate: "2026-07-07",
      staffMemberships: [adminAtThunderBay, staffMemberships[1]]
    });

    expect(preview.currentMasjidAccess).toBe("Admin only");
    expect(preview.resultingMasjidAccess).toBe("Admin + Teacher");
    expect(preview.addedRoles).toEqual(["teacher"]);
    expect(preview.resultingRole).toBe("admin");
    expect(preview.noOp).toBe(false);
  });

  it("keeps current role state while previewing a future additive capability", () => {
    const preview = previewAdditiveStaffGrant({
      targetRole: "student",
      targetActive: true,
      masjidId: "thunder-bay",
      grant: "teacher",
      startsOn: "2026-07-10",
      currentDate: "2026-07-07",
      studentMemberships,
      staffMemberships: []
    });

    expect(preview.resultingRole).toBe("student");
    expect(preview.resultingActive).toBe(true);
    expect(preview.effectiveRole).toBe("teacher");
    expect(preview.effectiveActive).toBe(true);
  });

  it("reports an additive no-op when every selected capability is already effective", () => {
    const preview = previewAdditiveStaffGrant({
      targetRole: "admin",
      targetActive: true,
      masjidId: "tic",
      grant: "admin",
      startsOn: "2026-07-07",
      currentDate: "2026-07-07",
      staffMemberships
    });

    expect(preview.addedRoles).toEqual([]);
    expect(preview.noOp).toBe(true);
    expect(preview.resultingMasjidAccess).toBe("Admin only");
  });

  it("refuses to replace a future open membership with an impossible end date", () => {
    expect(() =>
      buildSuperAdminAccessChangePlan({
        targetRole: "student",
        targetActive: true,
        preset: "student",
        selectedGroupId: "group-new",
        startsOn: "2026-07-07",
        studentMemberships: [
          {
            id: "future-student-membership",
            group_id: "group-future",
            starts_on: "2026-07-10",
            ends_on: null
          }
        ],
        staffMemberships: []
      })
    ).toThrow(SuperAdminAccessPlanError);
  });

  it("confirms the actual admin masjid names touched by the plan", () => {
    const studentPlan = buildSuperAdminAccessChangePlan({
      targetRole: "admin",
      targetActive: true,
      preset: "student",
      selectedGroupId: "group-new",
      startsOn: "2026-07-07",
      studentMemberships: [],
      staffMemberships
    });
    const studentAdminNames = adminMasjidConfirmationNamesForPlan({
      staffMemberships,
      staffMembershipCloses: studentPlan.staffMembershipCloses,
      staffMembershipInserts: studentPlan.staffMembershipInserts,
      selectedMasjid: { id: "thunder-bay", name: "Thunder Bay Masjid" }
    });

    expect(studentAdminNames).toEqual(["Toronto Islamic Centre (TIC)"]);
    expect(adminMasjidConfirmationText(studentAdminNames)).toBe("Toronto Islamic Centre (TIC)");

    const adminGrantPlan = buildSuperAdminAccessChangePlan({
      targetRole: "teacher",
      targetActive: true,
      preset: "admin_teacher",
      selectedMasjidId: "thunder-bay",
      startsOn: "2026-07-07",
      studentMemberships: [],
      staffMemberships: staffMemberships.filter((membership) => membership.id !== "admin-tic")
    });

    expect(
      adminMasjidConfirmationNamesForPlan({
        staffMemberships,
        staffMembershipCloses: adminGrantPlan.staffMembershipCloses,
        staffMembershipInserts: adminGrantPlan.staffMembershipInserts,
        selectedMasjid: { id: "thunder-bay", name: "Thunder Bay Masjid" }
      })
    ).toEqual(["Thunder Bay Masjid"]);
  });
});
