"use client";

import { useState } from "react";
import { saveHalaqaGrade } from "@/app/admin/actions";
import type { HalaqaGrade } from "@/lib/types";

export default function HalaqaGradeForm({
  studentId,
  weekStart,
  grade
}: {
  studentId: string;
  weekStart: string;
  grade: HalaqaGrade | null;
}) {
  const [attended, setAttended] = useState(Boolean(grade?.attended));
  const [recitationPoints, setRecitationPoints] = useState(grade?.recitation_points || 10);
  const total = attended ? 100 + recitationPoints : 0;

  return (
    <form action={saveHalaqaGrade} className="mt-4 grid gap-4 md:grid-cols-4">
      <input name="student_id" type="hidden" value={studentId} />
      <input name="week_start" type="hidden" value={weekStart} />
      <fieldset className="md:col-span-2">
        <legend className="text-sm font-medium text-ink">Attended Saturday halaqa?</legend>
        <div className="mt-2 flex gap-3">
          <label className="flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm">
            <input
              checked={attended}
              name="attended"
              onChange={() => setAttended(true)}
              type="radio"
              value="true"
            />
            Yes
          </label>
          <label className="flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm">
            <input
              checked={!attended}
              name="attended"
              onChange={() => setAttended(false)}
              type="radio"
              value="false"
            />
            No
          </label>
        </div>
      </fieldset>
      <label className="block">
        <span className="text-sm font-medium text-ink">Recitation grade</span>
        <input
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 disabled:bg-stone-100 disabled:text-stone-500"
          disabled={!attended}
          max={50}
          min={10}
          name="recitation_points"
          onChange={(event) => setRecitationPoints(Number(event.target.value))}
          required={attended}
          type="number"
          value={recitationPoints}
        />
      </label>
      <div className="rounded-md bg-stone-50 px-4 py-3">
        <p className="text-xs font-medium uppercase text-stone-500">Halaqa grade</p>
        <p className="mt-1 text-2xl font-semibold text-ink">{total} / 150</p>
      </div>
      <label className="block md:col-span-4">
        <span className="text-sm font-medium text-ink">Notes</span>
        <textarea
          className="mt-1 min-h-24 w-full rounded-md border border-stone-300 px-3 py-2"
          defaultValue={grade?.notes ?? ""}
          name="notes"
          placeholder="Optional admin note"
        />
      </label>
      <div className="md:col-span-4">
        <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">
          Save halaqa grade
        </button>
      </div>
    </form>
  );
}
