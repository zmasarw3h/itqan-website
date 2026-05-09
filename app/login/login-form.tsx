"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import type { Profile } from "@/lib/types";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const supabase = createBrowserSupabaseClient();
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      const user = signInData.user;

      if (!user) {
        await supabase.auth.signOut();
        setError("Unable to confirm the signed-in user.");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id,name,email,phone,role,active")
        .eq("id", user.id)
        .single<Profile>();

      if (profileError && profileError.code !== "PGRST116") {
        await supabase.auth.signOut();
        setError("Unable to load your profile. Please try again.");
        return;
      }

      if (!profile || !profile.active) {
        await supabase.auth.signOut();
        setError("This account is not active.");
        return;
      }

      window.location.href = profile.role === "admin" ? "/admin" : "/student/check-in";
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Unable to sign in.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block">
        <span className="text-sm font-medium text-ink">Email</span>
        <input
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-moss focus:ring-2 focus:ring-moss/20"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink">Password</span>
        <input
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-moss focus:ring-2 focus:ring-moss/20"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <button
        className="w-full rounded-md bg-moss px-4 py-2.5 font-medium text-white transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60"
        type="submit"
        disabled={isLoading}
      >
        {isLoading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
