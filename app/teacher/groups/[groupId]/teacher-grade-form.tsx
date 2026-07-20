"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { saveTeacherHalaqaGrade } from "@/app/teacher/actions";
import type { HalaqaGrade } from "@/lib/types";

function GradeSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="h-10 w-full rounded-md bg-moss px-4 text-sm font-medium text-white hover:bg-ink disabled:cursor-wait disabled:bg-stone-400 lg:w-auto"
      disabled={pending}
      type="submit"
    >
      {pending ? "Saving..." : "Save grade"}
    </button>
  );
}

export default function TeacherGradeForm({
  grade,
  groupId,
  studentId,
  weekStart
}: {
  grade: HalaqaGrade | null;
  groupId: string;
  studentId: string;
  weekStart: string;
}) {
  const [attended, setAttended] = useState(Boolean(grade?.attended));
  const [recitationPoints, setRecitationPoints] = useState(String(grade?.attended ? grade.recitation_points : 50));

  return (
    <form action={saveTeacherHalaqaGrade} className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[1.1fr_0.8fr_1.6fr_auto] lg:items-end">
      <input name="student_id" type="hidden" value={studentId} />
      <input name="group_id" type="hidden" value={groupId} />
      <input name="week_start" type="hidden" value={weekStart} />
      <fieldset>
        <legend className="text-sm font-medium text-ink">Attended halaqa?</legend>
        <div className="mt-2 flex gap-3">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input checked={attended} name="attended" onChange={() => setAttended(true)} type="radio" value="true" />
            Yes
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input checked={!attended} name="attended" onChange={() => setAttended(false)} type="radio" value="false" />
            No
          </label>
        </div>
      </fieldset>
      <label className="block">
        <span className="text-sm font-medium text-ink">Recitation points</span>
        <input
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 disabled:bg-stone-100 disabled:text-stone-500"
          disabled={!attended}
          max={50}
          min={10}
          name="recitation_points"
          onChange={(event) => setRecitationPoints(event.target.value)}
          required={attended}
          type="number"
          value={recitationPoints}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink">Notes</span>
        <input
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
          defaultValue={grade?.notes ?? ""}
          name="notes"
          placeholder="Optional feedback"
        />
      </label>
      <GradeSubmitButton />
    </form>
  );
}
