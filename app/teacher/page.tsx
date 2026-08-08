import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle, ShieldCheck, Star, UsersThree } from "@phosphor-icons/react/dist/ssr";
import AppNav from "@/app/nav";
import TeacherWeekSelector from "@/app/teacher/week-selector";
import { formatWeekRange, friendlyDate, torontoCivilDateString, weekStartForDate } from "@/lib/dates";
import {
  assignmentWeekStarts,
  assignmentsForWeek,
  resolveAuthorizedTeacherWeekStart
} from "@/lib/teacher-dashboard";
import { loadTeacherSessionDashboards, requireTeacherExperience } from "@/lib/teacher-scope";

export const dynamic = "force-dynamic";

type TeacherDashboardSearchParams = { week?: string | string[] };

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
  const selectedWeekStart = resolveAuthorizedTeacherWeekStart(requestedWeek, currentWeekStart, assignments);

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
      <AppNav activeHref="/teacher" name={profile.name} role={profile.role} variant="teacher" />
      <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-8 sm:py-10">
        <header>
          <p className="text-sm font-bold uppercase tracking-wide text-gold">Teaching</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Published teaching groups</h1>
          <p className="mt-3 max-w-4xl text-base text-stone-600">
            All published teaching groups are accessible to you. Your assigned group is shown for responsibility emphasis only.
          </p>
        </header>

        <div className="mt-7">
          <TeacherWeekSelector presentation="card" selectedWeekStart={selectedWeekStart} weekStarts={weekStarts} />
        </div>

        {publishedDashboards.length ? (
          <div className="mt-6 space-y-6">
            {publishedDashboards.map((dashboard) => {
              const publication = dashboard.publication!;
              return (
                <section className="overflow-hidden rounded-xl border border-stone-300 bg-white" key={dashboard.scope.cohort_id}>
                  <div className="flex flex-col gap-3 border-b border-stone-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                    <div>
                      <h2 className="text-xl font-bold text-ink">
                        {dashboard.scope.masjid_name} · {dashboard.scope.cohort_kind === "brothers" ? "Brothers" : "Sisters"}
                      </h2>
                      <p className="mt-1 text-sm text-stone-600">Published roster · Version {publication.version_number}</p>
                    </div>
                    <p className="inline-flex w-fit items-center gap-2 rounded-lg bg-[#edf3ef] px-3 py-2 text-sm font-semibold text-moss">
                      <CheckCircle aria-hidden="true" className="size-5" weight="fill" />
                      Published roster · Version {publication.version_number}
                    </p>
                  </div>

                  <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-2">
                    {dashboard.groups.map((group) => (
                      <article
                        className={`relative flex min-h-[166px] flex-col justify-between rounded-xl border bg-white p-5 ${
                          group.is_assigned_group ? "border-[#dfc47e] border-l-4 bg-[#fffdf7] sm:pt-14" : "border-stone-200"
                        }`}
                        key={group.group_id}
                      >
                        {group.is_assigned_group ? (
                          <span className="mb-4 inline-flex w-fit items-center gap-1.5 self-end rounded-lg bg-[#f8f0dc] px-3 py-2 text-xs font-bold text-[#9b6b12] sm:absolute sm:right-4 sm:top-4">
                            <Star aria-hidden="true" className="size-4" weight="fill" /> Your assigned group
                          </span>
                        ) : null}
                        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
                          <span className={`grid size-12 shrink-0 place-items-center rounded-full text-white ${group.is_assigned_group ? "bg-[#bf841d]" : "bg-moss"}`}>
                            <UsersThree aria-hidden="true" className="size-6" weight="fill" />
                          </span>
                          <div className="min-w-0 sm:w-40">
                            <h3 className="text-lg font-bold text-ink">{group.group_name}</h3>
                            <p className="mt-2 text-xs text-stone-500">Primary teacher</p>
                            <p className="mt-1 truncate text-sm font-medium text-ink">{group.primary_teacher_name}</p>
                          </div>
                          <dl className="grid flex-1 grid-cols-3 divide-x divide-stone-200 text-sm">
                            <div className="px-3"><dt className="text-xs text-stone-600">Students</dt><dd className="mt-1 text-xl font-bold text-moss">{group.roster_count}</dd></div>
                            <div className="px-3"><dt className="text-xs text-stone-600">Plans</dt><dd className="mt-1 text-xl font-bold text-moss">{group.weekly_plan_count}/{group.roster_count}</dd></div>
                            <div className="px-3"><dt className="text-xs text-stone-600">Graded progress</dt><dd className="mt-1 text-xl font-bold text-moss">{group.grade_progress.graded_count}/{group.grade_progress.roster_count}</dd></div>
                          </dl>
                          <Link
                            className="inline-flex min-h-11 items-center justify-center rounded-md bg-moss px-4 py-2 text-center text-sm font-semibold text-white hover:bg-ink"
                            href={`/teacher/groups/${group.group_id}?week=${selectedWeekStart}`}
                          >
                            Open grading workspace
                          </Link>
                        </div>
                        <p className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-moss">
                          Cohort access <CheckCircle aria-hidden="true" className="size-4" />
                        </p>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}

            {unpublishedDashboards.length ? (
              <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                <h2 className="text-lg font-semibold text-ink">Some authorized cohorts are not published yet</h2>
                <p className="mt-1 text-sm text-stone-700">Students, plans, and grading remain unavailable until an administrator publishes those Saturday rosters.</p>
              </section>
            ) : null}

            <aside className="flex items-start gap-3 rounded-xl border border-[#e6decf] bg-[#fbf8f1] px-5 py-5 text-sm text-stone-600">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-gold" />
              <p>
                Groups reflect the published Saturday roster for this week ({friendlyDate(publishedDashboards[0].publication!.halaqa_saturday)}) and may differ from permanent membership. Attendance and history remain unchanged.
              </p>
            </aside>
          </div>
        ) : selectedAssignments.length > 0 ? (
          <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-5 py-12 text-center">
            <h2 className="text-xl font-semibold text-ink">No published session roster</h2>
            <p className="mx-auto mt-2 max-w-xl text-stone-700">Your teaching capability is active, but an administrator has not published the roster for {formatWeekRange(selectedWeekStart)}.</p>
          </section>
        ) : (
          <section className="mt-8 border-y border-stone-200 py-12 text-center">
            <h2 className="text-xl font-semibold text-ink">{explicitlyUnavailable ? "You are not in rotation this week" : "No group assigned for this week"}</h2>
            <p className="mx-auto mt-2 max-w-xl text-stone-600">{explicitlyUnavailable ? "Your administrator marked you unavailable, so no halaqa group is assigned." : "There is no active teacher capability for the selected tracker week."}</p>
          </section>
        )}
      </main>
    </>
  );
}
