export type TransactionalWorkflowError = {
  code?: string | null;
  message?: string | null;
};

export type TransactionalWorkflowErrorKind =
  | "stale"
  | "denied"
  | "conflict"
  | "invalid"
  | "unknown";

export type WorkflowCallResult<T> = {
  data: T | null;
  error: TransactionalWorkflowError | null;
};

export type ScopedUserSetupResult = {
  profile_id: string;
  membership_id: string;
  role: "student" | "teacher";
  masjid_id: string;
  group_id: string | null;
};

export type ScopedUserSetupInput = {
  requestId: string;
  actorId: string;
  name: string;
  email: string;
  phone: string;
  role: "student" | "teacher";
  startsOn: string;
  masjidId: string;
  groupId: string | null;
};

export type ScopedUserSetupOutcome =
  | {
      ok: true;
      profileId: string;
      result: ScopedUserSetupResult | null;
      recoveredAfterError: boolean;
    }
  | {
      ok: false;
      stage: "auth";
      error: TransactionalWorkflowError;
    }
  | {
      ok: false;
      stage: "database";
      profileId: string;
      error: TransactionalWorkflowError;
      errorKind: TransactionalWorkflowErrorKind;
      cleanup: "succeeded" | "failed";
      cleanupError: TransactionalWorkflowError | null;
    };

export type PersonAccessState = Record<string, unknown>;

export type SuperAdminAccessChangeInput = {
  requestId: string;
  actorId: string;
  targetProfileId: string;
  preset: "student" | "teacher" | "admin" | "admin_teacher" | "inactive";
  startsOn: string;
  selectedMasjidId: string | null;
  selectedGroupId: string | null;
  submittedExpectedState?: PersonAccessState | null;
};

export type SuperAdminAccessChangeResult = {
  profile_id: string;
  preset: SuperAdminAccessChangeInput["preset"];
  role: "student" | "teacher" | "admin" | "super_admin";
  active: boolean;
  access_state: PersonAccessState;
};

export type SuperAdminAccessChangeOutcome =
  | {
      ok: true;
      currentState: PersonAccessState;
      expectedState: PersonAccessState;
      result: SuperAdminAccessChangeResult;
    }
  | {
      ok: false;
      stage: "state" | "database";
      error: TransactionalWorkflowError;
      errorKind: TransactionalWorkflowErrorKind;
    };

export function scopedUserSetupRpcArguments(profileId: string, input: ScopedUserSetupInput) {
  return {
    input_request_id: input.requestId,
    input_actor_id: input.actorId,
    input_profile_id: profileId,
    input_name: input.name,
    input_email: input.email,
    input_phone: input.phone,
    input_role: input.role,
    input_starts_on: input.startsOn,
    input_masjid_id: input.masjidId,
    input_group_id: input.groupId
  };
}

export function superAdminAccessChangeRpcArguments(
  input: SuperAdminAccessChangeInput,
  expectedState: PersonAccessState
) {
  return {
    input_request_id: input.requestId,
    input_actor_id: input.actorId,
    input_target_profile_id: input.targetProfileId,
    input_preset: input.preset,
    input_starts_on: input.startsOn,
    input_selected_masjid_id: input.selectedMasjidId,
    input_selected_group_id: input.selectedGroupId,
    input_expected_state: expectedState
  };
}

export function parsePersonAccessState(value: string | null | undefined): PersonAccessState | null {
  if (!value || value.length > 200_000) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const state = parsed as {
      profile?: unknown;
      student_memberships?: unknown;
      staff_memberships?: unknown;
    };

    if (
      !state.profile ||
      typeof state.profile !== "object" ||
      Array.isArray(state.profile) ||
      !Array.isArray(state.student_memberships) ||
      !Array.isArray(state.staff_memberships)
    ) {
      return null;
    }

    return parsed as PersonAccessState;
  } catch {
    return null;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

export function classifyTransactionalWorkflowError(
  error: TransactionalWorkflowError | null | undefined
): TransactionalWorkflowErrorKind {
  if (!error) {
    return "unknown";
  }

  if (error.code === "P0001" && /access state changed/i.test(error.message ?? "")) {
    return "stale";
  }

  if (error.code === "42501") {
    return "denied";
  }

  if (["23503", "23505", "23514", "23P01"].includes(error.code ?? "")) {
    return "conflict";
  }

  if (error.code === "22023") {
    return "invalid";
  }

  return "unknown";
}

function workflowErrorFromUnknown(error: unknown): TransactionalWorkflowError {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown };
    return {
      code: typeof candidate.code === "string" ? candidate.code : null,
      message: typeof candidate.message === "string" ? candidate.message : "Workflow call failed."
    };
  }

  return { message: "Workflow call failed." };
}

export async function createScopedUserTransactionally(
  input: ScopedUserSetupInput,
  dependencies: {
    createAuthUser: () => Promise<WorkflowCallResult<{ id: string }>>;
    applyScopedUserSetup: (
      profileId: string,
      input: ScopedUserSetupInput
    ) => Promise<WorkflowCallResult<ScopedUserSetupResult>>;
    isScopedUserSetupCommitted?: (profileId: string) => Promise<WorkflowCallResult<boolean>>;
    deleteAuthUser: (profileId: string) => Promise<{ error: TransactionalWorkflowError | null }>;
  }
): Promise<ScopedUserSetupOutcome> {
  let authResult: WorkflowCallResult<{ id: string }>;

  try {
    authResult = await dependencies.createAuthUser();
  } catch (error) {
    authResult = { data: null, error: workflowErrorFromUnknown(error) };
  }

  if (authResult.error || !authResult.data) {
    return {
      ok: false,
      stage: "auth",
      error: authResult.error ?? { message: "Auth user was not returned." }
    };
  }

  const profileId = authResult.data.id;
  let setupResult: WorkflowCallResult<ScopedUserSetupResult>;

  try {
    setupResult = await dependencies.applyScopedUserSetup(profileId, input);
  } catch (error) {
    setupResult = { data: null, error: workflowErrorFromUnknown(error) };
  }

  if (!setupResult.error && setupResult.data) {
    return {
      ok: true,
      profileId,
      result: setupResult.data,
      recoveredAfterError: false
    };
  }

  const setupError = setupResult.error ?? { message: "Database setup result was not returned." };

  if (dependencies.isScopedUserSetupCommitted) {
    let verificationResult: WorkflowCallResult<boolean>;

    try {
      verificationResult = await dependencies.isScopedUserSetupCommitted(profileId);
    } catch (error) {
      verificationResult = { data: null, error: workflowErrorFromUnknown(error) };
    }

    if (!verificationResult.error && verificationResult.data === true) {
      return {
        ok: true,
        profileId,
        result: null,
        recoveredAfterError: true
      };
    }

    if (verificationResult.error || verificationResult.data === null) {
      return {
        ok: false,
        stage: "database",
        profileId,
        error: setupError,
        errorKind: classifyTransactionalWorkflowError(setupError),
        cleanup: "failed",
        cleanupError: verificationResult.error ?? { message: "Setup commit status could not be verified." }
      };
    }
  }

  let cleanupResult: { error: TransactionalWorkflowError | null };

  try {
    cleanupResult = await dependencies.deleteAuthUser(profileId);
  } catch (error) {
    cleanupResult = { error: workflowErrorFromUnknown(error) };
  }

  return {
    ok: false,
    stage: "database",
    profileId,
    error: setupError,
    errorKind: classifyTransactionalWorkflowError(setupError),
    cleanup: cleanupResult.error ? "failed" : "succeeded",
    cleanupError: cleanupResult.error
  };
}

export async function applySuperAdminAccessChangeTransactionally(
  input: SuperAdminAccessChangeInput,
  dependencies: {
    getPersonAccessState: (
      actorId: string,
      targetProfileId: string
    ) => Promise<WorkflowCallResult<PersonAccessState>>;
    applyAccessChange: (
      input: SuperAdminAccessChangeInput,
      expectedState: PersonAccessState
    ) => Promise<WorkflowCallResult<SuperAdminAccessChangeResult>>;
  }
): Promise<SuperAdminAccessChangeOutcome> {
  let stateResult: WorkflowCallResult<PersonAccessState>;

  try {
    stateResult = await dependencies.getPersonAccessState(input.actorId, input.targetProfileId);
  } catch (error) {
    stateResult = { data: null, error: workflowErrorFromUnknown(error) };
  }

  if (stateResult.error || !stateResult.data) {
    const error = stateResult.error ?? { message: "Access state was not returned." };

    return {
      ok: false,
      stage: "state",
      error,
      errorKind: classifyTransactionalWorkflowError(error)
    };
  }

  const submittedExpectedState = input.submittedExpectedState ?? null;
  const expectedState = submittedExpectedState && canonicalJson(submittedExpectedState) !== canonicalJson(stateResult.data)
    ? submittedExpectedState
    : stateResult.data;
  let changeResult: WorkflowCallResult<SuperAdminAccessChangeResult>;

  try {
    changeResult = await dependencies.applyAccessChange(input, expectedState);
  } catch (error) {
    changeResult = { data: null, error: workflowErrorFromUnknown(error) };
  }

  if (changeResult.error || !changeResult.data) {
    const error = changeResult.error ?? { message: "Access change result was not returned." };

    return {
      ok: false,
      stage: "database",
      error,
      errorKind: classifyTransactionalWorkflowError(error)
    };
  }

  return {
    ok: true,
    currentState: stateResult.data,
    expectedState,
    result: changeResult.data
  };
}

export function scopedUserSetupStatusForOutcome(outcome: Exclude<ScopedUserSetupOutcome, { ok: true }>) {
  if (outcome.stage === "auth") {
    return "exists";
  }

  if (outcome.cleanup === "failed") {
    return "setup-cleanup-error";
  }

  if (outcome.errorKind === "conflict") {
    return "exists";
  }

  if (outcome.errorKind === "denied" || outcome.errorKind === "invalid") {
    return "invalid-scope";
  }

  return "setup-error";
}

export function superAdminAccessStatusForError(error: TransactionalWorkflowError) {
  const kind = classifyTransactionalWorkflowError(error);

  if (kind === "stale") {
    return "access-stale";
  }

  if (kind === "denied" || (error.code === "23514" && /must retain|must remain/i.test(error.message ?? ""))) {
    return "guard-denied";
  }

  if (kind === "invalid" || kind === "conflict") {
    return "scope-invalid";
  }

  return "save-error";
}
