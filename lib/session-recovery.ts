export const SESSION_EXPIRED_STATUS = "session-expired";

type SupabaseAuthErrorLike = {
  code?: unknown;
  message?: unknown;
};

export function isSupabaseAuthCookieName(name: string) {
  return name.startsWith("sb-") && name.includes("-auth-token");
}

export function isStaleRefreshTokenError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const { code, message } = error as SupabaseAuthErrorLike;
  const normalizedCode = typeof code === "string" ? code.toLowerCase() : "";
  const normalizedMessage = typeof message === "string" ? message.toLowerCase() : "";

  return (
    normalizedCode === "refresh_token_not_found" ||
    normalizedCode === "refresh_token_already_used" ||
    normalizedMessage.includes("invalid refresh token") ||
    normalizedMessage.includes("refresh token is not valid") ||
    normalizedMessage.includes("refresh token not found") ||
    normalizedMessage.includes("refresh token already used")
  );
}
