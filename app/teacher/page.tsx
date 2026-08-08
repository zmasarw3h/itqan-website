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
      <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-8 sm:py-10">
        <header>
          <p className="text-xs font-bold uppercase tracking-wide text-gold sm:text-sm">Teaching</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:mt-2 sm:text-4xl">Published teaching groups</h1>
          <p className="mt-2 max-w-4xl text-sm leading-5 text-stone-600 sm:mt-3 sm:text-base">
            All published teaching groups are accessible to you. Your assigned group is shown for responsibility emphasis only.
          </p>
        </header>

        <div className="mt-4 sm:mt-7">
          <TeacherWeekSelector presentation="card" selectedWeekStart={selectedWeekStart} weekStarts={weekStarts} />
        </div>

        {publishedDashboards.length ? (
          <div className="mt-4 space-y-5 sm:mt-6 sm:space-y-6">
            {publishedDashboards.map((dashboard) => {
              const publication = dashboard.publication!;
              return (
                <section className="overflow-hidden border-y border-stone-300 bg-transparent sm:rounded-xl sm:border sm:bg-white" key={dashboard.scope.cohort_id}>
                  <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-1 py-3 sm:px-8 sm:py-5">
                    <div>
                      <h2 className="text-base font-bold text-ink sm:text-xl">
                        {dashboard.scope.masjid_name} · {dashboard.scope.cohort_kind === "brothers" ? "Brothers" : "Sisters"}
                      </h2>
                      <p className="mt-1 hidden text-sm text-stone-600 sm:block">Published roster · Version {publication.version_number}</p>
                    </div>
                    <p className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md bg-[#edf3ef] px-2 py-1.5 text-xs font-semibold text-moss sm:gap-2 sm:rounded-lg sm:px-3 sm:py-2 sm:text-sm">
                      <CheckCircle aria-hidden="true" className="size-4 sm:size-5" weight="fill" />
                      <span className="sm:hidden">Version {publication.version_number}</span><span className="hidden sm:inline">Published roster · Version {publication.version_number}</span>
                    </p>
                  </div>

                  <div className="grid divide-y divide-stone-200 sm:gap-3 sm:divide-y-0 sm:p-4 lg:grid-cols-2">
                    {dashboard.groups.map((group) => (
                      <article
                        className={`relative flex flex-col bg-white px-1 py-4 sm:min-h-[166px] sm:justify-between sm:rounded-xl sm:border sm:p-5 ${
                          group.is_assigned_group ? "border-l-2 border-l-[#c6902d] bg-[#fffdf7] pl-3 pt-12 sm:border-[#dfc47e] sm:border-l-4 sm:pt-14" : "sm:border-stone-200"
                        }`}
                        key={group.group_id}
                      >
                        {group.is_assigned_group ? (
                          <span className="absolute right-1 top-3 inline-flex w-fit items-center gap-1 rounded-md bg-[#f8f0dc] px-2 py-1 text-[11px] font-bold text-[#9b6b12] sm:right-4 sm:top-4 sm:gap-1.5 sm:rounded-lg sm:px-3 sm:py-2 sm:text-xs">
                            <Star aria-hidden="true" className="size-3.5 sm:size-4" weight="fill" /> Your assigned group
                          </span>
                        ) : null}
                        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:flex-nowrap sm:gap-4">
                          <span className={`grid size-9 shrink-0 place-items-center rounded-full text-white sm:size-12 ${group.is_assigned_group ? "bg-[#bf841d]" : "bg-moss"}`}>
                            <UsersThree aria-hidden="true" className="size-5 sm:size-6" weight="fill" />
                          </span>
                          <div className="min-w-0 flex-1 sm:w-40 sm:flex-none">
                            <h3 className="font-bold text-ink sm:text-lg">{group.group_name}</h3>
                            <p className="mt-0.5 truncate text-xs text-stone-600 sm:mt-2 sm:text-stone-500"><span className="sm:hidden">Primary: </span><span className="hidden sm:inline">Primary teacher<br /></span><span className="font-medium text-ink">{group.primary_teacher_name}</span></p>
                          </div>
                          <dl className="grid w-full basis-full grid-cols-3 divide-x divide-stone-200 text-sm sm:w-auto sm:basis-auto sm:flex-1">
                            <div className="px-2 first:pl-0 sm:px-3"><dt className="text-[11px] text-stone-600 sm:text-xs">Students</dt><dd className="mt-0.5 text-lg font-bold text-moss sm:mt-1 sm:text-xl">{group.roster_count}</dd></div>
                            <div className="px-2 sm:px-3"><dt className="text-[11px] text-stone-600 sm:text-xs">Plans</dt><dd className="mt-0.5 text-lg font-bold text-moss sm:mt-1 sm:text-xl">{group.weekly_plan_count}/{group.roster_count}</dd></div>
                            <div className="px-2 sm:px-3"><dt className="text-[11px] text-stone-600 sm:text-xs">Graded</dt><dd className="mt-0.5 text-lg font-bold text-moss sm:mt-1 sm:text-xl">{group.grade_progress.graded_count}/{group.grade_progress.roster_count}</dd></div>
                          </dl>
                          <Link
                            className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-moss px-4 py-2 text-center text-sm font-semibold text-white hover:bg-ink sm:w-auto"
                            href={`/teacher/groups/${group.group_id}?week=${selectedWeekStart}`}
                          >
                            Open grading workspace
                          </Link>
                        </div>
                        <p className="mt-4 hidden items-center gap-2 text-sm font-medium text-moss sm:inline-flex">
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
