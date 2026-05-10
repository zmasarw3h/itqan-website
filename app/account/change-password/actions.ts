"use server";

import { validateNewPassword } from "@/lib/password";
import { requireProfile } from "@/lib/supabase-server";

export type ChangePasswordState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function changePassword(
  _previousState: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const newPassword = String(formData.get("new_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");
  const validation = validateNewPassword(newPassword, confirmPassword);

  if (!validation.ok) {
    return { status: "error", message: validation.error };
  }

  const { supabase } = await requireProfile();
  const { error } = await supabase.auth.updateUser({
    password: validation.password
  });

  if (error) {
    return { status: "error", message: error.message };
  }

  return { status: "success", message: "Password updated successfully." };
}
