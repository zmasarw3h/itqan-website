"use client";

import { saveTeacherAvailability } from "@/app/admin/rotation/actions";
import { useRotationAvailability } from "@/app/admin/rotation/availability-state";
import type { RotationTeacherRow } from "@/app/admin/rotation/data";
import { useRouter } from "next/navigation";

type TeacherAvailabilityFormProps = {
  cohortId: string;
  masjidId: string;
  teachers: RotationTeacherRow[];
  weekStart: string;
  backHref?: string;
  continueHref?: string;
};

export default function TeacherAvailabilityForm({
  cohortId,
  masjidId,
  teachers,
  weekStart,
  backHref,
  continueHref
}: TeacherAvailabilityFormProps) {
  const router = useRouter();
  const { availableTeacherIds, isDirty, setAvailableTeacherIds } = useRotationAvailability();

  function setTeacherAvailable(teacherId: string, available: boolean) {
    setAvailableTeacherIds((current) => {
      const next = new Set(current);

      if (available) {
        next.add(teacherId);
      } else {
        next.delete(teacherId);
      }

      return next;
    });
  }

  return (
    <form action={saveTeacherAvailability} className="mt-5">
      <input name="masjid_id" type="hidden" value={masjidId} />
      <input name="cohort_id" type="hidden" value={cohortId} />
      <input name="week_start" type="hidden" value={weekStart} />
      <input name="step" type="hidden" value="teachers" />

      {teachers.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3">
            <p className="text-sm text-stone-600">
              <span className="font-semibold text-ink">{availableTeacherIds.size}</span> of {teachers.length} available
            </p>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-stone-50"
                onClick={() => setAvailableTeacherIds(new Set(teachers.map((teacher) => teacher.id)))}
                type="button"
              >
                Select all
              </button>
              <button
                className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-stone-50"
                onClick={() => setAvailableTeacherIds(new Set())}
                type="button"
              >
                Clear all
              </button>
            </div>
          </div>

          <div className="divide-y divide-stone-200">
            {teachers.map((teacher) => (
              <label className="flex min-h-14 items-center justify-between gap-4 py-3" key={teacher.id}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{teacher.name}</span>
                  <span className="block truncate text-xs text-stone-500">{teacher.email}</span>
                </span>
                <input
                  checked={availableTeacherIds.has(teacher.id)}
                  className="h-5 w-5 shrink-0 rounded border-stone-300 text-moss"
                  name="available_teacher_id"
                  onChange={(event) => setTeacherAvailable(teacher.id, event.target.checked)}
                  type="checkbox"
                  value={teacher.id}
                />
              </label>
            ))}
          </div>

          {isDirty ? (
            <p className="mt-4 text-sm font-medium text-amber-800" role="status">
              Unsaved availability changes. Save to refresh the assignment preview.
            </p>
          ) : null}

          <div className="mt-4 flex flex-col-reverse gap-3 border-t border-stone-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            {backHref ? <button className="min-h-11 rounded-md border border-stone-300 bg-white px-4 text-sm font-medium text-ink" onClick={() => router.push(backHref)} type="button">Back to students</button> : <span />}
            <div className="flex flex-col gap-3 sm:flex-row">
              <button className="min-h-11 rounded-md border border-moss bg-white px-4 text-sm font-medium text-moss disabled:opacity-50" disabled={!isDirty}>Save availability</button>
              {continueHref ? <button className="min-h-11 rounded-md bg-moss px-4 text-sm font-medium text-white disabled:opacity-50" disabled={isDirty || availableTeacherIds.size === 0} onClick={() => router.push(continueHref)} type="button">Continue to session groups</button> : null}
            </div>
          </div>
        </>
      ) : (
        <p className="rounded-md bg-stone-50 px-3 py-3 text-sm text-stone-600">No active teachers found.</p>
      )}
    </form>
  );
}
