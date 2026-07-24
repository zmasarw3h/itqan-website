import { normalizePhoneNumber, phoneNumberToAuthEmail } from "@/lib/phone-auth";
import type { Role } from "@/lib/types";

export const DEFAULT_USER_PASSWORD = "itqan2026";

const CREATEABLE_ROLES = new Set<Role>(["student", "teacher"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNCERTAIN_SETUP_STATUSES = new Set(["setup-uncertain", "auth-uncertain"]);

export type ScopedUserSetupRetryContext = {
  status: string;
  requestId: string;
  role: "student" | "teacher";
  studentMasjidId?: string | null;
  studentCohortId?: string | null;
  studentGroupId?: string | null;
  teacherMasjidId?: string | null;
  scoreStartsOn?: string | null;
};

export function preservedScopedUserSetupRequestId(status: string | undefined, requestId: string | undefined) {
  return status && UNCERTAIN_SETUP_STATUSES.has(status) && requestId && UUID_PATTERN.test(requestId)
    ? requestId
    : null;
}

export function scopedUserSetupFailureSearchParams(input: ScopedUserSetupRetryContext) {
  const params = new URLSearchParams({ status: input.status, role: input.role });

  if (!UNCERTAIN_SETUP_STATUSES.has(input.status) || !UUID_PATTERN.test(input.requestId)) {
    return params;
  }

  params.set("request_id", input.requestId);
  if (input.scoreStartsOn) params.set("score_starts_on", input.scoreStartsOn);
  const scopeValues = {
    student_masjid_id: input.studentMasjidId,
    student_cohort_id: input.studentCohortId,
    student_group_id: input.studentGroupId,
    teacher_masjid_id: input.teacherMasjidId
  };

  for (const [key, value] of Object.entries(scopeValues)) {
    if (value && UUID_PATTERN.test(value)) params.set(key, value);
  }

  return params;
}

export function buildAdminUserCreateInput(input: {
  name: FormDataEntryValue | null;
  phone: FormDataEntryValue | null;
  role: FormDataEntryValue | null;
}) {
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  const phoneInput = typeof input.phone === "string" ? input.phone : "";
  const role = typeof input.role === "string" && CREATEABLE_ROLES.has(input.role as Role) ? (input.role as Role) : null;

  if (name.length < 2) {
    throw new Error("Enter the user's name.");
  }

  if (name.length > 120) {
    throw new Error("User name is too long.");
  }

  if (!role) {
    throw new Error("Choose a valid user role.");
  }

  const phone = normalizePhoneNumber(phoneInput);
  const email = phoneNumberToAuthEmail(phone);

  return {
    name,
    phone,
    email,
    password: DEFAULT_USER_PASSWORD,
    role,
    active: true
  };
}
