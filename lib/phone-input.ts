import { AsYouType } from "libphonenumber-js/min";

const EMAIL_LIKE_INPUT = /[A-Za-z@]/;

export function formatLoginIdentifier(input: string) {
  if (!input || EMAIL_LIKE_INPUT.test(input)) {
    return input;
  }

  const trimmedInput = input.trimStart();
  const hasInternationalPrefix = trimmedInput.startsWith("+");
  const digits = input.replace(/\D/g, "");

  if (!digits) {
    return hasInternationalPrefix ? "+" : "";
  }

  const formatter = new AsYouType("CA");
  return formatter.input(`${hasInternationalPrefix ? "+" : ""}${digits}`);
}

