import type { Profile, Role } from "@/lib/types";

export function defaultPathForRole(role: Role) {
  if (role === "admin") {
    return "/admin";
  }

  if (role === "student") {
    return "/student/check-in";
  }

  return "/account/change-password";
}

export function canUseApp(profile: Profile | null) {
  return Boolean(profile?.active);
}

export function canReadStudentData(actor: Profile | null, studentId: string) {
  if (!actor?.active) {
    return false;
  }

  return actor.role === "admin" || actor.role === "super_admin" || actor.id === studentId;
}

export function canReadAdminData(actor: Profile | null) {
  return Boolean(actor?.active && (actor.role === "admin" || actor.role === "super_admin"));
}

export function canSubmitStudentCheckIn(actor: Profile | null, studentId: string) {
  return Boolean(actor?.active && actor.role === "student" && actor.id === studentId);
}

export function canReadCheckInScores(actor: Profile | null, studentId: string) {
  return canReadStudentData(actor, studentId);
}
