import Link from "next/link";
import { notFound } from "next/navigation";
import AppNav from "@/app/nav";
import TeacherGradeForm from "@/app/teacher/groups/[groupId]/teacher-grade-form";
import TeacherWeekSelector from "@/app/teacher/week-selector";
import { formatDateTimeInAppTimeZone, formatWeekRange, todayDateString, weekStartForDate } from "@/lib/dates";
import { isTrackerWeekStart, resolveTeacherWeekStart } from "@/lib/teacher-dashboard";
import {
  loadTeacherGroupRoster,
  requireTeacherExperience
} from "@/lib/teacher-scope";
import type { HalaqaGrade, WeeklyPlan } from "@/lib/types";

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
  const currentWeekStart = weekStartForDate(todayDateString());
  const requestedWeek = Array.isArray(resolvedSearchParams.week)
    ? resolvedSearchParams.week[0]
    : resolvedSearchParams.week;

  if (requestedWeek && !isTrackerWeekStart(requestedWeek)) {
    notFound();
  }

  const selectedWeekStart = resolveTeacherWeekStart(requestedWeek, currentWeekStart);
  const { supabase, profile, assignments } = await requireTeacherExperience(selectedWeekStart);
  const assignment = assignments.find(
    (candidate) => candidate.group_id === groupId && candidate.week_start === selectedWeekStart
  );

  if (!assignment) {
    notFound();
  }

  const roster = await loadTeacherGroupRoster(supabase, groupId, selectedWeekStart);
  const studentIds = roster.map((student) => student.id);
  const [planResult, gradeResult] = studentIds.length
    ? await Promise.all([
        supabase
          .from("weekly_plans")
          .select("id,student_id,week_start,file_path,file_name,file_type,file_size,uploaded_at,masjid_id,cohort_id,halaqa_group_id")
          .in("student_id", studentIds)
          .eq("week_start", selectedWeekStart)
          .eq("halaqa_group_id", groupId)
          .returns<WeeklyPlan[]>(),
        supabase
          .from("halaqa_grades")
          .select("id,student_id,week_start,attended,attendance_points,recitation_points,notes,graded_by,graded_at,updated_at,masjid_id,cohort_id,halaqa_group_id")
          .in("student_id", studentIds)
          .eq("week_start", selectedWeekStart)
          .eq("halaqa_group_id", groupId)
          .returns<HalaqaGrade[]>()
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  if (planResult.error || gradeResult.error) {
    throw new Error("Unable to load weekly halaqa records.");
  }

  const planByStudentId = new Map((planResult.data ?? []).map((plan) => [plan.student_id, plan]));
  const gradeByStudentId = new Map((gradeResult.data ?? []).map((grade) => [grade.student_id, grade]));
  const status = Array.isArray(resolvedSearchParams.status)
    ? resolvedSearchParams.status[0]
    : resolvedSearchParams.status;
  const groupWeekStarts = [
    ...new Set(
      assignments
        .filter((candidate) => candidate.group_id === groupId)
        .map((candidate) => candidate.week_start)
    )
  ].sort((a, b) => b.localeCompare(a));

  return (
    <>
      <AppNav name={profile.name} role={profile.role} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-col justify-between gap-5 border-b border-stone-200 pb-6 sm:flex-row sm:items-end">
          <div>
            <Link className="text-sm font-medium text-moss hover:text-ink" href={`/teacher?week=${selectedWeekStart}`}>
              Back to assigned groups
            </Link>
            <h1 className="mt-2 text-3xl font-semibold text-ink">{assignment.group_name}</h1>
            <p className="mt-2 text-stone-600">
              {assignment.masjid_name} · {assignment.cohort_name} · {formatWeekRange(selectedWeekStart)}
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
        {status === "grade-invalid" || status === "grade-error" ? (
          <p aria-live="polite" className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="status">
            Unable to save the grade. Present students need a whole-number recitation score from 10 to 50.
          </p>
        ) : null}
        {status === "grade-denied" ? (
          <p aria-live="polite" className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="status">
            The assignment or student roster changed. Reload before grading.
          </p>
        ) : null}
        {status === "plan-error" || status === "plan-missing" ? (
          <p aria-live="polite" className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="status">
            The weekly plan is unavailable or no longer belongs to this assigned roster.
          </p>
        ) : null}

        <section className="mt-6 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-ink">Roster</h2>
            <p className="mt-1 text-sm text-stone-600">{roster.length} students effective for this tracker week</p>
          </div>
          {roster.length ? (
            <div className="divide-y divide-stone-200">
              {roster.map((student) => {
                const plan = planByStudentId.get(student.id) ?? null;
                const grade = gradeByStudentId.get(student.id) ?? null;

                return (
                  <article className="p-5" key={student.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-ink">{student.name}</h3>
                        <p className="mt-1 text-sm text-stone-600">
                          {grade
                            ? `${grade.attended ? "Present" : "Absent"} · ${grade.attendance_points + grade.recitation_points} / 150`
                            : "No halaqa grade saved"}
                        </p>
                        {grade ? (
                          <p className="mt-1 text-xs text-stone-500">
                            Last saved {formatDateTimeInAppTimeZone(grade.updated_at ?? grade.graded_at)}
                          </p>
                        ) : null}
                        <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-sm sm:flex sm:flex-wrap sm:gap-x-8">
                          <div>
                            <dt className="text-xs text-stone-500">Daily check-ins</dt>
                            <dd className="font-medium text-ink">
                              {student.dailyCheckinDays}/7 · {student.dailyPoints}/700
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-stone-500">Partner recitation</dt>
                            <dd className="font-medium text-ink">
                              {student.partnerRounds}/2 · {student.partnerPoints}/150
                            </dd>
                          </div>
                        </dl>
                      </div>
                      {plan ? (
                        <a
                          className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-ink hover:bg-stone-50"
                          href={`/teacher/plans/${student.id}?week=${selectedWeekStart}`}
                        >
                          View weekly plan
                        </a>
                      ) : (
                        <span className="rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-500">No weekly plan</span>
                      )}
                    </div>
                    <TeacherGradeForm
                      grade={grade}
                      groupId={groupId}
                      key={`${student.id}-${selectedWeekStart}-${grade?.updated_at ?? grade?.graded_at ?? "new"}`}
                      studentId={student.id}
                      weekStart={selectedWeekStart}
                    />
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="px-5 py-12 text-center text-stone-600">No active students are in this group for the selected week.</p>
          )}
        </section>
      </main>
    </>
  );
}
