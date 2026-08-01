import { describe, expect, it } from "vitest";

import {
  buildGuidedChangeReview,
  operationLabelForSnapshot,
  presetForGuidedOperation,
  type GuidedAccessSnapshot,
  type GuidedGroupOption,
  type GuidedStaffMembership,
  type GuidedStudentMembership
} from "@/lib/super-admin-guided-change";

const TODAY = "2026-07-22";
const SUNDAY = "2026-07-19";
const FUTURE_SUNDAY = "2026-07-26";

const centralMasjid = { id: "masjid-central", name: "Central Masjid" };
const lakeshoreMasjid = { id: "masjid-lakeshore", name: "Lakeshore Masjid" };

const centralGroup: GuidedGroupOption = {
  id: "group-central",
  name: "Central Brothers A",
  cohort_name: "Brothers",
  masjid_id: centralMasjid.id,
  masjid_name: centralMasjid.name
};

const lakeshoreGroup: GuidedGroupOption = {
  id: "group-lakeshore",
  name: "Lakeshore Sisters B",
  cohort_name: "Sisters",
  masjid_id: lakeshoreMasjid.id,
  masjid_name: lakeshoreMasjid.name
};

function staffMembership(
  id: string,
  masjid: typeof centralMasjid,
  staffRole: "admin" | "teacher"
): GuidedStaffMembership {
  return {
    id,
    masjid_id: masjid.id,
    masjid_name: masjid.name,
    staff_role: staffRole,
    active: true,
    starts_on: "2026-01-01",
    ends_on: null
  };
}

function studentMembership(
  id = "student-membership",
  group = centralGroup
): GuidedStudentMembership {
  return {
    id,
    group_id: group.id,
    group_name: group.name,
    cohort_name: group.cohort_name,
    masjid_id: group.masjid_id,
    masjid_name: group.masjid_name,
    starts_on: "2026-01-04",
    ends_on: null
  };
}

function snapshot(overrides: Partial<GuidedAccessSnapshot> = {}): GuidedAccessSnapshot {
  return {
    profile: {
      id: "person-1",
      name: "Amina Rahman",
      role: "student",
      active: true
    },
    studentMemberships: [],
    staffMemberships: [],
    teacherAssignments: [],
    masjids: [centralMasjid, lakeshoreMasjid],
    groups: [centralGroup, lakeshoreGroup],
    ...overrides
  };
}

describe("presetForGuidedOperation", () => {
  it("derives the base access preset for every guided operation", () => {
    const input = { staffMemberships: [], masjidId: centralMasjid.id };

    expect(presetForGuidedOperation({ ...input, operation: "set_teacher_only" })).toBe("teacher");
    expect(presetForGuidedOperation({ ...input, operation: "set_admin_only" })).toBe("admin");
    expect(presetForGuidedOperation({ ...input, operation: "set_admin_teacher" })).toBe("admin_teacher");
    expect(presetForGuidedOperation({ ...input, operation: "assign_student" })).toBe("student");
    expect(presetForGuidedOperation({ ...input, operation: "deactivate_account" })).toBe("inactive");
  });

  it("replaces selected-masjid admin access when setting teacher only", () => {
    const admin = staffMembership("central-admin", centralMasjid, "admin");
    const accessSnapshot = snapshot({
      profile: { id: "person-1", name: "Amina Rahman", role: "admin", active: true },
      staffMemberships: [admin]
    });

    expect(
      presetForGuidedOperation({
        operation: "set_teacher_only",
        masjidId: centralMasjid.id,
        staffMemberships: [admin]
      })
    ).toBe("teacher");

    const review = buildGuidedChangeReview({
      snapshot: accessSnapshot,
      draft: { operation: "set_teacher_only", masjidId: centralMasjid.id, startsOn: TODAY },
      today: TODAY
    });

    expect(review.plan?.staffMembershipCloses).toEqual([{ id: admin.id, endsOn: "2026-07-21" }]);
    expect(review.plan?.staffMembershipInserts).toEqual([
      { masjidId: centralMasjid.id, staffRole: "teacher", startsOn: TODAY }
    ]);
    expect(review.rows.find((row) => row.id === `staff-${centralMasjid.id}`)?.after).toBe(
      "Teacher only"
    );
  });

  it("replaces selected-masjid teacher access when setting admin only", () => {
    const teacher = staffMembership("central-teacher", centralMasjid, "teacher");
    const accessSnapshot = snapshot({
      profile: { id: "person-1", name: "Amina Rahman", role: "teacher", active: true },
      staffMemberships: [teacher]
    });

    expect(
      presetForGuidedOperation({
        operation: "set_admin_only",
        masjidId: centralMasjid.id,
        staffMemberships: [teacher]
      })
    ).toBe("admin");

    const review = buildGuidedChangeReview({
      snapshot: accessSnapshot,
      draft: { operation: "set_admin_only", masjidId: centralMasjid.id, startsOn: TODAY },
      today: TODAY
    });

    expect(review.plan?.staffMembershipCloses).toEqual([{ id: teacher.id, endsOn: "2026-07-21" }]);
    expect(review.plan?.staffMembershipInserts).toEqual([
      { masjidId: centralMasjid.id, staffRole: "admin", startsOn: TODAY }
    ]);
    expect(review.rows.find((row) => row.id === `staff-${centralMasjid.id}`)?.after).toBe(
      "Admin only"
    );
  });
});

describe("buildGuidedChangeReview", () => {
  it("uses the explicitly selected group for a student assignment review", () => {
    const accessSnapshot = snapshot({
      profile: { id: "person-1", name: "Amina Rahman", role: "admin", active: true },
      staffMemberships: [staffMembership("central-admin", centralMasjid, "admin")]
    });

    const review = buildGuidedChangeReview({
      snapshot: accessSnapshot,
      draft: {
        operation: "assign_student",
        masjidId: lakeshoreMasjid.id,
        groupId: lakeshoreGroup.id,
        startsOn: SUNDAY
      },
      today: SUNDAY
    });

    expect(review.scopeLabel).toBe("Lakeshore Masjid / Sisters / Lakeshore Sisters B");
    expect(review.plan?.studentMembershipInsert).toEqual({
      groupId: lakeshoreGroup.id,
      startsOn: SUNDAY
    });
    expect(review.rows.find((row) => row.id === "student-placement")?.after).toBe(
      "Lakeshore Sisters B · Sisters · Lakeshore Masjid"
    );
  });

  it("blocks student placement dates that are not Sunday boundaries", () => {
    const review = buildGuidedChangeReview({
      snapshot: snapshot(),
      draft: {
        operation: "assign_student",
        masjidId: centralMasjid.id,
        groupId: centralGroup.id,
        startsOn: TODAY
      },
      today: TODAY
    });

    expect(review.blockers).toContain(
      "Student placement must start on a Sunday tracker-week boundary."
    );
  });

  it("keeps access at unrelated masajid out of the mutation plan and names it as unchanged", () => {
    const centralAdmin = staffMembership("central-admin", centralMasjid, "admin");
    const lakeshoreTeacher = staffMembership("lakeshore-teacher", lakeshoreMasjid, "teacher");
    const review = buildGuidedChangeReview({
      snapshot: snapshot({
        profile: { id: "person-1", name: "Amina Rahman", role: "admin", active: true },
        staffMemberships: [centralAdmin, lakeshoreTeacher]
      }),
      draft: { operation: "set_teacher_only", masjidId: centralMasjid.id, startsOn: TODAY },
      today: TODAY
    });

    expect(review.plan?.staffMembershipCloses).toEqual([{ id: centralAdmin.id, endsOn: "2026-07-21" }]);
    expect(review.plan?.staffMembershipInserts).not.toContainEqual(
      expect.objectContaining({ masjidId: lakeshoreMasjid.id })
    );
    expect(review.unchanged).toContain(
      "Lakeshore Masjid: Teacher only remains unchanged."
    );
  });

  it("retains an admin role projected from another masjid during replacement", () => {
    const centralAdmin = staffMembership("central-admin", centralMasjid, "admin");
    const lakeshoreAdmin = staffMembership("lakeshore-admin", lakeshoreMasjid, "admin");
    const review = buildGuidedChangeReview({
      snapshot: snapshot({
        profile: { id: "person-1", name: "Amina Rahman", role: "admin", active: true },
        staffMemberships: [centralAdmin, lakeshoreAdmin]
      }),
      draft: { operation: "set_teacher_only", masjidId: centralMasjid.id, startsOn: TODAY },
      today: TODAY
    });

    expect(review.plan?.staffMembershipCloses).toEqual([{ id: centralAdmin.id, endsOn: "2026-07-21" }]);
    expect(review.plan?.staffMembershipCloses).not.toContainEqual(
      expect.objectContaining({ id: lakeshoreAdmin.id })
    );
    expect(review.plan?.nextRole).toBe("admin");
    expect(review.plan?.effectiveRole).toBe("admin");
  });

  it("keeps student placement during selected-masjid staff replacement and warns on staff-to-student conversion", () => {
    const studentToStaff = buildGuidedChangeReview({
      snapshot: snapshot({ studentMemberships: [studentMembership()] }),
      draft: { operation: "set_teacher_only", masjidId: centralMasjid.id, startsOn: TODAY },
      today: TODAY
    });
    const staffToStudent = buildGuidedChangeReview({
      snapshot: snapshot({
        profile: { id: "person-1", name: "Amina Rahman", role: "teacher", active: true },
        staffMemberships: [staffMembership("central-teacher", centralMasjid, "teacher")]
      }),
      draft: {
        operation: "assign_student",
        masjidId: centralMasjid.id,
        groupId: centralGroup.id,
        startsOn: SUNDAY
      },
      today: SUNDAY
    });

    expect(studentToStaff.plan?.studentMembershipCloses).toEqual([]);
    expect(studentToStaff.unchanged).toContain("Student placement is unchanged.");
    expect(staffToStudent.warnings).toContain(
      "This is an account conversion: all current staff access will end when student placement starts."
    );
  });

  it("blocks removal of teacher access while assignments remain", () => {
    const review = buildGuidedChangeReview({
      snapshot: snapshot({
        profile: { id: "person-1", name: "Amina Rahman", role: "teacher", active: true },
        staffMemberships: [staffMembership("central-teacher", centralMasjid, "teacher")],
        teacherAssignments: [
          {
            id: "assignment-1",
            week_start: FUTURE_SUNDAY,
            group_name: centralGroup.name,
            cohort_name: centralGroup.cohort_name,
            masjid_id: centralMasjid.id,
            masjid_name: centralMasjid.name
          }
        ]
      }),
      draft: { operation: "deactivate_account", startsOn: TODAY },
      today: TODAY
    });

    expect(review.blockers).toContain(
      "Current or upcoming teacher assignments must be resolved before this operation can remove teacher access for their halaqa Saturday."
    );
  });

  it("keeps the current global role until a future replacement starts", () => {
    const review = buildGuidedChangeReview({
      snapshot: snapshot({
        profile: { id: "person-1", name: "Amina Rahman", role: "teacher", active: true },
        staffMemberships: [staffMembership("central-teacher", centralMasjid, "teacher")]
      }),
      draft: {
        operation: "set_admin_only",
        masjidId: centralMasjid.id,
        startsOn: FUTURE_SUNDAY
      },
      today: TODAY
    });

    expect(review.blockers).not.toContain(
      "This change would update the global account before the selected date. Choose today, or use a membership-only change that preserves the current role."
    );
    expect(review.plan?.nextRole).toBe("teacher");
    expect(review.plan?.effectiveRole).toBe("admin");
  });

  it("rejects a guided change that produces no mutations", () => {
    const review = buildGuidedChangeReview({
      snapshot: snapshot({
        profile: { id: "person-1", name: "Amina Rahman", role: "teacher", active: true },
        staffMemberships: [staffMembership("central-teacher", centralMasjid, "teacher")]
      }),
      draft: { operation: "set_teacher_only", masjidId: centralMasjid.id, startsOn: TODAY },
      today: TODAY
    });

    expect(review.blockers).toContain(
      "The selected access is already in effect; there is no change to apply."
    );
  });

  it("rejects historical effective dates", () => {
    const review = buildGuidedChangeReview({
      snapshot: snapshot(),
      draft: {
        operation: "set_teacher_only",
        masjidId: centralMasjid.id,
        startsOn: "2026-07-21"
      },
      today: TODAY
    });

    expect(review.blockers).toContain(
      "Guided Change cannot make historical corrections. Choose today or a future date."
    );
  });

  it("routes super-admin account changes away from the general guided workflow", () => {
    const review = buildGuidedChangeReview({
      snapshot: snapshot({
        profile: { id: "person-1", name: "Amina Rahman", role: "super_admin", active: true }
      }),
      draft: { operation: "deactivate_account", startsOn: TODAY },
      today: TODAY
    });

    expect(review.blockers).toContain(
      "Super-admin privilege and account state require the dedicated privilege-safe workflow and cannot be changed here yet."
    );
  });

  it("blocks student placement while any open staff capability remains", () => {
    const review = buildGuidedChangeReview({
      snapshot: snapshot({
        profile: { id: "person-1", name: "Amina Rahman", role: "admin", active: true },
        staffMemberships: [staffMembership("central-admin", centralMasjid, "admin")]
      }),
      draft: {
        operation: "assign_student",
        masjidId: centralMasjid.id,
        groupId: centralGroup.id,
        startsOn: FUTURE_SUNDAY
      },
      today: TODAY
    });

    expect(review.blockers).toContain(
      "This person has open staff access. End those capabilities through their guarded workflows before assigning student placement."
    );
  });

  it("allows deactivation when teacher access has no assignment after the stop date", () => {
    const review = buildGuidedChangeReview({
      snapshot: snapshot({
        profile: { id: "person-1", name: "Amina Rahman", role: "teacher", active: true },
        staffMemberships: [staffMembership("central-teacher", centralMasjid, "teacher")]
      }),
      draft: { operation: "deactivate_account", startsOn: TODAY },
      today: TODAY
    });

    expect(review.blockers).not.toContain(
      "Open teacher access must be ended through its assignment-aware workflow before this account can be deactivated."
    );
  });

  it("uses explicit replacement labels for inactive accounts", () => {
    const inactiveSnapshot = snapshot({
      profile: { id: "person-1", name: "Amina Rahman", role: "student", active: false }
    });

    expect(operationLabelForSnapshot(inactiveSnapshot, "set_teacher_only", TODAY)).toBe(
      "Set Teacher only"
    );
    expect(operationLabelForSnapshot(inactiveSnapshot, "assign_student", TODAY)).toBe(
      "Reactivate with student placement"
    );
  });

  it("ends a finite complementary staff membership during replacement", () => {
    const finiteTeacher = {
      ...staffMembership("central-teacher", centralMasjid, "teacher"),
      ends_on: "2026-08-31"
    };
    const review = buildGuidedChangeReview({
      snapshot: snapshot({
        profile: { id: "person-1", name: "Amina Rahman", role: "teacher", active: true },
        staffMemberships: [finiteTeacher]
      }),
      draft: { operation: "set_admin_only", masjidId: centralMasjid.id, startsOn: TODAY },
      today: TODAY
    });

    expect(review.plan?.staffMembershipCloses).toEqual([{ id: finiteTeacher.id, endsOn: "2026-07-21" }]);
    expect(review.plan?.staffMembershipInserts).toContainEqual({
      masjidId: centralMasjid.id,
      staffRole: "admin",
      startsOn: TODAY
    });
    expect(review.rows.find((row) => row.id === `staff-${centralMasjid.id}`)?.after).toBe(
      "Admin only"
    );
  });
});
