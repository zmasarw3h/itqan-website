"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteStudent } from "@/app/admin/actions";

function DeleteSubmit({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="min-h-11 w-full rounded-md bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-600 sm:w-auto"
      disabled={!enabled || pending}
    >
      {pending ? "Deleting…" : "Permanently delete"}
    </button>
  );
}

export default function StudentDeleteForm({
  studentId,
  studentName,
  redirectWeek,
  redirectView
}: {
  studentId: string;
  studentName: string;
  redirectWeek: string;
  redirectView: string;
}) {
  const [confirmationName, setConfirmationName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const confirmationMatches = confirmationName.trim() === studentName;

  return (
    <div className="mt-5 sm:ml-[52px]">
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm leading-6 text-stone-600">
          Exact-name confirmation is required before the permanent delete action is enabled.
        </p>
        <button
          aria-expanded={confirming}
          className="min-h-11 w-full shrink-0 rounded-md border border-red-600 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 sm:w-auto"
          onClick={() => setConfirming(true)}
          type="button"
        >
          Delete student
        </button>
      </div>

      {confirming ? (
        <form action={deleteStudent} className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 sm:p-5">
          <input name="student_id" type="hidden" value={studentId} />
          <input name="redirect_week" type="hidden" value={redirectWeek} />
          <input name="redirect_view" type="hidden" value={redirectView} />
          <fieldset>
          <legend className="text-base font-semibold text-red-900">Confirm permanent deletion</legend>
          <p className="mt-2 text-sm leading-6 text-stone-700">
            Type <span className="font-semibold text-ink">{studentName}</span> to enable deletion.
          </p>
          <label className="mt-3 block">
            <span className="text-sm font-medium text-ink">Student name</span>
            <input
              autoComplete="off"
              className="mt-1 min-h-11 w-full rounded-md border border-red-300 bg-white px-3 py-2 focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-200"
              name="confirmation_name"
              onChange={(event) => setConfirmationName(event.target.value)}
              value={confirmationName}
            />
          </label>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <DeleteSubmit enabled={confirmationMatches} />
            <button
              className="min-h-11 w-full rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-ink hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss sm:w-auto"
              onClick={() => {
                setConfirming(false);
                setConfirmationName("");
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
          </fieldset>
        </form>
      ) : null}
    </div>
  );
}
