import { describe, expect, it, vi } from "vitest";
import {
  applySuperAdminAccessChangeTransactionally,
  classifyAuthUserCreationError,
  classifyTransactionalWorkflowError,
  createScopedUserTransactionally,
  endStaffMembershipTransactionally,
  grantMasjidStaffAccessTransactionally,
  masjidStaffGrantRpcArguments,
  parsePersonAccessState,
  scopedUserSetupLookupRpcArguments,
  scopedUserSetupRpcArguments,
  scopedUserSetupAuthMetadata,
  scopedUserSetupStatusForOutcome,
  staffMembershipEndRpcArguments,
  superAdminAccessStatusForError,
  superAdminAccessChangeRpcArguments,
  superAdminMutationStatusForOutcome,
  type PersonAccessState,
  type MasjidStaffGrantInput,
  type ScopedUserSetupInput,
  type StaffMembershipEndInput,
  type SuperAdminAccessChangeInput
} from "@/lib/transactional-workflows";

const setupInput: ScopedUserSetupInput = {
  requestId: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  name: "Test Student",
  email: "15550101000@itqan.local",
  phone: "+15550101000",
  role: "student",
  startsOn: "2026-07-19",
  masjidId: "33333333-3333-4333-8333-333333333333",
  groupId: "44444444-4444-4444-8444-444444444444"
};

const setupResult = {
  profile_id: "55555555-5555-4555-8555-555555555555",
  membership_id: "66666666-6666-4666-8666-666666666666",
  role: "student" as const,
  masjid_id: setupInput.masjidId,
  group_id: setupInput.groupId
};

const accessInput: SuperAdminAccessChangeInput = {
  requestId: "77777777-7777-4777-8777-777777777777",
  actorId: "88888888-8888-4888-8888-888888888888",
  targetProfileId: "99999999-9999-4999-8999-999999999999",
  preset: "admin_teacher",
  startsOn: "2026-07-20",
  selectedMasjidId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  selectedGroupId: null
};

const expectedState = {
  profile: { id: accessInput.targetProfileId, role: "teacher", active: true },
  student_memberships: [],
  staff_memberships: []
};

const accessResult = {
  profile_id: accessInput.targetProfileId,
  preset: "admin_teacher" as const,
  role: "admin" as const,
  active: true,
  access_state: expectedState
};

const noCompletedSetup = async () => ({ data: null, error: null });

const membershipEndInput: StaffMembershipEndInput = {
  requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  actorId: accessInput.actorId,
  targetProfileId: accessInput.targetProfileId,
  membershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  endsOn: "2026-07-20"
};

const membershipEndResult = {
  profile_id: membershipEndInput.targetProfileId,
  membership_id: membershipEndInput.membershipId,
  ends_on: membershipEndInput.endsOn,
  access_state: expectedState
};

const staffGrantInput: MasjidStaffGrantInput = {
  requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  actorId: accessInput.actorId,
  targetProfileId: accessInput.targetProfileId,
  masjidId: accessInput.selectedMasjidId!,
  grant: "admin_teacher",
  startsOn: "2026-07-20"
};

const staffGrantResult = {
  profile_id: staffGrantInput.targetProfileId,
  masjid_id: staffGrantInput.masjidId,
  grant: staffGrantInput.grant,
  role: "admin" as const,
  access_state: expectedState
};

describe("transactional workflow error classification", () => {
  it("recognizes the non-retryable stale-state contract", () => {
    expect(
      classifyTransactionalWorkflowError({
        code: "P0001",
        message: "access state changed; reload before saving."
      })
    ).toBe("stale");
  });

  it("separates authorization, validation, and constraint conflicts", () => {
    expect(classifyTransactionalWorkflowError({ code: "42501" })).toBe("denied");
    expect(classifyTransactionalWorkflowError({ code: "22023" })).toBe("invalid");
    expect(classifyTransactionalWorkflowError({ code: "23505" })).toBe("conflict");
    expect(classifyTransactionalWorkflowError({ code: "23P01" })).toBe("conflict");
  });

  it("does not misclassify unrelated application exceptions", () => {
    expect(classifyTransactionalWorkflowError({ code: "P0001", message: "another failure" })).toBe("unknown");
    expect(classifyTransactionalWorkflowError(null)).toBe("unknown");
  });
});

describe("transactional RPC payloads", () => {
  it("maps scoped user setup arguments to the Phase 1A signature", () => {
    expect(scopedUserSetupRpcArguments(setupResult.profile_id, setupInput)).toEqual({
      input_request_id: setupInput.requestId,
      input_actor_id: setupInput.actorId,
      input_profile_id: setupResult.profile_id,
      input_name: setupInput.name,
      input_email: setupInput.email,
      input_phone: setupInput.phone,
      input_role: setupInput.role,
      input_starts_on: setupInput.startsOn,
      input_masjid_id: setupInput.masjidId,
      input_group_id: setupInput.groupId
    });
    expect(scopedUserSetupLookupRpcArguments(setupInput)).toEqual({
      input_request_id: setupInput.requestId,
      input_actor_id: setupInput.actorId,
      input_name: setupInput.name,
      input_email: setupInput.email,
      input_phone: setupInput.phone,
      input_role: setupInput.role,
      input_starts_on: setupInput.startsOn,
      input_masjid_id: setupInput.masjidId,
      input_group_id: setupInput.groupId
    });
    expect(scopedUserSetupAuthMetadata(setupInput)).toEqual({
      setup_request_id: setupInput.requestId,
      setup_actor_id: setupInput.actorId,
      setup_payload: {
        actor_id: setupInput.actorId,
        name: setupInput.name,
        email: setupInput.email,
        phone: setupInput.phone,
        role: setupInput.role,
        starts_on: setupInput.startsOn,
        masjid_id: setupInput.masjidId,
        group_id: setupInput.groupId
      }
    });
  });

  it("maps canonical state and access inputs to the Phase 1A signature", () => {
    expect(superAdminAccessChangeRpcArguments(accessInput, expectedState)).toEqual({
      input_request_id: accessInput.requestId,
      input_actor_id: accessInput.actorId,
      input_target_profile_id: accessInput.targetProfileId,
      input_preset: accessInput.preset,
      input_starts_on: accessInput.startsOn,
      input_selected_masjid_id: accessInput.selectedMasjidId,
      input_selected_group_id: accessInput.selectedGroupId,
      input_expected_state: expectedState
    });
    expect(staffMembershipEndRpcArguments(membershipEndInput, expectedState)).toEqual({
      input_request_id: membershipEndInput.requestId,
      input_actor_id: membershipEndInput.actorId,
      input_target_profile_id: membershipEndInput.targetProfileId,
      input_membership_id: membershipEndInput.membershipId,
      input_ends_on: membershipEndInput.endsOn,
      input_expected_state: expectedState
    });
    expect(masjidStaffGrantRpcArguments(staffGrantInput, expectedState)).toEqual({
      input_request_id: staffGrantInput.requestId,
      input_actor_id: staffGrantInput.actorId,
      input_target_profile_id: staffGrantInput.targetProfileId,
      input_masjid_id: staffGrantInput.masjidId,
      input_grant: staffGrantInput.grant,
      input_starts_on: staffGrantInput.startsOn,
      input_expected_state: expectedState
    });
  });

  it("accepts only bounded person access state objects", () => {
    expect(parsePersonAccessState(JSON.stringify(expectedState))).toEqual(expectedState);
    expect(parsePersonAccessState("[]")).toBeNull();
    expect(parsePersonAccessState("not-json")).toBeNull();
    expect(parsePersonAccessState(JSON.stringify({ profile: {}, student_memberships: [] }))).toBeNull();
  });

  it("maps only recognized Auth duplicate codes to exists", () => {
    expect(classifyAuthUserCreationError({ code: "email_exists", status: 422 })).toBe("exists");
    expect(classifyAuthUserCreationError({ code: "user_already_exists", status: 422 })).toBe("exists");
    expect(classifyAuthUserCreationError({ code: "not_admin", status: 403 })).toBe("error");
    expect(classifyAuthUserCreationError({ code: "unexpected_failure", status: 503 })).toBe("uncertain");
    expect(classifyAuthUserCreationError({ message: "network error" })).toBe("uncertain");
  });
});

describe("scoped user setup orchestration", () => {
  it("creates Auth first and sends one stable RPC payload", async () => {
    const events: string[] = [];
    const createAuthUser = vi.fn(async () => {
      events.push("auth");
      return { data: { id: setupResult.profile_id }, error: null };
    });
    const applyScopedUserSetup = vi.fn(async (profileId: string, input: ScopedUserSetupInput) => {
      events.push("rpc");
      expect(profileId).toBe(setupResult.profile_id);
      expect(input).toEqual(setupInput);
      return { data: setupResult, error: null };
    });
    const deleteAuthUser = vi.fn();

    await expect(
      createScopedUserTransactionally(setupInput, {
        lookupCompletedSetup: noCompletedSetup,
        createAuthUser,
        applyScopedUserSetup,
        deleteAuthUser
      })
    ).resolves.toEqual({
      ok: true,
      profileId: setupResult.profile_id,
      result: setupResult,
      recoveredAfterError: false,
      replayedBeforeAuth: false
    });
    expect(events).toEqual(["auth", "rpc"]);
    expect(applyScopedUserSetup).toHaveBeenCalledOnce();
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });

  it("replays a completed setup before calling Auth create", async () => {
    const createAuthUser = vi.fn();
    const applyScopedUserSetup = vi.fn();
    const outcome = await createScopedUserTransactionally(setupInput, {
      lookupCompletedSetup: async () => ({ data: setupResult, error: null }),
      createAuthUser,
      applyScopedUserSetup,
      deleteAuthUser: vi.fn()
    });

    expect(outcome).toEqual({
      ok: true,
      profileId: setupResult.profile_id,
      result: setupResult,
      recoveredAfterError: false,
      replayedBeforeAuth: true
    });
    expect(createAuthUser).not.toHaveBeenCalled();
    expect(applyScopedUserSetup).not.toHaveBeenCalled();
  });

  it("deletes the new Auth user after a database failure", async () => {
    const outcome = await createScopedUserTransactionally(setupInput, {
      lookupCompletedSetup: noCompletedSetup,
      createAuthUser: async () => ({ data: { id: setupResult.profile_id }, error: null }),
      applyScopedUserSetup: async () => ({ data: null, error: { code: "22023", message: "invalid scope" } }),
      deleteAuthUser: async () => ({ error: null })
    });

    expect(outcome).toMatchObject({
      ok: false,
      stage: "database",
      errorKind: "invalid",
      cleanup: "succeeded",
      cleanupError: null
    });
    if (!outcome.ok) {
      expect(scopedUserSetupStatusForOutcome(outcome)).toBe("invalid-scope");
    }
  });

  it("reports a failed compensation separately", async () => {
    const outcome = await createScopedUserTransactionally(setupInput, {
      lookupCompletedSetup: noCompletedSetup,
      createAuthUser: async () => ({ data: { id: setupResult.profile_id }, error: null }),
      applyScopedUserSetup: async () => ({
        data: null,
        error: { code: "22023", message: "setup payload is invalid" }
      }),
      deleteAuthUser: async () => ({ error: { message: "Auth cleanup failed" } })
    });

    expect(outcome).toMatchObject({
      ok: false,
      stage: "database",
      cleanup: "failed",
      cleanupError: { message: "Auth cleanup failed" }
    });
    if (!outcome.ok) {
      expect(scopedUserSetupStatusForOutcome(outcome)).toBe("setup-cleanup-error");
    }
  });

  it("never cleans up a committed or idempotently replayed RPC response", async () => {
    const deleteAuthUser = vi.fn();
    const applyScopedUserSetup = vi.fn(async () => ({ data: setupResult, error: null }));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const outcome = await createScopedUserTransactionally(setupInput, {
        lookupCompletedSetup: noCompletedSetup,
        createAuthUser: async () => ({ data: { id: setupResult.profile_id }, error: null }),
        applyScopedUserSetup,
        deleteAuthUser
      });

      expect(outcome.ok).toBe(true);
    }

    expect(applyScopedUserSetup).toHaveBeenNthCalledWith(1, setupResult.profile_id, setupInput);
    expect(applyScopedUserSetup).toHaveBeenNthCalledWith(2, setupResult.profile_id, setupInput);
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });

  it("does not delete Auth when a read confirms the RPC committed despite a response error", async () => {
    const deleteAuthUser = vi.fn();
    const outcome = await createScopedUserTransactionally(setupInput, {
      lookupCompletedSetup: noCompletedSetup,
      createAuthUser: async () => ({ data: { id: setupResult.profile_id }, error: null }),
      applyScopedUserSetup: async () => ({ data: null, error: { message: "Connection closed" } }),
      isScopedUserSetupCommitted: async () => ({ data: true, error: null }),
      deleteAuthUser
    });

    expect(outcome).toEqual({
      ok: true,
      profileId: setupResult.profile_id,
      result: null,
      recoveredAfterError: true,
      replayedBeforeAuth: false
    });
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });

  it("retries an ambiguous setup response with the same request and recovers the committed result", async () => {
    const deleteAuthUser = vi.fn();
    const applyScopedUserSetup = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "Connection closed" } })
      .mockResolvedValueOnce({ data: setupResult, error: null });
    const outcome = await createScopedUserTransactionally(setupInput, {
      lookupCompletedSetup: noCompletedSetup,
      createAuthUser: async () => ({ data: { id: setupResult.profile_id }, error: null }),
      applyScopedUserSetup,
      deleteAuthUser
    });

    expect(outcome).toMatchObject({ ok: true, recoveredAfterError: true, replayedBeforeAuth: false });
    expect(applyScopedUserSetup).toHaveBeenCalledTimes(2);
    expect(applyScopedUserSetup).toHaveBeenNthCalledWith(1, setupResult.profile_id, setupInput);
    expect(applyScopedUserSetup).toHaveBeenNthCalledWith(2, setupResult.profile_id, setupInput);
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });

  it("does not compensate when ambiguous retries and bounded verification remain unresolved", async () => {
    const deleteAuthUser = vi.fn();
    const verifyCommitted = vi.fn(async () => ({ data: false, error: null }));
    const outcome = await createScopedUserTransactionally(setupInput, {
      lookupCompletedSetup: noCompletedSetup,
      createAuthUser: async () => ({ data: { id: setupResult.profile_id }, error: null }),
      applyScopedUserSetup: async () => ({ data: null, error: { message: "Gateway timeout" } }),
      isScopedUserSetupCommitted: verifyCommitted,
      waitBeforeVerification: async () => undefined,
      deleteAuthUser
    });

    expect(outcome).toMatchObject({
      ok: false,
      stage: "database",
      cleanup: "not-attempted",
      uncertain: true
    });
    expect(verifyCommitted).toHaveBeenCalledTimes(3);
    expect(deleteAuthUser).not.toHaveBeenCalled();
    if (!outcome.ok) {
      expect(scopedUserSetupStatusForOutcome(outcome)).toBe("setup-uncertain");
    }
  });

  it("treats malformed setup payloads as ambiguous and never compensates without confirmation", async () => {
    const deleteAuthUser = vi.fn();
    const applyScopedUserSetup = vi.fn(async () => ({
      data: {} as typeof setupResult,
      error: null
    }));
    const outcome = await createScopedUserTransactionally(setupInput, {
      lookupCompletedSetup: noCompletedSetup,
      createAuthUser: async () => ({ data: { id: setupResult.profile_id }, error: null }),
      applyScopedUserSetup,
      isScopedUserSetupCommitted: async () => ({ data: false, error: null }),
      waitBeforeVerification: async () => undefined,
      deleteAuthUser
    });

    expect(outcome).toMatchObject({ ok: false, stage: "database", uncertain: true });
    expect(applyScopedUserSetup).toHaveBeenCalledTimes(2);
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });

  it("keeps definitive Auth errors distinct from duplicate and uncertain outcomes", async () => {
    const makeOutcome = (error: { code?: string; status?: number; message?: string }) =>
      createScopedUserTransactionally(setupInput, {
        lookupCompletedSetup: noCompletedSetup,
        createAuthUser: async () => ({ data: null, error }),
        applyScopedUserSetup: vi.fn(),
        deleteAuthUser: vi.fn()
      });

    const duplicate = await makeOutcome({ code: "email_exists", status: 422 });
    const denied = await makeOutcome({ code: "not_admin", status: 403 });
    const uncertain = await makeOutcome({ message: "Connection reset" });

    if (!duplicate.ok) expect(scopedUserSetupStatusForOutcome(duplicate)).toBe("exists");
    if (!denied.ok) expect(scopedUserSetupStatusForOutcome(denied)).toBe("auth-error");
    if (!uncertain.ok) expect(scopedUserSetupStatusForOutcome(uncertain)).toBe("auth-uncertain");
  });

  it("resumes an exact Auth-only identity after a duplicate create response", async () => {
    const applyScopedUserSetup = vi.fn(async () => ({ data: setupResult, error: null }));
    const outcome = await createScopedUserTransactionally(setupInput, {
      lookupCompletedSetup: noCompletedSetup,
      createAuthUser: async () => ({ data: null, error: { code: "email_exists", status: 422 } }),
      recoverAuthOnlySetup: async () => ({ data: { id: setupResult.profile_id }, error: null }),
      applyScopedUserSetup,
      deleteAuthUser: vi.fn()
    });

    expect(outcome).toMatchObject({ ok: true, profileId: setupResult.profile_id });
    expect(applyScopedUserSetup).toHaveBeenCalledWith(setupResult.profile_id, setupInput);
  });

  it("does not recover an unrelated duplicate Auth identity", async () => {
    const applyScopedUserSetup = vi.fn();
    const outcome = await createScopedUserTransactionally(setupInput, {
      lookupCompletedSetup: noCompletedSetup,
      createAuthUser: async () => ({ data: null, error: { code: "email_exists", status: 422 } }),
      recoverAuthOnlySetup: async () => ({ data: null, error: null }),
      applyScopedUserSetup,
      deleteAuthUser: vi.fn()
    });

    expect(outcome).toMatchObject({ ok: false, stage: "auth", authErrorKind: "exists" });
    expect(applyScopedUserSetup).not.toHaveBeenCalled();
  });
});

describe("super-admin access change orchestration", () => {
  it("loads canonical state and sends it unchanged with the stable request UUID", async () => {
    const getPersonAccessState = vi.fn(async () => ({ data: expectedState, error: null }));
    const applyAccessChange = vi.fn(async () => ({ data: accessResult, error: null }));

    await expect(
      applySuperAdminAccessChangeTransactionally(accessInput, {
        getPersonAccessState,
        applyAccessChange
      })
    ).resolves.toEqual({ ok: true, currentState: expectedState, expectedState, result: accessResult });
    expect(getPersonAccessState).toHaveBeenCalledWith(accessInput.actorId, accessInput.targetProfileId);
    expect(applyAccessChange).toHaveBeenCalledOnce();
    expect(applyAccessChange).toHaveBeenCalledWith(accessInput, expectedState);
  });

  it("surfaces stale state without retrying the mutation", async () => {
    const changedState = {
      ...expectedState,
      profile: { ...expectedState.profile, active: false }
    };
    const applyAccessChange = vi.fn(async () => ({
      data: null,
      error: { code: "P0001", message: "access state changed; reload before saving." }
    }));

    const outcome = await applySuperAdminAccessChangeTransactionally(
      { ...accessInput, submittedExpectedState: expectedState },
      {
      getPersonAccessState: async () => ({ data: changedState, error: null }),
      applyAccessChange
      }
    );

    expect(outcome).toMatchObject({ ok: false, stage: "database", errorKind: "stale" });
    expect(applyAccessChange).toHaveBeenCalledOnce();
    expect(applyAccessChange).toHaveBeenCalledWith(
      { ...accessInput, submittedExpectedState: expectedState },
      expectedState
    );
    if (!outcome.ok) {
      expect(superAdminAccessStatusForError(outcome.error)).toBe("access-stale");
    }
  });

  it("preserves duplicate request payloads for database idempotency", async () => {
    const appliedInputs: Array<{ input: SuperAdminAccessChangeInput; state: PersonAccessState }> = [];
    const applyAccessChange = vi.fn(async (input: SuperAdminAccessChangeInput, state: PersonAccessState) => {
      appliedInputs.push({ input, state });
      return { data: accessResult, error: null };
    });

    const retryInput = { ...accessInput, submittedExpectedState: expectedState };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const outcome = await applySuperAdminAccessChangeTransactionally(retryInput, {
        getPersonAccessState: async () => ({
          data: attempt === 0 ? expectedState : accessResult.access_state,
          error: null
        }),
        applyAccessChange
      });
      expect(outcome.ok).toBe(true);
    }

    expect(appliedInputs).toEqual([
      { input: retryInput, state: expectedState },
      { input: retryInput, state: expectedState }
    ]);
  });

  it("replays a lost committed response with the same mutation UUID", async () => {
    const applyAccessChange = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "Connection closed" } })
      .mockResolvedValueOnce({ data: accessResult, error: null });

    const outcome = await applySuperAdminAccessChangeTransactionally(accessInput, {
      getPersonAccessState: async () => ({ data: expectedState, error: null }),
      applyAccessChange
    });

    expect(outcome).toMatchObject({ ok: true, result: accessResult });
    expect(applyAccessChange).toHaveBeenCalledTimes(2);
    expect(applyAccessChange).toHaveBeenNthCalledWith(1, accessInput, expectedState);
    expect(applyAccessChange).toHaveBeenNthCalledWith(2, accessInput, expectedState);
  });

  it("returns access-uncertain after two unresolved access mutation responses", async () => {
    const applyAccessChange = vi.fn(async () => ({
      data: null,
      error: { message: "Gateway timeout" }
    }));

    const outcome = await applySuperAdminAccessChangeTransactionally(accessInput, {
      getPersonAccessState: async () => ({ data: expectedState, error: null }),
      applyAccessChange
    });

    expect(outcome).toMatchObject({ ok: false, stage: "database", uncertain: true });
    expect(applyAccessChange).toHaveBeenCalledTimes(2);
    if (!outcome.ok) {
      expect(superAdminMutationStatusForOutcome(outcome)).toBe("access-uncertain");
    }
  });

  it("retries malformed access mutation results before reporting uncertainty", async () => {
    const applyAccessChange = vi.fn(async () => ({ data: {} as typeof accessResult, error: null }));
    const outcome = await applySuperAdminAccessChangeTransactionally(accessInput, {
      getPersonAccessState: async () => ({ data: expectedState, error: null }),
      applyAccessChange
    });

    expect(outcome).toMatchObject({ ok: false, stage: "database", uncertain: true });
    expect(applyAccessChange).toHaveBeenCalledTimes(2);
  });

  it("keeps safety, validation, and generic status mappings distinct", () => {
    expect(superAdminAccessStatusForError({ code: "42501" })).toBe("guard-denied");
    expect(superAdminAccessStatusForError({ code: "23514", message: "an active masjid must retain an active admin." })).toBe(
      "guard-denied"
    );
    expect(superAdminAccessStatusForError({ code: "22023" })).toBe("scope-invalid");
    expect(superAdminAccessStatusForError({ code: "XX000" })).toBe("save-error");
  });
});

describe("staff membership end orchestration", () => {
  it("loads canonical state and sends a stable transactional close payload", async () => {
    const applyMembershipEnd = vi.fn(async () => ({ data: membershipEndResult, error: null }));

    const outcome = await endStaffMembershipTransactionally(membershipEndInput, {
      getPersonAccessState: async () => ({ data: expectedState, error: null }),
      applyMembershipEnd
    });

    expect(outcome).toEqual({
      ok: true,
      currentState: expectedState,
      expectedState,
      result: membershipEndResult
    });
    expect(applyMembershipEnd).toHaveBeenCalledOnce();
    expect(applyMembershipEnd).toHaveBeenCalledWith(membershipEndInput, expectedState);
  });

  it("replays an ambiguous close with the same request and state", async () => {
    const applyMembershipEnd = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "Response lost" } })
      .mockResolvedValueOnce({ data: membershipEndResult, error: null });

    const outcome = await endStaffMembershipTransactionally(membershipEndInput, {
      getPersonAccessState: async () => ({ data: expectedState, error: null }),
      applyMembershipEnd
    });

    expect(outcome).toMatchObject({ ok: true, result: membershipEndResult });
    expect(applyMembershipEnd).toHaveBeenCalledTimes(2);
    expect(applyMembershipEnd).toHaveBeenNthCalledWith(1, membershipEndInput, expectedState);
    expect(applyMembershipEnd).toHaveBeenNthCalledWith(2, membershipEndInput, expectedState);
  });

  it("preserves stale close errors without retry and maps unresolved ambiguity", async () => {
    const staleCall = vi.fn(async () => ({
      data: null,
      error: { code: "P0001", message: "access state changed; reload before saving." }
    }));
    const staleOutcome = await endStaffMembershipTransactionally(membershipEndInput, {
      getPersonAccessState: async () => ({ data: expectedState, error: null }),
      applyMembershipEnd: staleCall
    });
    expect(staleOutcome).toMatchObject({ ok: false, errorKind: "stale", uncertain: false });
    expect(staleCall).toHaveBeenCalledOnce();

    const uncertainCall = vi.fn(async () => ({ data: null, error: { message: "Timeout" } }));
    const uncertainOutcome = await endStaffMembershipTransactionally(membershipEndInput, {
      getPersonAccessState: async () => ({ data: expectedState, error: null }),
      applyMembershipEnd: uncertainCall
    });
    expect(uncertainOutcome).toMatchObject({ ok: false, uncertain: true });
    expect(uncertainCall).toHaveBeenCalledTimes(2);
    if (!uncertainOutcome.ok) {
      expect(superAdminMutationStatusForOutcome(uncertainOutcome)).toBe("access-uncertain");
    }
  });
});

describe("masjid staff grant orchestration", () => {
  it("retries a lost response with the same request and canonical state", async () => {
    const applyStaffGrant = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "Response lost" } })
      .mockResolvedValueOnce({ data: staffGrantResult, error: null });
    const outcome = await grantMasjidStaffAccessTransactionally(staffGrantInput, {
      getPersonAccessState: async () => ({ data: expectedState, error: null }),
      applyStaffGrant
    });

    expect(outcome).toMatchObject({ ok: true, result: staffGrantResult });
    expect(applyStaffGrant).toHaveBeenCalledTimes(2);
    expect(applyStaffGrant).toHaveBeenNthCalledWith(1, staffGrantInput, expectedState);
    expect(applyStaffGrant).toHaveBeenNthCalledWith(2, staffGrantInput, expectedState);
  });

  it("returns an uncertain result after two unresolved grant responses", async () => {
    const applyStaffGrant = vi.fn(async () => ({ data: null, error: { message: "Timeout" } }));
    const outcome = await grantMasjidStaffAccessTransactionally(staffGrantInput, {
      getPersonAccessState: async () => ({ data: expectedState, error: null }),
      applyStaffGrant
    });

    expect(outcome).toMatchObject({ ok: false, stage: "database", uncertain: true });
    expect(applyStaffGrant).toHaveBeenCalledTimes(2);
  });
});
