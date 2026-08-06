"use client";

import {
  CheckCircle,
  Info,
  Warning,
  ArrowRight,
  ArrowsClockwise,
  LockKey
} from "@phosphor-icons/react";
import { useState, useTransition } from "react";
import {
  assignSessionRosterPrimaryTeacher,
  createSessionRosterRevision,
  moveSessionRosterStudent,
  publishSessionRosterDraft,
  refreshSessionRosterDraft,
  reviewSessionRosterDraft
} from "@/app/admin/rotation/actions";
import { RotationAvailabilityProvider } from "@/app/admin/rotation/availability-state";
import TeacherAvailabilityForm from "@/app/admin/rotation/teacher-availability-form";
import type { RotationTeacherRow } from "@/app/admin/rotation/data";
import { formatDateTimeInAppTimeZone } from "@/lib/dates";
import type {
  RefreshSessionRosterDraftResponse,
  SessionRosterDraftResponse,
  SessionRosterHistoryResponse,
  SessionRosterPublishedResponse
} from "@/lib/session-roster";
import {
  sessionRosterActionError,
  sessionRosterAuditLabel,
  sessionRosterPublishBlocked,
  sessionRosterReadinessSummary
} from "@/lib/session-roster-ui";
import { focusRotationSection } from "@/lib/rotation-workflow";

type Props = {
  actorNames: Record<string, string>;
  cohortId: string;
  initialDraft: SessionRosterDraftResponse | null;
  initialHistory: SessionRosterHistoryResponse;
  initialPublished: SessionRosterPublishedResponse;
  masjidId: string;
  teachers: RotationTeacherRow[];
  weekStart: string;
};

type Notice = { tone: "success" | "warning" | "error"; text: string } | null;

function actionClass(tone: "success" | "warning" | "error") {
  return tone === "success"
    ? "border-green-300 bg-green-50 text-green-900"
    : tone === "warning"
      ? "border-amber-300 bg-amber-50 text-amber-950"
      : "border-red-300 bg-red-50 text-red-800";
}

function actorName(actorId: string, names: Record<string, string>) {
  return names[actorId] ?? "Scoped admin";
}

export default function SessionRosterEditor({
  actorNames,
  cohortId,
  initialDraft,
  initialHistory,
  initialPublished,
  masjidId,
  teachers,
  weekStart
}: Props) {
  const [draft, setDraft] = useState(initialDraft);
  const [history, setHistory] = useState(initialHistory);
  const [published, setPublished] = useState(initialPublished);
  const [notice, setNotice] = useState<Notice>(null);
  const [isPending, startTransition] = useTransition();
  const [showRefreshConfirmation, setShowRefreshConfirmation] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const scope = { masjidId, cohortId, weekStart };

  const applyDraftResult = (result: {
    ok: boolean;
    data?: SessionRosterDraftResponse;
    history?: SessionRosterHistoryResponse;
    published?: SessionRosterPublishedResponse;
    error?: string;
    message?: string;
  }) => {
    if (!result.ok || !result.data || !result.history || !result.published) {
      const kind = result.error ? sessionRosterActionError(result.message ?? "") : "failed";
      setNotice({
        tone: kind === "stale" || kind === "conflict" ? "warning" : "error",
        text: kind === "stale" || kind === "conflict"
          ? "The roster changed in another session. Reload the current server state before continuing."
          : result.message ?? "Unable to update the session roster."
      });
      return;
    }

    setDraft(result.data);
    setHistory(result.history);
    setPublished(result.published);
  };

  const applySessionActionFailure = (result: {
    ok: boolean;
    error?: string;
    message?: string;
  }) => {
    if (result.ok) return;
    const kind = result.error ? sessionRosterActionError(result.message ?? "") : "failed";
    setNotice({
      tone: kind === "stale" || kind === "conflict" ? "warning" : "error",
      text: kind === "stale" || kind === "conflict"
        ? "The roster changed in another session. Reload the current server state before continuing."
        : result.message ?? "Unable to update the session roster."
    });
  };

  function moveStudent(studentId: string, sessionGroupId: string | null) {
    if (!draft) return;
    const expectedStateVersion = draft.draft.state_version;
    startTransition(async () => {
      const result = await moveSessionRosterStudent({
        ...scope,
        draftId: draft.draft.id,
        studentId,
        sessionGroupId,
        expectedStateVersion
      });
      applyDraftResult(result);
    });
  }

  function assignTeacher(groupId: string, primaryTeacherId: string | null) {
    if (!draft) return;
    const expectedStateVersion = draft.draft.state_version;
    startTransition(async () => {
      const result = await assignSessionRosterPrimaryTeacher({
        ...scope,
        draftId: draft.draft.id,
        groupId,
        primaryTeacherId,
        expectedStateVersion
      });
      applyDraftResult(result);
    });
  }

  function reviewDraft() {
    if (!draft) return;
    const expectedStateVersion = draft.draft.state_version;
    startTransition(async () => {
      const result = await reviewSessionRosterDraft({ ...scope, draftId: draft.draft.id, expectedStateVersion });
      applyDraftResult(result);
      if (result.ok) setNotice({ tone: "success", text: "Draft reviewed against the current Saturday source." });
    });
  }

  function publishDraft() {
    if (!draft) return;
    const expectedStateVersion = draft.draft.state_version;
    startTransition(async () => {
      const result = await publishSessionRosterDraft({ ...scope, draftId: draft.draft.id, expectedStateVersion });
      if (!result.ok || !result.data || !result.history || !result.published) {
        applySessionActionFailure(result);
        return;
      }
      setDraft(null);
      setPublished(result.data);
      setHistory(result.history);
      setNotice({ tone: "success", text: `Saturday roster version ${result.data.version?.version_number ?? ""} is now live.` });
    });
  }

  function createRevision() {
    if (!published.version) return;
    const expectedPublishedVersionId = published.version.id;
    startTransition(async () => {
      const result = await createSessionRosterRevision({
        ...scope,
        expectedPublishedVersionId
      });
      applyDraftResult(result);
      if (result.ok) {
        setNotice({ tone: "success", text: "Revision draft opened. The published Saturday roster remains live." });
        focusRotationSection(document, "session-group-setup");
      }
    });
  }

  function refreshStaleDraft() {
    if (!draft || !confirmDiscard) return;
    const oldDraftId = draft.draft.id;
    startTransition(async () => {
      const result = await refreshSessionRosterDraft({
        ...scope,
        draftId: oldDraftId,
        expectedStateVersion: draft.draft.state_version,
        expectedSourceStateDigest: draft.draft.source_state_digest,
        expectedPublishedVersionId: published.version?.id ?? null,
        confirmDiscardChanges: true
      });
      if (!result.ok || !result.data || !result.history || !result.published) {
        applyDraftResult(result);
        return;
      }
      const refreshed = result.data as RefreshSessionRosterDraftResponse;
      setDraft(refreshed);
      setHistory(result.history);
      setPublished(result.published);
      setShowRefreshConfirmation(false);
      setConfirmDiscard(false);
      setNotice({
        tone: "success",
        text: "Draft refreshed. Unpublished placement and primary-teacher edits were discarded; review is required again."
      });
    });
  }

  const readiness = draft?.readiness;
  const groupCountById = new Map(readiness?.group_counts.map((group) => [group.group_id, group]) ?? []);
  const availableTeachers = teachers.filter((teacher) => teacher.available);
  const draftIsStale = Boolean(draft?.draft.source_stale || readiness?.source_stale);
  const liveLabel = published.version ? `Version ${published.version.version_number} remains live` : null;

  return (
    <RotationAvailabilityProvider initialAvailableTeacherIds={teachers.filter((teacher) => teacher.available).map((teacher) => teacher.id)}>
      {notice ? (
        <div aria-live="polite" className={`mt-5 border-l-4 px-4 py-3 text-sm ${actionClass(notice.tone)}`} role="status">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{notice.text}</span>
            {(notice.tone === "warning" || notice.tone === "error") ? (
              <button className="min-h-11 rounded-md border border-current px-3 text-sm font-medium" onClick={() => window.location.reload()} type="button">
                Reload current state
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {liveLabel ? (
        <p className="mt-5 flex items-center gap-2 border-l-4 border-green-600 bg-green-50 px-4 py-3 text-sm text-green-900">
          <LockKey aria-hidden="true" className="size-5" /> {liveLabel}; changes below are not live until published.
        </p>
      ) : null}

      <section className="scroll-mt-6 border-y border-stone-200 bg-white px-4 py-5 sm:mt-6 sm:rounded-lg sm:border sm:p-6" id="session-group-setup" tabIndex={-1}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-moss">Step 2</p>
            <h2 className="mt-1 text-lg font-semibold text-ink">Session group setup</h2>
            <p className="mt-1 text-sm text-stone-600">Place attending students for this Saturday only. Usual group memberships stay unchanged.</p>
          </div>
          {draft ? <span className="rounded border border-stone-300 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-700">Draft revision {draft.draft.revision_number}</span> : null}
        </div>

        {draft ? (
          <>
            <p className="mt-4 flex items-start gap-2 border border-green-200 bg-green-50/60 px-3 py-3 text-sm text-moss">
              <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              Session placements apply only to this Saturday. They never change permanent memberships or history.
            </p>
            {draftIsStale ? (
              <div className="mt-4 border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950">
                <div className="flex items-start gap-3">
                  <Warning aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-amber-700" />
                  <div>
                    <p className="font-semibold">This draft is out of date</p>
                    <p className="mt-1">Availability or another source changed. Refreshing replaces this draft and discards all unpublished manual placement and primary-teacher responsibility edits.</p>
                    {!showRefreshConfirmation ? (
                      <button className="mt-3 min-h-11 rounded-md border border-amber-500 bg-white px-4 text-sm font-medium text-amber-900" onClick={() => setShowRefreshConfirmation(true)} type="button">
                        Refresh stale draft
                      </button>
                    ) : (
                      <div className="mt-3 border-t border-amber-200 pt-3">
                        <label className="flex items-start gap-3">
                          <input checked={confirmDiscard} className="mt-1 size-4" onChange={(event) => setConfirmDiscard(event.target.checked)} type="checkbox" />
                          <span>I understand that unpublished placements and primary teacher assignments will be discarded.</span>
                        </label>
                        <div className="mt-3 flex flex-wrap gap-3">
                          <button className="min-h-11 rounded-md bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={!confirmDiscard || isPending} onClick={refreshStaleDraft} type="button">
                            {isPending ? "Refreshing…" : "Confirm refresh"}
                          </button>
                          <button className="min-h-11 rounded-md border border-amber-400 bg-white px-4 text-sm font-medium" onClick={() => { setShowRefreshConfirmation(false); setConfirmDiscard(false); }} type="button">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-5 overflow-x-auto border-y border-stone-200">
              <table className="min-w-[760px] w-full divide-y divide-stone-200 text-sm">
                <caption className="caption-top pb-2 text-left text-sm font-semibold text-ink">Group readiness</caption>
                <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-600"><tr><th className="px-3 py-3">Session group</th><th className="px-3 py-3">Students</th><th className="px-3 py-3">Primary teacher</th><th className="px-3 py-3">Readiness</th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {draft.groups.map((group) => {
                    const count = groupCountById.get(group.group_id);
                    const missing = readiness?.missing_primary_teachers.some((entry) => entry.group_id === group.group_id);
                    return <tr key={group.group_id}><td className="px-3 py-3 font-medium text-ink">{group.group_name}</td><td className="px-3 py-3 text-stone-700">{count?.attending_count ?? 0}</td><td className="px-3 py-3 text-stone-700">{group.primary_teacher_name ?? "Unassigned"}</td><td className={`px-3 py-3 font-medium ${missing ? "text-amber-800" : "text-moss"}`}>{missing ? "Needs primary teacher" : "Ready"}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
            {readiness?.warning_codes.includes("group_imbalance") ? <p className="mt-3 border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950">Group sizes are imbalanced. This is a warning only and does not prevent publication.</p> : null}

            <div className="mt-6 flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-base font-semibold text-ink">Manual redistribution</h3><p className="mt-1 text-sm text-stone-600">Only attending students are shown.</p></div><p className={`rounded border px-3 py-2 text-sm font-medium ${readiness?.unplaced_count ? "border-amber-300 bg-amber-50 text-amber-900" : "border-green-300 bg-green-50 text-moss"}`}>{readiness?.unplaced_count ?? 0} unplaced</p></div>
            <div className="mt-3 overflow-x-auto border-y border-stone-200">
              <table className="min-w-[780px] w-full divide-y divide-stone-200 text-sm">
                <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-600"><tr><th className="px-3 py-3">Student</th><th className="px-3 py-3">Usual group</th><th className="px-3 py-3">This Saturday&apos;s session group</th><th className="px-3 py-3">Placement</th><th className="px-3 py-3">Updated</th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {draft.students.filter((student) => student.attendance_status === "attending").map((student) => {
                    const moved = student.session_group_id && student.session_group_id !== student.usual_group_id;
                    return <tr className={moved ? "bg-amber-50/50" : "bg-white"} key={student.student_id}><td className="px-3 py-3 font-medium text-ink">{student.student_name}</td><td className="px-3 py-3 text-stone-600">{student.usual_group_name}</td><td className="px-3 py-2"><label className="sr-only" htmlFor={`session-group-${student.student_id}`}>Session group for {student.student_name}</label><select className="min-h-11 w-full rounded-md border border-stone-300 bg-white px-2 text-sm disabled:bg-stone-100" disabled={draftIsStale || isPending} id={`session-group-${student.student_id}`} onChange={(event) => moveStudent(student.student_id, event.target.value || null)} value={student.session_group_id ?? ""}><option value="">Unplaced</option>{draft.groups.map((group) => <option key={group.group_id} value={group.group_id}>{group.group_name}</option>)}</select></td><td className="px-3 py-3">{moved ? <span className="rounded border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-amber-800">Moved</span> : <span className="text-stone-500">Usual group</span>}</td><td className="whitespace-nowrap px-3 py-3 text-stone-500">{student.placed_at ? formatDateTimeInAppTimeZone(student.placed_at) : "—"}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end"><button className="min-h-11 rounded-md bg-moss px-4 text-sm font-medium text-white hover:bg-ink" onClick={() => focusRotationSection(document, "teacher-responsibilities")} type="button">Continue to teacher responsibilities <ArrowRight aria-hidden="true" className="ml-1 inline size-4" /></button></div>
          </>
        ) : <PublishedSetupNotice published={published} onRevise={createRevision} pending={isPending} />}
      </section>

      <section className="scroll-mt-6 border-y border-stone-200 bg-white px-4 py-5 sm:mt-6 sm:rounded-lg sm:border sm:p-6" id="teacher-responsibilities" tabIndex={-1}>
        <div><p className="text-xs font-semibold uppercase text-moss">Step 3</p><h2 className="mt-1 text-lg font-semibold text-ink">Teacher availability &amp; responsibilities</h2><p className="mt-1 text-sm text-stone-600">Availability applies only to this cohort and Saturday. Assign a primary teacher for every session group.</p></div>
        <TeacherAvailabilityForm cohortId={cohortId} masjidId={masjidId} teachers={teachers} weekStart={weekStart} />
        {draft ? <div className="mt-6 border-t border-stone-200 pt-5"><h3 className="text-base font-semibold text-ink">Primary responsibilities</h3><p className="mt-1 text-sm text-stone-600">Only teachers marked available above may be assigned.</p><div className="mt-3 overflow-x-auto border-y border-stone-200"><table className="min-w-[680px] w-full divide-y divide-stone-200 text-sm"><thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-600"><tr><th className="px-3 py-3">Session group</th><th className="px-3 py-3">Attending students</th><th className="px-3 py-3">Primary responsible teacher</th></tr></thead><tbody className="divide-y divide-stone-100">{draft.groups.map((group) => <tr key={group.group_id}><td className="px-3 py-3 font-medium text-ink">{group.group_name}</td><td className="px-3 py-3 text-stone-700">{groupCountById.get(group.group_id)?.attending_count ?? 0}</td><td className="px-3 py-2"><label className="sr-only" htmlFor={`teacher-${group.group_id}`}>Primary teacher for {group.group_name}</label><select className="min-h-11 w-full rounded-md border border-stone-300 bg-white px-2 text-sm disabled:bg-stone-100" disabled={draftIsStale || isPending} id={`teacher-${group.group_id}`} onChange={(event) => assignTeacher(group.group_id, event.target.value || null)} value={group.primary_teacher_id ?? ""}><option value="">Choose a primary teacher</option>{availableTeachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></td></tr>)}</tbody></table></div><div className="mt-4 flex justify-end"><button className="min-h-11 rounded-md bg-moss px-4 text-sm font-medium text-white hover:bg-ink" onClick={() => focusRotationSection(document, "assignment-review")} type="button">Continue to review &amp; publish <ArrowRight aria-hidden="true" className="ml-1 inline size-4" /></button></div></div> : null}
      </section>

      <section className="scroll-mt-6 border-y border-stone-200 bg-white px-4 py-5 sm:mt-6 sm:rounded-lg sm:border sm:p-6" id="assignment-review" tabIndex={-1}>
        {draft && readiness ? <DraftReview draft={draft} history={history} actorNames={actorNames} onPublish={publishDraft} onReview={reviewDraft} pending={isPending} published={published} /> : <PublishedReview history={history} actorNames={actorNames} published={published} onRevise={createRevision} pending={isPending} />}
      </section>
    </RotationAvailabilityProvider>
  );
}

function PublishedSetupNotice({ published, onRevise, pending }: { published: SessionRosterPublishedResponse; onRevise: () => void; pending: boolean }) {
  return <div className="mt-5 border border-green-200 bg-green-50 px-4 py-4 text-sm text-green-900"><p className="font-semibold">Saturday roster version {published.version?.version_number ?? ""} is live and read-only.</p><p className="mt-1">Open a revision to make a new draft; the live version stays in place until another version is published.</p><button className="mt-3 min-h-11 rounded-md border border-green-700 bg-white px-4 text-sm font-medium" disabled={pending || !published.version} onClick={onRevise} type="button">Revise this Saturday</button></div>;
}

function DraftReview({ draft, history, onPublish, onReview, pending, published }: { draft: SessionRosterDraftResponse; history: SessionRosterHistoryResponse; actorNames: Record<string, string>; onPublish: () => void; onReview: () => void; pending: boolean; published: SessionRosterPublishedResponse }) {
  const readiness = draft.readiness;
  const blocked = sessionRosterPublishBlocked(readiness);
  return <><div><p className="text-xs font-semibold uppercase text-moss">Step 4</p><h2 className="mt-1 text-lg font-semibold text-ink">{published.version ? "Review revision" : "Review & publish"}</h2><p className="mt-1 text-sm text-stone-600">Confirm student availability, session placements, and primary teacher responsibilities together.</p></div><p className={`mt-4 flex items-start gap-2 border px-3 py-3 text-sm ${readiness.can_publish ? "border-green-300 bg-green-50 text-green-900" : "border-amber-300 bg-amber-50 text-amber-950"}`}>{readiness.can_publish ? <CheckCircle aria-hidden="true" className="mt-0.5 size-5" /> : <Warning aria-hidden="true" className="mt-0.5 size-5" />}<span>{sessionRosterReadinessSummary(readiness)}</span></p><div className="mt-5 grid gap-4 lg:grid-cols-3"><Metric label="Attending" value={readiness.attending_count} /><Metric label="Absent" value={readiness.unavailable_count} /><Metric label="Unplaced" value={readiness.unplaced_count} /></div><ReviewTables draft={draft} /><p className="mt-5 flex items-start gap-2 border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-900"><LockKey aria-hidden="true" className="mt-0.5 size-5 shrink-0" />Publishing is atomic: availability, session groups, and primary responsibilities are saved as one historical Saturday version.</p><p className="mt-3 text-xs text-stone-500">Draft revision {draft.draft.revision_number} · last updated {formatDateTimeInAppTimeZone(draft.draft.updated_at)} · {history.audit_events.length} audit events</p><div className="mt-5 flex flex-wrap justify-end gap-3"><button className="min-h-11 rounded-md border border-stone-300 bg-white px-4 text-sm font-medium text-ink" disabled={pending || readiness.source_stale} onClick={onReview} type="button">{readiness.reviewed_current ? "Review again" : "Review draft"}</button><button className="min-h-11 rounded-md bg-moss px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={pending || blocked} onClick={onPublish} type="button">{pending ? "Saving…" : "Publish Saturday roster"}</button></div>{readiness.warning_codes.includes("group_imbalance") ? <p className="mt-3 text-sm text-amber-800">Imbalance is a warning only; publication remains available once blockers are resolved and this draft is reviewed.</p> : null}</>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="border border-stone-200 bg-stone-50 px-4 py-3"><p className="text-xs font-semibold uppercase text-stone-500">{label}</p><p className="mt-1 text-2xl font-semibold text-ink">{value}</p></div>; }

function ReviewTables({ draft }: { draft: SessionRosterDraftResponse }) {
  const counts = new Map(draft.readiness.group_counts.map((group) => [group.group_id, group]));
  return <div className="mt-5 space-y-5"><div className="overflow-x-auto border-y border-stone-200"><table className="min-w-[680px] w-full divide-y divide-stone-200 text-sm"><caption className="caption-top pb-2 text-left text-base font-semibold text-ink">Session groups</caption><thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-600"><tr><th className="px-3 py-3">Group</th><th className="px-3 py-3">Students</th><th className="px-3 py-3">Changes from usual</th><th className="px-3 py-3">Primary teacher</th></tr></thead><tbody className="divide-y divide-stone-100">{draft.groups.map((group) => { const moved = draft.students.filter((student) => student.session_group_id === group.group_id && student.session_group_id !== student.usual_group_id); return <tr key={group.group_id}><td className="px-3 py-3 font-medium text-ink">{group.group_name}</td><td className="px-3 py-3">{counts.get(group.group_id)?.attending_count ?? 0}</td><td className="px-3 py-3 text-stone-600">{moved.length ? `${moved.map((student) => student.student_name).join(", ")} moved in` : "No changes"}</td><td className="px-3 py-3">{group.primary_teacher_name ?? "Unassigned"}</td></tr>; })}</tbody></table></div><div className="overflow-x-auto border-y border-stone-200"><table className="min-w-[620px] w-full divide-y divide-stone-200 text-sm"><caption className="caption-top pb-2 text-left text-base font-semibold text-ink">Student availability</caption><thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-600"><tr><th className="px-3 py-3">Student</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Reason</th></tr></thead><tbody className="divide-y divide-stone-100">{draft.students.filter((student) => student.attendance_status === "unavailable").map((student) => <tr key={student.student_id}><td className="px-3 py-3 font-medium text-ink">{student.student_name}</td><td className="px-3 py-3 text-red-700">Absent</td><td className="px-3 py-3 text-stone-600">{student.unavailable_reason ?? "—"}</td></tr>)}{draft.readiness.unavailable_count === 0 ? <tr><td className="px-3 py-3 text-stone-600" colSpan={3}>All students are attending.</td></tr> : null}</tbody></table></div></div>;
}

function PublishedReview({ history, actorNames, published, onRevise, pending }: { history: SessionRosterHistoryResponse; actorNames: Record<string, string>; published: SessionRosterPublishedResponse; onRevise: () => void; pending: boolean }) {
  if (!published.version) return <p className="text-sm text-stone-600">Prepare the session roster above before reviewing it.</p>;
  const countByGroup = new Map<string, number>(); for (const student of published.roster) countByGroup.set(student.session_group_id, (countByGroup.get(student.session_group_id) ?? 0) + 1);
  return <><div><p className="text-xs font-semibold uppercase text-moss">Step 4</p><h2 className="mt-1 text-lg font-semibold text-ink">Saturday rotation published</h2><p className="mt-1 text-sm text-stone-600">The live plan for this Saturday is read-only.</p></div><p className="mt-4 flex items-center gap-2 border border-green-300 bg-green-50 px-3 py-3 text-sm text-green-900"><CheckCircle aria-hidden="true" className="size-5" />Published version {published.version.version_number} by {actorName(published.version.published_by, actorNames)} · {formatDateTimeInAppTimeZone(published.version.published_at)}</p><div className="mt-5 overflow-x-auto border-y border-stone-200"><table className="min-w-[700px] w-full divide-y divide-stone-200 text-sm"><thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-600"><tr><th className="px-3 py-3">Session group</th><th className="px-3 py-3">Students</th><th className="px-3 py-3">Teacher responsibility</th><th className="px-3 py-3">Status</th></tr></thead><tbody className="divide-y divide-stone-100">{published.groups.map((group) => <tr key={group.group_id}><td className="px-3 py-3 font-medium text-ink">{group.group_name}</td><td className="px-3 py-3">{countByGroup.get(group.group_id) ?? 0}</td><td className="px-3 py-3">{group.primary_teacher_name ?? "—"}</td><td className="px-3 py-3 text-moss"><LockKey aria-hidden="true" className="mr-1 inline size-4" />Published</td></tr>)}</tbody></table></div><AuditTable history={history} actorNames={actorNames} /><p className="mt-4 flex items-start gap-2 border border-stone-200 bg-stone-50 px-3 py-3 text-sm text-stone-700"><Info aria-hidden="true" className="mt-0.5 size-5 shrink-0" />Permanent student group memberships were not changed.</p><div className="mt-5 flex justify-end"><button className="min-h-11 rounded-md border border-stone-300 bg-white px-4 text-sm font-medium text-ink" disabled={pending} onClick={onRevise} type="button"><ArrowsClockwise aria-hidden="true" className="mr-1 inline size-4" />Revise this Saturday</button></div></>;
}

function AuditTable({ history, actorNames }: { history: SessionRosterHistoryResponse; actorNames: Record<string, string> }) { return <div className="mt-5 overflow-x-auto border-y border-stone-200"><table className="min-w-[660px] w-full divide-y divide-stone-200 text-sm"><caption className="caption-top pb-2 text-left text-base font-semibold text-ink">Publication audit</caption><thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-600"><tr><th className="px-3 py-3">Time</th><th className="px-3 py-3">Action</th><th className="px-3 py-3">Actor</th><th className="px-3 py-3">Reference</th></tr></thead><tbody className="divide-y divide-stone-100">{history.audit_events.map((event) => <tr key={event.id}><td className="whitespace-nowrap px-3 py-3 text-stone-600">{formatDateTimeInAppTimeZone(event.occurred_at)}</td><td className="px-3 py-3 font-medium text-ink">{sessionRosterAuditLabel(event.action)}</td><td className="px-3 py-3 text-stone-700">{actorName(event.actor_id, actorNames)}</td><td className="px-3 py-3 text-stone-500">{event.version_id ? "Published version" : "Draft"}</td></tr>)}</tbody></table></div>; }
