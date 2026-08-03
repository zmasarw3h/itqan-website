import {
  hasExplicitCountryCode,
  normalizedPhoneToAuthEmail,
  phoneDigits,
  phoneNumberToAuthEmail
} from "@/lib/phone-auth";
import { loginErrorMessage, type LoginErrorCode } from "@/lib/login-contract";
import type { Profile } from "@/lib/types";

export type LoginPhoneProfile = Pick<Profile, "id" | "email" | "phone" | "role" | "active">;

export type LoginPhoneProfileLookup = (digits: string) => Promise<LoginPhoneProfile[]>;

export type LoginIdentifierErrorCode = Extract<
  LoginErrorCode,
  "invalid_identifier" | "ambiguous_identifier" | "service_unavailable"
>;

export class LoginIdentifierError extends Error {
  readonly code: LoginIdentifierErrorCode;

  constructor(code: LoginIdentifierErrorCode) {
    super(loginErrorMessage(code));
    this.name = "LoginIdentifierError";
    this.code = code;
  }
}

export async function resolveLoginIdentifierToAuthEmail(
  identifier: string,
  lookupActiveProfilesByPhoneDigits: LoginPhoneProfileLookup
) {
  const trimmedIdentifier = identifier.trim();

  if (trimmedIdentifier.includes("@")) {
    return trimmedIdentifier.toLowerCase();
  }

  if (hasExplicitCountryCode(trimmedIdentifier)) {
    return phoneNumberToAuthEmail(trimmedIdentifier);
  }

  const digits = phoneDigits(trimmedIdentifier);

  if (digits.length < 7) {
    throw new LoginIdentifierError("invalid_identifier");
  }

  let fallbackAuthEmail: string | null = null;
  let fallbackError: LoginIdentifierError | null = null;

  try {
    fallbackAuthEmail = phoneNumberToAuthEmail(trimmedIdentifier);
  } catch {
    fallbackError = new LoginIdentifierError("invalid_identifier");
  }

  const profiles = await lookupActiveProfilesByPhoneDigits(digits);
  const matchingProfiles = profiles.filter((profile) => {
    if (!profile.active || !profile.phone) {
      return false;
    }

    return phoneDigits(profile.phone).endsWith(digits);
  });

  if (matchingProfiles.length > 1) {
    throw new LoginIdentifierError("ambiguous_identifier");
  }

  if (matchingProfiles.length === 1) {
    const [profile] = matchingProfiles;
    if (profile.phone) {
      return normalizedPhoneToAuthEmail(profile.phone);
    }
  }

  if (fallbackAuthEmail) {
    return fallbackAuthEmail;
  }

  throw fallbackError ?? new LoginIdentifierError("invalid_identifier");
}
