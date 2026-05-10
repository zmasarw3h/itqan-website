const AUTH_EMAIL_DOMAIN = "itqan.local";

export function phoneDigits(input: string) {
  return input.replace(/\D/g, "");
}

export function hasExplicitCountryCode(input: string) {
  return input.trim().startsWith("+");
}

export function normalizePhoneNumber(input: string) {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("Enter a phone number.");
  }

  if (trimmed.startsWith("+")) {
    const digits = phoneDigits(trimmed.slice(1));

    if (digits.length < 8 || digits.length > 15) {
      throw new Error("Enter a valid phone number.");
    }

    return `+${digits}`;
  }

  const digits = phoneDigits(trimmed);

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

export function normalizedPhoneToAuthEmail(normalizedPhone: string) {
  if (!normalizedPhone.startsWith("+")) {
    throw new Error("Normalized phone number must start with +.");
  }

  return `${normalizedPhone.slice(1)}@${AUTH_EMAIL_DOMAIN}`;
}
