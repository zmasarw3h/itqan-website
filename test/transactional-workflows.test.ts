import { describe, expect, it, vi } from "vitest";
import {
  applySuperAdminAccessChangeTransactionally,
  classifyTransactionalWorkflowError,
  createScopedUserTransactionally,
  parsePersonAccessState,
  scopedUserSetupRpcArguments,
  scopedUserSetupStatusForOutcome,
  superAdminAccessStatusForError,
  superAdminAccessChangeRpcArguments,
  type PersonAccessState,
  type ScopedUserSetupInput,
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
  });

  it("accepts only bounded person access state objects", () => {
    expect(parsePersonAccessState(JSON.stringify(expectedState))).toEqual(expectedState);
    expect(parsePersonAccessState("[]")).toBeNull();
    expect(parsePersonAccessState("not-json")).toBeNull();
    expect(parsePersonAccessState(JSON.stringify({ profile: {}, student_memberships: [] }))).toBeNull();
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
        createAuthUser,
        applyScopedUserSetup,
        deleteAuthUser
      })
    ).resolves.toEqual({
      ok: true,
      profileId: setupResult.profile_id,
      result: setupResult,
      recoveredAfterError: false
    });
    expect(events).toEqual(["auth", "rpc"]);
    expect(applyScopedUserSetup).toHaveBeenCalledOnce();
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });

  it("deletes the new Auth user after a database failure", async () => {
    const outcome = await createScopedUserTransactionally(setupInput, {
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
      createAuthUser: async () => ({ data: { id: setupResult.profile_id }, error: null }),
      applyScopedUserSetup: async () => ({ data: null, error: { code: "P0001", message: "setup failed" } }),
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
      createAuthUser: async () => ({ data: { id: setupResult.profile_id }, error: null }),
      applyScopedUserSetup: async () => ({ data: null, error: { message: "Connection closed" } }),
      isScopedUserSetupCommitted: async () => ({ data: true, error: null }),
      deleteAuthUser
    });

    expect(outcome).toEqual({
      ok: true,
      profileId: setupResult.profile_id,
      result: null,
      recoveredAfterError: true
    });
    expect(deleteAuthUser).not.toHaveBeenCalled();
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

  it("keeps safety, validation, and generic status mappings distinct", () => {
    expect(superAdminAccessStatusForError({ code: "42501" })).toBe("guard-denied");
    expect(superAdminAccessStatusForError({ code: "23514", message: "an active masjid must retain an active admin." })).toBe(
      "guard-denied"
    );
    expect(superAdminAccessStatusForError({ code: "22023" })).toBe("scope-invalid");
    expect(superAdminAccessStatusForError({ code: "XX000" })).toBe("save-error");
  });
});
