import { describe, expect, it } from "vitest";
import { resolveLoginIdentifierToAuthEmail, type LoginPhoneProfile } from "@/lib/login-identifier";

function profile(phone: string, id = phone): LoginPhoneProfile {
  return {
    id,
    email: `${id}@example.com`,
    phone,
    role: "student",
    active: true
  };
}

function lookupFrom(profiles: LoginPhoneProfile[]) {
  return async (digits: string) => profiles.filter((candidate) => candidate.phone?.replace(/\D/g, "").endsWith(digits));
}

describe("login identifier resolver", () => {
  it("uses trimmed lowercase email addresses directly", async () => {
    await expect(resolveLoginIdentifierToAuthEmail("  Admin@Example.com  ", lookupFrom([]))).resolves.toBe(
      "admin@example.com"
    );
  });

  it("resolves Canada/US phone numbers with the existing synthetic auth email format", async () => {
    await expect(resolveLoginIdentifierToAuthEmail("4165550100", lookupFrom([]))).resolves.toBe(
      "14165550100@itqan.local"
    );
  });

  it("resolves explicit international phone numbers without a profile lookup", async () => {
    await expect(resolveLoginIdentifierToAuthEmail("+201060901044", lookupFrom([]))).resolves.toBe(
      "201060901044@itqan.local"
    );
    await expect(resolveLoginIdentifierToAuthEmail("+923219448926", lookupFrom([]))).resolves.toBe(
      "923219448926@itqan.local"
    );
  });

  it("matches bare international digits against a stored Egyptian profile phone", async () => {
    await expect(
      resolveLoginIdentifierToAuthEmail("201060901044", lookupFrom([profile("+201060901044")]))
    ).resolves.toBe("201060901044@itqan.local");
  });

  it("matches bare international digits against a stored Pakistani profile phone", async () => {
    await expect(
      resolveLoginIdentifierToAuthEmail("923219448926", lookupFrom([profile("+923219448926")]))
    ).resolves.toBe("923219448926@itqan.local");
  });

  it("returns a clear error for ambiguous phone matches", async () => {
    await expect(
      resolveLoginIdentifierToAuthEmail(
        "1060901044",
        lookupFrom([profile("+201060901044", "egypt"), profile("+11060901044", "canada")])
      )
    ).rejects.toThrow("Multiple accounts match that phone number. Include + and country code.");
  });

  it("rejects invalid short phone numbers", async () => {
    await expect(resolveLoginIdentifierToAuthEmail("555", lookupFrom([]))).rejects.toThrow("Enter a valid phone number.");
  });
});
