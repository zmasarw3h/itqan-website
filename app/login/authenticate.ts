import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { defaultPathForRole } from "@/lib/access";
import { resolveLoginIdentifierToAuthEmail } from "@/lib/login-identifier";
import type { Profile } from "@/lib/types";

export type SignInResult = {
  error?: string;
  redirectTo?: string;
};

async function resolveAuthEmail(identifier: string) {
  return resolveLoginIdentifierToAuthEmail(identifier, async (digits) => {
    const adminSupabase = createSupabaseAdminClient();
    const { data: profiles, error } = await adminSupabase
      .from("profiles")
      .select("id,email,phone,role,active")
      .eq("active", true)
      .like("phone", `%${digits}`)
      .returns<Pick<Profile, "id" | "email" | "phone" | "role" | "active">[]>();

    if (error) {
      throw new Error("Unable to look up that phone number.");
    }

    return profiles ?? [];
  });
}

export async function authenticateWithPhone(
  identifier: string,
  password: string
): Promise<SignInResult> {
  let authEmail: string;

  try {
    authEmail = await resolveAuthEmail(identifier);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Enter a valid phone number." };
  }

  const supabase = await createServerSupabaseClient();
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password
  });

  if (signInError) {
    return { error: signInError.message };
  }

  const user = signInData.user;

  if (!user) {
    await supabase.auth.signOut();
    return { error: "Unable to confirm the signed-in user." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,name,email,phone,role,active")
    .eq("id", user.id)
    .single<Profile>();

  if (profileError && profileError.code !== "PGRST116") {
    await supabase.auth.signOut();
    return { error: "Unable to load your profile. Please try again." };
  }

  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    return { error: "This account is not active." };
  }

  return { redirectTo: defaultPathForRole(profile.role) };
}
