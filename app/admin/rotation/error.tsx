"use client";

export default function RotationError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto max-w-3xl px-4 py-12"><section className="rounded-lg border border-red-200 bg-white p-6"><p className="text-xs font-semibold uppercase text-red-700">Rotation unavailable</p><h1 className="mt-1 text-2xl font-semibold text-ink">We couldn’t load this Saturday’s plan</h1><p className="mt-2 text-sm text-stone-600">The request may be retryable. No roster changes were made.</p><button className="mt-5 min-h-11 rounded-md bg-moss px-4 text-sm font-semibold text-white" onClick={reset} type="button">Try again</button></section></main>;
}
