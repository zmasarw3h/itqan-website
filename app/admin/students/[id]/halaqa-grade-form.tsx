"use client";

import { useState } from "react";
import { saveHalaqaGrade } from "@/app/admin/actions";
import { storedRecitationPointsToMark } from "@/lib/scoring";
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
  const [recitationMark, setRecitationMark] = useState(
    grade?.attended ? storedRecitationPointsToMark(grade.recitation_points) : 10
  );
  const storedRecitationPoints = attended ? recitationMark * 5 : 0;
  const total = attended ? 100 + storedRecitationPoints : 0;

  return (
    <form action={saveHalaqaGrade} className="mt-4 grid gap-4 md:grid-cols-4">
      <input name="student_id" type="hidden" value={studentId} />
      <input name="week_start" type="hidden" value={weekStart} />
      <input name="redirect_week" type="hidden" value={weekStart} />
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
        <span className="text-sm font-medium text-ink">Recitation mark (out of 10)</span>
        <input
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 disabled:bg-stone-100 disabled:text-stone-500"
          disabled={!attended}
          max={10}
          min={2}
          name="recitation_mark_out_of_10"
          onChange={(event) => setRecitationMark(Number(event.target.value))}
          required={attended}
          type="number"
          value={recitationMark}
        />
      </label>
      <div className="rounded-md bg-stone-50 px-4 py-3">
        <p className="text-sm text-stone-600">Recitation points: {storedRecitationPoints} / 50</p>
        <p className="text-xs font-medium uppercase text-stone-500">Halaqa grade</p>
        <p className="mt-1 text-2xl font-semibold text-ink">{total} / 150</p>
      </div>
      <label className="block md:col-span-4">
        <span className="text-sm font-medium text-ink">Feedback</span>
        <textarea
          className="mt-1 min-h-24 w-full rounded-md border border-stone-300 px-3 py-2"
          defaultValue={grade?.notes ?? ""}
          name="notes"
          placeholder="Optional student feedback"
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
