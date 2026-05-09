"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/config";

export function createBrowserSupabaseClient() {
  const { url, anonKey } = getSupabasePublicConfig();
  return createBrowserClient(url, anonKey);
}
