"use client";

import { useState } from "react";
import { signInWithPhone } from "@/app/login/actions";

export default function LoginForm() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const result = await signInWithPhone(phone, password);

      if (result.error) {
        setError(result.error);
        return;
      }

      window.location.href = result.redirectTo ?? "/student/check-in";
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Unable to sign in.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block">
        <span className="text-sm font-medium text-ink">Phone Number</span>
        <input
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 outline-none focus:border-moss focus:ring-2 focus:ring-moss/20"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="4165551234"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          required
        />
        <span className="mt-1 block text-xs text-stone-500">
          Enter the phone number on file. Country code is optional unless two accounts share the same local number.
        </span>
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
