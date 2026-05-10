export type PasswordValidationResult =
  | { ok: true; password: string }
  | { ok: false; error: string };

export function validateNewPassword(newPassword: string, confirmPassword: string): PasswordValidationResult {
  if (newPassword.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  if (newPassword !== confirmPassword) {
    return { ok: false, error: "Passwords do not match." };
  }

  return { ok: true, password: newPassword };
}
