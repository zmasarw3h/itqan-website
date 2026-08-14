import type { Profile, Role } from "@/lib/types";

export function defaultPathForRole(role: Role) {
  if (role === "super_admin") {
    return "/super-admin";
  }

  if (role === "admin") {
    return "/admin";
  }

  if (role === "student") {
    return "/student/check-in";
  }

  return "/teacher";
}

export type AppNavigationLink = {
  href: string;
  label: string;
  prefetch?: false;
};

export function navigationLinksForRole(role: Role, hasTeacherCapability = false): AppNavigationLink[] {
  if (role === "admin") {
    return [
      { href: "/admin", label: "Admin", prefetch: false },
      ...(hasTeacherCapability ? [{ href: "/teacher", label: "Teaching", prefetch: false as const }] : []),
      { href: "/admin/rotation", label: "Rotation", prefetch: false },
      { href: "/admin/reports", label: "Reports", prefetch: false },
      { href: "/admin/students/new", label: "Add User" },
      { href: "/account/change-password", label: "Password" }
    ];
  }

  if (role === "student") {
    return [
      { href: "/student/check-in", label: "Today" },
      { href: "/student/partner-recitation", label: "My Progress" },
      { href: "/student/weekly-plan", label: "Weekly Plan" },
      { href: "/account/change-password", label: "Account" }
    ];
  }

  if (role === "super_admin") {
    return [
      { href: "/super-admin", label: "Overview" },
      { href: "/super-admin/people", label: "People" },
      { href: "/super-admin/masajid", label: "Masajid" },
      { href: "/super-admin/repairs", label: "Repairs" },
      { href: "/super-admin/audit", label: "Audit" },
      { href: "/account/change-password", label: "Account" }
    ];
  }

  return [
    { href: "/teacher", label: "Teaching", prefetch: false },
    { href: "/account/change-password", label: "Password" }
  ];
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
