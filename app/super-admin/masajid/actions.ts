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
  parseStaffAccessGrant
} from "@/lib/super-admin-setup";
import { requireSuperAdminAdminClient } from "@/lib/super-admin";
import {
  grantMasjidStaffAccessTransactionally,
  masjidStaffGrantPreparationRpcArguments,
  masjidStaffGrantRpcArguments,
  masjidUpdateRpcArguments,
  parseMasjidUpdateState,
  superAdminMutationStatusForOutcome,
  updateMasjidTransactionally,
  type MasjidUpdateResult,
  type MasjidStaffGrantResult,
  type PersonAccessState
} from "@/lib/transactional-workflows";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function masajidPath(status?: string) {
  return status ? `/super-admin/masajid?${new URLSearchParams({ status }).toString()}` : "/super-admin/masajid";
}

function masjidPath(masjidId: string, status?: string, requestId?: string) {
  const searchParams = new URLSearchParams();
  if (status) searchParams.set("status", status);
  if (requestId) searchParams.set("request_id", requestId);

  return searchParams.size > 0
    ? `/super-admin/masajid/${masjidId}?${searchParams.toString()}`
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

type HierarchyOperation = "create_cohort" | "update_cohort" | "create_group" | "update_group";

function parseHierarchyState(value: string, id: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed.id === id ? parsed : null;
  } catch {
    return null;
  }
}

function hierarchyFailureStatus(error: { code?: string | null } | null) {
  if (error?.code === "40001") return "hierarchy-stale";
  if (error?.code === "23514") return "hierarchy-dependencies";
  return "save-error";
}

async function applyHierarchyChange(input: {
  operation: HierarchyOperation;
  requestId: string;
  actorId: string;
  masjidId: string;
  cohortId: string | null;
  groupId: string | null;
  name: string;
  kind: "brothers" | "sisters" | null;
  sortOrder: number;
  active: boolean;
  expectedState: Record<string, unknown> | null;
  adminSupabase: Awaited<ReturnType<typeof requireSuperAdminAdminClient>>["adminSupabase"];
}) {
  return input.adminSupabase.rpc("apply_super_admin_hierarchy_change", {
    input_request_id: input.requestId,
    input_actor_id: input.actorId,
    input_operation: input.operation,
    input_masjid_id: input.masjidId,
    input_cohort_id: input.cohortId,
    input_group_id: input.groupId,
    input_name: input.name,
    input_kind: input.kind,
    input_sort_order: input.sortOrder,
    input_active: input.active,
    input_expected_state: input.expectedState
  });
}

export async function createMasjidSetup(formData: FormData) {
  const requestId = formString(formData, "request_id");
  const name = formString(formData, "name");
  const slug = normalizeMasjidSlug(formString(formData, "slug") || name);
  const cohortName = formString(formData, "cohort_name");
  const cohortKind = parseCohortKind(formData.get("cohort_kind")) ?? "brothers";
  const cohortSortOrder = parsePositiveInteger(formString(formData, "cohort_sort_order"), 1);
  const cohortActive = formBoolean(formData, "cohort_active");
  const groupName = formString(formData, "group_name");
  const groupSortOrder = parsePositiveInteger(formString(formData, "group_sort_order"), 1);
  const groupActive = formBoolean(formData, "group_active");

  if (!requireUuid(requestId) || !validateName(name) || !isValidMasjidSlug(slug)) {
    redirect(masajidPath("invalid"));
  }

  if ((cohortName || groupName) && !validateName(cohortName)) {
    redirect(masajidPath("invalid"));
  }

  if (groupName && !validateName(groupName)) {
    redirect(masajidPath("invalid"));
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const { data, error } = await adminSupabase.rpc("apply_super_admin_masjid_provision", {
    input_request_id: requestId,
    input_actor_id: actor.id,
    input_name: name,
    input_slug: slug,
    input_cohort_name: cohortName,
    input_cohort_kind: cohortKind,
    input_cohort_sort_order: cohortSortOrder,
    input_cohort_active: cohortActive,
    input_group_name: groupName,
    input_group_sort_order: groupSortOrder,
    input_group_active: groupActive
  });
  const result = data as { masjid_id?: unknown } | null;
  const masjidId = typeof result?.masjid_id === "string" ? result.masjid_id : null;

  if (error || !masjidId || !requireUuid(masjidId)) {
    if (error?.code === "23505") {
      redirect(masajidPath("slug-exists"));
    }
    redirect(masajidPath("save-error"));
  }

  revalidatePath("/super-admin");
  revalidatePath("/super-admin/masajid");
  redirect(masjidPath(masjidId, "created"));
}

export async function updateMasjidSetup(formData: FormData) {
  const masjidId = formString(formData, "masjid_id");
  const name = formString(formData, "name");
  const slug = normalizeMasjidSlug(formString(formData, "slug"));
  const active = formBoolean(formData, "active");
  const requestId = formString(formData, "request_id");
  const expectedState = parseMasjidUpdateState(formString(formData, "expected_state"));

  if (
    !requireUuid(masjidId) ||
    !requireUuid(requestId) ||
    !expectedState ||
    expectedState.id !== masjidId ||
    !validateName(name) ||
    !isValidMasjidSlug(slug)
  ) {
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

  const outcome = await updateMasjidTransactionally(
    { requestId, actorId: actor.id, masjidId, name, slug, active, expectedState },
    {
      applyMasjidUpdate: async (input) => {
        const { data, error } = await adminSupabase.rpc(
          "apply_super_admin_masjid_update",
          masjidUpdateRpcArguments(input)
        );
        return { data: data as MasjidUpdateResult | null, error };
      }
    }
  );

  if (!outcome.ok) {
    const baseStatus = superAdminMutationStatusForOutcome(outcome);
    const status = outcome.uncertain
      ? "masjid-update-uncertain"
      : baseStatus === "access-stale"
        ? "masjid-update-stale"
        : outcome.error.code === "23514"
          ? "masjid-coverage-required"
          : "save-error";

    if (outcome.uncertain) {
      console.error("Masjid update requires operator review.", {
        requestId,
        masjidId,
        mutationErrorCode: outcome.error.code ?? null
      });
    }

    redirect(masjidPath(masjidId, status, outcome.uncertain ? requestId : undefined));
  }

  revalidatePath("/super-admin/masajid");
  revalidatePath(`/super-admin/masajid/${masjidId}`);
  redirect(masjidPath(masjidId, "updated"));
}

export async function createCohortSetup(formData: FormData) {
  const requestId = formString(formData, "request_id");
  const masjidId = formString(formData, "masjid_id");
  const name = formString(formData, "name");
  const kind = parseCohortKind(formData.get("kind"));
  const sortOrder = parsePositiveInteger(formString(formData, "sort_order"), 1);
  const active = formBoolean(formData, "active");

  if (!requireUuid(requestId) || !requireUuid(masjidId) || !validateName(name) || !kind) {
    redirect(masajidPath("invalid"));
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const current = await loadMasjidSetupDetailData(adminSupabase, masjidId);

  if (!current) {
    redirect(masajidPath("not-found"));
  }

  const { error } = await applyHierarchyChange({
    operation: "create_cohort",
    requestId,
    actorId: actor.id,
    masjidId,
    cohortId: null,
    groupId: null,
    name,
    kind,
    sortOrder,
    active,
    expectedState: null,
    adminSupabase
  });

  if (error) {
    redirect(masjidPath(masjidId, hierarchyFailureStatus(error)));
  }

  revalidatePath("/super-admin");
  revalidatePath("/super-admin/masajid");
  revalidatePath("/super-admin/repairs");
  revalidatePath(`/super-admin/masajid/${masjidId}`);
  redirect(masjidPath(masjidId, "cohort-created"));
}

export async function updateCohortSetup(formData: FormData) {
  const requestId = formString(formData, "request_id");
  const masjidId = formString(formData, "masjid_id");
  const cohortId = formString(formData, "cohort_id");
  const name = formString(formData, "name");
  const kind = parseCohortKind(formData.get("kind"));
  const sortOrder = parsePositiveInteger(formString(formData, "sort_order"), 1);
  const active = formBoolean(formData, "active");
  const expectedState = parseHierarchyState(formString(formData, "expected_state"), cohortId);

  if (!requireUuid(requestId) || !requireUuid(masjidId) || !requireUuid(cohortId) || !validateName(name) || !kind || !expectedState) {
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

  const { error } = await applyHierarchyChange({
    operation: "update_cohort",
    requestId,
    actorId: actor.id,
    masjidId,
    cohortId,
    groupId: null,
    name,
    kind,
    sortOrder,
    active,
    expectedState,
    adminSupabase
  });

  if (error) {
    redirect(masjidPath(masjidId, hierarchyFailureStatus(error)));
  }

  revalidatePath("/super-admin");
  revalidatePath("/super-admin/masajid");
  revalidatePath("/super-admin/repairs");
  revalidatePath(`/super-admin/masajid/${masjidId}`);
  redirect(masjidPath(masjidId, "cohort-updated"));
}

export async function createGroupSetup(formData: FormData) {
  const requestId = formString(formData, "request_id");
  const masjidId = formString(formData, "masjid_id");
  const cohortId = formString(formData, "cohort_id");
  const name = formString(formData, "name");
  const sortOrder = parsePositiveInteger(formString(formData, "sort_order"), 1);
  const active = formBoolean(formData, "active");

  if (!requireUuid(requestId) || !requireUuid(masjidId) || !requireUuid(cohortId) || !validateName(name)) {
    redirect(masajidPath("invalid"));
  }

  const { profile: actor, adminSupabase } = await requireSuperAdminAdminClient();
  const detail = await loadMasjidSetupDetailData(adminSupabase, masjidId);

  if (!detail?.cohorts.some((cohort) => cohort.id === cohortId)) {
    redirect(masajidPath("not-found"));
  }

  const { error } = await applyHierarchyChange({
    operation: "create_group",
    requestId,
    actorId: actor.id,
    masjidId,
    cohortId,
    groupId: null,
    name,
    kind: null,
    sortOrder,
    active,
    expectedState: null,
    adminSupabase
  });

  if (error) {
    redirect(masjidPath(masjidId, hierarchyFailureStatus(error)));
  }

  revalidatePath("/super-admin");
  revalidatePath("/super-admin/masajid");
  revalidatePath("/super-admin/repairs");
  revalidatePath(`/super-admin/masajid/${masjidId}`);
  redirect(masjidPath(masjidId, "group-created"));
}

export async function updateGroupSetup(formData: FormData) {
  const requestId = formString(formData, "request_id");
  const masjidId = formString(formData, "masjid_id");
  const cohortId = formString(formData, "cohort_id");
  const groupId = formString(formData, "group_id");
  const name = formString(formData, "name");
  const sortOrder = parsePositiveInteger(formString(formData, "sort_order"), 1);
  const active = formBoolean(formData, "active");
  const expectedState = parseHierarchyState(formString(formData, "expected_state"), groupId);

  if (!requireUuid(requestId) || !requireUuid(masjidId) || !requireUuid(cohortId) || !requireUuid(groupId) || !validateName(name) || !expectedState) {
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

  const { error } = await applyHierarchyChange({
    operation: "update_group",
    requestId,
    actorId: actor.id,
    masjidId,
    cohortId,
    groupId,
    name,
    kind: null,
    sortOrder,
    active,
    expectedState,
    adminSupabase
  });

  if (error) {
    redirect(masjidPath(masjidId, hierarchyFailureStatus(error)));
  }

  revalidatePath("/super-admin");
  revalidatePath("/super-admin/masajid");
  revalidatePath("/super-admin/repairs");
  revalidatePath(`/super-admin/masajid/${masjidId}`);
  redirect(masjidPath(masjidId, "group-updated"));
}

export async function grantMasjidStaffAccess(formData: FormData) {
  const masjidId = formString(formData, "masjid_id");
  const personQuery = formString(formData, "person_query");
  const grant = parseStaffAccessGrant(formData.get("staff_access"));
  const startsOn = formString(formData, "starts_on") || todayDateString();
  const requestId = formString(formData, "request_id");

  if (!requireUuid(masjidId) || !personQuery || !grant || !isValidDateString(startsOn) || !requireUuid(requestId)) {
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

  const outcome = await grantMasjidStaffAccessTransactionally(
    {
      requestId,
      actorId: actor.id,
      targetProfileId: target.id,
      masjidId,
      grant,
      startsOn
    },
    {
      prepareExpectedState: async (input) => {
        const { data, error } = await adminSupabase.rpc(
          "prepare_super_admin_masjid_staff_grant",
          masjidStaffGrantPreparationRpcArguments(input)
        );
        return { data: data as PersonAccessState | null, error };
      },
      applyStaffGrant: async (input, expectedState) => {
        const { data, error } = await adminSupabase.rpc(
          "apply_super_admin_masjid_staff_grant",
          masjidStaffGrantRpcArguments(input, expectedState)
        );
        return { data: data as MasjidStaffGrantResult | null, error };
      }
    }
  );

  if (!outcome.ok) {
    const status = outcome.uncertain
      ? "staff-grant-uncertain"
      : superAdminMutationStatusForOutcome(outcome) === "access-stale"
        ? "staff-grant-stale"
        : "save-error";

    if (outcome.uncertain) {
      console.error("Masjid staff grant requires operator review.", {
        requestId,
        targetProfileId: target.id,
        masjidId,
        mutationErrorCode: outcome.error.code ?? null
      });
    }

    redirect(masjidPath(masjidId, status));
  }

  revalidatePath("/super-admin/masajid");
  revalidatePath(`/super-admin/masajid/${masjidId}`);
  revalidatePath("/super-admin/people");
  revalidatePath("/admin");
  revalidatePath("/admin/rotation");
  redirect(masjidPath(masjidId, "staff-granted"));
}
