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
import { createLoginTiming, measureLoginPhase, type LoginTimingFields } from "@/lib/login-timing";
import type { Profile } from "@/lib/types";

async function resolveAuthEmail(identifier: string) {
  return resolveLoginIdentifierToAuthEmail(identifier, async (digits) => {
    const adminSupabase = createSupabaseAdminClient();
    const { data: profiles, error } = await adminSupabase
      .from("profiles")
      .select("id,email,phone,role,active")
      .like("phone", `%${digits}`)
      .eq("active", true)
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
  password: string,
  timings?: LoginTimingFields
): Promise<SignInResult> {
  const loginTiming = timings ?? createLoginTiming();
  let authEmail: string;

  try {
    authEmail = await measureLoginPhase(
      loginTiming,
      "identifierAccountResolutionMs",
      () => resolveAuthEmail(identifier)
    );
  } catch (error) {
    return loginFailure(error instanceof LoginIdentifierError ? error.code : "service_unavailable");
  }

  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;

  try {
    const passwordResult = await measureLoginPhase(
      loginTiming,
      "passwordAuthenticationMs",
      async () => {
        const client = await createServerSupabaseClient();
        const result = await client.auth.signInWithPassword({
          email: authEmail,
          password
        });

        return { client, result };
      }
    );
    supabase = passwordResult.client;

    const { data: signInData, error: signInError } = passwordResult.result;

    if (signInError) {
      return loginFailure(loginErrorCodeForAuthError(signInError));
    }

    const user = signInData.user;

    return await measureLoginPhase(
      loginTiming,
      "profileRoleResolutionMs",
      async () => {
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
    );
  } catch {
    return loginFailure("service_unavailable");
  }
}
