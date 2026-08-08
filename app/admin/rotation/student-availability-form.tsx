"use client";

import { CheckCircle, MagnifyingGlass, ShieldCheck } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveStudentAvailability } from "@/app/admin/rotation/actions";
import type { RotationStudentRow } from "@/app/admin/rotation/data";
import {
  absenceCount,
  absencePayloadFromDrafts,
  type StudentRotationAvailabilityDraft
} from "@/lib/student-rotation-availability";
import { formatDateTimeInAppTimeZone } from "@/lib/dates";

type StudentAvailabilityFormProps = {
  cohortId: string;
  masjidId: string;
  saturdayLabel: string;
  students: RotationStudentRow[];
  weekStart: string;
  continueHref: string;
  initialConfirmed: boolean;
};

function initialDrafts(students: RotationStudentRow[]) {
  return students.map((student) => ({
    studentId: student.id,
    available: student.available,
    reason: student.availability_reason ?? ""
  }));
}

function sameDrafts(left: StudentRotationAvailabilityDraft[], right: StudentRotationAvailabilityDraft[]) {
  return left.length === right.length && left.every((draft, index) => {
    const other = right[index];
    return other?.studentId === draft.studentId
      && other.available === draft.available
      && other.reason === draft.reason;
  });
}

export default function StudentAvailabilityForm({
  cohortId,
  masjidId,
  saturdayLabel,
  students,
  weekStart,
  continueHref,
  initialConfirmed
}: StudentAvailabilityFormProps) {
  const router = useRouter();
  const initial = useMemo(() => initialDrafts(students), [students]);
  const [drafts, setDrafts] = useState(() => initialDrafts(students));
  const [query, setQuery] = useState("");
  const [showAbsencesOnly, setShowAbsencesOnly] = useState(false);
  const draftsByStudentId = useMemo(
    () => new Map(drafts.map((draft) => [draft.studentId, draft])),
    [drafts]
  );
  const filteredStudents = students.filter((student) => {
    const draft = draftsByStudentId.get(student.id);
    const matchesSearch = student.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return matchesSearch && (!showAbsencesOnly || draft?.available === false);
  });
  const absentCount = absenceCount(drafts);
  const isDirty = !sameDrafts(initial, drafts);

  function updateStudent(studentId: string, update: Partial<StudentRotationAvailabilityDraft>) {
    setDrafts((current) => current.map((draft) => (
      draft.studentId === studentId ? { ...draft, ...update } : draft
    )));
  }

  function markAllAttending() {
    setDrafts((current) => current.map((draft) => ({ ...draft, available: true, reason: "" })));
  }

  return (
    <form action={saveStudentAvailability} className="mt-5">
      <input name="masjid_id" type="hidden" value={masjidId} />
      <input name="cohort_id" type="hidden" value={cohortId} />
      <input name="week_start" type="hidden" value={weekStart} />
      <input name="step" type="hidden" value="students" />
      <input name="absences" type="hidden" value={JSON.stringify(absencePayloadFromDrafts(drafts))} />

      <div className="border border-green-100 bg-green-50/60 px-3 py-3 text-sm text-moss sm:flex sm:items-center sm:justify-between sm:gap-4">
        <p className="flex items-start gap-2">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" weight="regular" />
          <span>
            Attendance applies only to {saturdayLabel}. Permanent group membership and history stay unchanged.
          </span>
        </p>
        <p className="mt-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-green-800 sm:mt-0">
          Students attend by default
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative block min-w-0 lg:w-80">
          <span className="sr-only">Search students</span>
          <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-500" />
          <input
            className="min-h-11 w-full rounded-md border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-stone-400"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search students…"
            type="search"
            value={query}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-stone-700">
            <input
              checked={showAbsencesOnly}
              className="size-4 rounded border-stone-300 text-moss"
              onChange={(event) => setShowAbsencesOnly(event.target.checked)}
              type="checkbox"
            />
            Show absences only
          </label>
          <button
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-moss hover:bg-green-50"
            onClick={markAllAttending}
            type="button"
          >
            Mark all attending
          </button>
        </div>
      </div>

      <div className="mt-4 border-y border-stone-200">
        <table className="hidden w-full divide-y divide-stone-200 text-sm md:table">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-600">
            <tr>
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3">Usual group</th>
              <th className="px-4 py-3">This Saturday</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {filteredStudents.map((student) => {
              const draft = draftsByStudentId.get(student.id)!;
              const inputId = `availability-${student.id}`;

              return (
                <tr className={draft.available ? "bg-white" : "bg-red-50/60"} key={student.id}>
                  <td className="px-4 py-3 font-medium text-ink">{student.name}</td>
                  <td className="px-4 py-3 text-stone-600">{student.group_name}</td>
                  <td className="px-4 py-3">
                    <fieldset className="flex items-center gap-4">
                      <legend className="sr-only">Availability for {student.name}</legend>
                      <label className="inline-flex cursor-pointer items-center gap-2 text-stone-700">
                        <input
                          checked={draft.available}
                          className="size-4 border-stone-300 text-moss"
                          name={inputId}
                          onChange={() => updateStudent(student.id, { available: true, reason: "" })}
                          type="radio"
                        />
                        Attending
                      </label>
                      <label className="inline-flex cursor-pointer items-center gap-2 text-stone-700">
                        <input
                          checked={!draft.available}
                          className="size-4 border-stone-300 text-red-700"
                          name={inputId}
                          onChange={() => updateStudent(student.id, { available: false })}
                          type="radio"
                        />
                        Absent
                      </label>
                    </fieldset>
                  </td>
                  <td className="px-4 py-3">
                    {draft.available ? (
                      <span className="text-stone-400">—</span>
                    ) : (
                      <label className="block">
                        <span className="sr-only">Absence reason for {student.name}</span>
                        <input
                          className="w-full min-w-48 rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-ink placeholder:text-stone-400"
                          maxLength={240}
                          onChange={(event) => updateStudent(student.id, { reason: event.target.value })}
                          placeholder="Optional reason"
                          value={draft.reason}
                        />
                      </label>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-500">
                    {student.availability_updated_at
                      ? formatDateTimeInAppTimeZone(student.availability_updated_at)
                      : "—"}
                  </td>
                </tr>
              );
            })}
            {filteredStudents.length === 0 ? (
              <tr>
                <td className="px-4 py-5 text-stone-600" colSpan={5}>
                  No students match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="divide-y divide-stone-200 md:hidden">
          {filteredStudents.map((student) => {
            const draft = draftsByStudentId.get(student.id)!;
            const inputId = `mobile-availability-${student.id}`;
            return <div className={`py-3 ${draft.available ? "bg-white" : "bg-red-50/60"}`} key={student.id}>
              <div className="flex items-start justify-between gap-3 px-1">
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{student.name}</p><p className="mt-0.5 truncate text-xs text-stone-500">Usual group: {student.group_name}</p></div>
                <fieldset className="grid shrink-0 grid-cols-2 overflow-hidden rounded-md border border-stone-300">
                  <legend className="sr-only">Availability for {student.name}</legend>
                  <label className={`grid min-h-11 cursor-pointer place-items-center px-3 text-xs font-medium ${draft.available ? "bg-moss text-white" : "bg-white text-ink"}`}><input checked={draft.available} className="sr-only" name={inputId} onChange={() => updateStudent(student.id, { available: true, reason: "" })} type="radio" />Attending</label>
                  <label className={`grid min-h-11 cursor-pointer place-items-center px-3 text-xs font-medium ${!draft.available ? "bg-red-700 text-white" : "bg-white text-ink"}`}><input checked={!draft.available} className="sr-only" name={inputId} onChange={() => updateStudent(student.id, { available: false })} type="radio" />Absent</label>
                </fieldset>
              </div>
              {!draft.available ? <label className="mt-2 block px-1"><span className="sr-only">Absence reason for {student.name}</span><input className="min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" maxLength={240} onChange={(event) => updateStudent(student.id, { reason: event.target.value })} placeholder="Optional absence reason" value={draft.reason} /></label> : null}
            </div>;
          })}
          {filteredStudents.length === 0 ? <p className="py-5 text-sm text-stone-600">No students match these filters.</p> : null}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-stone-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p aria-live="polite" className={`flex items-center gap-2 text-sm ${isDirty || !initialConfirmed ? "text-amber-800" : "text-moss"}`} role="status">
          <CheckCircle aria-hidden="true" className="size-5" weight="regular" />
          {isDirty
            ? "Unsaved availability changes"
            : initialConfirmed
              ? "Student availability confirmed on the server"
              : "Confirm attendance before continuing"}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <p className={`text-sm font-medium ${absentCount > 0 ? "text-red-700" : "text-stone-500"}`}>
            {absentCount} {absentCount === 1 ? "absence" : "absences"}
          </p>
          <button
            className="min-h-11 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-ink hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDirty ? "Save availability" : initialConfirmed ? "Re-confirm availability" : "Confirm availability"}
          </button>
          <button
            className="min-h-11 rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink disabled:opacity-50"
            disabled={isDirty || !initialConfirmed}
            onClick={() => router.push(continueHref)}
            type="button"
          >
            Continue to teacher availability
          </button>
        </div>
      </div>
    </form>
  );
}
