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
  const [dirty, setDirty] = useState(false);
  const isSaved = Boolean(grade && gradeIsCurrent && !dirty);

  return (
    <form action={saveTeacherHalaqaGrade} className="grid gap-3 border-b border-stone-200 px-3 py-4 last:border-b-0 sm:px-4 sm:py-5 lg:grid-cols-[2.5fr_1.15fr_1.05fr_1.9fr_1.2fr_1.15fr_.75fr] lg:items-center lg:gap-5 lg:px-7 lg:py-3">
      <input name="student_id" type="hidden" value={studentId} />
      <input name="group_id" type="hidden" value={groupId} />
      <input name="version_id" type="hidden" value={versionId} />
      <input name="week_start" type="hidden" value={weekStart} />

      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-moss text-xs font-bold text-white sm:size-9 sm:text-sm">{placementOrder}</span>
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-ink">{studentName}</h3>
          <p className="mt-1 text-xs text-stone-600">{usualGroupName} → {sessionGroupName}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:contents">
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-semibold text-stone-500 lg:sr-only">Attendance</span>
          <select className="min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" name="attended" onChange={(event) => { setAttended(event.target.value === "true"); setDirty(true); }} value={String(attended)}>
            <option value="true">Present</option>
            <option value="false">Absent</option>
          </select>
        </label>

        <label className="block min-w-0">
          <span className="mb-1 block truncate text-xs font-semibold text-stone-500 lg:sr-only">Recitation / 50</span>
          <input
            className="min-h-11 w-full rounded-md border border-stone-300 px-3 disabled:bg-stone-100 disabled:text-stone-400"
            disabled={!attended}
            max={50}
            min={10}
            name="recitation_points"
            onChange={(event) => { setRecitationPoints(event.target.value); setDirty(true); }}
            placeholder="—"
            required={attended}
            type="number"
            value={attended ? recitationPoints : ""}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-stone-500 lg:sr-only">Teacher notes</span>
        <input className="min-h-11 w-full rounded-md border border-stone-300 px-3 text-sm disabled:bg-stone-100 disabled:text-stone-400" defaultValue={grade?.notes ?? ""} disabled={!attended} name="notes" onChange={() => setDirty(true)} placeholder={attended ? "Add a note (optional)" : "Not applicable"} />
      </label>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
        <ChecklistDrawer currentDate={currentDate} groupId={groupId} studentId={studentId} studentName={studentName} versionId={versionId} weekStart={weekStart} />
        {weeklyPlanAvailable ? (
          <a className="flex min-h-11 items-center justify-center rounded-md border border-stone-300 bg-white px-3 py-2 text-center text-sm font-medium text-ink hover:bg-stone-50" href={`/teacher/plans/${studentId}?week=${weekStart}&version=${encodeURIComponent(versionId)}`}>Weekly plan</a>
        ) : (
          <span className="flex min-h-11 items-center justify-center rounded-md bg-stone-100 px-3 py-2 text-center text-sm text-stone-500">No plan</span>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-2 lg:contents">
        <p aria-live="polite" className={`inline-flex min-h-11 items-center gap-2 px-1 text-sm lg:rounded-lg lg:px-3 ${isSaved ? "text-moss lg:bg-[#edf3ef]" : dirty ? "text-amber-800 lg:bg-amber-50" : "text-stone-600 lg:bg-stone-100"}`}>
          {isSaved ? <CheckCircle aria-hidden="true" className="size-5 shrink-0" /> : <MinusCircle aria-hidden="true" className="size-5 shrink-0" />}
          {isSaved ? "Saved" : dirty ? "Unsaved" : "Not graded"}
        </p>
        <GradeSubmitButton />
      </div>
    </form>
  );
}
