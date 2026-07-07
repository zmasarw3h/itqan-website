import { describe, expect, it } from "vitest";
import {
  assertActiveSuperAdminProfile,
  assertNotLastSuperAdminRemoval,
  assertNotSelfDemotion,
  assertProfileRoleTransition,
  SuperAdminGuardError,
  superAdminAuditEventPayload
} from "@/lib/super-admin-rules";

describe("super-admin guard rules", () => {
  it("requires an active super-admin profile", () => {
    expect(() => assertActiveSuperAdminProfile({ role: "super_admin", active: true })).not.toThrow();
    expect(() => assertActiveSuperAdminProfile({ role: "admin", active: true })).toThrow(SuperAdminGuardError);
    expect(() => assertActiveSuperAdminProfile({ role: "super_admin", active: false })).toThrow(SuperAdminGuardError);
  });

  it("blocks self-demotion and self-deactivation", () => {
    expect(() =>
      assertNotSelfDemotion({
        actorId: "actor-1",
        targetProfileId: "actor-1",
        nextRole: "admin"
      })
    ).toThrow("demote");
    expect(() =>
      assertNotSelfDemotion({
        actorId: "actor-1",
        targetProfileId: "actor-1",
        nextActive: false
      })
    ).toThrow("deactivate");
    expect(() =>
      assertNotSelfDemotion({
        actorId: "actor-1",
        targetProfileId: "target-1",
        nextRole: "admin",
        nextActive: false
      })
    ).not.toThrow();
  });

  it("blocks removing the last active super admin", () => {
    expect(() =>
      assertNotLastSuperAdminRemoval({
        targetRole: "super_admin",
        targetActive: true,
        nextRole: "admin",
        activeSuperAdminCount: 1
      })
    ).toThrow("At least one active super admin");
    expect(() =>
      assertNotLastSuperAdminRemoval({
        targetRole: "super_admin",
        targetActive: true,
        nextActive: false,
        activeSuperAdminCount: 2
      })
    ).not.toThrow();
  });

  it("combines profile transition protections", () => {
    expect(() =>
      assertProfileRoleTransition({
        actorId: "super-1",
        targetProfileId: "super-2",
        targetRole: "super_admin",
        targetActive: true,
        nextRole: "admin",
        activeSuperAdminCount: 1
      })
    ).toThrow("At least one active super admin");
  });

  it("builds audit payloads without plaintext password fields", () => {
    expect(
      superAdminAuditEventPayload("actor-1", {
        action: " reset_password ",
        targetTable: "profiles",
        targetId: "target-1",
        metadata: { reason: "account recovery" }
      })
    ).toEqual({
      actor_id: "actor-1",
      action: "reset_password",
      target_table: "profiles",
      target_id: "target-1",
      target_masjid_id: null,
      before_data: null,
      after_data: null,
      metadata: { reason: "account recovery" }
    });

    expect(() =>
      superAdminAuditEventPayload("actor-1", {
        action: "reset_password",
        afterData: { temporary_password: "do-not-log" }
      })
    ).toThrow("plaintext passwords");
    expect(() =>
      superAdminAuditEventPayload("actor-1", {
        action: "reset_password",
        metadata: { generatedPasswordValue: "do-not-log" }
      })
    ).toThrow("plaintext passwords");
  });
});
