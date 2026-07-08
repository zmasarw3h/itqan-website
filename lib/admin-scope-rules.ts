export type AdminScopeErrorCode = "missing-scope" | "invalid-scope" | "scope-denied" | "scope-mismatch";

export class AdminScopeError extends Error {
  code: AdminScopeErrorCode;

  constructor(code: AdminScopeErrorCode, message: string) {
    super(message);
    this.name = "AdminScopeError";
    this.code = code;
  }
}

export type ScopeWindow = {
  starts_on: string;
  ends_on: string | null;
};

export type StudentScopeSelection = {
  masjidId: string | null;
  cohortId: string | null;
  groupId: string | null;
};

export type ResolvedStudentGroupScope = {
  masjidId: string;
  cohortId: string;
  groupId: string;
};

export function isScopeWindowEffectiveOn(window: ScopeWindow, effectiveDate: string) {
  return window.starts_on <= effectiveDate && (!window.ends_on || window.ends_on >= effectiveDate);
}

export function assertSelectedStudentScopeMatchesResolved(
  selected: StudentScopeSelection,
  resolved: ResolvedStudentGroupScope
) {
  if (!selected.masjidId || !selected.cohortId || !selected.groupId) {
    throw new AdminScopeError("missing-scope", "Choose a masjid, cohort, and group.");
  }

  if (
    selected.masjidId !== resolved.masjidId ||
    selected.cohortId !== resolved.cohortId ||
    selected.groupId !== resolved.groupId
  ) {
    throw new AdminScopeError("scope-mismatch", "The selected group does not belong to the selected cohort and masjid.");
  }
}

export function adminScopeStatusForError(error: unknown) {
  if (!(error instanceof AdminScopeError)) {
    return "assignment-error";
  }

  if (error.code === "missing-scope") {
    return "missing-scope";
  }

  return "invalid-scope";
}
