import { normalizePhoneNumber, phoneNumberToAuthEmail } from "@/lib/phone-auth";

export const DEFAULT_STUDENT_PASSWORD = "itqan2026";

export function buildAdminStudentCreateInput(input: { name: FormDataEntryValue | null; phone: FormDataEntryValue | null }) {
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  const phoneInput = typeof input.phone === "string" ? input.phone : "";

  if (name.length < 2) {
    throw new Error("Enter the student's name.");
  }

  if (name.length > 120) {
    throw new Error("Student name is too long.");
  }

  const phone = normalizePhoneNumber(phoneInput);
  const email = phoneNumberToAuthEmail(phone);

  return {
    name,
    phone,
    email,
    password: DEFAULT_STUDENT_PASSWORD,
    role: "student" as const,
    active: true
  };
}
