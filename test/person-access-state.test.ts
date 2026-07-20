import { describe, expect, it } from "vitest";
import type { PersonDetailData } from "@/app/super-admin/data";
import { reconcilePersonDetailWithAccessState } from "@/lib/person-access-state";

const createdAt = "2026-07-01T00:00:00.000Z";

describe("reconcilePersonDetailWithAccessState", () => {
  it("derives displayed profile and membership defaults from the same canonical snapshot", () => {
    const staleDetail: PersonDetailData = {
      profile: {
        id: "person-1",
        name: "Test Person",
        email: "person@example.com",
        phone: null,
        role: "student",
        active: false
      },
      authEmail: "person@example.com",
      authMissing: false,
      studentMemberships: [
        {
          id: "student-membership-old",
          student_id: "person-1",
          group_id: "group-old",
          starts_on: "2026-06-01",
          ends_on: null,
          assigned_by: null,
          created_at: createdAt,
          updated_at: null,
          group_name: "Old Group",
          cohort_name: "Old Cohort",
          cohort_kind: "brothers",
          masjid_id: "masjid-old",
          masjid_name: "Old Masjid"
        }
      ],
      staffMemberships: [],
      teacherAssignments: [],
      warnings: [],
      options: {
        masjids: [{ id: "masjid-new", name: "New Masjid", slug: "new-masjid" }],
        groups: [
          {
            id: "group-new",
            name: "New Group",
            cohort_id: "cohort-new",
            cohort_name: "New Cohort",
            cohort_kind: "sisters",
            masjid_id: "masjid-new",
            masjid_name: "New Masjid"
          }
        ]
      }
    };
    const canonicalState = {
      profile: { id: "person-1", role: "admin", active: true },
      student_memberships: [],
      staff_memberships: [
        {
          id: "staff-membership-new",
          profile_id: "person-1",
          masjid_id: "masjid-new",
          staff_role: "admin",
          active: true,
          starts_on: "2026-07-20",
          ends_on: null,
          created_by: "actor-1",
          created_at: createdAt,
          updated_at: null
        }
      ]
    };

    const reconciled = reconcilePersonDetailWithAccessState(staleDetail, canonicalState);

    expect(reconciled.profile).toMatchObject({ role: "admin", active: true });
    expect(reconciled.studentMemberships).toEqual([]);
    expect(reconciled.staffMemberships).toEqual([
      {
        ...canonicalState.staff_memberships[0],
        masjid_name: "New Masjid"
      }
    ]);
    expect(canonicalState).toEqual({
      profile: { id: "person-1", role: "admin", active: true },
      student_memberships: [],
      staff_memberships: [
        {
          id: "staff-membership-new",
          profile_id: "person-1",
          masjid_id: "masjid-new",
          staff_role: "admin",
          active: true,
          starts_on: "2026-07-20",
          ends_on: null,
          created_by: "actor-1",
          created_at: createdAt,
          updated_at: null
        }
      ]
    });
  });
});
