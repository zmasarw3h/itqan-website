"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  findActiveProfileForStaffGrant,
  loadMasjidSetupDetailData
} from "@/app/super-admin/masajid/data";
import { isValidDateString, todayDateString } from "@/lib/dates";
import {
  isValidMasjidSlug,
  normalizeMasjidSlug,
  parseCohortKind,
  parsePositiveInteger,
  parseStaffAccessGrant,
  staffRolesForGrant
} from "@/lib/super-admin-setup";
import {
  insertSuperAdminAuditEvent,
  loadActiveSuperAdminCount,
  requireSuperAdminAdminClient
} from "@/lib/super-admin";
import { assertProfileRoleTransition, type JsonValue } from "@/lib/super-admin-rules";
import type { Cohort, HalaqaGroup, Masjid, MasjidStaffMembership, Profile, StaffRole } from "@/lib/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function masajidPath(status?: string) {
  return status ? `/super-admin/masajid?${new URLSearchParams({ status }).toString()}` : "/super-admin/masajid";
}

function masjidPath(masjidId: string, status?: string) {
  return status
    ? `/super-admin/masajid/${masjidId}?${new URLSearchParams({ status }).toString()}`
    : `/super-admin/masajid/${masjidId}`;
}

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function formBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function requireUuid(value: string | null) {
  return Boolean(value && UUID_PATTERN.test(value));
}

function validateName(value: string, maxLength = 120) {
  return value.length >= 2 && value.length <= maxLength;
}

function masjidAuditData(masjid: Pick<Masjid, "name" | "slug" | "active">) {
  return {
    name: masjid.name,
    slug: masjid.slug,
    active: masjid.active
  };
}

function cohortAuditData(cohort: Pick<Cohort, "masjid_id" | "kind" | "name" | "active" | "sort_order">) {
  return {
    masjid_id: cohort.masjid_id,
    kind: cohort.kind,
    name: cohort.name,
    active: cohort.active,
    sort_order: cohort.sort_order
  };
}

function groupAuditData(group: Pick<HalaqaGroup, "cohort_id" | "name" | "active" | "sort_order">) {
  return {
    cohort_id: group.cohort_id,
    name: group.name,
    active: group.active,
    sort_order: group.sort_order
  };
}

function staffMembershipAuditData(
  membership: Pick<MasjidStaffMembership, "profile_id" | "masjid_id" | "staff_role" | "active" | "starts_on" | "ends_on">
) {
  return {
    profile_id: membership.profile_id,
    masjid_id: membership.masjid_id,
    staff_role: membership.staff_role,
    active: membership.active,
    starts_on: membership.starts_on,
    ends_on: membership.ends_on
  };
}

async function auditSetupEvent(input: {
  actor: Profile;
  adminSupabase: Awaited<ReturnType<typeof requireSuperAdminAdminClient>>["adminSupabase"];
  action: string;
  targetTable: string;
  targetId: string;
  targetMasjidId?: string | null;
  beforeData?: JsonValue;
  afterData?: JsonValue;
  metadata?: JsonValue;
}) {
  await insertSuperAdminAuditEvent({
    actor: input.actor,
    adminSupabase: input.adminSupabase,
    event: {
      action: input.action,
      targetTable: input.targetTable,
      targetId: input.targetId,
      targetMasjidId: input.targetMasjidId ?? null,
      beforeData: input.beforeData ?? undefined,
      afterData: input.afterData ?? undefined,
      metadata: input.metadata ?? undefined
    }
  });
}

async function currentStaffRoleExists(input: {
  adminSupabase: Awaited<ReturnType<typeof requireSuperAdminAdminClient>>["adminSupabase"];
  profileId: string;
  masjidId: string;
  staffRole: StaffRole;
  startsOn: string;
}) {
  const { data, error } = await input.adminSupabase
    .from("masjid_staff_memberships")
    .select("id")
    .eq("profile_id", input.profileId)
    .eq("masjid_id", input.masjidId)
    .eq("staff_role", input.staffRole)
    .eq("active", true)
    .lte("starts_on", input.startsOn)
    .or(`ends_on.is.null,ends_on.gte.${input.startsOn}`)
    .limit(1);

  if (error) {
    throw new Error("Unable to check staff access.");
  }

  return Boolean(data?.length);
}

export async function createMasjidSetup(formData: FormData) {
  const name = formString(formData, "name");
  const slug = normalizeMasjidSlug(formString(formData, "slug") || name);
  const active = formBoolean(formData, "active");
  const cohortName = formString(formData, "cohort_name");
  const cohortKind = parseCohortKind(formData.get("cohort_kind")) ?? "brothers";
  const cohortSortOrder = parsePositiveInteger(formString(formData, "cohort_sort_order"), 1);
  const cohortActive = formBoolean(formData, "cohort_active");
  const groupName = formString(formData, "group_name");
  const groupSortOrder = parsePositiveInteger(formString(formData, "group_sort_order"), 1);
  const groupActive = formBoolean(formData, "group_active");

  if (!validateName(name) || !isValidMasjidSlug(slug)) {
    redirect(masajidPath("invalid"));
  }

  if ((cohortName || groupName) && !validateName(cohortName)) {
    redirect(masajidPath("invalid"));
  }

  if (groupName && !validateName(groupName)) {
    redirect(masajidPath("invalid"));
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  let masjidId: string | null = null;

  try {
    const { data: masjid, error: masjidError } = await adminSupabase
      .from("masajid")
      .insert({ name, slug, active })
      .select("id,name,slug,active,created_at,updated_at")
      .single<Masjid>();

    if (masjidError || !masjid) {
      throw new Error("Unable to create masjid.");
    }

    masjidId = masjid.id;
    await auditSetupEvent({
      actor,
      adminSupabase,
      action: "masjid_created",
      targetTable: "masajid",
      targetId: masjid.id,
      targetMasjidId: masjid.id,
      afterData: masjidAuditData(masjid)
    });

    if (cohortName) {
      const { data: cohort, error: cohortError } = await adminSupabase
        .from("cohorts")
        .insert({
          masjid_id: masjid.id,
          kind: cohortKind,
          name: cohortName,
          sort_order: cohortSortOrder,
          active: cohortActive
        })
        .select("id,masjid_id,kind,name,active,sort_order,created_at,updated_at")
        .single<Cohort>();

      if (cohortError || !cohort) {
        throw new Error("Unable to create cohort.");
      }

      await auditSetupEvent({
        actor,
        adminSupabase,
        action: "cohort_created",
        targetTable: "cohorts",
        targetId: cohort.id,
        targetMasjidId: masjid.id,
        afterData: cohortAuditData(cohort)
      });

      if (groupName) {
        const { data: group, error: groupError } = await adminSupabase
          .from("halaqa_groups")
          .insert({
            cohort_id: cohort.id,
            name: groupName,
            sort_order: groupSortOrder,
            active: groupActive
          })
          .select("id,cohort_id,name,active,sort_order,created_at,updated_at")
          .single<HalaqaGroup>();

        if (groupError || !group) {
          throw new Error("Unable to create group.");
        }

        await auditSetupEvent({
          actor,
          adminSupabase,
          action: "group_created",
          targetTable: "halaqa_groups",
          targetId: group.id,
          targetMasjidId: masjid.id,
          afterData: groupAuditData(group)
        });
      }
    }
  } catch {
    redirect(masajidPath("save-error"));
  }

  if (!masjidId) {
    redirect(masajidPath("save-error"));
  }

  revalidatePath("/super-admin/masajid");
  redirect(masjidPath(masjidId, "created"));
}

export async function updateMasjidSetup(formData: FormData) {
  const masjidId = formString(formData, "masjid_id");
  const name = formString(formData, "name");
  const slug = normalizeMasjidSlug(formString(formData, "slug"));
  const active = formBoolean(formData, "active");

  if (!requireUuid(masjidId) || !validateName(name) || !isValidMasjidSlug(slug)) {
    redirect(masajidPath("invalid"));
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const current = await loadMasjidSetupDetailData(adminSupabase, masjidId);

  if (!current) {
    redirect(masajidPath("not-found"));
  }

  if (current.masjid.active && !active && formString(formData, "confirmation_name") !== current.masjid.name) {
    redirect(masjidPath(masjidId, "confirmation-mismatch"));
  }

  const { data, error } = await adminSupabase
    .from("masajid")
    .update({ name, slug, active, updated_at: new Date().toISOString() })
    .eq("id", masjidId)
    .select("id,name,slug,active,created_at,updated_at")
    .single<Masjid>();

  if (error || !data) {
    redirect(masjidPath(masjidId, "save-error"));
  }

  await auditSetupEvent({
    actor,
    adminSupabase,
    action: "masjid_updated",
    targetTable: "masajid",
    targetId: masjidId,
    targetMasjidId: masjidId,
    beforeData: masjidAuditData(current.masjid),
    afterData: masjidAuditData(data)
  });

  revalidatePath("/super-admin/masajid");
  revalidatePath(`/super-admin/masajid/${masjidId}`);
  redirect(masjidPath(masjidId, "updated"));
}

export async function createCohortSetup(formData: FormData) {
  const masjidId = formString(formData, "masjid_id");
  const name = formString(formData, "name");
  const kind = parseCohortKind(formData.get("kind"));
  const sortOrder = parsePositiveInteger(formString(formData, "sort_order"), 1);
  const active = formBoolean(formData, "active");

  if (!requireUuid(masjidId) || !validateName(name) || !kind) {
    redirect(masajidPath("invalid"));
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const current = await loadMasjidSetupDetailData(adminSupabase, masjidId);

  if (!current) {
    redirect(masajidPath("not-found"));
  }

  const { data, error } = await adminSupabase
    .from("cohorts")
    .insert({ masjid_id: masjidId, name, kind, sort_order: sortOrder, active })
    .select("id,masjid_id,kind,name,active,sort_order,created_at,updated_at")
    .single<Cohort>();

  if (error || !data) {
    redirect(masjidPath(masjidId, "save-error"));
  }

  await auditSetupEvent({
    actor,
    adminSupabase,
    action: "cohort_created",
    targetTable: "cohorts",
    targetId: data.id,
    targetMasjidId: masjidId,
    afterData: cohortAuditData(data)
  });

  revalidatePath("/super-admin/masajid");
  revalidatePath(`/super-admin/masajid/${masjidId}`);
  redirect(masjidPath(masjidId, "cohort-created"));
}

export async function updateCohortSetup(formData: FormData) {
  const masjidId = formString(formData, "masjid_id");
  const cohortId = formString(formData, "cohort_id");
  const name = formString(formData, "name");
  const kind = parseCohortKind(formData.get("kind"));
  const sortOrder = parsePositiveInteger(formString(formData, "sort_order"), 1);
  const active = formBoolean(formData, "active");

  if (!requireUuid(masjidId) || !requireUuid(cohortId) || !validateName(name) || !kind) {
    redirect(masajidPath("invalid"));
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const detail = await loadMasjidSetupDetailData(adminSupabase, masjidId);
  const current = detail?.cohorts.find((cohort) => cohort.id === cohortId);

  if (!detail || !current) {
    redirect(masajidPath("not-found"));
  }

  if (current.active && !active && formString(formData, "confirmation_name") !== current.name) {
    redirect(masjidPath(masjidId, "confirmation-mismatch"));
  }

  const { data, error } = await adminSupabase
    .from("cohorts")
    .update({ name, kind, sort_order: sortOrder, active, updated_at: new Date().toISOString() })
    .eq("id", cohortId)
    .eq("masjid_id", masjidId)
    .select("id,masjid_id,kind,name,active,sort_order,created_at,updated_at")
    .single<Cohort>();

  if (error || !data) {
    redirect(masjidPath(masjidId, "save-error"));
  }

  await auditSetupEvent({
    actor,
    adminSupabase,
    action: "cohort_updated",
    targetTable: "cohorts",
    targetId: cohortId,
    targetMasjidId: masjidId,
    beforeData: cohortAuditData(current),
    afterData: cohortAuditData(data)
  });

  revalidatePath("/super-admin/masajid");
  revalidatePath(`/super-admin/masajid/${masjidId}`);
  redirect(masjidPath(masjidId, "cohort-updated"));
}

export async function createGroupSetup(formData: FormData) {
  const masjidId = formString(formData, "masjid_id");
  const cohortId = formString(formData, "cohort_id");
  const name = formString(formData, "name");
  const sortOrder = parsePositiveInteger(formString(formData, "sort_order"), 1);
  const active = formBoolean(formData, "active");

  if (!requireUuid(masjidId) || !requireUuid(cohortId) || !validateName(name)) {
    redirect(masajidPath("invalid"));
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const detail = await loadMasjidSetupDetailData(adminSupabase, masjidId);

  if (!detail?.cohorts.some((cohort) => cohort.id === cohortId)) {
    redirect(masajidPath("not-found"));
  }

  const { data, error } = await adminSupabase
    .from("halaqa_groups")
    .insert({ cohort_id: cohortId, name, sort_order: sortOrder, active })
    .select("id,cohort_id,name,active,sort_order,created_at,updated_at")
    .single<HalaqaGroup>();

  if (error || !data) {
    redirect(masjidPath(masjidId, "save-error"));
  }

  await auditSetupEvent({
    actor,
    adminSupabase,
    action: "group_created",
    targetTable: "halaqa_groups",
    targetId: data.id,
    targetMasjidId: masjidId,
    afterData: groupAuditData(data)
  });

  revalidatePath("/super-admin/masajid");
  revalidatePath(`/super-admin/masajid/${masjidId}`);
  redirect(masjidPath(masjidId, "group-created"));
}

export async function updateGroupSetup(formData: FormData) {
  const masjidId = formString(formData, "masjid_id");
  const cohortId = formString(formData, "cohort_id");
  const groupId = formString(formData, "group_id");
  const name = formString(formData, "name");
  const sortOrder = parsePositiveInteger(formString(formData, "sort_order"), 1);
  const active = formBoolean(formData, "active");

  if (!requireUuid(masjidId) || !requireUuid(cohortId) || !requireUuid(groupId) || !validateName(name)) {
    redirect(masajidPath("invalid"));
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const detail = await loadMasjidSetupDetailData(adminSupabase, masjidId);
  const current = detail?.groupsByCohortId.get(cohortId)?.find((group) => group.id === groupId);

  if (!detail || !current) {
    redirect(masajidPath("not-found"));
  }

  if (current.active && !active && formString(formData, "confirmation_name") !== current.name) {
    redirect(masjidPath(masjidId, "confirmation-mismatch"));
  }

  const { data, error } = await adminSupabase
    .from("halaqa_groups")
    .update({ name, sort_order: sortOrder, active, updated_at: new Date().toISOString() })
    .eq("id", groupId)
    .eq("cohort_id", cohortId)
    .select("id,cohort_id,name,active,sort_order,created_at,updated_at")
    .single<HalaqaGroup>();

  if (error || !data) {
    redirect(masjidPath(masjidId, "save-error"));
  }

  await auditSetupEvent({
    actor,
    adminSupabase,
    action: "group_updated",
    targetTable: "halaqa_groups",
    targetId: groupId,
    targetMasjidId: masjidId,
    beforeData: groupAuditData(current),
    afterData: groupAuditData(data)
  });

  revalidatePath("/super-admin/masajid");
  revalidatePath(`/super-admin/masajid/${masjidId}`);
  redirect(masjidPath(masjidId, "group-updated"));
}

export async function grantMasjidStaffAccess(formData: FormData) {
  const masjidId = formString(formData, "masjid_id");
  const personQuery = formString(formData, "person_query");
  const grant = parseStaffAccessGrant(formData.get("staff_access"));
  const startsOn = formString(formData, "starts_on") || todayDateString();

  if (!requireUuid(masjidId) || !personQuery || !grant || !isValidDateString(startsOn)) {
    redirect(masajidPath("invalid"));
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const detail = await loadMasjidSetupDetailData(adminSupabase, masjidId);

  if (!detail) {
    redirect(masajidPath("not-found"));
  }

  const target = await findActiveProfileForStaffGrant(adminSupabase, personQuery);

  if (!target) {
    redirect(masjidPath(masjidId, "staff-not-found"));
  }

  if (
    formString(formData, "confirmation_masjid") !== detail.masjid.name ||
    formString(formData, "confirmation_name") !== target.name
  ) {
    redirect(masjidPath(masjidId, "confirmation-mismatch"));
  }

  const activeSuperAdminCount = await loadActiveSuperAdminCount(adminSupabase);
  const nextRole = target.role === "super_admin" ? "super_admin" : "admin";

  assertProfileRoleTransition({
    actorId: actor.id,
    targetProfileId: target.id,
    targetRole: target.role,
    targetActive: target.active,
    nextRole,
    nextActive: true,
    activeSuperAdminCount
  });

  try {
    if (target.role !== nextRole || !target.active) {
      const { error: profileError } = await adminSupabase
        .from("profiles")
        .update({ role: nextRole, active: true })
        .eq("id", target.id);

      if (profileError) {
        throw new Error("Unable to update profile role.");
      }

      await auditSetupEvent({
        actor,
        adminSupabase,
        action: "profile_staff_grant_update",
        targetTable: "profiles",
        targetId: target.id,
        targetMasjidId: masjidId,
        beforeData: { role: target.role, active: target.active },
        afterData: { role: nextRole, active: true },
        metadata: { staff_access: grant }
      });
    }

    for (const staffRole of staffRolesForGrant(grant)) {
      const exists = await currentStaffRoleExists({
        adminSupabase,
        profileId: target.id,
        masjidId,
        staffRole,
        startsOn
      });

      if (exists) {
        continue;
      }

      const { data, error } = await adminSupabase
        .from("masjid_staff_memberships")
        .insert({
          profile_id: target.id,
          masjid_id: masjidId,
          staff_role: staffRole,
          active: true,
          starts_on: startsOn,
          created_by: actor.id
        })
        .select("id,profile_id,masjid_id,staff_role,active,starts_on,ends_on,created_by,created_at,updated_at")
        .single<MasjidStaffMembership>();

      if (error || !data) {
        throw new Error("Unable to grant staff access.");
      }

      await auditSetupEvent({
        actor,
        adminSupabase,
        action: "staff_membership_created",
        targetTable: "masjid_staff_memberships",
        targetId: data.id,
        targetMasjidId: masjidId,
        afterData: staffMembershipAuditData(data),
        metadata: { source: "masjid_setup" }
      });
    }
  } catch {
    redirect(masjidPath(masjidId, "save-error"));
  }

  revalidatePath("/super-admin/masajid");
  revalidatePath(`/super-admin/masajid/${masjidId}`);
  revalidatePath("/super-admin/people");
  revalidatePath("/admin");
  revalidatePath("/admin/rotation");
  redirect(masjidPath(masjidId, "staff-granted"));
}
