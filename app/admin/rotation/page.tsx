import AppNav from "@/app/nav";
import RotationScopeSelector from "@/app/admin/rotation/scope-selector";
import {
  ROTATION_STATUS_MESSAGES,
  loadRotationPageData,
  type RotationSearchParams
} from "@/app/admin/rotation/data";
import {
  generateRotation,
  saveRotationSettings,
  saveTeacherAvailability
} from "@/app/admin/rotation/actions";
import { formatWeekRange } from "@/lib/dates";
import { requireProfile } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function statusFor(value: string | undefined) {
  return value ? ROTATION_STATUS_MESSAGES[value] : null;
}

function availabilityLabel(availableCount: number, teacherCount: number) {
  if (teacherCount === 0) {
    return "No teachers";
  }

  return `${availableCount} / ${teacherCount} available`;
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

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Weekly Rotation</h1>
            <p className="mt-1 text-sm text-stone-600">
              {data.context
                ? `${data.context.masjid.name} · ${data.context.cohort.name} · ${data.selectedWeekLabel}`
                : data.selectedWeekLabel}
            </p>
          </div>
          <RotationScopeSelector
            contexts={data.contexts}
            selectedCohortId={resolvedSearchParams.cohort}
            selectedMasjidId={resolvedSearchParams.masjid}
            selectedWeekStart={data.selectedWeekStart}
          />
        </div>

        {status ? (
          <p className={`mt-6 rounded-md px-3 py-2 text-sm ${status.className}`}>{status.text}</p>
        ) : null}

        {data.setupIssues.length > 0 ? (
          <section className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <h2 className="font-semibold">Setup incomplete</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {data.setupIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-stone-600">Target groups</p>
            <p className="mt-2 text-3xl font-semibold text-ink">
              {data.settings?.target_group_count ?? "Not set"}
            </p>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-stone-600">Active groups</p>
            <p className="mt-2 text-3xl font-semibold text-ink">{data.groups.length}</p>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-stone-600">Students</p>
            <p className="mt-2 text-3xl font-semibold text-ink">{data.students.length}</p>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-stone-600">Teachers</p>
            <p className="mt-2 text-3xl font-semibold text-ink">
              {availabilityLabel(availableTeacherCount, data.teachers.length)}
            </p>
          </div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
          <div className="space-y-6">
            <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-ink">Teacher Availability</h2>
                  <p className="mt-1 text-sm text-stone-600">{formatWeekRange(data.selectedWeekStart)}</p>
                </div>
                <form action={saveRotationSettings} className="flex flex-wrap items-end gap-2">
                  <input name="masjid_id" type="hidden" value={data.context?.masjid.id ?? ""} />
                  <input name="cohort_id" type="hidden" value={data.context?.cohort.id ?? ""} />
                  <input name="week_start" type="hidden" value={data.selectedWeekStart} />
                  <label className="block">
                    <span className="text-sm font-medium text-ink">Target group count</span>
                    <input
                      className="mt-1 w-32 rounded-md border border-stone-300 px-3 py-2"
                      defaultValue={data.settings?.target_group_count ?? ""}
                      min={1}
                      name="target_group_count"
                      required
                      type="number"
                    />
                  </label>
                  <button
                    className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!data.context}
                  >
                    Save
                  </button>
                </form>
              </div>

              <form action={saveTeacherAvailability} className="mt-5">
                <input name="masjid_id" type="hidden" value={data.context?.masjid.id ?? ""} />
                <input name="cohort_id" type="hidden" value={data.context?.cohort.id ?? ""} />
                <input name="week_start" type="hidden" value={data.selectedWeekStart} />
                <div className="divide-y divide-stone-200 rounded-md border border-stone-200">
                  {data.teachers.length > 0 ? (
                    data.teachers.map((teacher) => (
                      <label
                        className="flex items-center justify-between gap-4 px-4 py-3"
                        key={teacher.id}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-ink">{teacher.name}</span>
                          <span className="block truncate text-xs text-stone-500">{teacher.email}</span>
                        </span>
                        <input
                          className="h-5 w-5 rounded border-stone-300 text-moss"
                          defaultChecked={teacher.available}
                          name="available_teacher_id"
                          type="checkbox"
                          value={teacher.id}
                        />
                      </label>
                    ))
                  ) : (
                    <p className="px-4 py-3 text-sm text-stone-600">No active teachers found.</p>
                  )}
                </div>
                <button
                  className="mt-4 rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!data.context}
                >
                  Save availability
                </button>
              </form>
            </section>

            <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-ink">Assignments</h2>
                  <p className="mt-1 text-sm text-stone-600">One active teacher per group for the selected week.</p>
                </div>
                <form action={generateRotation}>
                  <input name="masjid_id" type="hidden" value={data.context?.masjid.id ?? ""} />
                  <input name="cohort_id" type="hidden" value={data.context?.cohort.id ?? ""} />
                  <input name="week_start" type="hidden" value={data.selectedWeekStart} />
                  <button
                    className="rounded-md bg-gold px-4 py-2.5 text-sm font-semibold text-ink hover:bg-moss hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!data.context || !data.settings}
                  >
                    Generate / rebalance
                  </button>
                </form>
              </div>

              {data.persistencePlan?.rotationPlan.warnings.length ? (
                <div className="mt-4 space-y-2">
                  {data.persistencePlan.rotationPlan.warnings.map((warning) => (
                    <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" key={warning.code}>
                      {warning.message}
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-stone-200 text-sm">
                  <thead>
                    <tr className="text-left text-stone-600">
                      <th className="py-2 pr-4 font-medium">Group</th>
                      <th className="py-2 pr-4 font-medium">Current teacher</th>
                      <th className="py-2 pr-4 font-medium">Generated teacher</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {data.groups.map((group) => {
                      const currentAssignment = data.assignments.find((assignment) => assignment.group_id === group.id);
                      const generatedAssignment = data.persistencePlan?.assignmentUpserts.find(
                        (assignment) => assignment.group_id === group.id
                      );
                      const generatedTeacher = generatedAssignment
                        ? data.teachers.find((teacher) => teacher.id === generatedAssignment.teacher_id)
                        : null;

                      return (
                        <tr key={group.id}>
                          <td className="py-3 pr-4 font-medium text-ink">{group.name}</td>
                          <td className="py-3 pr-4 text-stone-700">
                            {currentAssignment?.teacher_name ?? "Unassigned"}
                          </td>
                          <td className="py-3 pr-4 text-stone-700">
                            {generatedTeacher?.name ?? "Unassigned"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-ink">Group Sizes</h2>
              <div className="mt-4 space-y-3">
                {data.groups.length > 0 ? (
                  data.groups.map((group) => (
                    <div className="flex items-center justify-between gap-3" key={group.id}>
                      <span className="text-sm font-medium text-ink">{group.name}</span>
                      <span className="rounded-md bg-stone-100 px-2 py-1 text-sm text-stone-700">
                        {group.student_count}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-stone-600">No groups yet.</p>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-ink">Students</h2>
              <div className="mt-4 max-h-96 space-y-3 overflow-y-auto pr-1">
                {data.students.length > 0 ? (
                  data.students.map((student) => (
                    <div className="rounded-md bg-stone-50 px-3 py-2" key={student.id}>
                      <p className="truncate text-sm font-medium text-ink">{student.name}</p>
                      <p className="text-xs text-stone-500">{student.group_name}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-stone-600">No students assigned for this week.</p>
                )}
              </div>
            </section>
          </aside>
        </section>
      </main>
    </>
  );
}
