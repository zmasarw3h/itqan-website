import type { Profile, Role } from "@/lib/types";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type SuperAdminAuditEventInput = {
  action: string;
  targetTable?: string | null;
  targetId?: string | null;
  targetMasjidId?: string | null;
  beforeData?: JsonValue;
  afterData?: JsonValue;
  metadata?: JsonValue;
};

export type SuperAdminAuditEventPayload = {
  actor_id: string;
  action: string;
  target_table: string | null;
  target_id: string | null;
  target_masjid_id: string | null;
  before_data: JsonValue;
  after_data: JsonValue;
  metadata: JsonValue;
};

export class SuperAdminGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuperAdminGuardError";
  }
}

function normalizeDataKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function assertNoPlaintextPasswordData(value: JsonValue | undefined, path = "event") {
  if (value === undefined || value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPlaintextPasswordData(item, `${path}[${index}]`));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (normalizeDataKey(key).includes("password")) {
      throw new SuperAdminGuardError("Audit events must not include plaintext passwords.");
    }

    assertNoPlaintextPasswordData(child, `${path}.${key}`);
  }
}

export function isActiveSuperAdminProfile(profile: Pick<Profile, "role" | "active"> | null | undefined) {
  return Boolean(profile?.active && profile.role === "super_admin");
}

export function assertActiveSuperAdminProfile(profile: Pick<Profile, "role" | "active"> | null | undefined) {
  if (!isActiveSuperAdminProfile(profile)) {
    throw new SuperAdminGuardError("You do not have permission to manage super admin operations.");
  }
}

export function assertNotSelfDemotion(input: {
  actorId: string;
  targetProfileId: string;
  nextRole?: Role;
  nextActive?: boolean;
}) {
  if (input.actorId !== input.targetProfileId) {
    return;
  }

  if (input.nextRole !== undefined && input.nextRole !== "super_admin") {
    throw new SuperAdminGuardError("Super admins cannot demote their own account.");
  }

  if (input.nextActive === false) {
    throw new SuperAdminGuardError("Super admins cannot deactivate their own account.");
  }
}

export function assertNotLastSuperAdminRemoval(input: {
  targetRole: Role;
  targetActive: boolean;
  nextRole?: Role;
  nextActive?: boolean;
  activeSuperAdminCount: number;
}) {
  const currentlyActiveSuperAdmin = input.targetRole === "super_admin" && input.targetActive;
  const nextRole = input.nextRole ?? input.targetRole;
  const nextActive = input.nextActive ?? input.targetActive;
  const remainsActiveSuperAdmin = nextRole === "super_admin" && nextActive;

  if (currentlyActiveSuperAdmin && !remainsActiveSuperAdmin && input.activeSuperAdminCount <= 1) {
    throw new SuperAdminGuardError("At least one active super admin must remain.");
  }
}

export function assertProfileRoleTransition(input: {
  actorId: string;
  targetProfileId: string;
  targetRole: Role;
  targetActive: boolean;
  nextRole?: Role;
  nextActive?: boolean;
  activeSuperAdminCount: number;
}) {
  assertNotSelfDemotion(input);
  assertNotLastSuperAdminRemoval(input);
}

export function superAdminAuditEventPayload(
  actorId: string,
  event: SuperAdminAuditEventInput
): SuperAdminAuditEventPayload {
  const action = event.action.trim();

  if (!action) {
    throw new SuperAdminGuardError("Audit event action is required.");
  }

  assertNoPlaintextPasswordData(event.beforeData);
  assertNoPlaintextPasswordData(event.afterData);
  assertNoPlaintextPasswordData(event.metadata);

  return {
    actor_id: actorId,
    action,
    target_table: event.targetTable ?? null,
    target_id: event.targetId ?? null,
    target_masjid_id: event.targetMasjidId ?? null,
    before_data: event.beforeData ?? null,
    after_data: event.afterData ?? null,
    metadata: event.metadata ?? null
  };
}
