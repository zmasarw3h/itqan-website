"use client";

import { useMemo, useState } from "react";
import { correctCheckIn } from "@/app/admin/actions";
import { tasksForDate } from "@/lib/scoring";

export type CorrectionFormCheckIn = {
  date: string;
  status: "submitted" | "missing";
  note: string;
  completedTaskKeys: string[];
};

function completedKeysForDate(date: string, existing: CorrectionFormCheckIn | undefined) {
  if (!date) {
    return [];
  }

  const taskKeysForDate = new Set(tasksForDate(date).map((task) => task.key));

  return (existing?.completedTaskKeys ?? []).filter((taskKey) => taskKeysForDate.has(taskKey));
}

export default function CorrectionForm({
  studentId,
  initialDate,
  redirectWeek,
  existingCheckIns
}: {
  studentId: string;
  initialDate: string;
  redirectWeek: string;
  existingCheckIns: CorrectionFormCheckIn[];
}) {
  const initialExisting = existingCheckIns.find((checkin) => checkin.date === initialDate);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [status, setStatus] = useState<"submitted" | "missing">(initialExisting?.status ?? "submitted");
  const [note, setNote] = useState(initialExisting?.note ?? "");
  const [completedTaskKeys, setCompletedTaskKeys] = useState<string[]>(
    completedKeysForDate(initialDate, initialExisting)
  );
  const existingByDate = useMemo(
    () => new Map(existingCheckIns.map((checkin) => [checkin.date, checkin])),
    [existingCheckIns]
  );
  const tasks = selectedDate ? tasksForDate(selectedDate) : [];

  function syncToDate(date: string) {
    const existing = existingByDate.get(date);

    setStatus(existing?.status ?? "submitted");
    setNote(existing?.note ?? "");
    setCompletedTaskKeys(completedKeysForDate(date, existing));
  }

  function handleDateChange(date: string) {
    setSelectedDate(date);
    syncToDate(date);
  }

  function toggleTask(taskKey: string, checked: boolean) {
    setCompletedTaskKeys((current) =>
      checked ? [...new Set([...current, taskKey])] : current.filter((currentTaskKey) => currentTaskKey !== taskKey)
    );
  }

  return (
    <form action={correctCheckIn} className="mt-4 grid gap-4 md:grid-cols-4">
      <input name="student_id" type="hidden" value={studentId} />
      <input name="redirect_week" type="hidden" value={redirectWeek} />
      <label className="block">
        <span className="text-sm font-medium text-ink">Date</span>
        <input
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
          name="date"
          onChange={(event) => handleDateChange(event.target.value)}
          onInput={(event) => handleDateChange(event.currentTarget.value)}
          required
          type="date"
          value={selectedDate}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink">Status</span>
        <select
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
          name="status"
          onChange={(event) => setStatus(event.target.value as "submitted" | "missing")}
          value={status}
        >
          <option value="submitted">Submitted</option>
          <option value="missing">Missing</option>
        </select>
      </label>
      <label className="block md:col-span-2">
        <span className="text-sm font-medium text-ink">Note</span>
        <input
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
          name="note"
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional correction note"
          value={note}
        />
      </label>
      <fieldset className="space-y-3 md:col-span-4">
        <legend className="text-sm font-medium text-ink">Completed tasks for selected date</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {tasks.map((task) => (
            <label
              className="flex items-start justify-between gap-4 rounded-md border border-stone-200 p-3"
              key={task.key}
            >
              <span className="flex items-start gap-3">
                <input
                  checked={completedTaskKeys.includes(task.key)}
                  className="mt-1 h-4 w-4"
                  name="task_keys"
                  onChange={(event) => toggleTask(task.key, event.target.checked)}
                  type="checkbox"
                  value={task.key}
                />
                <span className="text-sm text-ink">{task.label}</span>
              </span>
              <span className="shrink-0 text-sm text-stone-600">{task.weight}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="md:col-span-4">
        <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">
          Save correction
        </button>
      </div>
    </form>
  );
}
