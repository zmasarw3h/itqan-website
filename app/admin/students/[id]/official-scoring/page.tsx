import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import AppNav from "@/app/nav";
import { applyOfficialScoringStart, reviewOfficialScoringStart } from "./actions";
import { canAdminManageStudentForWeek, requireScopedAdmin } from "@/lib/admin-scope";
import { addDays, formatWeekRange, todayDateString, weekStartForDate } from "@/lib/dates";
import {
  isCanonicalScoringSunday,
  officialScoringStatus,
  parseOfficialScoringChangePreview
} from "@/lib/official-scoring";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = {
  proposed?: string;
  status?: string;
  return_to?: string;
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
  const currentWeekStart = weekStartForDate(todayDateString());
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
  const defaultDate = student.score_starts_on ?? addDays(currentWeekStart, 7);
  const returnTo = query.return_to === "super_admin" ? "super_admin" : "";
  const backHref = returnTo
    ? `/super-admin/people/${student.id}`
    : `/admin/students/${student.id}`;
  const errorMessage = messageFor(query.status)
    ?? (proposed && !preview ? "This proposed change is no longer valid. Start a fresh review." : null);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link className="text-sm font-semibold text-moss hover:text-ink" href={backHref}>
          ← Back to {student.name}
        </Link>
        <p className="mt-5 text-sm font-semibold uppercase tracking-[0.14em] text-gold">Official scoring</p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">Set the first scored week</h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Orientation access and saved activity remain available. This boundary controls official scores,
          streaks, rewards, and Sadaqa accountability.
        </p>

        {errorMessage ? (
          <p className="mt-5 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">{student.name}</h2>
              <p className="mt-1 text-sm text-stone-600">{student.phone || student.email}</p>
            </div>
            <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-medium text-stone-700">
              {currentStatus.label}
            </span>
          </div>
          <p className="mt-3 text-sm text-stone-600">{currentStatus.description}</p>

          <form action={reviewOfficialScoringStart} className="mt-5 grid gap-3">
            <input name="student_id" type="hidden" value={student.id} />
            {returnTo ? <input name="return_to" type="hidden" value={returnTo} /> : null}
            <label>
              <span className="text-sm font-medium text-ink">Official scoring begins</span>
              <input
                className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                defaultValue={proposed ?? defaultDate}
                name="score_starts_on"
                required
                type="date"
              />
              <span className="mt-1 block text-xs text-stone-600">The selected date must be a Sunday.</span>
            </label>
            <div>
              <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink">
                Review impact
              </button>
            </div>
          </form>
        </section>

        {preview ? (
          <section className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">Review required</p>
            <h2 className="mt-2 text-lg font-semibold text-ink">
              {preview.direction === "activate"
                ? "Activate official scoring"
                : preview.direction === "forward"
                  ? "Move scoring forward"
                  : preview.direction === "backward"
                    ? "Move scoring backward"
                    : "No change"}
            </h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-stone-600">Current boundary</dt>
                <dd className="font-semibold text-ink">{preview.old_score_starts_on ?? "Not scorable yet"}</dd>
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
                not be marked paid or deleted. Valid obligations on or after the boundary keep the Sadaqa gate.
              </p>
            ) : null}

            {preview.direction === "backward" ? (
              <p className="mt-4 text-sm leading-6 text-amber-950">
                Backdating can add historical weeks to reports and accountability. Previously waived obligations
                are not reopened automatically.
              </p>
            ) : null}

            {preview.direction !== "unchanged" ? (
              <form action={applyOfficialScoringStart} className="mt-5 grid gap-3 border-t border-amber-200 pt-5">
                <input name="student_id" type="hidden" value={student.id} />
                <input name="request_id" type="hidden" value={randomUUID()} />
                <input name="score_starts_on" type="hidden" value={preview.new_score_starts_on} />
                <input name="expected_score_starts_on" type="hidden" value={preview.old_score_starts_on ?? ""} />
                {returnTo ? <input name="return_to" type="hidden" value={returnTo} /> : null}
                <label>
                  <span className="text-sm font-medium text-ink">Reason for change</span>
                  <textarea
                    className="mt-1 min-h-24 w-full rounded-md border border-stone-300 px-3 py-2"
                    maxLength={500}
                    minLength={5}
                    name="reason"
                    required
                  />
                </label>
                <label>
                  <span className="text-sm font-medium text-ink">Type {student.name} to confirm</span>
                  <input
                    autoComplete="off"
                    className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                    name="confirmation_name"
                    required
                  />
                </label>
                <div>
                  <button className="rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss">
                    Confirm official scoring change
                  </button>
                </div>
              </form>
            ) : (
              <p className="mt-4 text-sm text-stone-700">Choose a different Sunday to make a change.</p>
            )}
          </section>
        ) : null}
      </main>
    </>
  );
}
