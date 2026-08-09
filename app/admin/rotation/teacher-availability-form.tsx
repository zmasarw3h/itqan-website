"use client";

import { MagnifyingGlass } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveTeacherAvailability } from "@/app/admin/rotation/actions";
import { useRotationAvailability } from "@/app/admin/rotation/availability-state";
import { friendlyDate } from "@/lib/dates";
import type { SessionRosterWizardTeacher } from "@/lib/session-roster";

type TeacherAvailabilityFormProps = {
  cohortId: string;
  masjidId: string;
  teachers: SessionRosterWizardTeacher[];
  weekStart: string;
  initialConfirmed: boolean;
  backHref?: string;
  continueHref?: string;
};

export default function TeacherAvailabilityForm({
  cohortId,
  masjidId,
  teachers,
  weekStart,
  initialConfirmed,
  backHref,
  continueHref
}: TeacherAvailabilityFormProps) {
  const router = useRouter();
  const { availableTeacherIds, isDirty, setAvailableTeacherIds } = useRotationAvailability();
  const [query, setQuery] = useState("");
  const filteredTeachers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return teachers;
    return teachers.filter((teacher) => [
      teacher.teacher_name,
      teacher.last_published_group_name ?? "",
      teacher.last_published_week_start ?? "",
      teacher.last_published_halaqa_saturday ?? ""
    ].some((value) => value.toLocaleLowerCase().includes(needle)));
  }, [query, teachers]);

  function setTeacherAvailable(teacherId: string, available: boolean) {
    setAvailableTeacherIds((current) => {
      const next = new Set(current);
      if (available) next.add(teacherId);
      else next.delete(teacherId);
      return next;
    });
  }

  return (
    <form action={saveTeacherAvailability} className="mt-5">
      <input name="masjid_id" type="hidden" value={masjidId} />
      <input name="cohort_id" type="hidden" value={cohortId} />
      <input name="week_start" type="hidden" value={weekStart} />
      <input name="step" type="hidden" value="teachers" />
      {[...availableTeacherIds].map((teacherId) => (
        <input key={teacherId} name="available_teacher_id" type="hidden" value={teacherId} />
      ))}

      {teachers.length > 0 ? (
        <>
          <div className="flex flex-col gap-3 border-b border-stone-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block min-w-0 sm:w-80">
              <span className="sr-only">Search teachers</span>
              <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-500" />
              <input
                className="min-h-11 w-full rounded-md border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-stone-400"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search teachers…"
                type="search"
                value={query}
              />
            </label>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <p className="text-sm text-stone-600">
                <span className="font-semibold text-ink">{availableTeacherIds.size}</span> of {teachers.length} available
              </p>
              <div className="flex items-center gap-2">
                <button className="min-h-11 rounded-md border border-stone-300 bg-white px-3 text-xs font-medium text-ink hover:bg-stone-50" onClick={() => setAvailableTeacherIds(new Set(teachers.map((teacher) => teacher.teacher_id)))} type="button">Select all</button>
                <button className="min-h-11 rounded-md border border-stone-300 bg-white px-3 text-xs font-medium text-ink hover:bg-stone-50" onClick={() => setAvailableTeacherIds(new Set())} type="button">Clear all</button>
              </div>
            </div>
          </div>

          <div className="border-b border-stone-200">
            <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_18rem] gap-4 bg-stone-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-600 md:grid">
              <span>Teacher</span><span>Last assigned</span><span>This Saturday</span>
            </div>
            <div className="divide-y divide-stone-200">
              {filteredTeachers.map((teacher) => {
                const available = availableTeacherIds.has(teacher.teacher_id);
                return (
                  <div className="grid gap-2 px-1 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_18rem] md:items-center md:gap-4 md:px-3" key={teacher.teacher_id}>
                    <p className="min-w-0 truncate text-sm font-semibold text-ink">{teacher.teacher_name}</p>
                    <p className="text-xs text-stone-600 sm:text-sm">
                      {teacher.last_published_halaqa_saturday || teacher.last_published_week_start || teacher.last_published_group_name
                        ? <>
                            {teacher.last_published_halaqa_saturday ? <span className="font-medium text-ink">{friendlyDate(teacher.last_published_halaqa_saturday)}</span> : null}
                            <span className="block text-xs text-stone-500">
                              {[teacher.last_published_week_start ? `Week of ${friendlyDate(teacher.last_published_week_start)}` : null, teacher.last_published_group_name].filter(Boolean).join(" · ")}
                            </span>
                          </>
                        : <span className="text-stone-500">Never assigned</span>}
                    </p>
                    <fieldset className="grid grid-cols-2 overflow-hidden rounded-md border border-stone-300">
                      <legend className="sr-only">Availability for {teacher.teacher_name}</legend>
                      <label className={`grid min-h-11 cursor-pointer place-items-center px-3 text-sm font-medium focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-moss ${available ? "bg-moss text-white" : "bg-white text-ink"}`}>
                        <input checked={available} className="sr-only" name={`teacher-${teacher.teacher_id}`} onChange={() => setTeacherAvailable(teacher.teacher_id, true)} type="radio" />
                        Available
                      </label>
                      <label className={`grid min-h-11 cursor-pointer place-items-center border-l border-stone-300 px-3 text-sm font-medium focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-red-700 ${!available ? "bg-red-700 text-white" : "bg-white text-ink"}`}>
                        <input checked={!available} className="sr-only" name={`teacher-${teacher.teacher_id}`} onChange={() => setTeacherAvailable(teacher.teacher_id, false)} type="radio" />
                        Unavailable
                      </label>
                    </fieldset>
                  </div>
                );
              })}
              {filteredTeachers.length === 0 ? <p className="px-3 py-5 text-sm text-stone-600">No teachers match this search.</p> : null}
            </div>
          </div>

          <div className="mt-4 flex flex-col-reverse gap-3 border-t border-stone-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            {backHref ? <button className="min-h-11 rounded-md border border-stone-300 bg-white px-4 text-sm font-medium text-ink" onClick={() => router.push(backHref)} type="button">Back to students</button> : <span />}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <p aria-live="polite" className={`text-sm ${isDirty || !initialConfirmed ? "text-amber-800" : "text-moss"}`} role="status">
                {isDirty ? "Unsaved teacher changes" : initialConfirmed ? "Teacher availability confirmed on the server" : "Confirm availability before continuing"}
              </p>
              <button className="min-h-11 rounded-md border border-moss bg-white px-4 text-sm font-medium text-moss">{isDirty ? "Save availability" : initialConfirmed ? "Re-confirm availability" : "Confirm availability"}</button>
              {continueHref ? <button className="min-h-11 rounded-md bg-moss px-4 text-sm font-medium text-white disabled:opacity-50" disabled={isDirty || !initialConfirmed || availableTeacherIds.size === 0} onClick={() => router.push(continueHref)} type="button">Continue to session groups</button> : null}
            </div>
          </div>
        </>
      ) : (
        <p className="rounded-md bg-stone-50 px-3 py-3 text-sm text-stone-600">No active teachers found.</p>
      )}
    </form>
  );
}
