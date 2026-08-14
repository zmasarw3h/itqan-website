"use client";

import { WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect } from "react";
import StudentProgressNav from "@/app/student/progress-nav";

export default function StudentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("A student route failed to load.", { digest: error.digest ?? null });
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10" id="main-content">
      <StudentProgressNav />
      <section className="mx-auto flex min-h-[26rem] max-w-lg flex-col items-center justify-center text-center" role="alert">
        <WarningCircle aria-hidden className="text-red-600" size={50} />
        <h1 className="mt-5 text-2xl font-semibold text-ink">We couldn&apos;t load this page</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          Your account is still signed in. Try loading this page again.
        </p>
        <button className="mt-6 min-h-11 w-full max-w-xs rounded-md bg-action px-5 py-3 text-sm font-semibold text-white hover:bg-ink" onClick={reset}>
          Try again
        </button>
        <Link className="mt-3 inline-flex min-h-11 items-center px-4 text-sm font-medium text-moss underline-offset-4 hover:underline" href="/student/check-in">
          Go to Today
        </Link>
      </section>
    </main>
  );
}
