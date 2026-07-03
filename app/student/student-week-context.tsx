import AppNav from "@/app/nav";
import { formatWeekRange } from "@/lib/dates";
import type { Role } from "@/lib/types";
import type { StudentWeekScope, StudentWeekTeacher } from "@/lib/student-scope";

export function StudentSetupIncomplete({
  name,
  role,
  weekStart
}: {
  name: string;
  role: Role;
  weekStart: string;
}) {
  return (
    <>
      <AppNav role={role} name={name} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium uppercase text-moss">Halaqa setup</p>
          <h1 className="mt-2 text-2xl font-semibold text-ink">Assignment pending</h1>
          <p className="mt-2 text-stone-600">
            Your account is active, but it is not assigned to a halaqa group for {formatWeekRange(weekStart)}.
          </p>
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Ask an admin to assign your cohort and group before using check-ins, weekly plans, recitation, grades, and
            leaderboard.
          </p>
        </section>
      </main>
    </>
  );
}

export function StudentWeekContextPanel({
  scope,
  teacher
}: {
  scope: StudentWeekScope;
  teacher: StudentWeekTeacher | null;
}) {
  return (
    <div className="mt-5 grid gap-3 rounded-md border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700 md:grid-cols-3">
      <p>
        <span className="block font-medium text-ink">Masjid</span>
        {scope.masjidName}
      </p>
      <p>
        <span className="block font-medium text-ink">Cohort and group</span>
        {scope.cohortName} · {scope.groupName}
      </p>
      <p>
        <span className="block font-medium text-ink">This week&apos;s teacher</span>
        {teacher?.teacher_name ?? "Not assigned yet"}
      </p>
    </div>
  );
}
