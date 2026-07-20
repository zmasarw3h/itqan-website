import type { PersonDetailData, StaffMembershipDetail, StudentMembershipDetail } from "@/app/super-admin/data";
import type { PersonAccessState } from "@/lib/transactional-workflows";
import type { Role, StaffRole } from "@/lib/types";

type CanonicalProfile = {
  id: string;
  role: Role;
  active: boolean;
};

type CanonicalStudentMembership = Pick<
  StudentMembershipDetail,
  "id" | "student_id" | "group_id" | "starts_on" | "ends_on" | "assigned_by" | "created_at" | "updated_at"
>;

type CanonicalStaffMembership = Pick<
  StaffMembershipDetail,
  "id" | "profile_id" | "masjid_id" | "staff_role" | "active" | "starts_on" | "ends_on" | "created_by" | "created_at" | "updated_at"
>;

export type CanonicalPersonAccessState = PersonAccessState & {
  profile: CanonicalProfile;
  student_memberships: CanonicalStudentMembership[];
  staff_memberships: CanonicalStaffMembership[];
};

export function canonicalPersonAccessState(state: PersonAccessState): CanonicalPersonAccessState {
  return state as CanonicalPersonAccessState;
}

export function reconcilePersonDetailWithAccessState(
  data: PersonDetailData,
  rawState: PersonAccessState
): PersonDetailData {
  const state = canonicalPersonAccessState(rawState);
  const existingStudents = new Map(data.studentMemberships.map((membership) => [membership.id, membership]));
  const existingStaff = new Map(data.staffMemberships.map((membership) => [membership.id, membership]));
  const groupOptions = new Map(data.options.groups.map((group) => [group.id, group]));
  const masjidOptions = new Map(data.options.masjids.map((masjid) => [masjid.id, masjid]));

  const studentMemberships = state.student_memberships.map((membership): StudentMembershipDetail => {
    const existing = existingStudents.get(membership.id);
    const group = groupOptions.get(membership.group_id);

    return {
      ...membership,
      group_name: existing?.group_name ?? group?.name ?? "Missing group",
      cohort_name: existing?.cohort_name ?? group?.cohort_name ?? "Missing cohort",
      cohort_kind: existing?.cohort_kind ?? group?.cohort_kind ?? "brothers",
      masjid_id: existing?.masjid_id ?? group?.masjid_id ?? "",
      masjid_name: existing?.masjid_name ?? group?.masjid_name ?? "Missing masjid"
    };
  });
  const staffMemberships = state.staff_memberships.map((membership): StaffMembershipDetail => ({
    ...membership,
    staff_role: membership.staff_role as StaffRole,
    masjid_name:
      existingStaff.get(membership.id)?.masjid_name ??
      masjidOptions.get(membership.masjid_id)?.name ??
      "Missing masjid"
  }));

  return {
    ...data,
    profile: {
      ...data.profile,
      id: state.profile.id,
      role: state.profile.role,
      active: state.profile.active
    },
    studentMemberships,
    staffMemberships
  };
}
