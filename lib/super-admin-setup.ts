import type { CohortKind, StaffRole } from "@/lib/types";

export type MasjidSetupCounts = {
  activeCohortCount: number;
  activeGroupCount: number;
  activeAdminCount: number;
};

export type StaffAccessGrant = "admin" | "admin_teacher";

const COHORT_KINDS = new Set<CohortKind>(["brothers", "sisters"]);
const STAFF_ACCESS_GRANTS = new Set<StaffAccessGrant>(["admin", "admin_teacher"]);
const MASJID_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeMasjidSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function isValidMasjidSlug(value: string) {
  return MASJID_SLUG_PATTERN.test(value);
}

export function parseCohortKind(value: FormDataEntryValue | string | null): CohortKind | null {
  return typeof value === "string" && COHORT_KINDS.has(value as CohortKind) ? (value as CohortKind) : null;
}

export function parseStaffAccessGrant(value: FormDataEntryValue | string | null): StaffAccessGrant | null {
  return typeof value === "string" && STAFF_ACCESS_GRANTS.has(value as StaffAccessGrant)
    ? (value as StaffAccessGrant)
    : null;
}

export function staffRolesForGrant(grant: StaffAccessGrant): StaffRole[] {
  return grant === "admin_teacher" ? ["admin", "teacher"] : ["admin"];
}

export function parsePositiveInteger(value: string, fallback: number) {
  if (!/^\d+$/.test(value.trim())) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildMasjidSetupWarnings(input: { active: boolean; counts: MasjidSetupCounts }) {
  const warnings: string[] = [];

  if (!input.active) {
    return warnings;
  }

  if (input.counts.activeCohortCount === 0) {
    warnings.push("Active masjid has no active cohorts.");
  }

  if (input.counts.activeGroupCount === 0) {
    warnings.push("Active masjid has no active groups.");
  }

  if (input.counts.activeAdminCount === 0) {
    warnings.push("Active masjid has no active admin.");
  }

  return warnings;
}
