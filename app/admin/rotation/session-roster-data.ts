import "server-only";

import { assertAdminCanManageCohort } from "@/lib/admin-scope";
import type {
  SessionRosterHistoryResponse,
  SessionRosterPublishedResponse,
  SessionRosterWizardDraftResponse,
  SessionRosterWizardLegacyTransitionPreviewResponse
} from "@/lib/session-roster";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { Profile } from "@/lib/types";
import type { RotationContext } from "./data";

export type SessionRosterWizardPageData = {
  draft: SessionRosterWizardDraftResponse | null;
  published: SessionRosterPublishedResponse;
  history: SessionRosterHistoryResponse;
  legacyTransition: SessionRosterWizardLegacyTransitionPreviewResponse | null;
  actorNames: Record<string, string>;
};

function responseOrThrow<T>(data: T | null, error: { message: string } | null, message: string) {
  if (error || !data) throw new Error(error?.message || message);
  return data;
}

export async function loadSessionRosterPageData(input: {
  context: RotationContext;
  profile: Pick<Profile, "id" | "role">;
  weekStart: string;
}): Promise<SessionRosterWizardPageData> {
  const adminSupabase = createSupabaseAdminClient();
  const cohort = await assertAdminCanManageCohort({
    adminSupabase,
    admin: input.profile,
    cohortId: input.context.cohort.id
  });

  if (cohort.masjid_id !== input.context.masjid.id) {
    throw new Error("Session roster scope does not match the selected masjid.");
  }

  const [publishedResult, historyResult, legacyResult] = await Promise.all([
    adminSupabase.rpc("get_current_session_roster", {
      input_actor_id: input.profile.id,
      input_cohort_id: input.context.cohort.id,
      input_week_start: input.weekStart
    }),
    adminSupabase.rpc("get_session_roster_history", {
      input_actor_id: input.profile.id,
      input_cohort_id: input.context.cohort.id,
      input_week_start: input.weekStart
    }),
    adminSupabase.rpc("preview_session_roster_wizard_legacy_transition", {
      input_actor_id: input.profile.id,
      input_cohort_id: input.context.cohort.id,
      input_week_start: input.weekStart
    })
  ]);
  const published = responseOrThrow(
    publishedResult.data as SessionRosterPublishedResponse | null,
    publishedResult.error,
    "Unable to load the live Saturday roster."
  );
  const history = responseOrThrow(
    historyResult.data as SessionRosterHistoryResponse | null,
    historyResult.error,
    "Unable to load Saturday roster history."
  );
  const legacyTransition = responseOrThrow(
    legacyResult.data as SessionRosterWizardLegacyTransitionPreviewResponse | null,
    legacyResult.error,
    "Unable to inspect legacy roster recovery."
  );

  let draft: SessionRosterWizardDraftResponse | null = null;
  const draftIds = [...new Set(history.audit_events.map((event) => event.draft_id).filter(Boolean))] as string[];

  for (const draftId of draftIds) {
    const result = await adminSupabase.rpc("get_session_roster_draft", {
      input_actor_id: input.profile.id,
      input_draft_id: draftId
    });
    if (!result.error && result.data) {
      const candidate = result.data as SessionRosterWizardDraftResponse;
      if (candidate.contract_version === 2 && candidate.draft.status === "draft" && candidate.draft.wizard_mode === "teacher_driven") {
        draft = candidate;
        break;
      }
    }
  }

  if (!draft && !published.version && !legacyTransition.blocking_legacy_draft) {
    const result = await adminSupabase.rpc("load_or_create_session_roster_wizard_draft", {
      input_request_id: crypto.randomUUID(),
      input_actor_id: input.profile.id,
      input_cohort_id: input.context.cohort.id,
      input_week_start: input.weekStart
    });
    draft = responseOrThrow(
      result.data as SessionRosterWizardDraftResponse | null,
      result.error,
      "Unable to prepare the Saturday roster wizard."
    );
  }

  const actorIds = [...new Set([
    ...history.audit_events.map((event) => event.actor_id),
    ...history.versions.map((version) => version.published_by)
  ])];
  const actorNames: Record<string, string> = {};
  if (actorIds.length) {
    const { data: actors, error } = await adminSupabase
      .from("profiles")
      .select("id,name")
      .in("id", actorIds)
      .returns<Array<Pick<Profile, "id" | "name">>>();
    if (error) throw new Error("Unable to load roster audit actors.");
    for (const actor of actors ?? []) actorNames[actor.id] = actor.name;
  }

  return { draft, published, history, legacyTransition, actorNames };
}
