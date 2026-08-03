"use client";

import { useRef, useState } from "react";
import {
  isSignInResult,
  loginErrorMessage,
  type SignInResult
} from "@/lib/login-contract";
import { formatLoginIdentifier } from "@/lib/phone-input";

async function readSignInResult(response: Response): Promise<SignInResult | null> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    const result: unknown = await response.json();
    return isSignInResult(result) ? result : null;
  } catch {
    return null;
  }
}

export default function LoginForm() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const submitInFlight = useRef(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitInFlight.current) {
      return;
    }

    submitInFlight.current = true;
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ identifier, password })
      });
      const result = await readSignInResult(response);

      if (response.status === 429) {
        setError(loginErrorMessage("rate_limited"));
        return;
      }

      if (!result) {
        setError(loginErrorMessage("service_unavailable"));
        return;
      }

      if (!response.ok || !result.ok) {
        setError(loginErrorMessage(result.ok ? "service_unavailable" : result.error.code));
        return;
      }

      window.location.href = result.redirectTo;
    } catch {
      setError(loginErrorMessage("service_unavailable"));
    } finally {
      submitInFlight.current = false;
      setIsLoading(false);
    }
  }

  return (
    <form aria-busy={isLoading} className="space-y-6 sm:space-y-7 lg:space-y-9" onSubmit={handleSubmit}>
      <div>
        <label className="block text-base font-medium text-ink" htmlFor="login-phone">
          Phone Number
        </label>
        <input
          aria-describedby="login-phone-help"
          className="mt-2 h-14 w-full rounded-lg border border-stone-300 bg-white px-4 text-lg text-ink outline-none transition placeholder:text-stone-400 focus:border-moss focus:ring-2 focus:ring-moss/20 sm:h-16 lg:h-[4.5rem]"
          id="login-phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="(416) 555-0100"
          value={identifier}
          onChange={(event) => setIdentifier(formatLoginIdentifier(event.target.value))}
          disabled={isLoading}
          required
        />
        <p className="mt-2 text-sm text-stone-600" id="login-phone-help">
          International numbers: start with +
        </p>
      </div>

      <div>
        <label className="block text-base font-medium text-ink" htmlFor="login-password">
          Password
        </label>
        <div className="relative mt-2">
          <input
            className="h-14 w-full rounded-lg border border-stone-300 bg-white px-4 pr-20 text-lg text-ink outline-none transition focus:border-moss focus:ring-2 focus:ring-moss/20 sm:h-16 lg:h-[4.5rem]"
            id="login-password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isLoading}
            required
          />
          <button
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 min-w-16 rounded-r-lg px-4 text-sm font-medium text-stone-600 transition hover:text-ink focus-visible:outline-offset-[-4px] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => setShowPassword((current) => !current)}
            disabled={isLoading}
            type="button"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {error ? (
        <p aria-live="polite" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      <button
        aria-busy={isLoading}
        className="h-14 w-full rounded-lg bg-[#294a39] px-4 text-base font-semibold text-white transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60 sm:h-16 lg:h-[4.5rem]"
        type="submit"
        disabled={isLoading}
      >
        {isLoading ? "Signing in..." : "Sign in"}
      </button>

      <p className="text-left text-sm text-stone-600">
        Having trouble signing in? Contact your administrator.
      </p>
    </form>
  );
}
