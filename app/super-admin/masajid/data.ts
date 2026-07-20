import "server-only";
import { buildMasjidSetupWarnings } from "@/lib/super-admin-setup";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { todayDateString } from "@/lib/dates";
import type { Cohort, HalaqaGroup, Masjid, MasjidStaffMembership, Profile } from "@/lib/types";

type AdminSupabaseClient = ReturnType<typeof createSupabaseAdminClient>;

export type MasjidSetupSearchParams = {
  status?: string;
};

export type MasjidSetupStaffMember = Pick<
  MasjidStaffMembership,
  "id" | "profile_id" | "masjid_id" | "staff_role" | "active" | "starts_on" | "ends_on"
> & {
  profile_name: string;
  profile_email: string;
};

export type MasjidSetupListRow = Pick<Masjid, "id" | "name" | "slug" | "active" | "created_at" | "updated_at"> & {
  cohort_count: number;
  active_cohort_count: number;
  group_count: number;
  active_group_count: number;
  active_admin_count: number;
  warnings: string[];
};

export type MasjidSetupDetailData = {
  masjid: Pick<Masjid, "id" | "name" | "slug" | "active" | "created_at" | "updated_at">;
  cohorts: Array<Pick<Cohort, "id" | "masjid_id" | "kind" | "name" | "active" | "sort_order" | "created_at" | "updated_at">>;
  groupsByCohortId: Map<string, Array<Pick<HalaqaGroup, "id" | "cohort_id" | "name" | "active" | "sort_order" | "created_at" | "updated_at">>>;
  staff: MasjidSetupStaffMember[];
  warnings: string[];
};

export const SUPER_ADMIN_MASJID_STATUS_MESSAGES: Record<string, { text: string; className: string }> = {
  created: {
    text: "Masjid setup created.",
    className: "bg-green-50 text-green-800"
  },
  updated: {
    text: "Masjid updated.",
    className: "bg-green-50 text-green-800"
  },
  "cohort-created": {
    text: "Cohort created.",
    className: "bg-green-50 text-green-800"
  },
  "cohort-updated": {
    text: "Cohort updated.",
    className: "bg-green-50 text-green-800"
  },
  "group-created": {
    text: "Group created.",
    className: "bg-green-50 text-green-800"
  },
  "group-updated": {
    text: "Group updated.",
    className: "bg-green-50 text-green-800"
  },
  "staff-granted": {
    text: "Staff access granted.",
    className: "bg-green-50 text-green-800"
  },
  "staff-grant-stale": {
    text: "Staff access changed while this form was open. Review the current access and submit again.",
    className: "bg-amber-50 text-amber-900"
  },
  "staff-grant-uncertain": {
    text: "The database did not confirm whether staff access was granted. Review current access before trying again.",
    className: "bg-amber-50 text-amber-900"
  },
  invalid: {
    text: "Check the submitted setup values and try again.",
    className: "bg-red-50 text-red-700"
  },
  "not-found": {
    text: "The selected setup record was not found.",
    className: "bg-red-50 text-red-700"
  },
  "confirmation-mismatch": {
    text: "Confirmation did not match the required name.",
    className: "bg-red-50 text-red-700"
  },
  "staff-not-found": {
    text: "No active profile matched that email or phone.",
    className: "bg-red-50 text-red-700"
  },
  "save-error": {
    text: "Unable to save setup changes.",
    className: "bg-red-50 text-red-700"
  }
};

function uniq<T>(values: T[]) {
  return [...new Set(values)];
}

function membershipIsCurrent(membership: Pick<MasjidStaffMembership, "active" | "starts_on" | "ends_on">, date: string) {
  return membership.active && membership.starts_on <= date && (!membership.ends_on || membership.ends_on >= date);
}

async function loadProfilesById(adminSupabase: AdminSupabaseClient, profileIds: string[]) {
  const ids = uniq(profileIds).filter(Boolean);

  if (ids.length === 0) {
    return new Map<string, Pick<Profile, "id" | "name" | "email">>();
  }

  const { data, error } = await adminSupabase
    .from("profiles")
    .select("id,name,email")
    .in("id", ids)
    .returns<Array<Pick<Profile, "id" | "name" | "email">>>();

  if (error) {
    throw new Error("Unable to load staff profiles.");
  }

  return new Map((data ?? []).map((profile) => [profile.id, profile]));
}

async function loadCurrentStaffForMasjids(adminSupabase: AdminSupabaseClient, masjidIds: string[]) {
  const ids = uniq(masjidIds).filter(Boolean);

  if (ids.length === 0) {
    return [];
  }

  const today = todayDateString();
  const { data, error } = await adminSupabase
    .from("masjid_staff_memberships")
    .select("id,profile_id,masjid_id,staff_role,active,starts_on,ends_on")
    .in("masjid_id", ids)
    .eq("active", true)
    .lte("starts_on", today)
    .or(`ends_on.is.null,ends_on.gte.${today}`)
    .returns<
      Array<
        Pick<
          MasjidStaffMembership,
          "id" | "profile_id" | "masjid_id" | "staff_role" | "active" | "starts_on" | "ends_on"
        >
      >
    >();

  if (error) {
    throw new Error("Unable to load staff access.");
  }

  const profileById = await loadProfilesById(
    adminSupabase,
    (data ?? []).map((membership) => membership.profile_id)
  );

  return (data ?? []).filter((membership) => membershipIsCurrent(membership, today)).map((membership) => {
    const profile = profileById.get(membership.profile_id);

    return {
      ...membership,
      profile_name: profile?.name ?? "Missing profile",
      profile_email: profile?.email ?? ""
    };
  });
}

export async function loadMasjidSetupListData(adminSupabase: AdminSupabaseClient) {
  const { data: masjids, error: masjidError } = await adminSupabase
    .from("masajid")
    .select("id,name,slug,active,created_at,updated_at")
    .order("name", { ascending: true })
    .returns<Array<Pick<Masjid, "id" | "name" | "slug" | "active" | "created_at" | "updated_at">>>();

  if (masjidError) {
    throw new Error("Unable to load masjid setup.");
  }

  const masjidIds = (masjids ?? []).map((masjid) => masjid.id);
  const { data: cohorts, error: cohortError } = masjidIds.length
    ? await adminSupabase
        .from("cohorts")
        .select("id,masjid_id,kind,name,active,sort_order,created_at,updated_at")
        .in("masjid_id", masjidIds)
        .returns<
          Array<Pick<Cohort, "id" | "masjid_id" | "kind" | "name" | "active" | "sort_order" | "created_at" | "updated_at">>
        >()
    : { data: [], error: null };

  if (cohortError) {
    throw new Error("Unable to load cohort setup.");
  }

  const cohortIds = (cohorts ?? []).map((cohort) => cohort.id);
  const { data: groups, error: groupError } = cohortIds.length
    ? await adminSupabase
        .from("halaqa_groups")
        .select("id,cohort_id,name,active,sort_order,created_at,updated_at")
        .in("cohort_id", cohortIds)
        .returns<Array<Pick<HalaqaGroup, "id" | "cohort_id" | "name" | "active" | "sort_order" | "created_at" | "updated_at">>>()
    : { data: [], error: null };

  if (groupError) {
    throw new Error("Unable to load group setup.");
  }

  const staff = await loadCurrentStaffForMasjids(adminSupabase, masjidIds);
  const cohortsByMasjidId = new Map<string, typeof cohorts>();
  const activeCohortIds = new Set((cohorts ?? []).filter((cohort) => cohort.active).map((cohort) => cohort.id));
  const groupsByMasjidId = new Map<string, typeof groups>();
  const adminCountByMasjidId = new Map<string, number>();

  for (const cohort of cohorts ?? []) {
    cohortsByMasjidId.set(cohort.masjid_id, [...(cohortsByMasjidId.get(cohort.masjid_id) ?? []), cohort]);
  }

  const cohortMasjidById = new Map((cohorts ?? []).map((cohort) => [cohort.id, cohort.masjid_id]));

  for (const group of groups ?? []) {
    const masjidId = cohortMasjidById.get(group.cohort_id);

    if (masjidId) {
      groupsByMasjidId.set(masjidId, [...(groupsByMasjidId.get(masjidId) ?? []), group]);
    }
  }

  for (const membership of staff) {
    if (membership.staff_role === "admin") {
      adminCountByMasjidId.set(membership.masjid_id, (adminCountByMasjidId.get(membership.masjid_id) ?? 0) + 1);
    }
  }

  return (masjids ?? []).map((masjid): MasjidSetupListRow => {
    const masjidCohorts = cohortsByMasjidId.get(masjid.id) ?? [];
    const masjidGroups = groupsByMasjidId.get(masjid.id) ?? [];
    const activeGroupCount = masjidGroups.filter((group) => group.active && activeCohortIds.has(group.cohort_id)).length;
    const activeCohortCount = masjidCohorts.filter((cohort) => cohort.active).length;
    const activeAdminCount = adminCountByMasjidId.get(masjid.id) ?? 0;

    return {
      ...masjid,
      cohort_count: masjidCohorts.length,
      active_cohort_count: activeCohortCount,
      group_count: masjidGroups.length,
      active_group_count: activeGroupCount,
      active_admin_count: activeAdminCount,
      warnings: buildMasjidSetupWarnings({
        active: masjid.active,
        counts: {
          activeCohortCount,
          activeGroupCount,
          activeAdminCount
        }
      })
    };
  });
}

export async function loadMasjidSetupDetailData(
  adminSupabase: AdminSupabaseClient,
  masjidId: string
): Promise<MasjidSetupDetailData | null> {
  const { data: masjid, error: masjidError } = await adminSupabase
    .from("masajid")
    .select("id,name,slug,active,created_at,updated_at")
    .eq("id", masjidId)
    .maybeSingle<Pick<Masjid, "id" | "name" | "slug" | "active" | "created_at" | "updated_at">>();

  if (masjidError) {
    throw new Error("Unable to load masjid setup.");
  }

  if (!masjid) {
    return null;
  }

  const { data: cohorts, error: cohortError } = await adminSupabase
    .from("cohorts")
    .select("id,masjid_id,kind,name,active,sort_order,created_at,updated_at")
    .eq("masjid_id", masjid.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<Array<Pick<Cohort, "id" | "masjid_id" | "kind" | "name" | "active" | "sort_order" | "created_at" | "updated_at">>>();

  if (cohortError) {
    throw new Error("Unable to load cohorts.");
  }

  const cohortIds = (cohorts ?? []).map((cohort) => cohort.id);
  const { data: groups, error: groupError } = cohortIds.length
    ? await adminSupabase
        .from("halaqa_groups")
        .select("id,cohort_id,name,active,sort_order,created_at,updated_at")
        .in("cohort_id", cohortIds)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true })
        .returns<Array<Pick<HalaqaGroup, "id" | "cohort_id" | "name" | "active" | "sort_order" | "created_at" | "updated_at">>>()
    : { data: [], error: null };

  if (groupError) {
    throw new Error("Unable to load groups.");
  }

  const staff = await loadCurrentStaffForMasjids(adminSupabase, [masjid.id]);
  const groupsByCohortId = new Map<string, typeof groups>();

  for (const group of groups ?? []) {
    groupsByCohortId.set(group.cohort_id, [...(groupsByCohortId.get(group.cohort_id) ?? []), group]);
  }

  const activeCohortIds = new Set((cohorts ?? []).filter((cohort) => cohort.active).map((cohort) => cohort.id));
  const activeCohortCount = (cohorts ?? []).filter((cohort) => cohort.active).length;
  const activeGroupCount = (groups ?? []).filter((group) => group.active && activeCohortIds.has(group.cohort_id)).length;
  const activeAdminCount = staff.filter((membership) => membership.staff_role === "admin").length;

  return {
    masjid,
    cohorts: cohorts ?? [],
    groupsByCohortId,
    staff,
    warnings: buildMasjidSetupWarnings({
      active: masjid.active,
      counts: {
        activeCohortCount,
        activeGroupCount,
        activeAdminCount
      }
    })
  };
}

export async function findActiveProfileForStaffGrant(adminSupabase: AdminSupabaseClient, value: string) {
  const normalized = value.trim().toLowerCase();
  const digits = value.replace(/\D/g, "");

  if (!normalized && !digits) {
    return null;
  }

  let query = adminSupabase.from("profiles").select("id,name,email,phone,role,active,created_at").eq("active", true).limit(2);

  if (normalized.includes("@")) {
    query = query.eq("email", normalized);
  } else if (digits) {
    query = query.ilike("phone", `%${digits}%`);
  } else {
    query = query.ilike("name", normalized);
  }

  const { data, error } = await query.returns<Profile[]>();

  if (error) {
    throw new Error("Unable to find staff profile.");
  }

  return data?.length === 1 ? data[0] : null;
}
