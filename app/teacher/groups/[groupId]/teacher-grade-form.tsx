"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle, MinusCircle } from "@phosphor-icons/react";
import { saveTeacherHalaqaGrade } from "@/app/teacher/actions";
import ChecklistDrawer from "@/app/teacher/groups/[groupId]/checklist-drawer";
import type { TeacherSessionGradeProjection } from "@/lib/teacher-session";

function GradeSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="min-h-11 w-full rounded-md bg-moss px-4 text-sm font-semibold text-white hover:bg-ink disabled:cursor-wait disabled:bg-stone-400" disabled={pending} type="submit">
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

export default function TeacherGradeForm({
  grade,
  gradeIsCurrent,
  groupId,
  studentId,
  studentName,
  usualGroupName,
  sessionGroupName,
  placementOrder,
  weeklyPlanAvailable,
  versionId,
  weekStart,
  currentDate
}: {
  grade: TeacherSessionGradeProjection | null;
  gradeIsCurrent: boolean;
  groupId: string;
  studentId: string;
  studentName: string;
  usualGroupName: string;
  sessionGroupName: string;
  placementOrder: number;
  weeklyPlanAvailable: boolean;
  versionId: string;
  weekStart: string;
  currentDate: string;
}) {
  const [attended, setAttended] = useState(grade ? grade.attended : true);
  const [recitationPoints, setRecitationPoints] = useState(String(grade?.attended ? grade.recitation_points : ""));

  return (
    <form action={saveTeacherHalaqaGrade} className="grid gap-4 border-b border-stone-200 px-4 py-5 last:border-b-0 lg:grid-cols-[2.5fr_1.15fr_1.05fr_1.9fr_1.2fr_1.15fr_.75fr] lg:items-center lg:gap-5 lg:px-7 lg:py-3">
      <input name="student_id" type="hidden" value={studentId} />
      <input name="group_id" type="hidden" value={groupId} />
      <input name="version_id" type="hidden" value={versionId} />
      <input name="week_start" type="hidden" value={weekStart} />

      <div className="flex min-w-0 items-center gap-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-moss text-sm font-bold text-white">{placementOrder}</span>
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-ink">{studentName}</h3>
          <p className="mt-1 text-xs text-stone-600">{usualGroupName} → {sessionGroupName}</p>
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-stone-500 lg:sr-only">Attendance</span>
        <select className="min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" name="attended" onChange={(event) => setAttended(event.target.value === "true")} value={String(attended)}>
          <option value="true">Present</option>
          <option value="false">Absent</option>
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-stone-500 lg:sr-only">Recitation / 50</span>
        <input
          className="min-h-11 w-full rounded-md border border-stone-300 px-3 disabled:bg-stone-100 disabled:text-stone-400"
          disabled={!attended}
          max={50}
          min={10}
          name="recitation_points"
          onChange={(event) => setRecitationPoints(event.target.value)}
          placeholder="—"
          required={attended}
          type="number"
          value={attended ? recitationPoints : ""}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-stone-500 lg:sr-only">Teacher notes</span>
        <input className="min-h-11 w-full rounded-md border border-stone-300 px-3 disabled:bg-stone-100 disabled:text-stone-400" defaultValue={grade?.notes ?? ""} disabled={!attended} name="notes" placeholder={attended ? "Add a note (optional)" : "Not applicable"} />
      </label>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
        <ChecklistDrawer currentDate={currentDate} groupId={groupId} studentId={studentId} studentName={studentName} versionId={versionId} weekStart={weekStart} />
        {weeklyPlanAvailable ? (
          <a className="flex min-h-11 items-center justify-center rounded-md border border-stone-300 bg-white px-3 py-2 text-center text-sm font-medium text-ink hover:bg-stone-50" href={`/teacher/plans/${studentId}?week=${weekStart}&version=${encodeURIComponent(versionId)}`}>Weekly plan</a>
        ) : (
          <span className="flex min-h-11 items-center justify-center rounded-md bg-stone-100 px-3 py-2 text-center text-sm text-stone-500">No plan</span>
        )}
      </div>

      <p className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm ${grade && gradeIsCurrent ? "bg-[#edf3ef] text-moss" : "bg-stone-100 text-stone-600"}`}>
        {grade && gradeIsCurrent ? <CheckCircle aria-hidden="true" className="size-5 shrink-0" /> : <MinusCircle aria-hidden="true" className="size-5 shrink-0" />}
        {grade && gradeIsCurrent ? "Saved" : "Not graded"}
      </p>
      <GradeSubmitButton />
    </form>
  );
}
