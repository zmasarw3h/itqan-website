import Link from "next/link";
import { StudentPage } from "@/app/student/student-ui";
import { formatWeekRange } from "@/lib/dates";
import type { Role } from "@/lib/types";
import type { StudentWeekScope, StudentWeekTeacher } from "@/lib/student-scope";

export function StudentSetupIncomplete({
  weekStart,
  teacher
}: {
  name: string;
  role: Role;
  weekStart: string;
  teacher?: StudentWeekTeacher | null;
}) {
  return (
    <StudentPage width="standard">
      <section className="student-assignment-pending">
        <p className="student-assignment-eyebrow">Halaqa setup</p>
        <h1>Assignment pending</h1>
        <p className="student-assignment-lead">Your account is active, but it is not assigned to a halaqa group for {formatWeekRange(weekStart)}.</p>
        <div className="student-assignment-notice">Ask an admin to assign your cohort and group before using check-ins, weekly plans, partner recitation, grades, history, leaderboard, and badge awards.</div>
        <dl>
          <div><dt>Account status</dt><dd>Active</dd></div>
          <div><dt>Week</dt><dd>{formatWeekRange(weekStart)}</dd></div>
          <div><dt>Halaqa assignment</dt><dd>Not assigned</dd></div>
        </dl>
        <h2>What to do next</h2>
        <p>Contact your ITQAN administrator and ask them to complete your halaqa assignment.</p>
        <Link href="/account/change-password">Open account &amp; security</Link>
        {teacher ? <p className="student-assignment-historical">A historical teacher is recorded for this week, but an active halaqa assignment is still required.</p> : null}
      </section>
    </StudentPage>
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
