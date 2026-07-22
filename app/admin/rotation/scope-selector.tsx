"use client";

import { useMemo, useState } from "react";
import type { RotationContext } from "@/lib/rotation-scope";

type RotationScopeSelectorProps = {
  contexts: RotationContext[];
  selectedMasjidId?: string;
  selectedCohortId?: string;
  selectedWeekStart: string;
};

function cohortKindLabel(kind: RotationContext["cohort"]["kind"]) {
  return kind === "sisters" ? "Sisters" : "Brothers";
}

export default function RotationScopeSelector({
  contexts,
  selectedMasjidId,
  selectedCohortId,
  selectedWeekStart
}: RotationScopeSelectorProps) {
  const masjids = useMemo(
    () => [
      ...new Map(contexts.map((context) => [context.masjid.id, context.masjid])).values()
    ],
    [contexts]
  );
  const initialMasjidId = masjids.some((masjid) => masjid.id === selectedMasjidId)
    ? selectedMasjidId ?? ""
    : masjids[0]?.id ?? "";
  const [masjidId, setMasjidId] = useState(initialMasjidId);
  const cohorts = contexts.filter((context) => context.masjid.id === masjidId);
  const selectedCohortIsValid = cohorts.some(
    (context) => context.cohort.id === selectedCohortId
  );
  const [cohortId, setCohortId] = useState(
    selectedCohortIsValid ? selectedCohortId ?? "" : cohorts[0]?.cohort.id ?? ""
  );

  function selectMasjid(nextMasjidId: string) {
    setMasjidId(nextMasjidId);
    const firstCohort = contexts.find((context) => context.masjid.id === nextMasjidId);
    setCohortId(firstCohort?.cohort.id ?? "");
  }

  if (contexts.length === 0) {
    return null;
  }

  const hasMultipleMasjids = masjids.length > 1;

  return (
    <form
      className={`grid gap-3 sm:items-end ${
        hasMultipleMasjids
          ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          : "sm:grid-cols-[minmax(0,1fr)_auto]"
      }`}
    >
      {hasMultipleMasjids ? (
        <label className="block min-w-0">
          <span className="text-xs font-semibold uppercase text-stone-500">Masjid</span>
          <select
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2.5 text-sm"
            name="masjid"
            onChange={(event) => selectMasjid(event.target.value)}
            value={masjidId}
          >
            {masjids.map((masjid) => (
              <option key={masjid.id} value={masjid.id}>
                {masjid.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input name="masjid" type="hidden" value={masjidId} />
      )}
      <label className="block min-w-0">
        <span className="text-xs font-semibold uppercase text-stone-500">Cohort</span>
        <select
          className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2.5 text-sm"
          name="cohort"
          onChange={(event) => setCohortId(event.target.value)}
          value={cohortId}
        >
          {cohorts.map((context) => (
            <option key={context.cohort.id} value={context.cohort.id}>
              {context.cohort.name} ({cohortKindLabel(context.cohort.kind)})
            </option>
          ))}
        </select>
      </label>
      <input name="week" type="hidden" value={selectedWeekStart} />
      <button className="h-10 rounded-md bg-ink px-4 text-sm font-medium text-white hover:bg-moss">
        Apply
      </button>
    </form>
  );
}
