export const LOGIN_ERROR_CODES = [
  "invalid_request",
  "invalid_identifier",
  "ambiguous_identifier",
  "invalid_credentials",
  "inactive_account",
  "rate_limited",
  "service_unavailable"
] as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

export type LoginFailure = {
  ok: false;
  error: {
    code: LoginErrorCode;
  };
};

export type LoginSuccess = {
  ok: true;
  redirectTo: string;
};

export type SignInResult = LoginFailure | LoginSuccess;

const LOGIN_ERROR_CODE_SET = new Set<string>(LOGIN_ERROR_CODES);

const LOGIN_ERROR_MESSAGES: Record<LoginErrorCode, string> = {
  invalid_request: "Enter your phone number and password.",
  invalid_identifier: "Enter a valid phone number.",
  ambiguous_identifier: "Multiple accounts match that phone number. Include + and country code.",
  invalid_credentials: "The phone number or password is incorrect.",
  inactive_account: "This account is not active. Contact your administrator.",
  rate_limited: "Too many sign-in attempts. Wait a few minutes and try again.",
  service_unavailable: "Sign-in is temporarily unavailable. Please try again."
};

export function loginFailure(code: LoginErrorCode): LoginFailure {
  return { ok: false, error: { code } };
}

export function loginErrorMessage(code: LoginErrorCode) {
  return LOGIN_ERROR_MESSAGES[code];
}

export function isSafeLoginRedirect(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

export function isSignInResult(value: unknown): value is SignInResult {
  if (!value || typeof value !== "object" || !("ok" in value)) {
    return false;
  }

  if (value.ok === true) {
    return "redirectTo" in value && isSafeLoginRedirect(value.redirectTo);
  }

  if (value.ok !== false || !("error" in value) || !value.error || typeof value.error !== "object") {
    return false;
  }

  return "code" in value.error && typeof value.error.code === "string" && LOGIN_ERROR_CODE_SET.has(value.error.code);
}

export function loginErrorCodeForAuthError(error: unknown): LoginErrorCode {
  if (!error || typeof error !== "object") {
    return "invalid_credentials";
  }

  const status = "status" in error && typeof error.status === "number" ? error.status : null;
  const code = "code" in error && typeof error.code === "string" ? error.code.toLowerCase() : "";

  if (status === 429 || code.includes("rate_limit") || code.includes("over_request")) {
    return "rate_limited";
  }

  if (status !== null && status >= 500) {
    return "service_unavailable";
  }

  return "invalid_credentials";
}
