"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Info } from "@phosphor-icons/react";
import { saveHalaqaGrade } from "@/app/admin/actions";
import { halaqaGradeDraftSummary } from "@/lib/admin-student-halaqa-plan";
import type { HalaqaGrade } from "@/lib/types";

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="min-h-11 w-full rounded-md bg-moss px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink disabled:cursor-wait disabled:opacity-65 sm:w-auto"
      disabled={pending}
      type="submit"
    >
      {pending ? "Saving halaqa grade…" : "Save halaqa grade"}
    </button>
  );
}

function ResultMessage({ status }: { status?: string }) {
  if (status === "grade-saved") {
    return <p className="text-sm font-medium text-emerald-800" role="status">Halaqa grade saved.</p>;
  }
  if (status === "grade-invalid") {
    return <p className="text-sm font-medium text-red-700" role="alert">Enter a whole-number recitation score from 10 to 50.</p>;
  }
  if (status === "grade-error") {
    return <p className="text-sm font-medium text-red-700" role="alert">Unable to save the halaqa grade. Your draft has been restored; try again.</p>;
  }
  return null;
}

export default function HalaqaGradeForm({
  studentId,
  weekStart,
  grade,
  redirectView,
  resultStatus,
  onSummaryChange
}: {
  studentId: string;
  weekStart: string;
  grade: HalaqaGrade | null;
  redirectView: string;
  resultStatus?: string;
  onSummaryChange?: (totalPoints: number) => void;
}) {
  const initialAttended = Boolean(grade?.attended);
  const initialRecitationPoints = grade?.attended ? String(grade.recitation_points) : "";
  const initialNotes = grade?.notes ?? "";
  const [attended, setAttended] = useState(initialAttended);
  const [recitationPoints, setRecitationPoints] = useState(initialRecitationPoints);
  const [notes, setNotes] = useState(initialNotes);
  const [resultDismissed, setResultDismissed] = useState(false);
  const summary = halaqaGradeDraftSummary(attended, recitationPoints);
  const visibleResultStatus = resultDismissed ? undefined : resultStatus;
  const draftKey = `itqan:v1:admin-halaqa-grade:${studentId}:${weekStart}`;
  const dirty = attended !== initialAttended
    || (attended && recitationPoints !== initialRecitationPoints)
    || notes !== initialNotes;

  useEffect(() => {
    if (resultStatus === "grade-saved") {
      sessionStorage.removeItem(draftKey);
      return;
    }
    if (!["grade-invalid", "grade-error"].includes(resultStatus ?? "")) return;

    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey) ?? "null") as {
        attended?: boolean;
        recitationPoints?: string;
        notes?: string;
      } | null;
      if (!draft) return;
      const timeout = window.setTimeout(() => {
        setAttended(Boolean(draft.attended));
        const restoredRecitationPoints = typeof draft.recitationPoints === "string" ? draft.recitationPoints : "";
        setRecitationPoints(restoredRecitationPoints);
        setNotes(typeof draft.notes === "string" ? draft.notes : "");
        onSummaryChange?.(halaqaGradeDraftSummary(Boolean(draft.attended), restoredRecitationPoints).totalPoints);
      }, 0);
      return () => window.clearTimeout(timeout);
    } catch {
      sessionStorage.removeItem(draftKey);
    }
  }, [draftKey, onSummaryChange, resultStatus]);

  return (
    <form
      action={saveHalaqaGrade}
      className="mt-5"
      data-halaqa-grade-form
      onSubmit={() => sessionStorage.setItem(draftKey, JSON.stringify({ attended, recitationPoints, notes }))}
    >
      <input name="student_id" type="hidden" value={studentId} />
      <input name="week_start" type="hidden" value={weekStart} />
      <input name="redirect_week" type="hidden" value={weekStart} />
      <input name="redirect_view" type="hidden" value={redirectView} />

      <fieldset>
        <legend className="text-sm font-semibold text-ink">Attended Saturday halaqa?</legend>
        <div className="mt-2 grid grid-cols-2 overflow-hidden rounded-md border border-stone-300">
          {[true, false].map((value) => (
            <label
              className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 border-r border-stone-300 px-3 text-sm last:border-r-0 has-[:focus-visible]:relative has-[:focus-visible]:z-10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-moss ${attended === value ? "bg-emerald-50 text-ink" : "bg-white text-stone-700"}`}
              key={String(value)}
            >
              <input
                checked={attended === value}
                className="size-5 accent-moss"
                name="attended"
                onChange={() => {
                  setResultDismissed(true);
                  setAttended(value);
                  onSummaryChange?.(halaqaGradeDraftSummary(value, recitationPoints).totalPoints);
                }}
                type="radio"
                value={String(value)}
              />
              {value ? "Yes" : "No"}
            </label>
          ))}
        </div>
      </fieldset>

      {attended ? (
        <label className="mt-4 block">
          <span className="text-sm font-semibold text-ink">Recitation points (10 to 50) <span aria-hidden="true" className="text-red-700">*</span></span>
          <input
            aria-describedby="recitation-points-help recitation-points-error"
            aria-invalid={!summary.valid}
            className="mt-1.5 min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-ink aria-[invalid=true]:border-red-500"
            inputMode="numeric"
            max={50}
            min={10}
            name="recitation_points"
            onChange={(event) => {
              const value = event.target.value.replace(/^0+(?=\d)/, "");
              setResultDismissed(true);
              setRecitationPoints(value);
              onSummaryChange?.(halaqaGradeDraftSummary(true, value).totalPoints);
            }}
            required
            step={1}
            type="number"
            value={recitationPoints}
          />
          <span className="mt-1.5 block text-sm text-stone-600" id="recitation-points-help">Enter the student&apos;s recitation mark for this halaqa.</span>
          {!summary.valid && recitationPoints ? <span className="mt-1 block text-sm text-red-700" id="recitation-points-error">Use a whole number from 10 to 50.</span> : <span id="recitation-points-error" />}
        </label>
      ) : (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <p>No attendance or recitation points will be awarded.</p>
        </div>
      )}

      <div className="mt-5 grid grid-cols-3 divide-x divide-stone-200 text-center" aria-live="polite">
        <div className="px-2">
          <p className="text-sm text-stone-600">Attendance</p>
          <p className="mt-1 text-lg font-semibold text-ink sm:text-xl">{summary.attendancePoints} / 100</p>
        </div>
        <div className="px-2">
          <p className="text-sm text-stone-600">Recitation</p>
          <p className="mt-1 text-lg font-semibold text-ink sm:text-xl">{summary.recitationPoints} / 50</p>
        </div>
        <div className="px-2">
          <p className="text-sm text-stone-600">Total</p>
          <p className="mt-1 text-lg font-semibold text-ink sm:text-xl">{summary.totalPoints} / 150</p>
        </div>
      </div>

      <label className="mt-5 block">
        <span className="text-sm font-semibold text-ink">Feedback</span>
        <textarea
          className="mt-1.5 min-h-24 w-full resize-y rounded-md border border-stone-300 px-3 py-2 text-ink"
          name="notes"
          onChange={(event) => {
            setResultDismissed(true);
            setNotes(event.target.value);
          }}
          placeholder="Optional student feedback"
          value={notes}
        />
      </label>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SaveButton />
        <div className="min-h-5 text-right">
          <ResultMessage status={visibleResultStatus} />
          {!visibleResultStatus && dirty ? <p className="text-sm text-stone-500" role="status">Unsaved changes</p> : null}
          {!visibleResultStatus && !dirty ? <p className="text-sm text-stone-500">{grade ? "Saved grade" : "Not saved yet"}</p> : null}
        </div>
      </div>
      {!attended ? <p className="mt-5 flex items-start gap-2 border-t border-stone-200 pt-4 text-sm text-stone-600"><Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Selecting Yes adds the required recitation-points field.</p> : null}
    </form>
  );
}
