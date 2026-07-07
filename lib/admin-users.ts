import { normalizePhoneNumber, phoneNumberToAuthEmail } from "@/lib/phone-auth";
import type { Role } from "@/lib/types";

export const DEFAULT_USER_PASSWORD = "itqan2026";

const CREATEABLE_ROLES = new Set<Role>(["student", "teacher"]);

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
