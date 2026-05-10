const AUTH_EMAIL_DOMAIN = "itqan.local";

export function normalizePhoneNumber(input: string) {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("Enter a phone number.");
  }

  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");

    if (digits.length < 8 || digits.length > 15) {
      throw new Error("Enter a valid phone number.");
    }

    return `+${digits}`;
  }

  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  throw new Error("Enter a valid 10-digit phone number, or include + and country code.");
}

export function phoneNumberToAuthEmail(input: string) {
  const normalized = normalizePhoneNumber(input);
  return `${normalized.slice(1)}@${AUTH_EMAIL_DOMAIN}`;
}
