"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type RoleErrorFallbackProps = {
  error: Error & { digest?: string };
  reset: () => void;
  dashboardHref: string;
  dashboardLabel: string;
  workspaceLabel: string;
  tone?: "default" | "student" | "teacher" | "admin" | "super-admin";
};

const toneClasses = {
  default: "border-stone-200 bg-white",
  student: "border-moss/25 bg-white",
  teacher: "border-moss/30 bg-white",
  admin: "border-stone-200 bg-white",
  "super-admin": "border-gold/40 bg-white"
} as const;

export default function RoleErrorFallback({
  error,
  reset,
  dashboardHref,
  dashboardLabel,
  workspaceLabel,
  tone = "default"
}: RoleErrorFallbackProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const retryTimeout = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(retryTimeout.current);
  }, []);

  function retry() {
    if (isRetrying) return;

    setIsRetrying(true);
    retryTimeout.current = window.setTimeout(() => setIsRetrying(false), 1500);
    reset();
  }

  return (
    <main className="flex min-h-dvh w-full overflow-x-hidden px-4 py-8 sm:px-6 sm:py-12 lg:px-8" id="main-content">
      <section
        aria-describedby="role-error-description"
        aria-labelledby="role-error-title"
        aria-live={error ? "assertive" : "polite"}
        className={`m-auto w-full max-w-xl rounded-xl border p-6 shadow-sm sm:p-8 ${toneClasses[tone]}`}
        role="alert"
      >
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-gold">ITQAN</p>
        <p className="mt-4 text-sm font-semibold text-moss">{workspaceLabel}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl" id="role-error-title">
          This page could not be loaded
        </h1>
        <p className="mt-3 text-sm leading-6 text-stone-600 sm:text-base" id="role-error-description">
          Please try again. If the problem continues, return to your dashboard.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-moss px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-ink disabled:cursor-not-allowed disabled:bg-stone-500"
            disabled={isRetrying}
            onClick={retry}
            type="button"
          >
            {isRetrying ? "Trying again…" : "Try again"}
          </button>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-stone-50"
            href={dashboardHref}
          >
            {dashboardLabel}
          </Link>
        </div>
      </section>
    </main>
  );
}
