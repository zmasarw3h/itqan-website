import Link from "next/link";
import AppNav from "@/app/nav";
import TeacherWeekSelector from "@/app/teacher/week-selector";
import { formatWeekRange, todayDateString, weekStartForDate } from "@/lib/dates";
import {
  assignmentWeekStarts,
  assignmentsForWeek,
  resolveTeacherWeekStart
} from "@/lib/teacher-dashboard";
import { loadTeacherAssignmentContexts, requireTeacherExperience } from "@/lib/teacher-scope";

export const dynamic = "force-dynamic";

type TeacherDashboardSearchParams = {
  week?: string | string[];
};

export default async function TeacherDashboardPage({
  searchParams
}: {
  searchParams: Promise<TeacherDashboardSearchParams>;
}) {
  const { supabase, profile } = await requireTeacherExperience();
  const currentWeekStart = weekStartForDate(todayDateString());
  const [resolvedSearchParams, assignments] = await Promise.all([
    searchParams,
    loadTeacherAssignmentContexts(supabase)
  ]);
  const selectedWeekStart = resolveTeacherWeekStart(resolvedSearchParams.week, currentWeekStart);
  const weekStarts = assignmentWeekStarts(assignments, currentWeekStart);
  const selectedAssignments = assignmentsForWeek(assignments, selectedWeekStart);

  const { data: availability } = await supabase
    .from("teacher_rotation_availability")
    .select("available")
    .eq("teacher_id", profile.id)
    .eq("week_start", selectedWeekStart)
    .returns<Array<{ available: boolean }>>();
  const explicitlyUnavailable = Boolean(availability?.length && availability.every((row) => !row.available));

  return (
    <>
      <AppNav name={profile.name} role={profile.role} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-col justify-between gap-5 border-b border-stone-200 pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-semibold text-gold">TEACHING</p>
            <h1 className="mt-1 text-3xl font-semibold text-ink">Assigned groups</h1>
            <p className="mt-2 max-w-2xl text-stone-600">
              Saturday halaqa assignments for {formatWeekRange(selectedWeekStart)}.
            </p>
          </div>
          <TeacherWeekSelector selectedWeekStart={selectedWeekStart} weekStarts={weekStarts} />
        </div>

        {selectedAssignments.length > 0 ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {selectedAssignments.map((assignment) => (
              <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm" key={assignment.assignment_id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-moss">{assignment.masjid_name}</p>
                    <h2 className="mt-1 text-xl font-semibold text-ink">{assignment.group_name}</h2>
                    <p className="mt-1 text-sm text-stone-600">
                      {assignment.cohort_name} · {assignment.cohort_kind === "brothers" ? "Brothers" : "Sisters"}
                    </p>
                  </div>
                  <div className="min-w-20 rounded-md bg-stone-50 px-3 py-2 text-right">
                    <p className="text-2xl font-semibold text-ink">{assignment.roster_count}</p>
                    <p className="text-xs text-stone-500">Students</p>
                  </div>
                </div>
                <Link
                  className="mt-5 inline-flex rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink"
                  href={`/teacher/groups/${assignment.group_id}?week=${selectedWeekStart}`}
                >
                  Open group
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <section className="mt-8 border-y border-stone-200 py-12 text-center">
            <h2 className="text-xl font-semibold text-ink">
              {explicitlyUnavailable ? "You are not in rotation this week" : "No group assigned for this week"}
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-stone-600">
              {explicitlyUnavailable
                ? "Your administrator marked you unavailable, so no halaqa group is assigned."
                : "There is no active group assignment for the selected tracker week."}
            </p>
          </section>
        )}
      </main>
    </>
  );
}
