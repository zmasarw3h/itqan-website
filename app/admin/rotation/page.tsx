import { randomUUID } from "crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import AppNav from "@/app/nav";
import RotationScopeSelector from "@/app/admin/rotation/scope-selector";
import RotationStepIndicator from "@/app/admin/rotation/rotation-step-indicator";
import {
  LegacyTeacherAssignmentPublication,
  PermanentGroupManagement
} from "@/app/admin/rotation/legacy-rotation-controls";
import SessionRosterEditor from "@/app/admin/rotation/session-roster-editor";
import { loadSessionRosterPageData } from "@/app/admin/rotation/session-roster-data";
import StudentAvailabilityForm from "@/app/admin/rotation/student-availability-form";
import {
  ROTATION_STATUS_MESSAGES,
  loadRotationPageData,
  type RotationSearchParams
} from "@/app/admin/rotation/data";
import { formatHalaqaSaturday, halaqaWeekStarts } from "@/lib/dates";
import { rotationPath } from "@/lib/rotation-scope";
import { requireProfile } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function statusFor(value: string | undefined) {
  return value ? ROTATION_STATUS_MESSAGES[value] : null;
}

export default async function AdminRotationPage({
  searchParams
}: {
  searchParams: Promise<RotationSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { profile } = await requireProfile(["admin"]);
  const data = await loadRotationPageData({
    profile,
    searchParams: resolvedSearchParams,
    publicationRequestId: randomUUID()
  });

  if (data.canonicalPath) redirect(data.canonicalPath);

  const sessionRoster = data.context
    ? await loadSessionRosterPageData({
        context: data.context,
        profile,
        weekStart: data.selectedWeekStart
      })
    : null;
  const status = statusFor(resolvedSearchParams.status);
  const readiness = sessionRoster?.draft?.readiness;
  const attendingCount = readiness?.attending_count ?? data.students.filter((student) => student.available).length;
  const absentCount = readiness?.unavailable_count ?? data.students.filter((student) => !student.available).length;
  const sessionGroupCount = sessionRoster?.draft?.groups.length ?? sessionRoster?.published.groups.length ?? data.groups.length;
  const liveVersion = sessionRoster?.published.version;
  const weekStarts = halaqaWeekStarts();
  const availableTeacherCount = data.teachers.filter((teacher) => teacher.available).length;
  const publishedAssignmentCount = data.assignments.filter((assignment) => assignment.active && assignment.teacher_id).length;
  const proposedAssignmentCount = data.persistencePlan?.run.assigned_count ?? 0;
  const newGroupCount = data.rebalancePreview?.groups.filter((group) => group.is_new).length ?? 0;
  const movedStudentCount = data.rebalancePreview?.moved_student_ids.length ?? 0;
  const rebalanceHasChanges = newGroupCount > 0 || movedStudentCount > 0;
  const teacherPublicationReady = Boolean(
    data.context && data.settings && data.groups.length === data.settings.target_group_count &&
    data.students.length > 0 && data.teachers.length > 0 && data.persistencePlan && data.publicationRequestId
  );

  function selectedContextPath(weekStart: string) {
    if (!data.context) return "/admin/rotation";
    return rotationPath({ masjidId: data.context.masjid.id, cohortId: data.context.cohort.id, weekStart });
  }

  function weekLinkClass(weekStart: string, borderRight = false) {
    const active = data.selectedWeekStart === weekStart;
    return `${borderRight ? "border-r border-stone-300 " : ""}px-3 py-2.5 text-center text-xs font-medium ${active ? "bg-ink text-white" : "bg-white text-ink hover:bg-stone-50"}`;
  }

  return <>
    <AppNav activeHref="/admin/rotation" role={profile.role} name={profile.name} variant="rotation" />
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <header><p className="text-sm font-medium text-moss">Saturday halaqa operations</p><h1 className="mt-1 text-2xl font-semibold text-ink">Weekly Rotation</h1><p className="mt-1 text-sm text-stone-600">Prepare availability, session groups, and teacher responsibilities for the selected Saturday.</p></header>
      <section className="mt-5 border-y border-stone-200 bg-white px-4 py-4 sm:rounded-lg sm:border"><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"><RotationScopeSelector key={`${data.context?.masjid.id ?? "none"}:${data.context?.cohort.id ?? "none"}:${data.selectedWeekStart}`} contexts={data.contexts} selectedCohortId={resolvedSearchParams.cohort} selectedMasjidId={resolvedSearchParams.masjid} selectedWeekStart={data.selectedWeekStart} /><nav aria-label="Halaqa week" className="grid grid-cols-3 overflow-hidden rounded-md border border-stone-300"><Link className={weekLinkClass(weekStarts.previous, true)} href={selectedContextPath(weekStarts.previous)}>Previous</Link><Link className={weekLinkClass(weekStarts.current, true)} href={selectedContextPath(weekStarts.current)}>This Saturday</Link><Link className={weekLinkClass(weekStarts.next)} href={selectedContextPath(weekStarts.next)}>Next</Link></nav></div></section>
      {status ? <p className={`mt-5 rounded-md px-3 py-2.5 text-sm ${status.className}`}>{status.text}</p> : null}
      {data.setupIssues.length > 0 ? <section className="mt-5 border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-950"><h2 className="font-semibold">Needs attention</h2><ul className="mt-1 space-y-1">{data.setupIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></section> : null}
      <section aria-label="Rotation readiness" className="mt-5 grid divide-y divide-stone-200 border-y border-stone-200 bg-white sm:grid-cols-2 lg:grid-cols-5 lg:divide-x lg:divide-y-0 lg:rounded-lg lg:border"><ReadinessMetric label="Students" value={data.students.length} detail="In this cohort" /><ReadinessMetric label="Attending" value={attendingCount} detail="This Saturday" valueClass="text-moss" /><ReadinessMetric label="Absent" value={absentCount} detail="Marked unavailable" valueClass="text-red-700" /><ReadinessMetric label="Session groups" value={sessionGroupCount} detail="Saturday-only placement" /><ReadinessMetric label="Plan status" value={liveVersion ? "Published" : readiness?.source_stale ? "Stale draft" : "Draft"} detail={liveVersion ? `Version ${liveVersion.version_number} is live` : readiness?.unplaced_count ? `${readiness.unplaced_count} unplaced` : "Students attend by default"} /></section>
      <RotationStepIndicator />
      <div className="mt-6 space-y-6"><section className="scroll-mt-6 border-y border-stone-200 bg-white px-4 py-5 sm:rounded-lg sm:border sm:p-6" id="student-availability" tabIndex={-1}><div><p className="text-xs font-semibold uppercase text-moss">Step 1</p><h2 className="mt-1 text-lg font-semibold text-ink">Student availability</h2><p className="mt-1 text-sm text-stone-600">Mark absences for {formatHalaqaSaturday(data.selectedWeekStart)}. Attendance applies only to this session.</p></div>{data.context ? <StudentAvailabilityForm key={`${data.context.cohort.id}:${data.selectedWeekStart}`} cohortId={data.context.cohort.id} masjidId={data.context.masjid.id} saturdayLabel={formatHalaqaSaturday(data.selectedWeekStart)} students={data.students} weekStart={data.selectedWeekStart} /> : null}</section>
      {data.context && sessionRoster ? <SessionRosterEditor actorNames={sessionRoster.actorNames} cohortId={data.context.cohort.id} initialDraft={sessionRoster.draft} initialHistory={sessionRoster.history} initialPublished={sessionRoster.published} legacyGroupManagement={<PermanentGroupManagement context={data.context} data={data} hasChanges={rebalanceHasChanges} movedStudentCount={movedStudentCount} newGroupCount={newGroupCount} />} legacyTeacherAssignment={<LegacyTeacherAssignmentPublication availableTeacherCount={availableTeacherCount} data={data} publishedAssignmentCount={publishedAssignmentCount} publishReady={teacherPublicationReady} proposedAssignmentCount={proposedAssignmentCount} />} masjidId={data.context.masjid.id} teachers={data.teachers} weekStart={data.selectedWeekStart} /> : null}</div>
    </main>
  </>;
}

function ReadinessMetric({ detail, label, value, valueClass = "text-ink" }: { detail: string; label: string; value: number | string; valueClass?: string }) {
  return <div className="min-w-0 px-4 py-4"><p className="text-xs font-semibold uppercase text-stone-500">{label}</p><p className={`mt-1 text-2xl font-semibold ${valueClass}`}>{value}</p><p className="mt-1 text-xs text-stone-500">{detail}</p></div>;
}
