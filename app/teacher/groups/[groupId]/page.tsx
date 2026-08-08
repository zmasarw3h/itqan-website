import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle, ClipboardText, Info, LockKey, Star, User, UsersThree } from "@phosphor-icons/react/dist/ssr";
import AppNav from "@/app/nav";
import TeacherGradeForm from "@/app/teacher/groups/[groupId]/teacher-grade-form";
import TeacherWeekSelector from "@/app/teacher/week-selector";
import { formatWeekRange, torontoCivilDateString, weekStartForDate } from "@/lib/dates";
import { assignmentWeekStarts, isTrackerWeekStart, resolveTeacherWeekStart } from "@/lib/teacher-dashboard";
import { loadTeacherSessionDashboards, loadTeacherSessionGroupRoster, requireTeacherExperience } from "@/lib/teacher-scope";

export const dynamic = "force-dynamic";

type GroupSearchParams = { status?: string | string[]; week?: string | string[] };

function StatusMessage({ status }: { status?: string }) {
  const messages: Record<string, { tone: string; text: string }> = {
    "grade-saved": { tone: "bg-green-50 text-green-800", text: "Halaqa grade saved." },
    "grade-invalid": { tone: "bg-red-50 text-red-700", text: "The grade is invalid. Present students need a whole-number recitation score from 10 to 50." },
    "grade-stale": { tone: "bg-amber-50 text-amber-900", text: "The published roster changed while saving. Reload the current group before grading again." },
    "grade-denied": { tone: "bg-red-50 text-red-700", text: "You are not authorized to grade this published student context." },
    "grade-error": { tone: "bg-red-50 text-red-700", text: "The grade could not be saved. Try again or contact an administrator." },
    "plan-stale": { tone: "bg-red-50 text-red-700", text: "The weekly plan is unavailable or no longer belongs to this published roster." },
    "plan-error": { tone: "bg-red-50 text-red-700", text: "The weekly plan could not be opened. Try again." },
    "plan-missing": { tone: "bg-red-50 text-red-700", text: "No weekly plan is available for this published student context." }
  };
  const message = status ? messages[status] : null;
  return message ? <p aria-live="polite" className={`mt-5 rounded-md px-4 py-3 text-sm ${message.tone}`} role="status">{message.text}</p> : null;
}

export default async function TeacherGroupPage({ params, searchParams }: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<GroupSearchParams>;
}) {
  const [{ groupId }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const currentDate = torontoCivilDateString();
  const currentWeekStart = weekStartForDate(currentDate);
  const requestedWeek = Array.isArray(resolvedSearchParams.week) ? resolvedSearchParams.week[0] : resolvedSearchParams.week;
  if (requestedWeek && !isTrackerWeekStart(requestedWeek)) notFound();

  const selectedWeekStart = resolveTeacherWeekStart(requestedWeek, currentWeekStart);
  const { supabase, profile, assignments } = await requireTeacherExperience(selectedWeekStart);
  const groupWeekStarts = assignmentWeekStarts(assignments, currentWeekStart);
  const dashboards = await loadTeacherSessionDashboards(supabase, selectedWeekStart);
  const dashboard = dashboards.find((candidate) => candidate.publication && candidate.groups.some((group) => group.group_id === groupId));
  const hasAuthorizedUnpublishedGroup = dashboards.some((candidate) => !candidate.publication && candidate.scope.assigned_group_ids.includes(groupId));

  if (!dashboard) {
    if (!hasAuthorizedUnpublishedGroup) notFound();
    return (
      <>
        <AppNav activeHref="/teacher" name={profile.name} role={profile.role} variant="teacher" />
        <main className="mx-auto max-w-4xl px-4 py-10 sm:px-8">
          <Link className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-moss hover:text-ink" href={`/teacher?week=${selectedWeekStart}`}><ArrowLeft aria-hidden="true" /> Published teaching groups</Link>
          <h1 className="mt-4 text-3xl font-bold text-ink">Group unavailable</h1>
          <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-5 py-12 text-center">
            <h2 className="text-xl font-semibold text-ink">No published session roster</h2>
            <p className="mx-auto mt-2 max-w-xl text-stone-700">Students, weekly plans, and grading remain unavailable until an administrator publishes this Saturday roster.</p>
          </section>
        </main>
      </>
    );
  }

  const publication = dashboard.publication!;
  const rosterResponse = await loadTeacherSessionGroupRoster(supabase, publication.version_id, groupId, selectedWeekStart);
  const status = Array.isArray(resolvedSearchParams.status) ? resolvedSearchParams.status[0] : resolvedSearchParams.status;
  const groupSummary = dashboard.groups.find((candidate) => candidate.group_id === groupId);
  const gradedCount = groupSummary?.grade_progress.graded_count ?? rosterResponse.roster.filter((student) => student.grade_is_current).length;
  const planCount = groupSummary?.weekly_plan_count ?? rosterResponse.roster.filter((student) => student.weekly_plan_available).length;

  return (
    <>
      <AppNav activeHref="/teacher" name={profile.name} role={profile.role} variant="teacher" />
      <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-8">
        <Link className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-moss hover:text-ink" href={`/teacher?week=${selectedWeekStart}`}><ArrowLeft aria-hidden="true" /> Published teaching groups</Link>
        <div className="mt-3 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <header>
            <p className="text-sm font-bold uppercase tracking-wide text-gold">Grading workspace</p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight text-ink">{rosterResponse.group.group_name}</h1>
            <p className="mt-3 text-base text-stone-600">{dashboard.scope.masjid_name} · {dashboard.scope.cohort_kind === "brothers" ? "Brothers" : "Sisters"} · {formatWeekRange(selectedWeekStart)} · Published roster version {publication.version_number}</p>
          </header>
          <div className="w-full lg:max-w-[430px]"><TeacherWeekSelector path={`/teacher/groups/${groupId}`} presentation="card" selectedWeekStart={selectedWeekStart} weekStarts={groupWeekStarts} /></div>
        </div>

        <StatusMessage status={status} />

        {groupSummary?.is_assigned_group ? (
          <aside className="mt-6 flex items-center gap-4 rounded-lg border border-[#e6cd91] bg-[#fffaf0] px-5 py-3 text-sm text-stone-700">
            <Star aria-hidden="true" className="size-7 shrink-0 rounded-full bg-[#c48d26] p-1.5 text-white" weight="fill" />
            <strong className="text-ink">Your assigned group</strong><span className="h-6 w-px bg-[#dfc98f]" /><span>You can also grade other published cohort groups.</span>
          </aside>
        ) : null}

        <section aria-label="Group summary" className="mt-5 grid rounded-xl border border-stone-300 bg-white sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center gap-5 border-b border-stone-200 px-7 py-5 sm:border-r lg:border-b-0"><span className="grid size-12 place-items-center rounded-full bg-moss text-white"><UsersThree aria-hidden="true" className="size-6" weight="fill" /></span><p><strong className="block text-xl text-ink">{rosterResponse.roster.length}</strong><span className="text-sm text-stone-600">Students</span></p></div>
          <div className="flex items-center gap-5 border-b border-stone-200 px-7 py-5 lg:border-b-0 lg:border-r"><span className="grid size-12 place-items-center rounded-full bg-moss text-white"><CheckCircle aria-hidden="true" className="size-6" /></span><p><strong className="block text-xl text-ink">{gradedCount}</strong><span className="text-sm text-stone-600">Graded</span></p></div>
          <div className="flex items-center gap-5 border-b border-stone-200 px-7 py-5 sm:border-b-0 sm:border-r"><span className="grid size-12 place-items-center rounded-full bg-moss text-white"><ClipboardText aria-hidden="true" className="size-6" weight="fill" /></span><p><strong className="block text-xl text-ink">{planCount}</strong><span className="text-sm text-stone-600">Plans</span></p></div>
          <div className="flex items-center gap-5 px-7 py-5"><span className="grid size-12 place-items-center rounded-full bg-moss text-white"><User aria-hidden="true" className="size-6" /></span><p><strong className="block text-base text-ink">{rosterResponse.group.primary_teacher_name}</strong><span className="text-sm text-stone-600">Primary teacher</span></p></div>
        </section>

        <section className="mt-5 overflow-hidden rounded-xl border border-stone-300 bg-white">
          <div className="hidden grid-cols-[2.5fr_1.15fr_1.05fr_1.9fr_1.2fr_1.15fr_.75fr] gap-5 border-b border-stone-200 px-7 py-4 text-sm font-semibold text-ink lg:grid">
            <span>Student</span><span>Attendance</span><span>Recitation / 50</span><span>Teacher notes</span><span className="inline-flex items-center gap-1">Resources <Info aria-hidden="true" /></span><span>Status</span><span>Action</span>
          </div>
          {rosterResponse.roster.length ? rosterResponse.roster.map((student) => (
            <TeacherGradeForm
              currentDate={currentDate}
              grade={student.grade}
              gradeIsCurrent={student.grade_is_current}
              groupId={rosterResponse.group.group_id}
              key={`${student.student_id}-${selectedWeekStart}-${student.grade?.updated_at ?? student.grade?.graded_at ?? "new"}`}
              placementOrder={student.placement_order}
              sessionGroupName={rosterResponse.group.group_name}
              studentId={student.student_id}
              studentName={student.student_name}
              usualGroupName={student.usual_group_name}
              versionId={publication.version_id}
              weekStart={selectedWeekStart}
              weeklyPlanAvailable={student.weekly_plan_available}
            />
          )) : <div className="px-5 py-14 text-center"><h2 className="text-lg font-semibold text-ink">No students in this published group</h2><p className="mt-2 text-sm text-stone-600">There are no grade or resource actions for this roster.</p></div>}
        </section>

        <aside className="mt-6 flex items-start gap-3 rounded-xl border border-[#e6decf] bg-[#fbf8f1] px-5 py-5 text-sm text-stone-600"><LockKey aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-gold" />Checklist details are read-only and exclude private student notes.</aside>
      </main>
    </>
  );
}
