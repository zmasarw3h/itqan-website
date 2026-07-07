import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import type { Profile } from "@/lib/types";
import {
  assertActiveSuperAdminProfile,
  superAdminAuditEventPayload,
  type SuperAdminAuditEventInput
} from "@/lib/super-admin-rules";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

export async function requireSuperAdmin() {
  const context = await requireProfile(["super_admin"]);
  assertActiveSuperAdminProfile(context.profile);
  return context;
}

export async function requireSuperAdminAdminClient() {
  const context = await requireSuperAdmin();

  return {
    ...context,
    adminSupabase: createSupabaseAdminClient()
  };
}

export async function insertSuperAdminAuditEvent(input: {
  actor: Pick<Profile, "id" | "role" | "active">;
  event: SuperAdminAuditEventInput;
  adminSupabase?: SupabaseAdminClient;
}) {
  assertActiveSuperAdminProfile(input.actor);

  const adminSupabase = input.adminSupabase ?? createSupabaseAdminClient();
  const { error } = await adminSupabase
    .from("super_admin_audit_events")
    .insert(superAdminAuditEventPayload(input.actor.id, input.event));

  if (error) {
    throw new Error("Unable to write super-admin audit event.");
  }
}

export async function loadActiveSuperAdminCount(adminSupabase: SupabaseAdminClient) {
  const { count, error } = await adminSupabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "super_admin")
    .eq("active", true);

  if (error) {
    throw new Error("Unable to count active super admins.");
  }

  return count ?? 0;
}
