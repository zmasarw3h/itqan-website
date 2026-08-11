"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { correctPartnerRecitations } from "@/app/admin/actions";
import { PARTNER_RECITATION_ROUNDS } from "@/lib/partner-recitations";
import type { PartnerRecitation, PartnerRound } from "@/lib/types";
import { useCorrectionDisplayDate } from "./correction-date-context";

function roundLabel(round: PartnerRound) {
  return round === "round_1" ? "Round 1" : "Round 2";
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="min-h-11 w-full rounded-md bg-moss px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink disabled:cursor-wait disabled:opacity-65 sm:w-auto" disabled={pending} type="submit">
      {pending ? "Saving partner rounds…" : "Save partner correction"}
    </button>
  );
}

export default function PartnerCorrectionForm({
  studentId,
  weekStart,
  redirectView,
  recitations,
  resultStatus
}: {
  studentId: string;
  weekStart: string;
  redirectView: string;
  recitations: PartnerRecitation[];
  resultStatus?: string;
}) {
  const [completedRounds, setCompletedRounds] = useState<PartnerRound[]>(() => recitations.map((row) => row.round));
  const { selectedDate } = useCorrectionDisplayDate();
  const draftKey = `itqan:v1:admin-partner-correction:${studentId}:${weekStart}`;

  useEffect(() => {
    if (resultStatus === "partner-corrected") {
      sessionStorage.removeItem(draftKey);
      return;
    }
    if (!["partner-correction-invalid", "partner-correction-error"].includes(resultStatus ?? "")) return;

    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey) ?? "null") as unknown;
      if (!Array.isArray(draft)) return;
      const timeout = window.setTimeout(() => {
        setCompletedRounds(PARTNER_RECITATION_ROUNDS.filter((round) => draft.includes(round)));
      }, 0);
      return () => window.clearTimeout(timeout);
    } catch {
      sessionStorage.removeItem(draftKey);
    }
  }, [draftKey, resultStatus]);

  function toggleRound(round: PartnerRound, checked: boolean) {
    setCompletedRounds((current) => checked ? [...new Set([...current, round])] : current.filter((value) => value !== round));
  }

  return (
    <form
      action={correctPartnerRecitations}
      className="mt-5"
      data-correction-form="partner"
      onSubmit={() => sessionStorage.setItem(draftKey, JSON.stringify(completedRounds))}
    >
      <input name="student_id" type="hidden" value={studentId} />
      <input name="week_start" type="hidden" value={weekStart} />
      <input name="redirect_week" type="hidden" value={weekStart} />
      <input name="redirect_view" type="hidden" value={redirectView} />
      <input name="correction_date" type="hidden" value={selectedDate} />
      <fieldset>
        <legend className="sr-only">Partner recitation completion</legend>
        <div className="space-y-3">
          {PARTNER_RECITATION_ROUNDS.map((round) => {
            const checked = completedRounds.includes(round);
            return (
              <label className="flex min-h-[72px] min-w-0 items-center gap-3 rounded-lg border border-stone-200 bg-white p-4 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-moss" key={round}>
                <input checked={checked} className="size-5 shrink-0 accent-moss" name="completed_rounds" onChange={(event) => toggleRound(round, event.target.checked)} type="checkbox" value={round} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{roundLabel(round)}</span>
                  <span className="mt-0.5 block text-sm text-stone-600">{checked ? "Completed" : "Not completed"}</span>
                </span>
                <strong className="shrink-0 text-ink">{checked ? 75 : 0} / 75</strong>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SubmitButton />
        <p className="text-sm text-stone-500">Each completed round is always worth 75 points.</p>
      </div>
    </form>
  );
}
