"use client";

import { useFormStatus } from "react-dom";

export function ReviewImpactButton() {
  const { pending } = useFormStatus();
  return (
    <button className="min-h-11 w-full rounded-md bg-moss px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss disabled:cursor-wait disabled:opacity-70 sm:w-auto" disabled={pending}>
      {pending ? "Reviewing…" : "Review impact"}
    </button>
  );
}

export function ConfirmScoringButton() {
  const { pending } = useFormStatus();
  return (
    <button className="min-h-11 w-full rounded-md bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:bg-moss focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-wait disabled:opacity-70 sm:w-auto" disabled={pending}>
      {pending ? "Saving change…" : "Confirm scoring change"}
    </button>
  );
}
