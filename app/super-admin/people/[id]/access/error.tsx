"use client";

export default function PersonAccessError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <section className="rounded-xl border border-red-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Unable to load Guided Change</h1>
        <p className="mt-2 text-sm text-stone-600">
          The current access snapshot could not be loaded safely. No change was made.
        </p>
        <button
          className="mt-5 rounded-lg bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink"
          onClick={reset}
          type="button"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
