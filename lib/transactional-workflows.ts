export type TransactionalWorkflowError = {
  code?: string | null;
  message?: string | null;
  status?: number | null;
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
  score_starts_on: string | null;
};

export type ScopedUserSetupInput = {
  requestId: string;
  actorId: string;
  name: string;
  email: string;
  phone: string;
  role: "student" | "teacher";
  startsOn: string;
  scoreStartsOn: string | null;
  masjidId: string;
  groupId: string | null;
};

export type ScopedUserSetupOutcome =
  | {
      ok: true;
      profileId: string;
      result: ScopedUserSetupResult | null;
      recoveredAfterError: boolean;
      replayedBeforeAuth: boolean;
    }
  | {
      ok: false;
      stage: "auth";
      error: TransactionalWorkflowError;
      authErrorKind: "exists" | "error" | "uncertain";
    }
  | {
      ok: false;
      stage: "lookup";
      error: TransactionalWorkflowError;
      errorKind: TransactionalWorkflowErrorKind;
      uncertain: boolean;
    }
  | {
      ok: false;
      stage: "database";
      profileId: string;
      error: TransactionalWorkflowError;
      errorKind: TransactionalWorkflowErrorKind;
      cleanup: "succeeded" | "failed" | "not-attempted";
      cleanupError: TransactionalWorkflowError | null;
      uncertain: boolean;
    };

export type MasjidUpdateState = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  updated_at: string;
};

export type MasjidUpdateInput = {
  requestId: string;
  actorId: string;
  masjidId: string;
  name: string;
  slug: string;
  active: boolean;
  expectedState: MasjidUpdateState;
};

export type MasjidUpdateResult = {
  masjid_id: string;
  masjid_state: MasjidUpdateState;
};

export type MasjidUpdateOutcome =
  | { ok: true; result: MasjidUpdateResult }
  | {
      ok: false;
      stage: "database";
      error: TransactionalWorkflowError;
      errorKind: TransactionalWorkflowErrorKind;
      uncertain: boolean;
    };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function preservedMasjidUpdateRequestId(status: string | undefined, requestId: string | undefined) {
  return status === "masjid-update-uncertain" && requestId && UUID_PATTERN.test(requestId)
    ? requestId
    : null;
}

export type MasjidStaffGrantInput = {
  requestId: string;
  actorId: string;
  targetProfileId: string;
  masjidId: string;
  grant: "admin" | "teacher" | "admin_teacher";
  startsOn: string;
  submittedExpectedState?: PersonAccessState | null;
};

export type MasjidStaffGrantResult = {
  profile_id: string;
  masjid_id: string;
  grant: MasjidStaffGrantInput["grant"];
  role: "student" | "teacher" | "admin" | "super_admin";
  access_state: PersonAccessState;
};

export type MasjidStaffGrantOutcome =
  | {
      ok: true;
      currentState: PersonAccessState;
      expectedState: PersonAccessState;
      result: MasjidStaffGrantResult;
    }
  | {
      ok: false;
      stage: "state" | "database";
      error: TransactionalWorkflowError;
      errorKind: TransactionalWorkflowErrorKind;
      uncertain: boolean;
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
      uncertain: boolean;
    };

export type StaffMembershipEndInput = {
  requestId: string;
  actorId: string;
  targetProfileId: string;
  membershipId: string;
  endsOn: string;
  submittedExpectedState?: PersonAccessState | null;
};

export type StaffMembershipEndResult = {
  profile_id: string;
  membership_id: string;
  ends_on: string;
  access_state: PersonAccessState;
};

export type StaffMembershipEndOutcome =
  | {
      ok: true;
      currentState: PersonAccessState;
      expectedState: PersonAccessState;
      result: StaffMembershipEndResult;
    }
  | {
      ok: false;
      stage: "state" | "database";
      error: TransactionalWorkflowError;
      errorKind: TransactionalWorkflowErrorKind;
      uncertain: boolean;
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
    input_score_starts_on: input.scoreStartsOn,
    input_masjid_id: input.masjidId,
    input_group_id: input.groupId
  };
}

export function scopedUserSetupLookupRpcArguments(input: ScopedUserSetupInput) {
  return {
    input_request_id: input.requestId,
    input_actor_id: input.actorId,
    input_name: input.name,
    input_email: input.email,
    input_phone: input.phone,
    input_role: input.role,
    input_starts_on: input.startsOn,
    input_score_starts_on: input.scoreStartsOn,
    input_masjid_id: input.masjidId,
    input_group_id: input.groupId
  };
}

export function scopedUserSetupAuthMetadata(input: ScopedUserSetupInput) {
  // The database wrapper persists scoreStartsOn atomically. Auth metadata
  // deliberately retains the original payload contract used by the inner
  // idempotent setup primitive.
  return {
    setup_request_id: input.requestId,
    setup_actor_id: input.actorId,
    setup_payload: {
      actor_id: input.actorId,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      role: input.role,
      starts_on: input.startsOn,
      masjid_id: input.masjidId,
      group_id: input.groupId
    }
  };
}

export function masjidStaffGrantRpcArguments(
  input: MasjidStaffGrantInput,
  expectedState: PersonAccessState
) {
  return {
    input_request_id: input.requestId,
    input_actor_id: input.actorId,
    input_target_profile_id: input.targetProfileId,
    input_masjid_id: input.masjidId,
    input_grant: input.grant,
    input_starts_on: input.startsOn,
    input_expected_state: expectedState
  };
}

export function masjidStaffGrantPreparationRpcArguments(input: MasjidStaffGrantInput) {
  return {
    input_request_id: input.requestId,
    input_actor_id: input.actorId,
    input_target_profile_id: input.targetProfileId,
    input_masjid_id: input.masjidId,
    input_grant: input.grant,
    input_starts_on: input.startsOn
  };
}

export function masjidUpdateRpcArguments(input: MasjidUpdateInput) {
  return {
    input_request_id: input.requestId,
    input_actor_id: input.actorId,
    input_masjid_id: input.masjidId,
    input_name: input.name,
    input_slug: input.slug,
    input_active: input.active,
    input_expected_state: input.expectedState
  };
}

export function masjidUpdateState(input: {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  updated_at: string | null;
}): MasjidUpdateState {
  if (!input.updated_at || !Number.isFinite(Date.parse(input.updated_at))) {
    throw new Error("Masjid updated_at is required for stale-state protection.");
  }

  return {
    id: input.id,
    name: input.name,
    slug: input.slug,
    active: input.active,
    updated_at: new Date(input.updated_at).toISOString()
  };
}

export function parseMasjidUpdateState(value: string | null | undefined): MasjidUpdateState | null {
  if (!value || value.length > 10_000) return null;

  try {
    const parsed = JSON.parse(value) as Partial<MasjidUpdateState>;

    if (
      typeof parsed.id !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.slug !== "string" ||
      typeof parsed.active !== "boolean" ||
      typeof parsed.updated_at !== "string" ||
      !Number.isFinite(Date.parse(parsed.updated_at))
    ) {
      return null;
    }

    return masjidUpdateState(parsed as MasjidUpdateState);
  } catch {
    return null;
  }
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

export function staffMembershipEndRpcArguments(
  input: StaffMembershipEndInput,
  expectedState: PersonAccessState
) {
  return {
    input_request_id: input.requestId,
    input_actor_id: input.actorId,
    input_target_profile_id: input.targetProfileId,
    input_membership_id: input.membershipId,
    input_ends_on: input.endsOn,
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

  if (error.code === "P0001" && /(access|masjid) state changed/i.test(error.message ?? "")) {
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
    const candidate = error as { code?: unknown; message?: unknown; status?: unknown };
    return {
      code: typeof candidate.code === "string" ? candidate.code : null,
      message: typeof candidate.message === "string" ? candidate.message : "Workflow call failed.",
      status: typeof candidate.status === "number" ? candidate.status : null
    };
  }

  return { message: "Workflow call failed." };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isScopedUserSetupResult(
  value: unknown,
  input: ScopedUserSetupInput,
  profileId?: string
): value is ScopedUserSetupResult {
  if (!isRecord(value)) return false;

  return (
    typeof value.profile_id === "string" &&
    (!profileId || value.profile_id === profileId) &&
    typeof value.membership_id === "string" &&
    value.role === input.role &&
    value.masjid_id === input.masjidId &&
    value.group_id === input.groupId
  );
}

function isSuperAdminAccessChangeResult(
  value: unknown,
  input: SuperAdminAccessChangeInput
): value is SuperAdminAccessChangeResult {
  if (!isRecord(value)) return false;

  return (
    value.profile_id === input.targetProfileId &&
    value.preset === input.preset &&
    ["student", "teacher", "admin", "super_admin"].includes(String(value.role)) &&
    typeof value.active === "boolean" &&
    isRecord(value.access_state)
  );
}

function isStaffMembershipEndResult(
  value: unknown,
  input: StaffMembershipEndInput
): value is StaffMembershipEndResult {
  if (!isRecord(value)) return false;

  return (
    value.profile_id === input.targetProfileId &&
    value.membership_id === input.membershipId &&
    value.ends_on === input.endsOn &&
    isRecord(value.access_state)
  );
}

function isMasjidStaffGrantResult(
  value: unknown,
  input: MasjidStaffGrantInput
): value is MasjidStaffGrantResult {
  if (!isRecord(value)) return false;

  return (
    value.profile_id === input.targetProfileId &&
    value.masjid_id === input.masjidId &&
    value.grant === input.grant &&
    ["student", "teacher", "admin", "super_admin"].includes(String(value.role)) &&
    isRecord(value.access_state)
  );
}

function isMasjidUpdateResult(value: unknown, input: MasjidUpdateInput): value is MasjidUpdateResult {
  if (!isRecord(value) || !isRecord(value.masjid_state)) return false;

  return (
    value.masjid_id === input.masjidId &&
    value.masjid_state.id === input.masjidId &&
    value.masjid_state.name === input.name.trim() &&
    value.masjid_state.slug === input.slug.trim().toLowerCase() &&
    value.masjid_state.active === input.active &&
    typeof value.masjid_state.updated_at === "string"
  );
}

export function classifyAuthUserCreationError(
  error: TransactionalWorkflowError | null | undefined
): "exists" | "error" | "uncertain" {
  if (error?.code === "email_exists" || error?.code === "user_already_exists") {
    return "exists";
  }

  if (!error || error.status == null || error.status >= 500) {
    return "uncertain";
  }

  return "error";
}

async function callWorkflow<T>(call: () => Promise<WorkflowCallResult<T>>): Promise<WorkflowCallResult<T>> {
  try {
    return await call();
  } catch (error) {
    return { data: null, error: workflowErrorFromUnknown(error) };
  }
}

export async function createScopedUserTransactionally(
  input: ScopedUserSetupInput,
  dependencies: {
    lookupCompletedSetup: (input: ScopedUserSetupInput) => Promise<WorkflowCallResult<ScopedUserSetupResult>>;
    recoverAuthOnlySetup?: (input: ScopedUserSetupInput) => Promise<WorkflowCallResult<{ id: string }>>;
    createAuthUser: () => Promise<WorkflowCallResult<{ id: string }>>;
    applyScopedUserSetup: (
      profileId: string,
      input: ScopedUserSetupInput
    ) => Promise<WorkflowCallResult<ScopedUserSetupResult>>;
    isScopedUserSetupCommitted?: (profileId: string) => Promise<WorkflowCallResult<boolean>>;
    deleteAuthUser: (profileId: string) => Promise<{ error: TransactionalWorkflowError | null }>;
    waitBeforeVerification?: (attempt: number) => Promise<void>;
  }
): Promise<ScopedUserSetupOutcome> {
  const lookupResult = await callWorkflow(() => dependencies.lookupCompletedSetup(input));

  if (!lookupResult.error && lookupResult.data && isScopedUserSetupResult(lookupResult.data, input)) {
    return {
      ok: true,
      profileId: lookupResult.data.profile_id,
      result: lookupResult.data,
      recoveredAfterError: false,
      replayedBeforeAuth: true
    };
  }

  if (!lookupResult.error && lookupResult.data) {
    return {
      ok: false,
      stage: "lookup",
      error: { message: "Completed setup lookup returned a malformed result." },
      errorKind: "unknown",
      uncertain: true
    };
  }

  if (lookupResult.error) {
    const errorKind = classifyTransactionalWorkflowError(lookupResult.error);
    return {
      ok: false,
      stage: "lookup",
      error: lookupResult.error,
      errorKind,
      uncertain: errorKind === "unknown"
    };
  }

  let authResult = await callWorkflow(() => dependencies.createAuthUser());

  if (authResult.error && classifyAuthUserCreationError(authResult.error) === "exists" && dependencies.recoverAuthOnlySetup) {
    const recoveryResult = await callWorkflow(() => dependencies.recoverAuthOnlySetup!(input));

    if (recoveryResult.error) {
      return {
        ok: false,
        stage: "auth",
        error: recoveryResult.error,
        authErrorKind: classifyTransactionalWorkflowError(recoveryResult.error) === "unknown" ? "uncertain" : "error"
      };
    }

    if (recoveryResult.data?.id) {
      authResult = recoveryResult;
    }
  }

  if (authResult.error || !authResult.data || typeof authResult.data.id !== "string" || !authResult.data.id) {
    const error = authResult.error ?? { message: "Auth user was not returned." };
    return {
      ok: false,
      stage: "auth",
      error,
      authErrorKind: classifyAuthUserCreationError(authResult.error)
    };
  }

  const profileId = authResult.data.id;
  let setupError: TransactionalWorkflowError = { message: "Database setup result was not returned." };
  let errorKind: TransactionalWorkflowErrorKind = "unknown";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const setupResult = await callWorkflow(() => dependencies.applyScopedUserSetup(profileId, input));

    if (!setupResult.error && setupResult.data && isScopedUserSetupResult(setupResult.data, input, profileId)) {
      return {
        ok: true,
        profileId,
        result: setupResult.data,
        recoveredAfterError: attempt > 0,
        replayedBeforeAuth: false
      };
    }

    setupError = setupResult.error ?? {
      message: setupResult.data
        ? "Database setup returned a malformed result."
        : "Database setup result was not returned."
    };
    errorKind = classifyTransactionalWorkflowError(setupError);

    if (errorKind !== "unknown") {
      break;
    }
  }

  if (errorKind === "unknown") {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (dependencies.waitBeforeVerification) {
        await dependencies.waitBeforeVerification(attempt);
      }

      if (!dependencies.isScopedUserSetupCommitted) {
        break;
      }

      const verificationResult = await callWorkflow(() => dependencies.isScopedUserSetupCommitted!(profileId));

      if (!verificationResult.error && verificationResult.data === true) {
        return {
          ok: true,
          profileId,
          result: null,
          recoveredAfterError: true,
          replayedBeforeAuth: false
        };
      }
    }

    return {
      ok: false,
      stage: "database",
      profileId,
      error: setupError,
      errorKind,
      cleanup: "not-attempted",
      cleanupError: null,
      uncertain: true
    };
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
    cleanupError: cleanupResult.error,
    uncertain: false
  };
}

function expectedStateForMutation(
  currentState: PersonAccessState,
  submittedExpectedState: PersonAccessState | null | undefined
) {
  return submittedExpectedState && canonicalJson(submittedExpectedState) !== canonicalJson(currentState)
    ? submittedExpectedState
    : currentState;
}

async function applyMutationWithAmbiguousRetry<T>(
  call: () => Promise<WorkflowCallResult<T>>,
  isValidResult: (value: unknown) => value is T
): Promise<WorkflowCallResult<T> & { uncertain: boolean }> {
  let lastError: TransactionalWorkflowError = { message: "Mutation result was not returned." };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await callWorkflow(call);

    if (!result.error && result.data && isValidResult(result.data)) {
      return { ...result, uncertain: false };
    }

    lastError = result.error ?? {
      message: result.data ? "Mutation returned a malformed result." : "Mutation result was not returned."
    };

    if (classifyTransactionalWorkflowError(lastError) !== "unknown") {
      return { data: null, error: lastError, uncertain: false };
    }
  }

  return { data: null, error: lastError, uncertain: true };
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
  const stateResult = await callWorkflow(() => dependencies.getPersonAccessState(input.actorId, input.targetProfileId));

  if (stateResult.error || !stateResult.data) {
    const error = stateResult.error ?? { message: "Access state was not returned." };

    return {
      ok: false,
      stage: "state",
      error,
      errorKind: classifyTransactionalWorkflowError(error),
      uncertain: false
    };
  }

  const expectedState = expectedStateForMutation(stateResult.data, input.submittedExpectedState);
  const changeResult = await applyMutationWithAmbiguousRetry(
    () => dependencies.applyAccessChange(input, expectedState),
    (value): value is SuperAdminAccessChangeResult => isSuperAdminAccessChangeResult(value, input)
  );

  if (changeResult.error || !changeResult.data) {
    const error = changeResult.error ?? { message: "Access change result was not returned." };

    return {
      ok: false,
      stage: "database",
      error,
      errorKind: classifyTransactionalWorkflowError(error),
      uncertain: changeResult.uncertain
    };
  }

  return {
    ok: true,
    currentState: stateResult.data,
    expectedState,
    result: changeResult.data
  };
}

export async function endStaffMembershipTransactionally(
  input: StaffMembershipEndInput,
  dependencies: {
    getPersonAccessState: (
      actorId: string,
      targetProfileId: string
    ) => Promise<WorkflowCallResult<PersonAccessState>>;
    applyMembershipEnd: (
      input: StaffMembershipEndInput,
      expectedState: PersonAccessState
    ) => Promise<WorkflowCallResult<StaffMembershipEndResult>>;
  }
): Promise<StaffMembershipEndOutcome> {
  const stateResult = await callWorkflow(() => dependencies.getPersonAccessState(input.actorId, input.targetProfileId));

  if (stateResult.error || !stateResult.data) {
    const error = stateResult.error ?? { message: "Access state was not returned." };
    return {
      ok: false,
      stage: "state",
      error,
      errorKind: classifyTransactionalWorkflowError(error),
      uncertain: false
    };
  }

  const expectedState = expectedStateForMutation(stateResult.data, input.submittedExpectedState);
  const endResult = await applyMutationWithAmbiguousRetry(
    () => dependencies.applyMembershipEnd(input, expectedState),
    (value): value is StaffMembershipEndResult => isStaffMembershipEndResult(value, input)
  );

  if (endResult.error || !endResult.data) {
    const error = endResult.error ?? { message: "Membership end result was not returned." };
    return {
      ok: false,
      stage: "database",
      error,
      errorKind: classifyTransactionalWorkflowError(error),
      uncertain: endResult.uncertain
    };
  }

  return {
    ok: true,
    currentState: stateResult.data,
    expectedState,
    result: endResult.data
  };
}

export async function grantMasjidStaffAccessTransactionally(
  input: MasjidStaffGrantInput,
  dependencies: {
    prepareExpectedState: (input: MasjidStaffGrantInput) => Promise<WorkflowCallResult<PersonAccessState>>;
    applyStaffGrant: (
      input: MasjidStaffGrantInput,
      expectedState: PersonAccessState
    ) => Promise<WorkflowCallResult<MasjidStaffGrantResult>>;
  }
): Promise<MasjidStaffGrantOutcome> {
  const stateResult = await callWorkflow(() => dependencies.prepareExpectedState(input));

  if (stateResult.error || !stateResult.data) {
    const error = stateResult.error ?? { message: "Expected access state was not returned." };
    return {
      ok: false,
      stage: "state",
      error,
      errorKind: classifyTransactionalWorkflowError(error),
      uncertain: false
    };
  }

  const expectedState = expectedStateForMutation(stateResult.data, input.submittedExpectedState);
  const grantResult = await applyMutationWithAmbiguousRetry(
    () => dependencies.applyStaffGrant(input, expectedState),
    (value): value is MasjidStaffGrantResult => isMasjidStaffGrantResult(value, input)
  );

  if (grantResult.error || !grantResult.data) {
    const error = grantResult.error ?? { message: "Staff grant result was not returned." };
    return {
      ok: false,
      stage: "database",
      error,
      errorKind: classifyTransactionalWorkflowError(error),
      uncertain: grantResult.uncertain
    };
  }

  return {
    ok: true,
    currentState: stateResult.data,
    expectedState,
    result: grantResult.data
  };
}

export async function updateMasjidTransactionally(
  input: MasjidUpdateInput,
  dependencies: {
    applyMasjidUpdate: (input: MasjidUpdateInput) => Promise<WorkflowCallResult<MasjidUpdateResult>>;
  }
): Promise<MasjidUpdateOutcome> {
  const updateResult = await applyMutationWithAmbiguousRetry(
    () => dependencies.applyMasjidUpdate(input),
    (value): value is MasjidUpdateResult => isMasjidUpdateResult(value, input)
  );

  if (updateResult.error || !updateResult.data) {
    const error = updateResult.error ?? { message: "Masjid update result was not returned." };
    return {
      ok: false,
      stage: "database",
      error,
      errorKind: classifyTransactionalWorkflowError(error),
      uncertain: updateResult.uncertain
    };
  }

  return { ok: true, result: updateResult.data };
}

export function scopedUserSetupStatusForOutcome(outcome: Exclude<ScopedUserSetupOutcome, { ok: true }>) {
  if (outcome.stage === "auth") {
    if (outcome.authErrorKind === "exists") return "exists";
    if (outcome.authErrorKind === "uncertain") return "auth-uncertain";
    return "auth-error";
  }

  if (outcome.stage === "lookup") {
    return outcome.uncertain ? "setup-uncertain" : "setup-error";
  }

  if (outcome.uncertain || outcome.cleanup === "not-attempted") {
    return "setup-uncertain";
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

export function superAdminMutationStatusForOutcome(
  outcome: Exclude<
    SuperAdminAccessChangeOutcome | StaffMembershipEndOutcome | MasjidStaffGrantOutcome | MasjidUpdateOutcome,
    { ok: true }
  >
) {
  return outcome.uncertain ? "access-uncertain" : superAdminAccessStatusForError(outcome.error);
}
