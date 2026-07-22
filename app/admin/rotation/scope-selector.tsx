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

  return (
    <form className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="text-sm font-medium text-ink">Masjid</span>
        <select
          className="mt-1 min-w-48 rounded-md border border-stone-300 bg-white px-3 py-2"
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
      <label className="block">
        <span className="text-sm font-medium text-ink">Cohort</span>
        <select
          className="mt-1 min-w-44 rounded-md border border-stone-300 bg-white px-3 py-2"
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
      <label className="block">
        <span className="text-sm font-medium text-ink">Target week</span>
        <input
          className="mt-1 rounded-md border border-stone-300 px-3 py-2"
          defaultValue={selectedWeekStart}
          name="week"
          required
          type="date"
        />
      </label>
      <button className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white">
        View
      </button>
    </form>
  );
}
