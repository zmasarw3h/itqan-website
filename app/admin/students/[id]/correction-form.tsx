"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { correctCheckIn } from "@/app/admin/actions";
import { validCompletedTaskKeysForCorrectionDate } from "@/lib/admin-student-workspace-sections";
import { friendlyDate } from "@/lib/dates";
import { tasksForDate } from "@/lib/scoring";

export type CorrectionFormCheckIn = {
  date: string;
  status: "submitted" | "missing";
  note: string;
  completedTaskKeys: string[];
};

function completedKeysForDate(date: string, existing: CorrectionFormCheckIn | undefined) {
  if (!date) return [];
  return validCompletedTaskKeysForCorrectionDate(date, existing?.completedTaskKeys ?? []);
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="min-h-11 w-full rounded-md bg-moss px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink disabled:cursor-wait disabled:opacity-65 sm:w-auto"
      disabled={pending}
      type="submit"
    >
      {pending ? "Saving correction…" : "Save daily correction"}
    </button>
  );
}

export default function CorrectionForm({
  studentId,
  initialDate,
  availableDates,
  redirectWeek,
  redirectView,
  existingCheckIns,
  resultStatus
}: {
  studentId: string;
  initialDate: string;
  availableDates: string[];
  redirectWeek: string;
  redirectView: string;
  existingCheckIns: CorrectionFormCheckIn[];
  resultStatus?: string;
}) {
  const initialExisting = existingCheckIns.find((checkin) => checkin.date === initialDate);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [status, setStatus] = useState<"submitted" | "missing">(initialExisting?.status ?? "submitted");
  const [note, setNote] = useState(initialExisting?.note ?? "");
  const [completedTaskKeys, setCompletedTaskKeys] = useState<string[]>(completedKeysForDate(initialDate, initialExisting));
  const existingByDate = useMemo(() => new Map(existingCheckIns.map((checkin) => [checkin.date, checkin])), [existingCheckIns]);
  const tasks = selectedDate ? tasksForDate(selectedDate) : [];
  const draftKey = `itqan:v1:admin-daily-correction:${studentId}:${redirectWeek}`;

  useEffect(() => {
    if (resultStatus === "corrected") {
      sessionStorage.removeItem(draftKey);
      return;
    }
    if (!["correction-error", "correction-future-date", "correction-outside-week"].includes(resultStatus ?? "")) return;

    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey) ?? "null") as {
        selectedDate?: string;
        status?: "submitted" | "missing";
        note?: string;
        completedTaskKeys?: string[];
      } | null;
      if (!draft?.selectedDate || !availableDates.includes(draft.selectedDate)) return;
      const date = draft.selectedDate;
      const timeout = window.setTimeout(() => {
        setSelectedDate(date);
        setStatus(draft.status === "missing" ? "missing" : "submitted");
        setNote(typeof draft.note === "string" ? draft.note : "");
        setCompletedTaskKeys(validCompletedTaskKeysForCorrectionDate(
          date,
          Array.isArray(draft.completedTaskKeys) ? draft.completedTaskKeys : []
        ));
      }, 0);
      return () => window.clearTimeout(timeout);
    } catch {
      sessionStorage.removeItem(draftKey);
    }
  }, [availableDates, draftKey, resultStatus]);

  function handleDateChange(date: string) {
    const existing = existingByDate.get(date);
    setSelectedDate(date);
    setStatus(existing?.status ?? "submitted");
    setNote(existing?.note ?? "");
    setCompletedTaskKeys(completedKeysForDate(date, existing));
  }

  function toggleTask(taskKey: string, checked: boolean) {
    setCompletedTaskKeys((current) => checked
      ? [...new Set([...current, taskKey])]
      : current.filter((currentTaskKey) => currentTaskKey !== taskKey));
  }

  if (!availableDates.length) {
    return <p className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900" role="status">This selected week has not opened for corrections yet.</p>;
  }

  const completedCount = completedTaskKeys.length;

  return (
    <form
      action={correctCheckIn}
      className="mt-5"
      data-correction-form="daily"
      onSubmit={() => sessionStorage.setItem(draftKey, JSON.stringify({ selectedDate, status, note, completedTaskKeys }))}
    >
      <input name="student_id" type="hidden" value={studentId} />
      <input name="redirect_week" type="hidden" value={redirectWeek} />
      <input name="redirect_view" type="hidden" value={redirectView} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold text-ink">Date</span>
          <select
            className="mt-1.5 min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-ink"
            name="date"
            onChange={(event) => handleDateChange(event.target.value)}
            required
            value={selectedDate}
          >
            {availableDates.map((date) => <option key={date} value={date}>{friendlyDate(date)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-ink">Status</span>
          <select
            className="mt-1.5 min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-ink"
            name="status"
            onChange={(event) => setStatus(event.target.value as "submitted" | "missing")}
            value={status}
          >
            <option value="submitted">Saved</option>
            <option value="missing">Missing</option>
          </select>
        </label>
      </div>

      <label className="mt-4 block">
        <span className="text-sm font-semibold text-ink">Student note</span>
        <textarea
          className="mt-1.5 min-h-24 w-full resize-y rounded-md border border-stone-300 px-3 py-2 text-ink"
          name="note"
          onChange={(event) => setNote(event.target.value)}
          placeholder="No note"
          value={note}
        />
      </label>

      <fieldset className="mt-5" disabled={status === "missing"}>
        <legend className="font-semibold text-ink">Checklist tasks</legend>
        <p className="mt-1 text-sm text-stone-600">
          {status === "missing" ? "A missing day has no completed tasks." : `${completedCount} of ${tasks.length} tasks completed.`}
        </p>
        <div className="mt-3 divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white">
          {tasks.map((task) => {
            const checked = completedTaskKeys.includes(task.key);
            return (
              <label className="flex min-h-14 min-w-0 items-center gap-3 px-4 py-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-moss disabled:opacity-60" key={task.key}>
                <input
                  checked={checked}
                  className="size-5 shrink-0 accent-moss"
                  name="task_keys"
                  onChange={(event) => toggleTask(task.key, event.target.checked)}
                  type="checkbox"
                  value={task.key}
                />
                <span className="min-w-0 flex-1 break-words text-sm text-ink">{task.label}</span>
                <span className="shrink-0 text-sm font-medium text-stone-600">{checked ? task.weight : 0} / {task.weight}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SaveButton />
        <p className="text-sm text-stone-500">Saving creates an audited admin correction.</p>
      </div>
    </form>
  );
}
