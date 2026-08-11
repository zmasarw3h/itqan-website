"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { applyOfficialScoringStart } from "./actions";

export function ReviewImpactButton() {
  const { pending } = useFormStatus();
  return (
    <button className="min-h-11 w-full rounded-md bg-moss px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss disabled:cursor-wait disabled:opacity-70 sm:w-auto" disabled={pending}>
      {pending ? "Reviewing…" : "Review impact"}
    </button>
  );
}

export function ConfirmScoringButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="min-h-11 w-full rounded-md bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:bg-moss focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-600 sm:w-auto" disabled={!ready || pending}>
      {pending ? "Saving change…" : "Confirm scoring change"}
    </button>
  );
}

export function OfficialScoringConfirmationForm({
  studentId,
  studentName,
  requestId,
  scoreStartsOn,
  expectedScoreStartsOn,
  returnTo,
  returnWeek,
  returnView,
  cancelHref
}: {
  studentId: string;
  studentName: string;
  requestId: string;
  scoreStartsOn: string;
  expectedScoreStartsOn: string;
  returnTo: string;
  returnWeek: string;
  returnView: string;
  cancelHref: string;
}) {
  const [reason, setReason] = useState("");
  const [confirmationName, setConfirmationName] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const trimmedReasonLength = reason.trim().length;
  const reasonReady = trimmedReasonLength >= 5 && trimmedReasonLength <= 500;
  const nameReady = confirmationName === studentName;
  const ready = reasonReady && nameReady;
  const helpId = "official-scoring-confirmation-help";

  return (
    <form action={applyOfficialScoringStart} className="mt-5 grid gap-3 border-t border-amber-200 pt-5" data-official-scoring-confirmation>
      <input name="student_id" type="hidden" value={studentId} />
      <input name="request_id" type="hidden" value={requestId} />
      <input name="score_starts_on" type="hidden" value={scoreStartsOn} />
      <input name="expected_score_starts_on" type="hidden" value={expectedScoreStartsOn} />
      {returnTo ? <input name="return_to" type="hidden" value={returnTo} /> : null}
      <input name="return_week" type="hidden" value={returnWeek} />
      <input name="return_view" type="hidden" value={returnView} />
      <p className="text-sm leading-6 text-stone-700" id={helpId}>
        Enter a 5–500 character reason, then type the student name exactly. The change remains server-validated and audited.
      </p>
      <label>
        <span className="text-sm font-medium text-ink">Reason for change</span>
        <textarea
          aria-describedby={helpId}
          className="mt-1 min-h-24 w-full rounded-md border border-stone-300 px-3 py-2"
          maxLength={500}
          minLength={5}
          name="reason"
          onBlur={() => setAnnouncement(reasonReady ? "Reason is ready." : "Reason must contain 5 to 500 non-whitespace characters.")}
          onChange={(event) => setReason(event.target.value)}
          required
          value={reason}
        />
      </label>
      <label>
        <span className="text-sm font-medium text-ink">Type {studentName} to confirm</span>
        <input
          aria-describedby={helpId}
          autoComplete="off"
          className="mt-1 min-h-11 w-full rounded-md border border-stone-300 px-3 py-2"
          name="confirmation_name"
          onBlur={() => setAnnouncement(nameReady ? "Confirmation name matches." : "Confirmation name must match exactly.")}
          onChange={(event) => setConfirmationName(event.target.value)}
          required
          value={confirmationName}
        />
      </label>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <ConfirmScoringButton ready={ready} />
        <Link className="inline-flex min-h-11 items-center justify-center rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-stone-50" href={cancelHref} prefetch={false}>Cancel</Link>
      </div>
    </form>
  );
}
