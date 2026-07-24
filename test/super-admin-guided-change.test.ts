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

    expect(presetForGuidedOperation({ ...input, operation: "add_teacher" })).toBe("teacher");
    expect(presetForGuidedOperation({ ...input, operation: "add_admin" })).toBe("admin");
    expect(presetForGuidedOperation({ ...input, operation: "add_admin_teacher" })).toBe("admin_teacher");
    expect(presetForGuidedOperation({ ...input, operation: "assign_student" })).toBe("student");
    expect(presetForGuidedOperation({ ...input, operation: "deactivate_account" })).toBe("inactive");
  });

  it("preserves existing admin access when adding teacher access", () => {
    const admin = staffMembership("central-admin", centralMasjid, "admin");
    const accessSnapshot = snapshot({
      profile: { id: "person-1", name: "Amina Rahman", role: "admin", active: true },
      staffMemberships: [admin]
    });

    expect(
      presetForGuidedOperation({
        operation: "add_teacher",
        masjidId: centralMasjid.id,
        staffMemberships: [admin]
      })
    ).toBe("admin_teacher");

    const review = buildGuidedChangeReview({
      snapshot: accessSnapshot,
      draft: { operation: "add_teacher", masjidId: centralMasjid.id, startsOn: TODAY },
      today: TODAY
    });

    expect(review.plan?.staffMembershipCloses).toEqual([]);
    expect(review.plan?.staffMembershipInserts).toEqual([
      { masjidId: centralMasjid.id, staffRole: "teacher", startsOn: TODAY }
    ]);
    expect(review.rows.find((row) => row.id === `staff-${centralMasjid.id}`)?.after).toBe(
      "Admin + Teacher"
    );
  });

  it("preserves existing teacher access when adding admin access", () => {
    const teacher = staffMembership("central-teacher", centralMasjid, "teacher");
    const accessSnapshot = snapshot({
      profile: { id: "person-1", name: "Amina Rahman", role: "teacher", active: true },
      staffMemberships: [teacher]
    });

    expect(
      presetForGuidedOperation({
        operation: "add_admin",
        masjidId: centralMasjid.id,
        staffMemberships: [teacher]
      })
    ).toBe("admin_teacher");

    const review = buildGuidedChangeReview({
      snapshot: accessSnapshot,
      draft: { operation: "add_admin", masjidId: centralMasjid.id, startsOn: TODAY },
      today: TODAY
    });

    expect(review.plan?.staffMembershipCloses).toEqual([]);
    expect(review.plan?.staffMembershipInserts).toEqual([
      { masjidId: centralMasjid.id, staffRole: "admin", startsOn: TODAY }
    ]);
    expect(review.rows.find((row) => row.id === `staff-${centralMasjid.id}`)?.after).toBe(
      "Admin + Teacher"
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
      draft: { operation: "add_teacher", masjidId: centralMasjid.id, startsOn: TODAY },
      today: TODAY
    });

    expect(review.plan?.staffMembershipCloses).toEqual([]);
    expect(review.plan?.staffMembershipInserts).not.toContainEqual(
      expect.objectContaining({ masjidId: lakeshoreMasjid.id })
    );
    expect(review.unchanged).toContain(
      "Lakeshore Masjid: Teacher only remains unchanged."
    );
  });

  it("warns when converting a student to staff and when converting staff to a student", () => {
    const studentToStaff = buildGuidedChangeReview({
      snapshot: snapshot({ studentMemberships: [studentMembership()] }),
      draft: { operation: "add_teacher", masjidId: centralMasjid.id, startsOn: TODAY },
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

    expect(studentToStaff.warnings).toContain(
      "This is an account conversion: the current student placement will end when staff access starts."
    );
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
      "Current or upcoming teacher assignments must be resolved before this operation can remove teacher access."
    );
  });

  it("blocks future-dated changes that would immediately alter the global role", () => {
    const review = buildGuidedChangeReview({
      snapshot: snapshot({
        profile: { id: "person-1", name: "Amina Rahman", role: "teacher", active: true },
        staffMemberships: [staffMembership("central-teacher", centralMasjid, "teacher")]
      }),
      draft: {
        operation: "add_admin",
        masjidId: centralMasjid.id,
        startsOn: FUTURE_SUNDAY
      },
      today: TODAY
    });

    expect(review.blockers).toContain(
      "This change would update the global account before the selected date. Choose today, or use a membership-only change that preserves the current role."
    );
  });

  it("rejects a guided change that produces no mutations", () => {
    const review = buildGuidedChangeReview({
      snapshot: snapshot({
        profile: { id: "person-1", name: "Amina Rahman", role: "teacher", active: true },
        staffMemberships: [staffMembership("central-teacher", centralMasjid, "teacher")]
      }),
      draft: { operation: "add_teacher", masjidId: centralMasjid.id, startsOn: TODAY },
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
        operation: "add_teacher",
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

  it("blocks deactivation while open teacher access requires assignment-aware closure", () => {
    const review = buildGuidedChangeReview({
      snapshot: snapshot({
        profile: { id: "person-1", name: "Amina Rahman", role: "teacher", active: true },
        staffMemberships: [staffMembership("central-teacher", centralMasjid, "teacher")]
      }),
      draft: { operation: "deactivate_account", startsOn: TODAY },
      today: TODAY
    });

    expect(review.blockers).toContain(
      "Open teacher access must be ended through its assignment-aware workflow before this account can be deactivated."
    );
  });

  it("describes inactive-account operations as reactivation", () => {
    const inactiveSnapshot = snapshot({
      profile: { id: "person-1", name: "Amina Rahman", role: "student", active: false }
    });

    expect(operationLabelForSnapshot(inactiveSnapshot, "add_teacher", TODAY)).toBe(
      "Reactivate with teacher access"
    );
    expect(operationLabelForSnapshot(inactiveSnapshot, "assign_student", TODAY)).toBe(
      "Reactivate with student placement"
    );
  });

  it("preserves a finite complementary staff membership", () => {
    const finiteTeacher = {
      ...staffMembership("central-teacher", centralMasjid, "teacher"),
      ends_on: "2026-08-31"
    };
    const review = buildGuidedChangeReview({
      snapshot: snapshot({
        profile: { id: "person-1", name: "Amina Rahman", role: "teacher", active: true },
        staffMemberships: [finiteTeacher]
      }),
      draft: { operation: "add_admin", masjidId: centralMasjid.id, startsOn: TODAY },
      today: TODAY
    });

    expect(review.plan?.staffMembershipCloses).toEqual([]);
    expect(review.plan?.staffMembershipInserts).toContainEqual({
      masjidId: centralMasjid.id,
      staffRole: "admin",
      startsOn: TODAY
    });
    expect(review.rows.find((row) => row.id === `staff-${centralMasjid.id}`)?.after).toBe(
      "Admin + Teacher"
    );
  });
});
