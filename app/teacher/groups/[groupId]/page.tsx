import Link from "next/link";
import { notFound } from "next/navigation";
import AppNav from "@/app/nav";
import TeacherGradeForm from "@/app/teacher/groups/[groupId]/teacher-grade-form";
import TeacherWeekSelector from "@/app/teacher/week-selector";
import { formatWeekRange, torontoCivilDateString, weekStartForDate } from "@/lib/dates";
import {
  assignmentWeekStarts,
  isTrackerWeekStart,
  resolveTeacherWeekStart
} from "@/lib/teacher-dashboard";
import {
  loadTeacherSessionDashboards,
  loadTeacherSessionGroupRoster,
  requireTeacherExperience
} from "@/lib/teacher-scope";

export const dynamic = "force-dynamic";

type GroupSearchParams = {
  status?: string | string[];
  week?: string | string[];
};

export default async function TeacherGroupPage({
  params,
  searchParams
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<GroupSearchParams>;
}) {
  const [{ groupId }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const currentWeekStart = weekStartForDate(torontoCivilDateString());
  const requestedWeek = Array.isArray(resolvedSearchParams.week)
    ? resolvedSearchParams.week[0]
    : resolvedSearchParams.week;

  if (requestedWeek && !isTrackerWeekStart(requestedWeek)) {
    notFound();
  }

  const selectedWeekStart = resolveTeacherWeekStart(requestedWeek, currentWeekStart);
  const { supabase, profile, assignments } = await requireTeacherExperience(selectedWeekStart);
  const groupWeekStarts = assignmentWeekStarts(assignments, currentWeekStart);
  const dashboards = await loadTeacherSessionDashboards(supabase, selectedWeekStart);
  const dashboard = dashboards.find(
    (candidate) =>
      candidate.publication !== null &&
      candidate.groups.some((candidateGroup) => candidateGroup.group_id === groupId)
  );
  const hasAuthorizedUnpublishedGroup = dashboards.some(
    (candidate) =>
      candidate.publication === null && candidate.scope.assigned_group_ids.includes(groupId)
  );

  if (!dashboard) {
    if (!hasAuthorizedUnpublishedGroup) {
      notFound();
    }

    return (
      <>
        <AppNav name={profile.name} role={profile.role} />
        <main className="mx-auto max-w-4xl px-4 py-8">
          <div className="flex flex-col justify-between gap-5 border-b border-stone-200 pb-6 sm:flex-row sm:items-end">
            <div>
              <Link className="text-sm font-medium text-moss hover:text-ink" href={`/teacher?week=${selectedWeekStart}`}>
                Back to published teaching groups
              </Link>
              <h1 className="mt-2 text-3xl font-semibold text-ink">Group unavailable</h1>
              <p className="mt-2 text-stone-600">{formatWeekRange(selectedWeekStart)}</p>
            </div>
            <TeacherWeekSelector
              path={`/teacher/groups/${groupId}`}
              selectedWeekStart={selectedWeekStart}
              weekStarts={groupWeekStarts}
            />
          </div>
          <section className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-5 py-12 text-center">
            <h2 className="text-xl font-semibold text-ink">No published session roster</h2>
            <p className="mx-auto mt-2 max-w-xl text-stone-700">
              This authorized group has no current published Saturday roster. Students, weekly plans, and grade forms
              remain unavailable until publication.
            </p>
          </section>
        </main>
      </>
    );
  }

  const publication = dashboard.publication;
  if (!publication) {
    notFound();
  }
  const rosterResponse = await loadTeacherSessionGroupRoster(
    supabase,
    publication.version_id,
    groupId,
    selectedWeekStart
  );
  const status = Array.isArray(resolvedSearchParams.status)
    ? resolvedSearchParams.status[0]
    : resolvedSearchParams.status;
  const groupSummary = dashboard.groups.find((candidate) => candidate.group_id === groupId);

  return (
    <>
      <AppNav name={profile.name} role={profile.role} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-col justify-between gap-5 border-b border-stone-200 pb-6 sm:flex-row sm:items-end">
          <div>
            <Link className="text-sm font-medium text-moss hover:text-ink" href={`/teacher?week=${selectedWeekStart}`}>
              Back to published teaching groups
            </Link>
            <h1 className="mt-2 text-3xl font-semibold text-ink">{rosterResponse.group.group_name}</h1>
            <p className="mt-2 text-stone-600">
              {dashboard.scope.masjid_name} · {dashboard.scope.cohort_name} · {formatWeekRange(selectedWeekStart)} ·
              Published version {publication.version_number}
            </p>
            <p className="mt-1 text-sm text-stone-500">
              Primary teacher: {rosterResponse.group.primary_teacher_name}
              {groupSummary?.is_assigned_group ? " · Assigned responsibility highlight" : " · Cohort-wide teacher access"}
            </p>
          </div>
          <TeacherWeekSelector
            path={`/teacher/groups/${groupId}`}
            selectedWeekStart={selectedWeekStart}
            weekStarts={groupWeekStarts}
          />
        </div>

        {status === "grade-saved" ? (
          <p aria-live="polite" className="mt-5 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
            Halaqa grade saved.
          </p>
        ) : null}
        {status === "grade-invalid" ? (
          <p aria-live="polite" className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="status">
            The grade is invalid. Present students need a whole-number recitation score from 10 to 50.
          </p>
        ) : null}
        {status === "grade-stale" ? (
          <p aria-live="polite" className="mt-5 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
            The published roster changed while saving. Reload the current group before grading again.
          </p>
        ) : null}
        {status === "grade-denied" ? (
          <p aria-live="polite" className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="status">
            You are not authorized to grade this published student context.
          </p>
        ) : null}
        {status === "grade-error" ? (
          <p aria-live="polite" className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="status">
            The grade could not be saved because of an unexpected server error. Try again or contact an administrator.
          </p>
        ) : null}
        {status === "plan-stale" || status === "plan-error" || status === "plan-missing" ? (
          <p aria-live="polite" className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="status">
            The weekly plan is unavailable or no longer belongs to this published roster.
          </p>
        ) : null}

        <section className="mt-6 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-ink">Published roster</h2>
            <p className="mt-1 text-sm text-stone-600">
              {rosterResponse.roster.length} students from publication version {publication.version_number}
            </p>
          </div>
          {rosterResponse.roster.length ? (
            <div className="divide-y divide-stone-200">
              {rosterResponse.roster.map((student) => {
                const grade = student.grade;

                return (
                  <article className="p-5" key={student.student_id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-ink">{student.student_name}</h3>
                        <p className="mt-1 text-sm text-stone-600">
                          {grade
                            ? `${grade.attended ? "Present" : "Absent"} · ${grade.attendance_points + grade.recitation_points} / 150`
                            : "No halaqa grade saved"}
                        </p>
                        {grade ? (
                          <p className="mt-1 text-xs text-stone-500">
                            Last saved {new Date(grade.updated_at ?? grade.graded_at).toLocaleString("en-CA", { timeZone: "America/Toronto" })}
                          </p>
                        ) : null}
                        <p className="mt-3 text-sm text-stone-600">
                          Published placement: {student.usual_group_name} → {rosterResponse.group.group_name}
                        </p>
                      </div>
                      {student.weekly_plan_available ? (
                        <a
                          className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-ink hover:bg-stone-50"
                          href={`/teacher/plans/${student.student_id}?week=${selectedWeekStart}&version=${encodeURIComponent(publication.version_id)}`}
                        >
                          View weekly plan
                        </a>
                      ) : (
                        <span className="rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-500">No weekly plan</span>
                      )}
                    </div>
                    <TeacherGradeForm
                      grade={grade}
                      groupId={rosterResponse.group.group_id}
                      key={`${student.student_id}-${selectedWeekStart}-${grade?.updated_at ?? grade?.graded_at ?? "new"}`}
                      studentId={student.student_id}
                      versionId={publication.version_id}
                      weekStart={selectedWeekStart}
                    />
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="px-5 py-12 text-center text-stone-600">No students are in this published group.</p>
          )}
        </section>
      </main>
    </>
  );
}
