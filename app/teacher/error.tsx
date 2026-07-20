"use client";

export default function TeacherError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-ink">Teacher dashboard unavailable</h1>
      <p className="mt-2 text-stone-600">The assigned-group data could not be loaded.</p>
      <button className="mt-5 rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
