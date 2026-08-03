import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { defaultPathForRole } from "@/lib/access";
import {
  LoginIdentifierError,
  resolveLoginIdentifierToAuthEmail
} from "@/lib/login-identifier";
import {
  loginErrorCodeForAuthError,
  loginFailure,
  type LoginErrorCode,
  type SignInResult
} from "@/lib/login-contract";
import type { Profile } from "@/lib/types";

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
      throw new LoginIdentifierError("service_unavailable");
    }

    return profiles ?? [];
  });
}

async function signOutAndFail(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  code: LoginErrorCode
) {
  try {
    await supabase.auth.signOut();
  } catch {
    // The original failure remains the actionable result. Route guards still reject inactive profiles.
  }

  return loginFailure(code);
}

export async function authenticateWithPhone(
  identifier: string,
  password: string
): Promise<SignInResult> {
  let authEmail: string;

  try {
    authEmail = await resolveAuthEmail(identifier);
  } catch (error) {
    return loginFailure(error instanceof LoginIdentifierError ? error.code : "service_unavailable");
  }

  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;

  try {
    supabase = await createServerSupabaseClient();
  } catch {
    return loginFailure("service_unavailable");
  }

  let signInData: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["data"];
  let signInError: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["error"];

  try {
    const result = await supabase.auth.signInWithPassword({
      email: authEmail,
      password
    });
    signInData = result.data;
    signInError = result.error;
  } catch {
    return loginFailure("service_unavailable");
  }

  if (signInError) {
    return loginFailure(loginErrorCodeForAuthError(signInError));
  }

  const user = signInData.user;

  if (!user) {
    return signOutAndFail(supabase, "service_unavailable");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,name,email,phone,role,active")
    .eq("id", user.id)
    .single<Profile>();

  if (profileError && profileError.code !== "PGRST116") {
    return signOutAndFail(supabase, "service_unavailable");
  }

  if (!profile || !profile.active) {
    return signOutAndFail(supabase, "inactive_account");
  }

  return { ok: true, redirectTo: defaultPathForRole(profile.role) };
}
