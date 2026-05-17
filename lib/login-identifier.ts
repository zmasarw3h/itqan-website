import {
  hasExplicitCountryCode,
  normalizedPhoneToAuthEmail,
  phoneDigits,
  phoneNumberToAuthEmail
} from "@/lib/phone-auth";
import type { Profile } from "@/lib/types";

export type LoginPhoneProfile = Pick<Profile, "id" | "email" | "phone" | "role" | "active">;

export type LoginPhoneProfileLookup = (digits: string) => Promise<LoginPhoneProfile[]>;

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
    throw new Error("Enter a valid phone number.");
  }

  let fallbackAuthEmail: string | null = null;
  let fallbackError: Error | null = null;

  try {
    fallbackAuthEmail = phoneNumberToAuthEmail(trimmedIdentifier);
  } catch (error) {
    fallbackError = error instanceof Error ? error : new Error("Enter a valid phone number.");
  }

  const profiles = await lookupActiveProfilesByPhoneDigits(digits);
  const matchingProfiles = profiles.filter((profile) => {
    if (!profile.active || !profile.phone) {
      return false;
    }

    return phoneDigits(profile.phone).endsWith(digits);
  });

  if (matchingProfiles.length > 1) {
    throw new Error("Multiple accounts match that phone number. Include + and country code.");
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

  throw fallbackError ?? new Error("Enter a valid phone number.");
}
