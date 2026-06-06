"use client";

import { useState } from "react";
import { deleteStudent } from "@/app/admin/actions";

export default function StudentDeleteForm({ studentId, studentName }: { studentId: string; studentName: string }) {
  const [confirmationName, setConfirmationName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const confirmationMatches = confirmationName.trim() === studentName;

  return (
    <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-red-900">Delete this student</h3>
          <p className="mt-1 text-sm text-red-800">
            This removes the student account and cascades their database records, including check-ins, grades,
            recitations, weekly plans, awards, and accountability obligations.
          </p>
        </div>
        <button
          className="rounded-md bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-900"
          onClick={() => setConfirming(true)}
          type="button"
        >
          Delete student
        </button>
      </div>

      {confirming ? (
        <form action={deleteStudent} className="mt-4 rounded-md border-2 border-red-600 bg-white p-4">
          <input name="student_id" type="hidden" value={studentId} />
          <p className="text-sm font-semibold text-red-900">Confirm permanent deletion</p>
          <p className="mt-1 text-sm text-stone-700">
            Type <span className="font-semibold text-ink">{studentName}</span> to enable deletion.
          </p>
          <label className="mt-3 block">
            <span className="text-sm font-medium text-ink">Student name</span>
            <input
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-red-300 px-3 py-2"
              name="confirmation_name"
              onChange={(event) => setConfirmationName(event.target.value)}
              value={confirmationName}
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="rounded-md bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-900 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-600"
              disabled={!confirmationMatches}
            >
              Permanently delete
            </button>
            <button
              className="rounded-md border border-stone-300 px-4 py-2.5 text-sm font-medium text-ink hover:bg-stone-50"
              onClick={() => {
                setConfirming(false);
                setConfirmationName("");
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
