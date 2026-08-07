import Link from "next/link";
import { redirect } from "next/navigation";
import AppNav from "@/app/nav";
import TeacherWeekSelector from "@/app/teacher/week-selector";
import { formatWeekRange, torontoCivilDateString, weekStartForDate } from "@/lib/dates";
import {
  assignmentWeekStarts,
  assignmentsForWeek,
  resolveAuthorizedTeacherWeekStart
} from "@/lib/teacher-dashboard";
import { loadTeacherSessionDashboards, requireTeacherExperience } from "@/lib/teacher-scope";

export const dynamic = "force-dynamic";

type TeacherDashboardSearchParams = {
  week?: string | string[];
};

export default async function TeacherDashboardPage({
  searchParams
}: {
  searchParams: Promise<TeacherDashboardSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile, assignments } = await requireTeacherExperience();
  const currentWeekStart = weekStartForDate(torontoCivilDateString());
  const requestedWeek = Array.isArray(resolvedSearchParams.week)
    ? resolvedSearchParams.week[0]
    : resolvedSearchParams.week;
  const selectedWeekStart = resolveAuthorizedTeacherWeekStart(
    requestedWeek,
    currentWeekStart,
    assignments
  );

  if (requestedWeek && requestedWeek !== selectedWeekStart) {
    redirect(`/teacher?week=${selectedWeekStart}`);
  }

  const weekStarts = assignmentWeekStarts(assignments, currentWeekStart);
  const selectedAssignments = assignmentsForWeek(assignments, selectedWeekStart);
  const sessionDashboards = await loadTeacherSessionDashboards(supabase, selectedWeekStart);
  const publishedDashboards = sessionDashboards.filter((dashboard) => dashboard.publication !== null);
  const unpublishedDashboards = sessionDashboards.filter((dashboard) => dashboard.publication === null);

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
            <h1 className="mt-1 text-3xl font-semibold text-ink">Published teaching groups</h1>
            <p className="mt-2 max-w-2xl text-stone-600">
              Current published Saturday session rosters for {formatWeekRange(selectedWeekStart)}. Your assigned group
              is shown as a responsibility highlight; it does not limit cohort access.
            </p>
          </div>
          <TeacherWeekSelector selectedWeekStart={selectedWeekStart} weekStarts={weekStarts} />
        </div>

        {publishedDashboards.length ? (
          <div className="mt-6 space-y-6">
            {publishedDashboards.map((dashboard) => {
              const publication = dashboard.publication!;

              return (
                <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm" key={dashboard.scope.cohort_id}>
                  <div className="flex flex-col justify-between gap-3 border-b border-stone-200 pb-4 sm:flex-row sm:items-start">
                    <div>
                      <p className="text-sm font-medium text-moss">{dashboard.scope.masjid_name}</p>
                      <h2 className="mt-1 text-xl font-semibold text-ink">{dashboard.scope.cohort_name}</h2>
                      <p className="mt-1 text-sm text-stone-600">
                        {dashboard.scope.cohort_kind === "brothers" ? "Brothers" : "Sisters"} · Published version {publication.version_number}
                      </p>
                    </div>
                    <p className="rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-600">
                      Halaqa Saturday {publication.halaqa_saturday}
                    </p>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {dashboard.groups.map((group) => (
                      <article className="rounded-lg border border-stone-200 p-4" key={group.group_id}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <h3 className="text-lg font-semibold text-ink">{group.group_name}</h3>
                            <p className="mt-1 text-sm text-stone-600">
                              Primary teacher: {group.primary_teacher_name}
                            </p>
                          </div>
                          {group.is_assigned_group ? (
                            <span className="rounded-md bg-gold/15 px-2.5 py-1 text-xs font-medium text-ink">
                              Assigned responsibility
                            </span>
                          ) : (
                            <span className="rounded-md bg-stone-50 px-2.5 py-1 text-xs text-stone-500">
                              Cohort access
                            </span>
                          )}
                        </div>
                        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                          <div>
                            <dt className="text-xs text-stone-500">Students</dt>
                            <dd className="font-medium text-ink">{group.roster_count}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-stone-500">Plans</dt>
                            <dd className="font-medium text-ink">{group.weekly_plan_count}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-stone-500">Grades</dt>
                            <dd className="font-medium text-ink">
                              {group.grade_progress.graded_count}/{group.grade_progress.roster_count}
                            </dd>
                          </div>
                        </dl>
                        <Link
                          className="mt-5 inline-flex rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink"
                          href={`/teacher/groups/${group.group_id}?week=${selectedWeekStart}`}
                        >
                          Open group
                        </Link>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}

            {unpublishedDashboards.length ? (
              <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
                <h2 className="text-lg font-semibold text-ink">Some authorized cohorts are not published yet</h2>
                <p className="mt-1 text-sm text-stone-700">
                  No teacher roster, plan link, or grade form is available for those cohorts until an administrator
                  publishes the Saturday session roster.
                </p>
              </section>
            ) : null}
          </div>
        ) : selectedAssignments.length > 0 ? (
          <section className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-5 py-12 text-center">
            <h2 className="text-xl font-semibold text-ink">No published session roster</h2>
            <p className="mx-auto mt-2 max-w-xl text-stone-700">
              Your teaching capability is active, but an administrator has not published the roster for this tracker
              week. Students and grading actions will appear after publication.
            </p>
          </section>
        ) : (
          <section className="mt-8 border-y border-stone-200 py-12 text-center">
            <h2 className="text-xl font-semibold text-ink">
              {explicitlyUnavailable ? "You are not in rotation this week" : "No group assigned for this week"}
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-stone-600">
              {explicitlyUnavailable
                ? "Your administrator marked you unavailable, so no halaqa group is assigned."
                : "There is no active teacher capability for the selected tracker week."}
            </p>
          </section>
        )}
      </main>
    </>
  );
}
