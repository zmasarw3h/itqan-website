import Link from "next/link";
import { notFound } from "next/navigation";
import { correctPartnerRecitations } from "@/app/admin/actions";
import AppNav from "@/app/nav";
import CorrectionForm, { type CorrectionFormCheckIn } from "./correction-form";
import HalaqaGradeForm from "./halaqa-grade-form";
import StudentDeleteForm from "./student-delete-form";
import StudentWeekSelector from "./student-week-selector";
import { canAdminManageStudentForWeek } from "@/lib/admin-scope";
import {
  addDays,
  formatDateTimeInAppTimeZone,
  formatWeekRange,
  friendlyDate,
  isValidDateString,
  todayDateString,
  weekDatesFromStart,
  weekStartForDate
} from "@/lib/dates";
import { PASSING_PERCENTAGE } from "@/lib/leaderboard";
import { PARTNER_RECITATION_ROUNDS } from "@/lib/partner-recitations";
import { officialScoringStatus } from "@/lib/official-scoring";
import { calculateDailyScoreProgress, calculateWeeklyScore, formatScore } from "@/lib/scoring";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn, CheckInItem, HalaqaGrade, PartnerRecitation, Profile, WeeklyPlan } from "@/lib/types";
import { WEEKLY_PLAN_BUCKET, weeklyPlanPathBelongsToStudent } from "@/lib/weekly-plans";

export const dynamic = "force-dynamic";

type AdminStudentSearchParams = {
  status?: string;
  week?: string;
};

type DayStatus = "submitted" | "missing" | "open" | "upcoming";

function validWeekStart(value: string | undefined, fallback: string) {
  if (!value || !isValidDateString(value)) {
    return fallback;
  }

  return weekStartForDate(value) === value ? value : fallback;
}

function weekIsComplete(weekStart: string, today: string) {
  return addDays(weekStart, 6) < today;
}

function effectiveTodayForDailyProgress(weekDates: string[], checkinByDate: Map<string, CheckIn>, today: string) {
  if (!weekDates.includes(today) || checkinByDate.has(today)) {
    return today;
  }

  return addDays(today, -1);
}

function dayStatus(date: string, today: string, checkin: CheckIn | undefined): DayStatus {
  if (checkin) {
    return "submitted";
  }

  if (date === today) {
    return "open";
  }

  return date < today ? "missing" : "upcoming";
}

function dayStatusLabel(status: DayStatus) {
  if (status === "submitted") return "Saved";
  if (status === "missing") return "Missing";
  if (status === "open") return "Open today";
  return "Upcoming";
}

function dayStatusClass(status: DayStatus) {
  if (status === "submitted") return "border-green-200 bg-green-50 text-green-800";
  if (status === "missing") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "open") return "border-stone-200 bg-stone-50 text-stone-700";
  return "border-stone-200 bg-stone-50 text-stone-500";
}

function weeklyStatus(input: { percentage: number; complete: boolean; scorable: boolean }) {
  if (!input.scorable) {
    return {
      label: "Orientation",
      scoreLabel: "Official score excluded",
      className: "bg-blue-50 text-blue-700"
    };
  }

  if (!input.complete) {
    return {
      label: "In progress",
      scoreLabel: "Week score so far",
      className: "bg-stone-100 text-stone-700"
    };
  }

  if (input.percentage >= PASSING_PERCENTAGE) {
    return {
      label: "Passing",
      scoreLabel: "Final weekly score",
      className: "bg-green-50 text-green-700"
    };
  }

  return {
    label: "Below 70%",
    scoreLabel: "Final weekly score",
    className: "bg-red-50 text-red-700"
  };
}

function partnerRoundLabel(round: PartnerRecitation["round"]) {
  return round === "round_1" ? "Round 1" : "Round 2";
}

export default async function AdminStudentPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<AdminStudentSearchParams>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["admin"]);
  const today = todayDateString();
  const currentTrackerWeekStart = weekStartForDate(today);
  const selectedWeekStart = validWeekStart(resolvedSearchParams.week, currentTrackerWeekStart);
  const selectedWeekDates = weekDatesFromStart(selectedWeekStart);
  const selectedWeekDateSet = new Set(selectedWeekDates);
  const selectedPlanWeekStart = selectedWeekStart;
  const selectedWeekComplete = weekIsComplete(selectedWeekStart, today);
  const correctionInitialDate = selectedWeekDates.includes(today)
    ? today
    : selectedWeekDates[0] > today
      ? today
      : selectedWeekDates[0];
  const canManageStudent = await canAdminManageStudentForWeek(supabase, resolvedParams.id, selectedWeekStart);

  if (!canManageStudent) {
    notFound();
  }

  const storageSupabase = createSupabaseAdminClient();

  const { data: student } = await supabase
    .from("profiles")
    .select("id,name,email,phone,role,active,score_starts_on,created_at")
    .eq("id", resolvedParams.id)
    .eq("role", "student")
    .single<Profile>();

  if (!student) {
    notFound();
  }

  const { data: checkins } = await supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin")
    .eq("student_id", student.id)
    .order("date", { ascending: false })
    .returns<CheckIn[]>();
  const checkinIds = (checkins ?? []).map((checkin) => checkin.id);
  const { data: items } = checkinIds.length
    ? await supabase
        .from("checkin_items")
        .select("id,checkin_id,student_id,date,task_key,task_label,weight,completed,created_at")
        .in("checkin_id", checkinIds)
        .order("created_at", { ascending: true })
        .returns<CheckInItem[]>()
    : { data: [] };
  const { data: partnerWeekRows } = await supabase
    .from("partner_recitations")
    .select("week_start")
    .eq("student_id", student.id)
    .order("week_start", { ascending: false })
    .returns<Array<{ week_start: string }>>();
  const { data: halaqaWeekRows } = await supabase
    .from("halaqa_grades")
    .select("week_start")
    .eq("student_id", student.id)
    .order("week_start", { ascending: false })
    .returns<Array<{ week_start: string }>>();
  const { data: weeklyPlanRows } = await supabase
    .from("weekly_plans")
    .select("week_start")
    .eq("student_id", student.id)
    .order("week_start", { ascending: false })
    .returns<Array<{ week_start: string }>>();
  const availableWeekStarts = [
    ...new Set([
      currentTrackerWeekStart,
      selectedWeekStart,
      ...(checkins ?? []).map((checkin) => weekStartForDate(checkin.date)),
      ...(partnerWeekRows ?? []).map((row) => row.week_start),
      ...(halaqaWeekRows ?? []).map((row) => row.week_start),
      ...(weeklyPlanRows ?? []).filter((row) => weekStartForDate(row.week_start) === row.week_start).map((row) => row.week_start)
    ])
  ].sort((a, b) => b.localeCompare(a));
  const itemsByCheckInId = new Map<string, CheckInItem[]>();

  for (const item of items ?? []) {
    itemsByCheckInId.set(item.checkin_id, [...(itemsByCheckInId.get(item.checkin_id) ?? []), item]);
  }

  const selectedCheckins = (checkins ?? []).filter((checkin) => selectedWeekDateSet.has(checkin.date));
  const selectedCheckinByDate = new Map(selectedCheckins.map((checkin) => [checkin.date, checkin]));
  const selectedDailyScoreByDate = new Map(selectedCheckins.map((checkin) => [checkin.date, checkin.daily_score]));
  const effectiveToday = effectiveTodayForDailyProgress(selectedWeekDates, selectedCheckinByDate, today);
  const dailyProgress = calculateDailyScoreProgress({
    weekDates: selectedWeekDates,
    dailyScoresByDate: selectedDailyScoreByDate,
    today: effectiveToday
  });
  const missingDates = selectedWeekDates.filter((date) => date < today && !selectedCheckinByDate.has(date));
  const correctionCheckIns: CorrectionFormCheckIn[] = (checkins ?? []).map((checkin) => ({
    date: checkin.date,
    status: checkin.completed ? "submitted" : "missing",
    note: checkin.note ?? "",
    completedTaskKeys: (itemsByCheckInId.get(checkin.id) ?? [])
      .filter((item) => item.completed)
      .map((item) => item.task_key)
  }));
  const { data: partnerRecitations } = await supabase
    .from("partner_recitations")
    .select("id,student_id,week_start,round,points,submitted_at")
    .eq("student_id", student.id)
    .eq("week_start", selectedWeekStart)
    .returns<PartnerRecitation[]>();
  const { data: halaqaGrade } = await supabase
    .from("halaqa_grades")
    .select("id,student_id,week_start,attended,attendance_points,recitation_points,notes,graded_by,graded_at,updated_at")
    .eq("student_id", student.id)
    .eq("week_start", selectedWeekStart)
    .maybeSingle<HalaqaGrade>();
  const { data: weeklyPlan } = await supabase
    .from("weekly_plans")
    .select("id,student_id,week_start,file_path,file_name,file_type,file_size,uploaded_at")
    .eq("student_id", student.id)
    .eq("week_start", selectedPlanWeekStart)
    .maybeSingle<WeeklyPlan>();
  const weeklyPlanUrl = weeklyPlan && weeklyPlanPathBelongsToStudent(student.id, selectedPlanWeekStart, weeklyPlan.file_path)
    ? (
        await storageSupabase.storage
          .from(WEEKLY_PLAN_BUCKET)
          .createSignedUrl(weeklyPlan.file_path, 60 * 60, { download: weeklyPlan.file_name })
      ).data?.signedUrl
    : null;
  const selectedWeekIsScorable = Boolean(
    student.score_starts_on && selectedWeekStart >= student.score_starts_on
  );
  const weeklyScore = calculateWeeklyScore({
    dailyScores: selectedWeekIsScorable
      ? selectedWeekDates.map((date) => selectedCheckinByDate.get(date)?.daily_score ?? 0)
      : [],
    partnerRecitations: selectedWeekIsScorable ? partnerRecitations ?? [] : [],
    halaqaGrade: selectedWeekIsScorable ? halaqaGrade ?? null : null
  });
  const status = weeklyStatus({
    percentage: weeklyScore.percentage,
    complete: selectedWeekComplete,
    scorable: selectedWeekIsScorable
  });
  const scoringStatus = officialScoringStatus(student.score_starts_on, currentTrackerWeekStart);
  const partnerRecitationByRound = new Map<PartnerRecitation["round"], PartnerRecitation>();

  for (const recitation of partnerRecitations ?? []) {
    const existing = partnerRecitationByRound.get(recitation.round);

    if (!existing || Number(recitation.points ?? 0) > Number(existing.points ?? 0)) {
      partnerRecitationByRound.set(recitation.round, recitation);
    }
  }

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        {resolvedSearchParams.status === "corrected" ? (
          <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Correction saved.</p>
        ) : null}
        {resolvedSearchParams.status === "correction-error" ? (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Unable to save correction.
          </p>
        ) : null}
        {resolvedSearchParams.status === "correction-future-date" ? (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Correction dates cannot be later than today.
          </p>
        ) : null}
        {resolvedSearchParams.status === "partner-corrected" ? (
          <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            Partner recitation correction saved.
          </p>
        ) : null}
        {resolvedSearchParams.status === "partner-correction-invalid" ||
        resolvedSearchParams.status === "partner-correction-error" ? (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Unable to save partner recitation correction.
          </p>
        ) : null}
        {resolvedSearchParams.status === "grade-saved" ? (
          <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Halaqa grade saved.</p>
        ) : null}
        {resolvedSearchParams.status === "grade-invalid" || resolvedSearchParams.status === "grade-error" ? (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Unable to save halaqa grade. If attended is yes, recitation points must be 10-50.
          </p>
        ) : null}
        {resolvedSearchParams.status === "delete-name-mismatch" ? (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Student deletion was not confirmed. Type the student name exactly before deleting.
          </p>
        ) : null}
        {resolvedSearchParams.status === "student-delete-error" ? (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Unable to delete this student.
          </p>
        ) : null}
        {resolvedSearchParams.status === "score-start-changed" ? (
          <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            Official scoring start updated. Any pending pre-boundary obligations were waived with an audit note,
            not marked paid.
          </p>
        ) : null}

        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Link className="text-sm font-medium text-moss hover:text-ink" href="/admin">
                Back to admin
              </Link>
              <h1 className="mt-2 text-2xl font-semibold text-ink">{student.name}</h1>
              <p className="mt-1 text-stone-600">{student.phone || student.email}</p>
            </div>
            <StudentWeekSelector
              availableWeekStarts={availableWeekStarts}
              selectedWeekStart={selectedWeekStart}
              studentId={student.id}
            />
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-ink">Official scoring</h2>
              <p className="mt-1 text-sm text-stone-600">{scoringStatus.description}</p>
              <p className="mt-2 text-sm font-medium text-ink">{scoringStatus.label}</p>
            </div>
            <Link
              className="rounded-md bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink"
              href={`/admin/students/${student.id}/official-scoring`}
            >
              Review or change
            </Link>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-stone-600">{status.scoreLabel}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="text-4xl font-semibold text-ink">{weeklyScore.percentage}%</p>
                <span className={`rounded-full px-3 py-1 text-sm font-medium ${status.className}`}>
                  {status.label}
                </span>
              </div>
              <p className="mt-2 text-sm text-stone-600">Week of {formatWeekRange(selectedWeekStart)}</p>
            </div>
            <div className="grid w-full gap-3 sm:grid-cols-3 lg:w-auto lg:min-w-[520px]">
              <div className="rounded-md bg-stone-50 p-4">
                <p className="text-sm text-stone-600">Daily</p>
                <p className="mt-1 text-xl font-semibold text-ink">{weeklyScore.daily_points} / 700</p>
              </div>
              <div className="rounded-md bg-stone-50 p-4">
                <p className="text-sm text-stone-600">Partner</p>
                <p className="mt-1 text-xl font-semibold text-ink">{weeklyScore.partner_points} / 150</p>
              </div>
              <div className="rounded-md bg-stone-50 p-4">
                <p className="text-sm text-stone-600">Halaqa</p>
                <p className="mt-1 text-xl font-semibold text-ink">{weeklyScore.halaqa_points} / 150</p>
              </div>
            </div>
          </div>
          {!selectedWeekIsScorable ? (
            <p className="mt-4 rounded-md bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-800">
              Activity from this orientation week is preserved, but it is excluded from official scores, streaks,
              rewards, and Sadaqa obligations.
            </p>
          ) : null}
          <div className="mt-5 rounded-md border border-stone-200 p-4 text-sm text-stone-700">
            <p>
              Daily check-ins:{" "}
              <span className="font-semibold text-ink">
                {dailyProgress.submitted_days} / {dailyProgress.due_days}
              </span>{" "}
              due saved
            </p>
            {missingDates.length ? (
              <p className="mt-1">
                Missing: <span className="font-medium text-amber-800">{missingDates.map(friendlyDate).join(", ")}</span>
              </p>
            ) : (
              <p className="mt-1 text-stone-600">No missing due days for this selected week.</p>
            )}
          </div>
        </section>

        <section className="mt-8">
          <div>
            <h2 className="text-lg font-semibold text-ink">Selected Week Activity</h2>
            <p className="mt-1 text-sm text-stone-600">
              Saved, missing, and upcoming check-ins for {formatWeekRange(selectedWeekStart)}.
            </p>
          </div>
          <div className="mt-3 space-y-3">
            {selectedWeekDates.map((date) => {
              const checkin = selectedCheckinByDate.get(date);
              const statusForDay = dayStatus(date, today, checkin);
              const checkinItems = checkin ? itemsByCheckInId.get(checkin.id) ?? [] : [];
              const completedItems = checkinItems.filter((item) => item.completed);
              const missedItems = checkinItems.filter((item) => !item.completed);

              return (
                <details
                  className={`rounded-lg border bg-white shadow-sm ${dayStatusClass(statusForDay)}`}
                  key={date}
                  open={statusForDay === "missing"}
                >
                  <summary className="cursor-pointer list-none px-4 py-3">
                    <div className="grid items-center gap-3 md:grid-cols-[1.2fr_1fr_1fr]">
                      <p className="font-medium text-ink">{friendlyDate(date)}</p>
                      <span className="font-medium">{dayStatusLabel(statusForDay)}</span>
                      <span className="text-sm text-stone-700">
                        {checkin ? formatScore(checkin.daily_score) : statusForDay === "upcoming" ? "Not due" : ""}
                      </span>
                    </div>
                  </summary>
                  <div className="border-t border-stone-200 bg-white px-4 py-4 text-sm text-stone-700">
                    {checkin ? (
                      <>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-ink">
                              Saved {formatDateTimeInAppTimeZone(checkin.updated_at ?? checkin.submitted_at)}
                            </p>
                            {checkin.note ? <p className="mt-1">Note: {checkin.note}</p> : null}
                          </div>
                          <p className="font-medium text-ink">
                            {checkin.earned_weight ?? 0}/{checkin.total_weight ?? 0} checklist points
                          </p>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div>
                            <p className="font-medium text-green-700">Completed</p>
                            <div className="mt-2 space-y-2">
                              {completedItems.length ? (
                                completedItems.map((item) => (
                                  <div className="rounded-md bg-green-50 px-3 py-2" key={item.id}>
                                    {item.task_label} <span className="text-stone-600">({item.weight})</span>
                                  </div>
                                ))
                              ) : (
                                <p className="rounded-md bg-stone-50 px-3 py-2 text-stone-600">No completed tasks.</p>
                              )}
                            </div>
                          </div>
                          <div>
                            <p className="font-medium text-amber-700">Missed</p>
                            <div className="mt-2 space-y-2">
                              {missedItems.length ? (
                                missedItems.map((item) => (
                                  <div className="rounded-md bg-amber-50 px-3 py-2" key={item.id}>
                                    {item.task_label} <span className="text-stone-600">({item.weight})</span>
                                  </div>
                                ))
                              ) : (
                                <p className="rounded-md bg-stone-50 px-3 py-2 text-stone-600">No missed tasks.</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p>
                        {statusForDay === "upcoming"
                          ? "This day is not due yet."
                          : statusForDay === "open"
                            ? "No checklist saved yet today."
                            : "No checklist saved for this day."}
                      </p>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </section>

        <section className="mt-8 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-ink">Weekly Requirements</h2>
            <p className="mt-1 text-sm text-stone-600">Partner recitation and halaqa grade for the selected week.</p>
          </div>
          <form action={correctPartnerRecitations} className="mt-4">
            <input name="student_id" type="hidden" value={student.id} />
            <input name="week_start" type="hidden" value={selectedWeekStart} />
            <input name="redirect_week" type="hidden" value={selectedWeekStart} />
            <fieldset className="grid gap-3 md:grid-cols-2">
              <legend className="sr-only">Partner recitation completion status</legend>
              {PARTNER_RECITATION_ROUNDS.map((round) => {
                const recitation = partnerRecitationByRound.get(round);

                return (
                  <label className="rounded-md border border-stone-200 p-4" key={round}>
                    <span className="flex items-start gap-3">
                      <input
                        className="mt-1 h-4 w-4"
                        defaultChecked={Boolean(recitation)}
                        name="completed_rounds"
                        type="checkbox"
                        value={round}
                      />
                      <span>
                        <span className="block text-sm font-medium text-ink">{partnerRoundLabel(round)}</span>
                        <span className={recitation ? "mt-1 block text-sm text-green-700" : "mt-1 block text-sm text-stone-600"}>
                          {recitation ? "Completed" : "Not completed"}
                        </span>
                      </span>
                    </span>
                    <span className="mt-2 block text-xl font-semibold text-ink">{recitation?.points ?? 0} / 75</span>
                    {recitation ? (
                      <span className="mt-1 block text-xs text-stone-500">
                        Submitted {formatDateTimeInAppTimeZone(recitation.submitted_at)}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </fieldset>
            <button className="mt-4 rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">
              Save partner recitation status
            </button>
          </form>
          <div className="mt-6 border-t border-stone-200 pt-4">
            <h3 className="font-semibold text-ink">Halaqa Grade</h3>
            <p className="mt-1 text-sm text-stone-600">Saturday grade for {formatWeekRange(selectedWeekStart)}</p>
            <HalaqaGradeForm
              grade={halaqaGrade ?? null}
              key={selectedWeekStart}
              studentId={student.id}
              weekStart={selectedWeekStart}
            />
          </div>
        </section>

        <section className="mt-8 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Weekly Plan</h2>
              <p className="mt-1 text-sm text-stone-600">{formatWeekRange(selectedPlanWeekStart)}</p>
            </div>
            {weeklyPlanUrl ? (
              <a
                className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink"
                href={weeklyPlanUrl}
              >
                View/download
              </a>
            ) : null}
          </div>
          {weeklyPlan ? (
            <div className="mt-4 rounded-md bg-stone-50 p-4">
              <p className="break-words font-medium text-ink">{weeklyPlan.file_name}</p>
              <p className="mt-1 text-sm text-stone-600">
                Uploaded {formatDateTimeInAppTimeZone(weeklyPlan.uploaded_at)}
              </p>
            </div>
          ) : (
            <p className="mt-4 rounded-md bg-stone-50 p-4 text-stone-600">No plan uploaded for this week.</p>
          )}
        </section>

        <section className="mt-8 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">Manual Correction</h2>
          <p className="mt-1 text-sm text-stone-600">Correct a daily check-in for the selected week.</p>
          <CorrectionForm
            existingCheckIns={correctionCheckIns}
            initialDate={correctionInitialDate}
            key={selectedWeekStart}
            maxDate={today}
            redirectWeek={selectedWeekStart}
            studentId={student.id}
          />
        </section>

        <section className="mt-8 rounded-lg border border-red-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-red-900">Danger Zone</h2>
          <p className="mt-1 text-sm text-stone-600">Permanent account and student data actions.</p>
          <StudentDeleteForm studentId={student.id} studentName={student.name} />
        </section>
      </main>
    </>
  );
}
