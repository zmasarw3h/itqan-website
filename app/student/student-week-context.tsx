import AppNav from "@/app/nav";
import { StudentNotice, StudentPage, StudentPageHeader, StudentSurface } from "@/app/student/student-ui";
import { formatWeekRange } from "@/lib/dates";
import type { Role } from "@/lib/types";
import type { StudentWeekScope, StudentWeekTeacher } from "@/lib/student-scope";

export function StudentSetupIncomplete({
  name,
  role,
  weekStart,
  teacher
}: {
  name: string;
  role: Role;
  weekStart: string;
  teacher?: StudentWeekTeacher | null;
}) {
  return (
    <>
      <AppNav role={role} name={name} />
      <StudentPage width="narrow">
        <StudentSurface emphasis="primary">
          <StudentPageHeader
            eyebrow="Halaqa setup"
            title="Assignment pending"
            description={
              <>Your account is active, but it is not assigned to a halaqa group for {formatWeekRange(weekStart)}.</>
            }
          />
          <StudentNotice className="mt-5" tone="warning">
            Ask an admin to assign your cohort and group before using check-ins, weekly plans, recitation, grades, and
            leaderboard.
          </StudentNotice>
          {teacher ? (
            <p className="mt-4 text-sm text-stone-700">
              Assigned teacher for this historical week: <span className="font-medium text-ink">{teacher.teacher_name}</span>
            </p>
          ) : null}
        </StudentSurface>
      </StudentPage>
    </>
  );
}

export function StudentWeekContextPanel({
  scope,
  teacher,
  layout = "inline"
}: {
  scope: StudentWeekScope;
  teacher: StudentWeekTeacher | null;
  layout?: "inline" | "stacked";
}) {
  const panelClass =
    layout === "stacked"
      ? "grid gap-0 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white px-5 text-sm text-stone-700 shadow-sm"
      : "mt-5 grid gap-4 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700 sm:p-5 md:grid-cols-3";
  const itemClass = layout === "stacked" ? "py-5 first:pt-5 last:pb-5" : "";

  return (
    <dl className={panelClass}>
      <div className={itemClass}>
        <dt className="font-medium text-ink">Masjid</dt>
        <dd className="mt-1 leading-6">{scope.masjidName}</dd>
      </div>
      <div className={itemClass}>
        <dt className="font-medium text-ink">Cohort and group</dt>
        <dd className="mt-1 leading-6">
          {scope.cohortName} · {scope.groupName}
        </dd>
      </div>
      <div className={itemClass}>
        <dt className="font-medium text-ink">This week&apos;s teacher</dt>
        <dd className="mt-1 leading-6">{teacher?.teacher_name ?? "Not assigned yet"}</dd>
      </div>
    </dl>
  );
}
