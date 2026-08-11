import Link from "next/link";
import { ArrowRight, CalendarBlank, CheckCircle, LockKey } from "@phosphor-icons/react/dist/ssr";
import { displayOfficialScoringBoundary } from "@/lib/official-scoring";
import type { AdminStudentSettingsData, AdminStudentWorkspaceShell } from "@/lib/admin-student-workspace";
import StudentDeleteForm from "./student-delete-form";

export function officialScoringSettingsHref(studentId: string, weekStart: string) {
  return `/admin/students/${studentId}/official-scoring?return_week=${encodeURIComponent(weekStart)}&return_view=settings`;
}

function boundaryCopy(settings: AdminStudentSettingsData) {
  const boundary = displayOfficialScoringBoundary(settings.scoreStartsOn);
  if (!settings.scoreStartsOn || settings.scoringStatus.state === "legacy") return boundary;
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${settings.scoreStartsOn}T12:00:00Z`)
  );
}

export default function StudentSettingsSection({
  settings,
  shell
}: {
  settings: AdminStudentSettingsData;
  shell: AdminStudentWorkspaceShell;
}) {
  const isLegacy = settings.scoringStatus.state === "legacy";

  return (
    <section className="py-8" aria-labelledby="student-settings-heading">
      <h2 className="text-2xl font-semibold text-ink" id="student-settings-heading">Student settings</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
        Manage this student&apos;s official scoring eligibility and account access.
      </p>

      <div className="mt-6 max-w-xl rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-lg font-semibold text-ink">Scoring eligibility</h3>
        <div className="mt-4 flex items-start gap-3">
          <CheckCircle className={isLegacy ? "mt-0.5 shrink-0 text-amber-700" : "mt-0.5 shrink-0 text-moss"} size={22} weight="fill" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold text-ink">{settings.scoringStatus.label}</p>
            <p className="mt-1 text-sm leading-6 text-stone-600">{settings.scoringStatus.description}</p>
          </div>
        </div>
        <div className="mt-5 flex items-start gap-3 border-t border-stone-100 pt-5">
          <CalendarBlank className="mt-0.5 shrink-0 text-moss" size={21} aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Official scoring boundary</p>
            <p className="mt-1 break-words font-semibold text-ink">{boundaryCopy(settings)}</p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-stone-600">
          Earlier weeks remain orientation activity. Changing this boundary uses a review and confirmation step.
        </p>
        <Link
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-moss px-4 py-2.5 text-sm font-semibold text-moss transition-colors hover:bg-green-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss sm:w-auto"
          href={officialScoringSettingsHref(shell.student.id, shell.selectedWeekStart)}
          prefetch={false}
        >
          Open scoring settings <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </div>

      {settings.canDeleteStudent ? (
        <div className="mt-12 border-t-2 border-red-200 pt-6">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700">
              <LockKey size={20} aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-lg font-semibold text-red-900">Danger zone</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">
                Permanently delete this student and all of their ITQAN records. This action cannot be undone.
              </p>
            </div>
          </div>
          <StudentDeleteForm
            redirectView="settings"
            redirectWeek={shell.selectedWeekStart}
            studentId={shell.student.id}
            studentName={shell.student.name}
          />
        </div>
      ) : null}
    </section>
  );
}
