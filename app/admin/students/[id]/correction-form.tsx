"use client";

import { useState } from "react";
import { correctCheckIn } from "@/app/admin/actions";
import { tasksForDate } from "@/lib/scoring";

export default function CorrectionForm({ studentId, today }: { studentId: string; today: string }) {
  const [selectedDate, setSelectedDate] = useState(today);
  const tasks = tasksForDate(selectedDate);

  return (
    <form action={correctCheckIn} className="mt-4 grid gap-4 md:grid-cols-4">
      <input name="student_id" type="hidden" value={studentId} />
      <label className="block">
        <span className="text-sm font-medium text-ink">Date</span>
        <input
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
          name="date"
          onChange={(event) => setSelectedDate(event.target.value)}
          required
          type="date"
          value={selectedDate}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink">Status</span>
        <select className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" name="status">
          <option value="submitted">Submitted</option>
          <option value="missing">Missing</option>
        </select>
      </label>
      <label className="block md:col-span-2">
        <span className="text-sm font-medium text-ink">Note</span>
        <input
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
          name="note"
          placeholder="Optional correction note"
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
                <input className="mt-1 h-4 w-4" name="task_keys" type="checkbox" value={task.key} />
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
