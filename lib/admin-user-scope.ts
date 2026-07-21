export type AdminUserMasjidScope = {
  id: string;
  name: string;
  slug: string;
  membership_starts_on: string | null;
};

export type AdminUserCohortScope = {
  id: string;
  masjid_id: string;
  kind: "brothers" | "sisters";
  name: string;
  sort_order: number;
};

export type AdminUserGroupScope = {
  id: string;
  cohort_id: string;
  name: string;
  sort_order: number;
};

export type AdminCreateUserScopeOptions = {
  masjids: AdminUserMasjidScope[];
  cohorts: AdminUserCohortScope[];
  groups: AdminUserGroupScope[];
};

export type StudentScopeSelection = {
  masjidId?: string;
  cohortId?: string;
  groupId?: string;
};

export type ResolvedStudentScope = {
  masjidId: string;
  cohortId: string;
  groupId: string;
  masjids: AdminUserMasjidScope[];
  cohorts: AdminUserCohortScope[];
  groups: AdminUserGroupScope[];
};

function selectedOrOnly<T extends { id: string }>(items: readonly T[], selectedId: string | undefined) {
  if (items.length === 1) {
    return items[0].id;
  }

  return selectedId && items.some((item) => item.id === selectedId) ? selectedId : "";
}

export function resolveStudentScope(
  options: AdminCreateUserScopeOptions,
  selection: StudentScopeSelection = {}
): ResolvedStudentScope {
  const masjidId = selectedOrOnly(options.masjids, selection.masjidId);
  const cohorts = masjidId
    ? options.cohorts.filter((cohort) => cohort.masjid_id === masjidId)
    : [];
  const cohortId = selectedOrOnly(cohorts, selection.cohortId);
  const groups = cohortId
    ? options.groups.filter((group) => group.cohort_id === cohortId)
    : [];
  const groupId = selectedOrOnly(groups, selection.groupId);

  return { masjidId, cohortId, groupId, masjids: options.masjids, cohorts, groups };
}

export function resolveTeacherMasjidId(
  options: AdminCreateUserScopeOptions,
  selectedMasjidId?: string
) {
  return selectedOrOnly(options.masjids, selectedMasjidId);
}
