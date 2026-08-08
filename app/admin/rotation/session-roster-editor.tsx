"use client";

import {
  ArrowLeft,
  ArrowRight,
  ArrowsClockwise,
  CheckCircle,
  Info,
  LockKey,
  Warning
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  assignSessionRosterWizardPrimaryTeacher,
  createSessionRosterWizardRevision,
  generateSessionRosterWizardGroups,
  moveSessionRosterWizardStudent,
  publishSessionRosterWizardDraft,
  reviewSessionRosterWizardDraft,
  transitionSessionRosterWizardLegacyDraft
} from "@/app/admin/rotation/actions";
import type {
  SessionRosterHistoryResponse,
  SessionRosterPublishedResponse,
  SessionRosterWizardDraftResponse,
  SessionRosterWizardLegacyTransitionPreviewResponse
} from "@/lib/session-roster";
import { sessionRosterActionError, sessionRosterReadinessSummary } from "@/lib/session-roster-ui";
import type { RotationWizardStep } from "@/lib/rotation-workflow";
import { formatDateTimeInAppTimeZone } from "@/lib/dates";

type Notice = { tone: "success" | "warning" | "error"; text: string } | null;
type Paths = Record<RotationWizardStep, string>;

export default function SessionRosterEditor({
  actorNames,
  initialDraft,
  initialHistory,
  initialPublished,
  legacyTransition,
  cohortId,
  masjidId,
  paths,
  step,
  weekStart
}: {
  actorNames: Record<string, string>;
  cohortId: string;
  initialDraft: SessionRosterWizardDraftResponse | null;
  initialHistory: SessionRosterHistoryResponse;
  initialPublished: SessionRosterPublishedResponse;
  legacyTransition: SessionRosterWizardLegacyTransitionPreviewResponse | null;
  masjidId: string;
  paths: Paths;
  step: "groups" | "review";
  weekStart: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [published, setPublished] = useState(initialPublished);
  const [legacy, setLegacy] = useState(legacyTransition);
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, startTransition] = useTransition();
  const [targetCount, setTargetCount] = useState(initialDraft?.readiness.requested_group_count ?? initialDraft?.readiness.default_group_count ?? 0);
  const [confirmCountMismatch, setConfirmCountMismatch] = useState(false);
  const [confirmRegeneration, setConfirmRegeneration] = useState(false);
  const [confirmAnchorMismatch, setConfirmAnchorMismatch] = useState(false);
  const [anchorConfirmationNeeded, setAnchorConfirmationNeeded] = useState(false);
  const [confirmLegacyDiscard, setConfirmLegacyDiscard] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const scope = { masjidId, cohortId, weekStart };

  function fail(result: { ok: boolean; error?: string; message?: string }) {
    if ((result.message ?? "").includes("mismatch_confirmation_required") || (result.message ?? "").includes("teacher_group_mismatch")) {
      setAnchorConfirmationNeeded(true);
    }
    const kind = sessionRosterActionError(result.message ?? "");
    setNotice({
      tone: kind === "stale" || kind === "conflict" ? "warning" : "error",
      text: kind === "stale" || kind === "conflict"
        ? "This draft changed or is out of date. Reload the current server state, then retry."
        : result.message ?? "Unable to update the Saturday roster. Please retry."
    });
  }

  function accept(result: { ok: boolean; data?: SessionRosterWizardDraftResponse; published?: SessionRosterPublishedResponse; error?: string; message?: string }, message?: string) {
    if (!result.ok || !result.data) return fail(result);
    setDraft(result.data);
    if (result.published) setPublished(result.published);
    setNotice(message ? { tone: "success", text: message } : null);
  }

  function generateGroups() {
    if (!draft) return;
    startTransition(async () => {
      const result = await generateSessionRosterWizardGroups({
        ...scope,
        draftId: draft.draft.id,
        expectedStateVersion: draft.draft.state_version,
        expectedDependencyDigest: draft.draft.dependency_digest ?? "",
        targetGroupCount: targetCount,
        confirmGroupCountMismatch: confirmCountMismatch,
        confirmDiscardChanges: draft.groups.length === 0 || confirmRegeneration
      });
      accept(result, draft.groups.length ? "Session groups regenerated from current availability." : "Session groups generated.");
      if (result.ok) setConfirmRegeneration(false);
    });
  }

  function moveStudent(studentId: string, slotId: string | null) {
    if (!draft) return;
    startTransition(async () => accept(await moveSessionRosterWizardStudent({
      ...scope, draftId: draft.draft.id, expectedStateVersion: draft.draft.state_version,
      studentId, sessionGroupSlotId: slotId
    })));
  }

  function assignTeacher(slotId: string, teacherId: string | null) {
    if (!draft) return;
    startTransition(async () => accept(await assignSessionRosterWizardPrimaryTeacher({
      ...scope, draftId: draft.draft.id, expectedStateVersion: draft.draft.state_version,
      sessionGroupSlotId: slotId, primaryTeacherId: teacherId, confirmMismatch: confirmAnchorMismatch
    })));
  }

  function recoverLegacy() {
    const blocked = legacy?.blocking_legacy_draft;
    if (!blocked || !confirmLegacyDiscard) return;
    startTransition(async () => {
      const result = await transitionSessionRosterWizardLegacyDraft({
        ...scope,
        legacyDraftId: blocked.id,
        expectedLegacyStateVersion: blocked.state_version,
        expectedLegacySourceStateDigest: blocked.source_state_digest,
        expectedPublishedVersionId: legacy?.current_published_version?.id ?? null,
        confirmDiscardLegacyDraft: true
      });
      if (!result.ok || !result.data) return fail(result);
      setDraft(result.data);
      setLegacy(null);
      setNotice({ tone: "success", text: "Legacy draft transitioned. The published version and permanent records were unchanged." });
    });
  }

  function review() {
    if (!draft) return;
    startTransition(async () => {
      const result = await reviewSessionRosterWizardDraft({ ...scope, draftId: draft.draft.id, expectedStateVersion: draft.draft.state_version });
      accept(result, "Review is current and ready for explicit publication confirmation.");
    });
  }

  function publish() {
    if (!draft || !confirmPublish) return;
    startTransition(async () => {
      const result = await publishSessionRosterWizardDraft({ ...scope, draftId: draft.draft.id, expectedStateVersion: draft.draft.state_version });
      if (!result.ok || !result.published) return fail(result);
      setDraft(null);
      setPublished(result.published);
      setConfirmPublish(false);
      setNotice({ tone: "success", text: `Saturday roster version ${result.data?.version.version_number ?? ""} is now live.` });
    });
  }

  function revise() {
    if (!published.version) return;
    startTransition(async () => {
      const result = await createSessionRosterWizardRevision({ ...scope, expectedPublishedVersionId: published.version!.id });
      accept(result, "Revision draft opened. The currently published roster remains live.");
      if (result.ok) router.push(paths.groups);
    });
  }

  if (legacy?.blocking_legacy_draft) {
    return <WizardSurface title="Legacy draft recovery" eyebrow="Recovery required" description="An unpublished draft from the earlier rotation workflow must be handled before teacher-driven session groups can be created.">
      <div className="border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">Explicit confirmation is required</p>
        <p className="mt-1">The legacy draft will be retained in history and marked superseded. Any current published roster stays live. Permanent memberships, teacher assignments, grades, and plans are not changed.</p>
        <label className="mt-4 flex min-h-11 items-start gap-3"><input checked={confirmLegacyDiscard} className="mt-1 size-5" onChange={(event) => setConfirmLegacyDiscard(event.target.checked)} type="checkbox" /><span>I confirm discarding the unpublished legacy draft and starting a fresh teacher-driven draft.</span></label>
        <button className="mt-3 min-h-11 rounded-md bg-amber-800 px-4 font-semibold text-white disabled:opacity-50" disabled={!confirmLegacyDiscard || pending} onClick={recoverLegacy} type="button">{pending ? "Recovering…" : "Transition legacy draft"}</button>
      </div>
    </WizardSurface>;
  }

  if (!draft && published.version) {
    const publishedCounts = new Map<string, number>();
    for (const student of published.roster) publishedCounts.set(student.session_group_id, (publishedCounts.get(student.session_group_id) ?? 0) + 1);
    return <WizardSurface title="Saturday roster published" eyebrow="Already published" description={`Version ${published.version.version_number} is live and read-only.`}>
      <div className="flex items-start gap-3 border border-green-200 bg-green-50 p-4 text-sm text-green-900"><LockKey className="mt-0.5 size-5 shrink-0" /><div><p className="font-semibold">The live teacher roster is protected.</p><p className="mt-1">Start a revision to make changes. Nothing live changes until the new revision is explicitly published.</p></div></div>
      <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">{published.groups.map((group) => <div className="grid grid-cols-2 gap-2 py-3 text-sm sm:grid-cols-3" key={group.group_id}><p className="font-semibold text-ink">{group.group_name}</p><p>{group.primary_teacher_name ?? "No primary teacher"}</p><p className="text-stone-600">{publishedCounts.get(group.group_id) ?? 0} students</p></div>)}</div>
      <AuditDetails actorNames={actorNames} history={initialHistory} />
      <button className="mt-4 min-h-11 rounded-md border border-moss bg-white px-4 text-sm font-semibold text-moss disabled:opacity-50" disabled={pending} onClick={revise} type="button"><ArrowsClockwise className="mr-2 inline size-4" />Revise this Saturday</button>
    </WizardSurface>;
  }

  if (!draft) return <WizardSurface title="Session roster unavailable" eyebrow="Unable to continue" description="Reload the page to retry loading this Saturday’s draft." />;

  const readiness = draft.readiness;
  const availableTeachers = draft.teachers.filter((teacher) => teacher.available);
  const counts = new Map(readiness.group_counts.map((group) => [group.session_group_slot_id ?? group.group_id, group.attending_count]));
  const actionableBlockers = readiness.blocker_codes.filter((code) => code !== "review_required");

  return <>
    {notice ? <div aria-live="polite" className={`mb-4 flex items-center justify-between gap-3 border-l-4 p-3 text-sm ${notice.tone === "success" ? "border-green-600 bg-green-50 text-green-900" : notice.tone === "warning" ? "border-amber-500 bg-amber-50 text-amber-950" : "border-red-600 bg-red-50 text-red-800"}`} role="status"><span>{notice.text}</span>{notice.tone !== "success" ? <button className="min-h-11 shrink-0 rounded-md border border-current px-3 font-medium" onClick={() => window.location.reload()} type="button">Reload</button> : null}</div> : null}
    {draft.draft.base_published_version_id ? <p className="mb-4 flex items-center gap-2 border-l-4 border-green-600 bg-green-50 p-3 text-sm text-green-900"><LockKey className="size-5" />Revision {draft.draft.revision_number}; the current published roster remains live.</p> : null}
    {step === "groups" ? <WizardSurface title="Session groups" eyebrow="Step 3" description="Review Saturday-only placements and give each available teacher at most one primary responsibility.">
      <Metrics items={[["Attending", readiness.attending_count], ["Available teachers", readiness.available_teacher_count], ["Session groups", readiness.actual_group_count], ["Unplaced", readiness.unplaced_count]]} />
      {readiness.source_stale ? <StateWarning title="Availability changed" text="This draft is stale. Regenerate explicitly to discard unpublished placements and responsibilities and use the latest availability." /> : null}
      <div className="mt-5 flex flex-col gap-3 border-y border-stone-200 bg-stone-50 px-3 py-3 sm:flex-row sm:items-end">
        <label className="block"><span className="text-xs font-semibold uppercase text-stone-600">Session groups</span><input className="mt-1 min-h-11 w-24 rounded-md border border-stone-300 bg-white px-3" max={availableTeachers.length || 1} min={1} onChange={(event) => { setTargetCount(Number(event.target.value)); setConfirmCountMismatch(false); }} type="number" value={targetCount} /></label>
        <p className="flex-1 text-sm text-stone-600">Default: {readiness.default_group_count} groups for {readiness.available_teacher_count} available teachers.</p>
        <button className="min-h-11 rounded-md border border-moss bg-white px-4 text-sm font-semibold text-moss disabled:opacity-50" disabled={pending || targetCount < 1 || targetCount > availableTeachers.length || (targetCount < availableTeachers.length && !confirmCountMismatch)} onClick={() => draft.groups.length ? setConfirmRegeneration(true) : generateGroups()} type="button">{draft.groups.length ? "Regenerate groups" : "Generate groups"}</button>
      </div>
      {targetCount > 0 && targetCount < availableTeachers.length ? <label className="mt-3 flex min-h-11 items-start gap-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950"><input checked={confirmCountMismatch} className="mt-0.5 size-5" onChange={(event) => setConfirmCountMismatch(event.target.checked)} type="checkbox" /><span><strong>Smaller group-count exception:</strong> confirm {targetCount} groups for {availableTeachers.length} available teachers. All available teachers remain session participants; teachers without a group have no false primary assignment.</span></label> : null}
      {targetCount > availableTeachers.length ? <StateWarning title="Group count blocked" text="The number of session groups cannot exceed the number of available teachers." /> : null}
      {confirmRegeneration ? <div className="mt-3 border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">Discard manual changes and regenerate?</p><p className="mt-1">Student moves and primary responsibilities in this draft will be replaced.</p><div className="mt-3 flex gap-3"><button className="min-h-11 rounded-md bg-amber-800 px-4 font-semibold text-white disabled:opacity-50" disabled={targetCount < availableTeachers.length && !confirmCountMismatch} onClick={generateGroups} type="button">Confirm regeneration</button><button className="min-h-11 rounded-md border border-amber-500 bg-white px-4" onClick={() => setConfirmRegeneration(false)} type="button">Cancel</button></div></div> : null}
      {anchorConfirmationNeeded || readiness.permanent_anchor_mismatch_confirmation_required ? <label className="mt-3 flex min-h-11 items-start gap-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950"><input checked={confirmAnchorMismatch} className="mt-0.5 size-5" onChange={(event) => setConfirmAnchorMismatch(event.target.checked)} type="checkbox" /><span>Confirm primary responsibilities that differ from permanent anchor groups. This is separate from the group-count exception.</span></label> : null}
      <GroupGrid draft={draft} counts={counts} pending={pending} teachers={availableTeachers} onAssign={assignTeacher} />
      {readiness.imbalance_warning ? <StateWarning title="Group sizes are imbalanced" text="This is a warning only. You may redistribute students or continue once every attending student is placed." /> : null}
      <button className="mt-4 min-h-11 rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold text-ink" onClick={() => setShowDetails((value) => !value)} type="button">{showDetails ? "Hide" : "Open"} detailed placement controls</button>
      {showDetails ? <PlacementRows draft={draft} pending={pending} onMove={moveStudent} /> : null}
      <div className="mt-5 flex flex-col-reverse gap-3 border-t border-stone-200 pt-4 sm:flex-row sm:justify-between"><NavButton href={paths.teachers} label="Back to teachers" /><NavButton disabled={actionableBlockers.length > 0 || readiness.source_stale || draft.groups.length === 0} href={paths.review} label="Continue to review" primary /></div>
    </WizardSurface> : <WizardSurface title={draft.draft.base_published_version_id ? "Review revision" : "Review & publish"} eyebrow="Step 4" description="Confirm student availability, teacher participation, placements, and primary responsibilities together.">
      <Metrics items={[["Attending", readiness.attending_count], ["Absent", readiness.unavailable_count], ["Available teachers", readiness.available_teacher_count], ["Session groups", readiness.actual_group_count], ["Unplaced", readiness.unplaced_count]]} />
      <div className={`mt-4 flex items-start gap-2 border p-3 text-sm ${readiness.can_publish ? "border-green-300 bg-green-50 text-green-900" : "border-amber-300 bg-amber-50 text-amber-950"}`}>{readiness.can_publish ? <CheckCircle className="size-5 shrink-0" /> : <Warning className="size-5 shrink-0" />}<span>{sessionRosterReadinessSummary(readiness)}</span></div>
      <ReviewRows draft={draft} />
      <div className="mt-4 border-y border-stone-200 py-3 text-sm"><p className="font-semibold text-ink">Available teacher participants</p><p className="mt-1 text-stone-600">{draft.participants.filter((teacher) => teacher.participating).map((teacher) => teacher.is_primary ? `${teacher.teacher_name} — ${teacher.primary_slot_name}` : `${teacher.teacher_name} — co-teacher`).join(" · ") || "None"}</p></div>
      <p className="mt-4 flex items-start gap-2 bg-stone-50 p-3 text-sm text-stone-700"><Info className="mt-0.5 size-5 shrink-0" />Publishing is atomic, versioned, and audited. Permanent memberships remain unchanged.</p>
      <AuditDetails actorNames={actorNames} history={initialHistory} />
      <label className="mt-4 flex min-h-11 items-start gap-3 text-sm text-ink"><input checked={confirmPublish} className="mt-0.5 size-5" onChange={(event) => setConfirmPublish(event.target.checked)} type="checkbox" /><span>I reviewed availability, teacher responsibilities, and all Saturday placements.</span></label>
      <div className="mt-5 flex flex-col-reverse gap-3 border-t border-stone-200 pt-4 sm:flex-row sm:justify-between"><NavButton href={paths.groups} label="Back to groups" /><div className="flex flex-col gap-3 sm:flex-row"><button className="min-h-11 rounded-md border border-moss bg-white px-4 text-sm font-semibold text-moss disabled:opacity-50" disabled={pending || readiness.source_stale || actionableBlockers.length > 0} onClick={review} type="button">{readiness.reviewed_current ? "Review again" : "Prepare review"}</button><button className="min-h-11 rounded-md bg-moss px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={pending || !readiness.can_publish || !confirmPublish} onClick={publish} type="button">{pending ? "Publishing…" : "Publish Saturday roster"}</button></div></div>
    </WizardSurface>}
  </>;
}

function WizardSurface({ children, description, eyebrow, title }: { children?: React.ReactNode; description: string; eyebrow: string; title: string }) { return <section className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6"><p className="text-xs font-semibold uppercase tracking-wide text-gold">{eyebrow}</p><h2 className="mt-1 text-2xl font-semibold text-ink">{title}</h2><p className="mt-1 text-sm text-stone-600">{description}</p><div className="mt-5">{children}</div></section>; }
function Metrics({ items }: { items: Array<[string, number]> }) { return <div className="grid grid-cols-2 divide-x divide-stone-200 border-y border-stone-200 py-3 sm:flex sm:justify-end">{items.map(([label, value]) => <div className="px-3 text-center sm:min-w-28" key={label}><p className="text-xl font-semibold text-moss">{value}</p><p className="text-xs text-stone-600">{label}</p></div>)}</div>; }
function StateWarning({ text, title }: { text: string; title: string }) { return <div className="mt-3 flex items-start gap-2 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950"><Warning className="mt-0.5 size-5 shrink-0" /><span><strong>{title}.</strong> {text}</span></div>; }
function NavButton({ disabled, href, label, primary = false }: { disabled?: boolean; href: string; label: string; primary?: boolean }) { const router = useRouter(); return <button className={`min-h-11 rounded-md px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${primary ? "bg-moss text-white" : "border border-stone-300 bg-white text-ink"}`} disabled={disabled} onClick={() => router.push(href)} type="button">{!primary ? <ArrowLeft className="mr-2 inline size-4" /> : null}{label}{primary ? <ArrowRight className="ml-2 inline size-4" /> : null}</button>; }

function GroupGrid({ counts, draft, onAssign, pending, teachers }: { counts: Map<string, number>; draft: SessionRosterWizardDraftResponse; onAssign: (slot: string, teacher: string | null) => void; pending: boolean; teachers: SessionRosterWizardDraftResponse["teachers"] }) { return <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{draft.groups.map((group) => { const students = draft.students.filter((student) => student.session_group_slot_id === group.session_group_slot_id); return <section className="rounded-md border border-stone-200" key={group.session_group_slot_id}><div className="p-3"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold text-ink">{group.group_name}</h3><span className="rounded bg-stone-100 px-2 py-1 text-xs">{counts.get(group.session_group_slot_id) ?? 0} students</span></div><label className="mt-3 block text-xs font-semibold text-stone-600">Primary teacher<select className="mt-1 min-h-11 w-full rounded-md border border-stone-300 bg-white px-2 text-sm font-normal text-ink" disabled={pending} onChange={(event) => onAssign(group.session_group_slot_id, event.target.value || null)} value={group.primary_teacher_id ?? ""}><option value="">Choose teacher</option>{teachers.map((teacher) => <option key={teacher.teacher_id} value={teacher.teacher_id}>{teacher.teacher_name}</option>)}</select></label></div><div className="border-t border-stone-200 px-3 py-2 text-sm text-stone-700">{students.slice(0, 4).map((student) => <p className="truncate py-1" key={student.student_id}>{student.student_name}</p>)}{students.length > 4 ? <p className="py-1 font-semibold text-ink">+{students.length - 4} more</p> : null}{students.length === 0 ? <p className="py-1 text-stone-500">No students placed</p> : null}</div></section>; })}</div>; }
function PlacementRows({ draft, onMove, pending }: { draft: SessionRosterWizardDraftResponse; onMove: (student: string, slot: string | null) => void; pending: boolean }) { return <div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{draft.students.filter((student) => student.attendance_status === "attending").map((student) => <div className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] sm:items-center" key={student.student_id}><div><p className="text-sm font-semibold text-ink">{student.student_name}</p><p className="text-xs text-stone-500">Usual group: {student.usual_group_name}</p></div><label><span className="sr-only">Session group for {student.student_name}</span><select className="min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" disabled={pending} onChange={(event) => onMove(student.student_id, event.target.value || null)} value={student.session_group_slot_id ?? ""}><option value="">Unplaced</option>{draft.groups.map((group) => <option key={group.session_group_slot_id} value={group.session_group_slot_id}>{group.group_name}</option>)}</select></label></div>)}</div>; }
function ReviewRows({ draft }: { draft: SessionRosterWizardDraftResponse }) { const counts = new Map(draft.readiness.group_counts.map((group) => [group.session_group_slot_id ?? group.group_id, group.attending_count])); return <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">{draft.groups.map((group) => { const moved = draft.students.filter((student) => student.session_group_slot_id === group.session_group_slot_id && student.session_group_id !== student.usual_group_id).length; return <div className="grid grid-cols-2 gap-x-3 gap-y-1 py-3 text-sm sm:grid-cols-4" key={group.session_group_slot_id}><p className="font-semibold text-ink">{group.group_name}</p><p><span className="text-stone-500 sm:hidden">Primary: </span>{group.primary_teacher_name ?? "Unassigned"}</p><p>{counts.get(group.session_group_slot_id) ?? 0} students</p><p className="text-stone-600">{moved} moved</p></div>; })}</div>; }
function AuditDetails({ actorNames, history }: { actorNames: Record<string, string>; history: SessionRosterHistoryResponse }) { return <details className="mt-4 border-t border-stone-200 pt-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-moss">Publication history and audit ({history.audit_events.length})</summary><div className="divide-y divide-stone-200 border-y border-stone-200">{history.audit_events.length ? history.audit_events.map((event) => <div className="grid gap-1 py-3 text-sm sm:grid-cols-3" key={event.id}><p className="font-medium text-ink">{event.action.replaceAll("_", " ")}</p><p className="text-stone-600">{actorNames[event.actor_id] ?? "Scoped admin"}</p><p className="text-stone-500">{formatDateTimeInAppTimeZone(event.occurred_at)}</p></div>) : <p className="py-3 text-sm text-stone-600">No roster audit events yet.</p>}</div></details>; }
