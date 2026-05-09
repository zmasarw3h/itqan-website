import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/config";
import type { Profile, Role } from "@/lib/types";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function createServerSupabaseClient() {
  const { url, anonKey } = getSupabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server components cannot always write cookies. Middleware refreshes sessions.
        }
      }
    }
  });
}

export async function getCurrentProfile() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, profile: null };
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id,name,email,role,active,created_at")
    .eq("id", user.id)
    .eq("active", true)
    .single<Profile>();

  if (error || !profile) {
    return { supabase, user, profile: null };
  }

  return { supabase, user, profile };
}

export async function requireProfile(allowedRoles?: Role[]) {
  const result = await getCurrentProfile();

  if (!result.user || !result.profile) {
    redirect("/login");
  }

  if (allowedRoles && !allowedRoles.includes(result.profile.role)) {
    redirect(result.profile.role === "admin" ? "/admin" : "/student/check-in");
  }

  return {
    supabase: result.supabase,
    user: result.user,
    profile: result.profile
  };
}
