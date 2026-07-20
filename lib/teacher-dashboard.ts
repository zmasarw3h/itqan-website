import { isValidDateString, weekStartForDate } from "@/lib/dates";
import type { Profile } from "@/lib/types";

export type TeacherAssignmentContext = {
  assignment_id: string;
  group_id: string;
  group_name: string;
  cohort_id: string;
  cohort_name: string;
  cohort_kind: "brothers" | "sisters";
  masjid_id: string;
  masjid_name: string;
  week_start: string;
  roster_count: number;
};

export type TeacherRosterMembership = {
  student_id: string;
  group_id: string;
  starts_on: string;
  ends_on: string | null;
};

export type TeacherRosterProfile = Pick<Profile, "id" | "name" | "active">;

export type TeacherRosterStudent = {
  id: string;
  name: string;
};

export type TeacherRosterContext = TeacherRosterStudent & {
  dailyCheckinDays: number;
  dailyPoints: number;
  partnerRounds: number;
  partnerPoints: number;
};

export function isTrackerWeekStart(value: string) {
  return isValidDateString(value) && weekStartForDate(value) === value;
}

export function resolveTeacherWeekStart(value: string | string[] | undefined, currentWeekStart: string) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && isTrackerWeekStart(candidate) ? candidate : currentWeekStart;
}

export function resolveAuthorizedTeacherWeekStart(
  value: string | string[] | undefined,
  currentWeekStart: string,
  assignments: readonly Pick<TeacherAssignmentContext, "week_start">[]
) {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (!candidate || !isTrackerWeekStart(candidate)) {
    return currentWeekStart;
  }

  return candidate === currentWeekStart || assignments.some((assignment) => assignment.week_start === candidate)
    ? candidate
    : currentWeekStart;
}

export function assignmentWeekStarts(
  assignments: readonly Pick<TeacherAssignmentContext, "week_start">[],
  currentWeekStart: string
) {
  return [...new Set([currentWeekStart, ...assignments.map((assignment) => assignment.week_start)])].sort((a, b) =>
    b.localeCompare(a)
  );
}

export function assignmentsForWeek(assignments: readonly TeacherAssignmentContext[], weekStart: string) {
  return assignments
    .filter((assignment) => assignment.week_start === weekStart)
    .sort(
      (a, b) =>
        a.masjid_name.localeCompare(b.masjid_name) ||
        a.cohort_name.localeCompare(b.cohort_name) ||
        a.group_name.localeCompare(b.group_name) ||
        a.group_id.localeCompare(b.group_id)
    );
}

export function scopeWindowIncludesWeek(
  membership: Pick<TeacherRosterMembership, "starts_on" | "ends_on">,
  weekStart: string
) {
  return membership.starts_on <= weekStart && (membership.ends_on === null || membership.ends_on >= weekStart);
}

export function selectTeacherRoster(input: {
  groupId: string;
  weekStart: string;
  memberships: readonly TeacherRosterMembership[];
  profiles: readonly TeacherRosterProfile[];
}) {
  const eligibleStudentIds = new Set(
    input.memberships
      .filter(
        (membership) =>
          membership.group_id === input.groupId && scopeWindowIncludesWeek(membership, input.weekStart)
      )
      .map((membership) => membership.student_id)
  );

  return input.profiles
    .filter((profile) => profile.active && eligibleStudentIds.has(profile.id))
    .map<TeacherRosterStudent>((profile) => ({ id: profile.id, name: profile.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function canAccessTeacherExperience(
  profile: Pick<Profile, "active" | "role"> | null,
  assignments: readonly Pick<TeacherAssignmentContext, "week_start">[],
  requestedAssignmentWeek?: string
) {
  if (!profile?.active) {
    return false;
  }

  if (profile.role === "teacher") {
    return true;
  }

  if (profile.role !== "admin" || assignments.length === 0) {
    return false;
  }

  return requestedAssignmentWeek
    ? assignments.some((assignment) => assignment.week_start === requestedAssignmentWeek)
    : true;
}

export type TeacherGradeInput = {
  attended: boolean;
  attendancePoints: number;
  recitationPoints: number;
  notes: string | null;
};

export function parseTeacherGradeInput(input: {
  attended: boolean;
  recitationPoints: FormDataEntryValue | null;
  notes: FormDataEntryValue | null;
}): TeacherGradeInput | null {
  const recitationPoints = Number(input.recitationPoints ?? 0);

  if (input.attended && (!Number.isInteger(recitationPoints) || recitationPoints < 10 || recitationPoints > 50)) {
    return null;
  }

  const notes = typeof input.notes === "string" ? input.notes.trim() : "";

  return {
    attended: input.attended,
    attendancePoints: input.attended ? 100 : 0,
    recitationPoints: input.attended ? recitationPoints : 0,
    notes: notes || null
  };
}
