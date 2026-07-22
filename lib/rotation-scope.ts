import type { AdminCreateUserScopeOptions } from "@/lib/admin-user-scope";
import type { CohortKind } from "@/lib/types";

export type RotationContext = {
  masjid: {
    id: string;
    name: string;
    slug: string;
  };
  cohort: {
    id: string;
    name: string;
    kind: CohortKind;
    masjid_id: string;
  };
};

export type RotationContextSelection = {
  masjidId?: string;
  cohortId?: string;
};

export type RotationContextResolution = {
  context: RotationContext | null;
  usedDefault: boolean;
  error: "no-contexts" | "invalid-selection" | null;
};

export function buildRotationContexts(options: AdminCreateUserScopeOptions): RotationContext[] {
  const masjidById = new Map(options.masjids.map((masjid) => [masjid.id, masjid]));

  return options.cohorts.flatMap((cohort) => {
    const masjid = masjidById.get(cohort.masjid_id);

    if (!masjid) {
      return [];
    }

    return [
      {
        masjid: {
          id: masjid.id,
          name: masjid.name,
          slug: masjid.slug
        },
        cohort: {
          id: cohort.id,
          name: cohort.name,
          kind: cohort.kind,
          masjid_id: cohort.masjid_id
        }
      }
    ];
  });
}

export function resolveRotationContext(
  contexts: readonly RotationContext[],
  selection: RotationContextSelection
): RotationContextResolution {
  if (contexts.length === 0) {
    return { context: null, usedDefault: false, error: "no-contexts" };
  }

  const hasMasjidSelection = Boolean(selection.masjidId);
  const hasCohortSelection = Boolean(selection.cohortId);

  if (!hasMasjidSelection && !hasCohortSelection) {
    return { context: contexts[0], usedDefault: true, error: null };
  }

  if (!hasMasjidSelection || !hasCohortSelection) {
    return { context: null, usedDefault: false, error: "invalid-selection" };
  }

  const context = contexts.find(
    (candidate) =>
      candidate.masjid.id === selection.masjidId && candidate.cohort.id === selection.cohortId
  );

  return context
    ? { context, usedDefault: false, error: null }
    : { context: null, usedDefault: false, error: "invalid-selection" };
}

export function rotationPath(input: {
  masjidId: string;
  cohortId: string;
  weekStart: string;
  status?: string;
}) {
  const params = new URLSearchParams({
    masjid: input.masjidId,
    cohort: input.cohortId,
    week: input.weekStart
  });

  if (input.status) {
    params.set("status", input.status);
  }

  return `/admin/rotation?${params.toString()}`;
}
