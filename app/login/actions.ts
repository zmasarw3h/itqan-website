"use server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  hasExplicitCountryCode,
  normalizedPhoneToAuthEmail,
  phoneDigits,
  phoneNumberToAuthEmail
} from "@/lib/phone-auth";
import type { Profile } from "@/lib/types";

type SignInResult = {
  error?: string;
  redirectTo?: string;
};

async function resolveAuthEmail(phone: string) {
  if (hasExplicitCountryCode(phone)) {
    return phoneNumberToAuthEmail(phone);
  }

  const digits = phoneDigits(phone);

  if (digits.length < 7) {
    throw new Error("Enter a valid phone number.");
  }

  const defaultAuthEmail = phoneNumberToAuthEmail(phone);
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

  if (!profiles || profiles.length === 0) {
    return defaultAuthEmail;
  }

  if (profiles.length > 1) {
    throw new Error("Multiple accounts match that phone number. Include + and country code.");
  }

  const profile = profiles[0];
  return profile.phone ? normalizedPhoneToAuthEmail(profile.phone) : profile.email;
}

export async function signInWithPhone(phone: string, password: string): Promise<SignInResult> {
  let authEmail: string;

  try {
    authEmail = await resolveAuthEmail(phone);
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

  return { redirectTo: profile.role === "admin" ? "/admin" : "/student/check-in" };
}
