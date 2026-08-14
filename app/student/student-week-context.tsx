import { CalendarBlank, Info, User, UsersThree } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { StudentAssignmentPendingMarker } from "@/app/student/student-shell";
import { StudentNotice, StudentPage } from "@/app/student/student-ui";
import { formatWeekRange } from "@/lib/dates";
import type { StudentWeekScope, StudentWeekTeacher } from "@/lib/student-scope";

export function StudentSetupIncomplete({
  weekStart
}: {
  weekStart: string;
}) {
  return (
    <StudentPage width="focused">
      <StudentAssignmentPendingMarker />
      <section className="max-w-2xl py-4 sm:py-8" data-student-assignment-pending>
        <p className="flex items-center gap-3 text-sm font-medium uppercase tracking-[0.08em] text-stone-700">
          <UsersThree aria-hidden className="text-gold" size={30} />
          Halaqa setup
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-forest sm:text-5xl">Assignment pending</h1>
        <p className="mt-5 max-w-xl text-lg leading-8 text-stone-700">
          Your account is active, but it is not assigned to an active halaqa context for {formatWeekRange(weekStart)}.
        </p>

        <StudentNotice className="mt-6 flex items-start gap-3 border-l-4 border-l-gold px-5 py-4" tone="warning">
          <Info aria-hidden className="mt-0.5 shrink-0 text-gold" size={24} />
          <span>
            Ask an administrator to assign your cohort and group before using check-ins, weekly plans, partner
            recitation, grades, history, leaderboard, and badge awards.
          </span>
        </StudentNotice>

        <dl className="mt-8 divide-y divide-stone-200 border-y border-stone-200">
          <div className="flex min-h-14 items-center justify-between gap-5 py-3">
            <dt className="flex items-center gap-3 text-stone-700"><User aria-hidden size={22} />Account status</dt>
            <dd className="font-medium text-ink">Active</dd>
          </div>
          <div className="flex min-h-14 items-center justify-between gap-5 py-3">
            <dt className="flex items-center gap-3 text-stone-700"><CalendarBlank aria-hidden size={22} />Week</dt>
            <dd className="text-right font-medium text-ink">{formatWeekRange(weekStart)}</dd>
          </div>
          <div className="flex min-h-14 items-center justify-between gap-5 py-3">
            <dt className="flex items-center gap-3 text-stone-700"><UsersThree aria-hidden size={22} />Halaqa assignment</dt>
            <dd className="text-right font-medium text-ink">Not assigned</dd>
          </div>
        </dl>

        <div className="mt-8">
          <h2 className="text-xl font-semibold text-forest">What to do next</h2>
          <p className="mt-2 max-w-lg leading-7 text-stone-700">
            Contact your ITQAN administrator and ask them to complete your halaqa assignment.
          </p>
          <Link className="mt-5 inline-flex min-h-11 items-center font-medium text-forest underline underline-offset-4" href="/account/change-password">
            Open account &amp; security
          </Link>
        </div>
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
