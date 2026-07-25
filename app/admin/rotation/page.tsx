import Link from "next/link";
import { redirect } from "next/navigation";
import AppNav from "@/app/nav";
import RotationScopeSelector from "@/app/admin/rotation/scope-selector";
import TeacherAvailabilityForm from "@/app/admin/rotation/teacher-availability-form";
import {
  RotationAvailabilityProvider,
  RotationPreviewGuard,
  RotationPublishButton
} from "@/app/admin/rotation/availability-state";
import {
  ROTATION_STATUS_MESSAGES,
  loadRotationPageData,
  type RotationSearchParams
} from "@/app/admin/rotation/data";
import {
  generateRotation,
  rebalanceStudentGroups,
  saveRotationSettings
} from "@/app/admin/rotation/actions";
import {
  formatHalaqaSaturday,
  halaqaWeekStarts
} from "@/lib/dates";
import { rotationPath } from "@/lib/rotation-scope";
import { requireProfile } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function statusFor(value: string | undefined) {
  return value ? ROTATION_STATUS_MESSAGES[value] : null;
}

function countLabel(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export default async function AdminRotationPage({
  searchParams
}: {
  searchParams: Promise<RotationSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { profile } = await requireProfile(["admin"]);
  const data = await loadRotationPageData({ profile, searchParams: resolvedSearchParams });

  if (data.canonicalPath) {
    redirect(data.canonicalPath);
  }

  const status = statusFor(resolvedSearchParams.status);
  const availableTeacherCount = data.teachers.filter((teacher) => teacher.available).length;
  const publishedAssignmentCount = data.assignments.filter(
    (assignment) => assignment.active && assignment.teacher_id
  ).length;
  const proposedAssignmentCount = data.persistencePlan?.run.assigned_count ?? 0;
  const newGroupCount = data.rebalancePreview?.groups.filter((group) => group.is_new).length ?? 0;
  const movedStudentCount = data.rebalancePreview?.moved_student_ids.length ?? 0;
  const rebalanceHasChanges = newGroupCount > 0 || movedStudentCount > 0;
  const weekStarts = halaqaWeekStarts();
  const publishReady = Boolean(
    data.context &&
      data.settings &&
      data.groups.length === data.settings.target_group_count &&
      data.students.length > 0 &&
      data.teachers.length > 0
  );

  function selectedContextPath(weekStart: string) {
    if (!data.context) {
      return "/admin/rotation";
    }

    return rotationPath({
      masjidId: data.context.masjid.id,
      cohortId: data.context.cohort.id,
      weekStart
    });
  }

  function weekLinkClass(weekStart: string, borderRight = false) {
    const active = data.selectedWeekStart === weekStart;

    return `${borderRight ? "border-r border-stone-300 " : ""}px-3 py-2.5 text-center text-xs font-medium ${
      active ? "bg-ink text-white" : "bg-white text-ink hover:bg-stone-50"
    }`;
  }

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <header>
          <p className="text-sm font-medium text-moss">Saturday halaqa operations</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">Weekly Rotation</h1>
          <p className="mt-1 text-sm text-stone-600">
            {data.context ? `${data.context.masjid.name} · ` : ""}
            {formatHalaqaSaturday(data.selectedWeekStart)}
          </p>
        </header>

        <section className="mt-5 border-y border-stone-200 bg-white px-4 py-4 sm:rounded-lg sm:border">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <RotationScopeSelector
              key={`${data.context?.masjid.id ?? "none"}:${data.context?.cohort.id ?? "none"}:${data.selectedWeekStart}`}
              contexts={data.contexts}
              selectedCohortId={resolvedSearchParams.cohort}
              selectedMasjidId={resolvedSearchParams.masjid}
              selectedWeekStart={data.selectedWeekStart}
            />

            <nav aria-label="Halaqa week" className="grid grid-cols-3 overflow-hidden rounded-md border border-stone-300">
              <Link
                className={weekLinkClass(weekStarts.previous, true)}
                href={selectedContextPath(weekStarts.previous)}
              >
                Previous
              </Link>
              <Link
                className={weekLinkClass(weekStarts.current, true)}
                href={selectedContextPath(weekStarts.current)}
              >
                This Saturday
              </Link>
              <Link
                className={weekLinkClass(weekStarts.next)}
                href={selectedContextPath(weekStarts.next)}
              >
                Next
              </Link>
            </nav>
          </div>
        </section>

        {status ? (
          <p className={`mt-5 rounded-md px-3 py-2.5 text-sm ${status.className}`}>{status.text}</p>
        ) : null}

        {data.setupIssues.length > 0 ? (
          <section className="mt-5 border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <h2 className="font-semibold">Needs attention</h2>
            <ul className="mt-1 space-y-1">
              {data.setupIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-label="Rotation readiness" className="mt-5 grid divide-y divide-stone-200 border-y border-stone-200 bg-white sm:grid-cols-4 sm:divide-x sm:divide-y-0 sm:rounded-lg sm:border">
          <div className="min-w-0 px-4 py-4">
            <p className="text-xs font-semibold uppercase text-stone-500">Students</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{data.students.length}</p>
            <p className="mt-1 text-xs text-stone-500">In this cohort</p>
          </div>
          <div className="min-w-0 px-4 py-4">
            <p className="text-xs font-semibold uppercase text-stone-500">Active groups</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{data.groups.length}</p>
            <p className="mt-1 text-xs text-stone-500">
              Target {data.settings?.target_group_count ?? "not set"}
            </p>
          </div>
          <div className="min-w-0 px-4 py-4">
            <p className="text-xs font-semibold uppercase text-stone-500">Available teachers</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{availableTeacherCount}</p>
            <p className="mt-1 text-xs text-stone-500">Of {data.teachers.length} active</p>
          </div>
          <div className="min-w-0 px-4 py-4">
            <p className="text-xs font-semibold uppercase text-stone-500">Assignment coverage</p>
            <p className="mt-1 text-2xl font-semibold text-ink">
              {proposedAssignmentCount}/{data.groups.length}
            </p>
            <p className="mt-1 text-xs text-stone-500">{publishedAssignmentCount} currently published</p>
          </div>
        </section>

        <div className="mt-6 space-y-6">
          <section className="border-y border-stone-200 bg-white px-4 py-5 sm:rounded-lg sm:border sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase text-moss">Step 1</p>
                <h2 className="mt-1 text-lg font-semibold text-ink">Group setup</h2>
                <p className="mt-1 text-sm text-stone-600">Balanced student groups effective this halaqa week.</p>
              </div>
              <form action={saveRotationSettings} className="flex flex-wrap items-end gap-2">
                <input name="masjid_id" type="hidden" value={data.context?.masjid.id ?? ""} />
                <input name="cohort_id" type="hidden" value={data.context?.cohort.id ?? ""} />
                <input name="week_start" type="hidden" value={data.selectedWeekStart} />
                <label className="block">
                  <span className="text-xs font-semibold text-stone-600">Target groups</span>
                  <input
                    className="mt-1 w-24 rounded-md border border-stone-300 px-3 py-2"
                    defaultValue={data.settings?.target_group_count ?? ""}
                    min={1}
                    name="target_group_count"
                    required
                    type="number"
                  />
                </label>
                <button
                  className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!data.context}
                >
                  Save target
                </button>
              </form>
            </div>

            {data.rebalancePreview ? (
              <>
                <div className="mt-5 overflow-x-auto border-y border-stone-200">
                  <table className="min-w-full divide-y divide-stone-200 text-sm">
                    <thead className="bg-stone-50">
                      <tr className="text-left text-stone-600">
                        <th className="px-3 py-2.5 font-medium">Group</th>
                        <th className="px-3 py-2.5 font-medium">Current students</th>
                        <th className="px-3 py-2.5 font-medium">After rebalance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {data.rebalancePreview.groups.map((group) => (
                        <tr key={group.id}>
                          <td className="px-3 py-3 font-medium text-ink">
                            {group.name}
                            {group.is_new ? (
                              <span className="ml-2 rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-800">
                                New
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 text-stone-700">{group.current_student_count}</td>
                          <td className="px-3 py-3 text-stone-700">{group.proposed_student_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {rebalanceHasChanges ? (
                  <form action={rebalanceStudentGroups} className="mt-4">
                    <input name="masjid_id" type="hidden" value={data.context?.masjid.id ?? ""} />
                    <input name="cohort_id" type="hidden" value={data.context?.cohort.id ?? ""} />
                    <input name="week_start" type="hidden" value={data.selectedWeekStart} />
                    <label className="flex items-start gap-3 border-l-4 border-amber-500 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                      <input
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-300 text-moss"
                        name="confirm_rebalance"
                        required
                        type="checkbox"
                        value="confirmed"
                      />
                      <span>
                        Confirm {countLabel(newGroupCount, "new group")} and {countLabel(movedStudentCount, "student move")} for {formatHalaqaSaturday(data.selectedWeekStart)}.
                      </span>
                    </label>
                    <button className="mt-3 rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-moss">
                      Apply student rebalance
                    </button>
                  </form>
                ) : (
                  <p className="mt-4 border-l-4 border-green-600 bg-green-50 px-3 py-2.5 text-sm text-green-900">
                    Student groups already match this balance.
                  </p>
                )}

                {data.students.length > 0 ? (
                  <details className="mt-4 border-t border-stone-200 pt-4">
                    <summary className="cursor-pointer text-sm font-medium text-ink">Current student groups</summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {data.students.map((student) => (
                        <div className="min-w-0 bg-stone-50 px-3 py-2" key={student.id}>
                          <p className="truncate text-sm font-medium text-ink">{student.name}</p>
                          <p className="truncate text-xs text-stone-500">{student.group_name}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </>
            ) : (
              <p className="mt-5 bg-stone-50 px-3 py-3 text-sm text-stone-600">
                Save a valid target group count to load the balance preview.
              </p>
            )}
          </section>

          <RotationAvailabilityProvider
            initialAvailableTeacherIds={data.teachers
              .filter((teacher) => teacher.available)
              .map((teacher) => teacher.id)}
          >
            <section className="border-y border-stone-200 bg-white px-4 py-5 sm:rounded-lg sm:border sm:p-6">
              <div>
                <p className="text-xs font-semibold uppercase text-moss">Step 2</p>
                <h2 className="mt-1 text-lg font-semibold text-ink">Teacher availability</h2>
                <p className="mt-1 text-sm text-stone-600">Availability applies only to this cohort and Saturday.</p>
              </div>
              {data.context ? (
                <TeacherAvailabilityForm
                  key={`${data.context.cohort.id}:${data.selectedWeekStart}`}
                  cohortId={data.context.cohort.id}
                  masjidId={data.context.masjid.id}
                  teachers={data.teachers}
                  weekStart={data.selectedWeekStart}
                />
              ) : null}
            </section>

            <section className="border-y border-stone-200 bg-white px-4 py-5 sm:rounded-lg sm:border sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-moss">Step 3</p>
                  <h2 className="mt-1 text-lg font-semibold text-ink">Assignment preview</h2>
                  <p className="mt-1 text-sm text-stone-600">One teacher per group for this Saturday.</p>
                </div>
                <form action={generateRotation}>
                  <input name="masjid_id" type="hidden" value={data.context?.masjid.id ?? ""} />
                  <input name="cohort_id" type="hidden" value={data.context?.cohort.id ?? ""} />
                  <input name="week_start" type="hidden" value={data.selectedWeekStart} />
                  <RotationPublishButton baseDisabled={!publishReady} />
                </form>
              </div>

              <RotationPreviewGuard>
                <>
                  {data.persistencePlan?.rotationPlan.warnings.length ? (
                    <div className="mt-4 space-y-2">
                      {data.persistencePlan.rotationPlan.warnings.map((warning) => (
                        <p className="border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950" key={warning.code}>
                          {warning.message}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-5 overflow-x-auto border-y border-stone-200">
                    <table className="min-w-full divide-y divide-stone-200 text-sm">
                      <thead className="bg-stone-50">
                        <tr className="text-left text-stone-600">
                          <th className="px-3 py-2.5 font-medium">Group</th>
                          <th className="px-3 py-2.5 font-medium">Students</th>
                          <th className="px-3 py-2.5 font-medium">Current teacher</th>
                          <th className="px-3 py-2.5 font-medium">Proposed teacher</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {data.groups.length > 0 ? (
                          data.groups.map((group) => {
                            const currentAssignment = data.assignments.find(
                              (assignment) => assignment.group_id === group.id
                            );
                            const proposedAssignment = data.persistencePlan?.assignmentUpserts.find(
                              (assignment) => assignment.group_id === group.id
                            );
                            const proposedTeacher = proposedAssignment
                              ? data.teachers.find((teacher) => teacher.id === proposedAssignment.teacher_id)
                              : null;

                            return (
                              <tr key={group.id}>
                                <td className="px-3 py-3 font-medium text-ink">{group.name}</td>
                                <td className="px-3 py-3 text-stone-700">{group.student_count}</td>
                                <td className="px-3 py-3 text-stone-700">
                                  {currentAssignment?.teacher_name ?? "Unassigned"}
                                </td>
                                <td className={`px-3 py-3 font-medium ${proposedTeacher ? "text-green-800" : "text-amber-800"}`}>
                                  {proposedTeacher?.name ?? "Unassigned"}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td className="px-3 py-4 text-stone-600" colSpan={4}>No active groups yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              </RotationPreviewGuard>
            </section>
          </RotationAvailabilityProvider>
        </div>
      </main>
    </>
  );
}
