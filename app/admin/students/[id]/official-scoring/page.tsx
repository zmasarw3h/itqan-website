import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarBlank, ChartBar, CheckCircle, Fire, Gift, Info, LockKey } from "@phosphor-icons/react/dist/ssr";
import AppNav from "@/app/nav";
import { reviewOfficialScoringStart } from "./actions";
import { isAdminStudentWorkspaceView } from "@/lib/admin-student-workspace";
import { canAdminManageStudentForWeek, requireScopedAdmin } from "@/lib/admin-scope";
import { addDays, formatWeekRange, isValidDateString, torontoCivilDateString, weekStartForDate } from "@/lib/dates";
import {
  displayOfficialScoringBoundary,
  isCanonicalScoringSunday,
  isLegacyOfficialScoringBoundary,
  officialScoringStatus,
  parseOfficialScoringChangePreview
} from "@/lib/official-scoring";
import type { Profile } from "@/lib/types";
import { OfficialScoringConfirmationForm, ReviewImpactButton } from "./submit-buttons";

export const dynamic = "force-dynamic";

type SearchParams = {
  proposed?: string;
  status?: string;
  return_to?: string;
  return_week?: string;
  return_view?: string;
};

function money(cents: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

function messageFor(status: string | undefined) {
  if (status === "invalid-date") return "Choose a Sunday that is not before the student's access eligibility.";
  if (status === "confirmation-mismatch") return "Type the student name exactly to confirm this change.";
  if (status === "stale") return "The scoring boundary changed while this review was open. Start a fresh review.";
  if (status === "scope-denied") return "This change crosses outside your authorized scope or requires a super admin.";
  if (status === "save-error") return "The change could not be saved. Review the details and try again.";
  if (status === "invalid") return "Complete the reason and confirmation fields before saving.";
  return null;
}

export default async function OfficialScoringPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase, adminSupabase, profile } = await requireScopedAdmin();
  const currentWeekStart = weekStartForDate(torontoCivilDateString());
  const canManage = await canAdminManageStudentForWeek(supabase, id, currentWeekStart);

  if (!canManage) notFound();

  const { data: student } = await adminSupabase
    .from("profiles")
    .select("id,name,email,phone,role,active,score_starts_on")
    .eq("id", id)
    .eq("role", "student")
    .eq("active", true)
    .single<Profile>();

  if (!student) notFound();

  const proposed = isCanonicalScoringSunday(query.proposed) ? query.proposed : null;
  const previewResponse = proposed
    ? await adminSupabase.rpc("preview_official_scoring_start_change", {
        input_actor_id: profile.id,
        input_student_id: student.id,
        input_score_starts_on: proposed
      })
    : null;
  const preview = previewResponse && !previewResponse.error
    ? parseOfficialScoringChangePreview(previewResponse.data)
    : null;
  const currentStatus = officialScoringStatus(student.score_starts_on, currentWeekStart);
  const defaultDate = student.score_starts_on && !isLegacyOfficialScoringBoundary(student.score_starts_on)
    ? student.score_starts_on
    : addDays(currentWeekStart, 7);
  const returnTo = query.return_to === "super_admin" ? "super_admin" : "";
  const returnWeek = query.return_week && isValidDateString(query.return_week)
    && weekStartForDate(query.return_week) === query.return_week
    ? query.return_week
    : currentWeekStart;
  const returnView = isAdminStudentWorkspaceView(query.return_view) ? query.return_view : "settings";
  const backHref = returnTo
    ? `/super-admin/people/${student.id}`
    : `/admin/students/${student.id}?week=${encodeURIComponent(returnWeek)}&view=${encodeURIComponent(returnView)}`;
  const errorMessage = messageFor(query.status)
    ?? (proposed && !preview ? "This proposed change is no longer valid. Start a fresh review." : null);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Link className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-moss hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss" href={backHref} prefetch={false}>
          <ArrowLeft size={17} aria-hidden="true" /> Back to {student.name}
        </Link>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-gold">Scoring eligibility</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Set the first scored week</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600 sm:text-base">
          Orientation access and saved activity remain available. This boundary controls official scores,
          streaks, rewards, and accountability.
        </p>

        {errorMessage ? (
          <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <section className="mt-7 rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="student-scoring-summary">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink" id="student-scoring-summary">{student.name}</h2>
              <p className="mt-1 text-sm text-stone-600">{student.phone || student.email}</p>
            </div>
            <span className="inline-flex min-h-8 w-fit items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-moss">
              <CheckCircle size={16} weight="fill" aria-hidden="true" />
              {currentStatus.label}
            </span>
          </div>
          <p className="mt-3 text-sm text-stone-600">{currentStatus.description}</p>
          <dl className="mt-5 border-t border-stone-100 pt-4 text-sm">
            <dt className="text-stone-500">Current boundary</dt>
            <dd className="mt-1 font-semibold text-ink">{displayOfficialScoringBoundary(student.score_starts_on)}</dd>
          </dl>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
        <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="choose-boundary-heading">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-green-50 text-moss"><CalendarBlank size={20} aria-hidden="true" /></span>
            <div>
              <h2 className="text-lg font-semibold text-ink" id="choose-boundary-heading">Choose a scoring start</h2>
              <p className="mt-1 text-sm leading-6 text-stone-600">Select the first Sunday that should count toward official results.</p>
            </div>
          </div>
          <form action={reviewOfficialScoringStart} className="mt-5 grid gap-3">
            <input name="student_id" type="hidden" value={student.id} />
            {returnTo ? <input name="return_to" type="hidden" value={returnTo} /> : null}
            <input name="return_week" type="hidden" value={returnWeek} />
            <input name="return_view" type="hidden" value={returnView} />
            <label>
              <span className="text-sm font-semibold text-ink">Official scoring begins</span>
              <input
                className="mt-2 min-h-11 w-full rounded-md border border-stone-300 px-3 py-2 focus:border-moss focus:outline-none focus:ring-2 focus:ring-green-100"
                defaultValue={proposed ?? defaultDate}
                name="score_starts_on"
                required
                type="date"
              />
              <span className="mt-2 block text-xs leading-5 text-stone-600">The selected date must be a canonical Sunday and cannot be before access eligibility.</span>
            </label>
            <div>
              <ReviewImpactButton />
            </div>
          </form>
        </section>

        <aside className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="boundary-controls-heading">
          <h2 className="text-lg font-semibold text-ink" id="boundary-controls-heading">What this boundary controls</h2>
          <ul className="mt-5 grid gap-4 text-sm text-stone-600">
            <li className="flex gap-3"><ChartBar className="mt-0.5 shrink-0 text-moss" size={20} aria-hidden="true" /><span><strong className="block text-ink">Official scores</strong>Weekly totals and leaderboard eligibility.</span></li>
            <li className="flex gap-3"><Fire className="mt-0.5 shrink-0 text-moss" size={20} aria-hidden="true" /><span><strong className="block text-ink">Streaks</strong>Accountable weeks and reset behavior.</span></li>
            <li className="flex gap-3"><Gift className="mt-0.5 shrink-0 text-moss" size={20} aria-hidden="true" /><span><strong className="block text-ink">Rewards and obligations</strong>Pre-boundary pending obligations may be waived after review.</span></li>
            <li className="flex gap-3"><LockKey className="mt-0.5 shrink-0 text-moss" size={20} aria-hidden="true" /><span><strong className="block text-ink">Guarded change</strong>Every confirmed change is scoped and audited.</span></li>
          </ul>
        </aside>
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <Info className="mt-0.5 shrink-0" size={20} aria-hidden="true" />
          <p>Review impact does not save anything. You will see affected weeks and obligations before exact-name confirmation.</p>
        </div>

        {preview ? (
          <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm sm:p-6" aria-labelledby="impact-review-heading">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">Review required</p>
            <h2 className="mt-2 text-xl font-semibold text-ink" id="impact-review-heading">
              {preview.direction === "activate"
                ? "Activate official scoring"
                : preview.direction === "forward"
                  ? "Move scoring forward"
                  : preview.direction === "backward"
                    ? "Move scoring backward"
                    : "No change"}
            </h2>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-stone-600">Current boundary</dt>
                <dd className="font-semibold text-ink">
                  {displayOfficialScoringBoundary(preview.old_score_starts_on)}
                </dd>
              </div>
              <div>
                <dt className="text-stone-600">Proposed boundary</dt>
                <dd className="font-semibold text-ink">{preview.new_score_starts_on}</dd>
              </div>
              <div>
                <dt className="text-stone-600">Activity weeks affected</dt>
                <dd className="font-semibold text-ink">{preview.affected_week_starts.length}</dd>
              </div>
              <div>
                <dt className="text-stone-600">Pending obligations waived</dt>
                <dd className="font-semibold text-ink">
                  {preview.pending_obligation_count} ({money(preview.pending_amount_cents)})
                </dd>
              </div>
            </dl>
            <dl className="mt-4 grid gap-3 rounded-md bg-white p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-stone-600">Access eligibility begins</dt><dd className="mt-1 font-semibold text-ink">{preview.earliest_access_starts_on}</dd></div>
              <div><dt className="text-stone-600">Earliest valid scored week</dt><dd className="mt-1 font-semibold text-ink">{preview.earliest_valid_score_start}</dd></div>
            </dl>

            {preview.affected_week_starts.length ? (
              <div className="mt-4 rounded-md bg-white p-3 text-sm text-stone-700">
                <p className="font-medium text-ink">Affected activity</p>
                <p className="mt-1">
                  {preview.affected_week_starts.map((week) => formatWeekRange(week)).join("; ")}
                </p>
              </div>
            ) : null}

            {preview.pending_obligation_count ? (
              <p className="mt-4 text-sm leading-6 text-amber-950">
                Pending obligations before the new boundary will be marked waived with an audit note. They will
                not be marked paid or deleted. Valid obligations on or after the boundary keep their accountability gate.
              </p>
            ) : null}

            {preview.direction === "backward" ? (
              <p className="mt-4 text-sm leading-6 text-amber-950">
                Backdating can add historical weeks to reports and accountability. Previously waived obligations
                are not reopened automatically.
              </p>
            ) : null}

            {preview.direction !== "unchanged" ? (
              <OfficialScoringConfirmationForm
                cancelHref={backHref}
                expectedScoreStartsOn={preview.old_score_starts_on ?? ""}
                requestId={randomUUID()}
                returnTo={returnTo}
                returnView={returnView}
                returnWeek={returnWeek}
                scoreStartsOn={preview.new_score_starts_on}
                studentId={student.id}
                studentName={student.name}
              />
            ) : (
              <p className="mt-4 text-sm text-stone-700">Choose a different Sunday to make a change.</p>
            )}
          </section>
        ) : null}
      </main>
    </>
  );
}
