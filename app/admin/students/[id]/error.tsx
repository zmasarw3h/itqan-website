"use client";

import { useEffect } from "react";

export default function AdminStudentWorkspaceError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin student workspace failed to load.", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl items-center px-4 py-12">
      <section className="w-full rounded-xl border border-rose-200 bg-white p-6" aria-labelledby="workspace-error-title">
        <p className="text-sm font-semibold uppercase tracking-wide text-moss">ITQAN</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink" id="workspace-error-title">Unable to load this student workspace</h1>
        <p className="mt-2 text-stone-600">The stored student data could not be loaded. No correction was made. Try the request again.</p>
        <button className="mt-5 min-h-11 rounded-md bg-moss px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink" onClick={reset} type="button">Try again</button>
      </section>
    </main>
  );
}
