import Link from "next/link";
import { notFound } from "next/navigation";
import AppNav from "@/app/nav";
import CorrectionForm, { type CorrectionFormCheckIn } from "./correction-form";
import HalaqaGradeForm from "./halaqa-grade-form";
import StudentWeekSelector from "./student-week-selector";
import {
  addDays,
  formatDateTimeInAppTimeZone,
  formatPlanWeekRange,
  formatWeekRange,
  friendlyDate,
  isValidDateString,
  planWeekStartForDate,
  todayDateString,
  weekDatesFromStart,
  weekStartForDate
} from "@/lib/dates";
import { PASSING_PERCENTAGE } from "@/lib/leaderboard";
import { calculateDailyScoreProgress, calculateWeeklyScore, formatScore } from "@/lib/scoring";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn, CheckInItem, HalaqaGrade, PartnerRecitation, Profile, WeeklyPlan } from "@/lib/types";
import { WEEKLY_PLAN_BUCKET } from "@/lib/weekly-plans";

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
  if (status === "submitted") return "Submitted";
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

function weeklyStatus(input: { percentage: number; complete: boolean }) {
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
  const storageSupabase = createSupabaseAdminClient();
  const today = todayDateString();
  const currentTrackerWeekStart = weekStartForDate(today);
  const selectedWeekStart = validWeekStart(resolvedSearchParams.week, currentTrackerWeekStart);
  const selectedWeekDates = weekDatesFromStart(selectedWeekStart);
  const selectedWeekDateSet = new Set(selectedWeekDates);
  const selectedPlanWeekStart = planWeekStartForDate(selectedWeekStart);
  const selectedWeekComplete = weekIsComplete(selectedWeekStart, today);
  const correctionInitialDate = selectedWeekDates.includes(today) ? today : selectedWeekDates[0];

  const { data: student } = await supabase
    .from("profiles")
    .select("id,name,email,phone,role,active,created_at")
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
      ...(weeklyPlanRows ?? []).map((row) => weekStartForDate(addDays(row.week_start, 1)))
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
  const weeklyPlanUrl = weeklyPlan
    ? (
        await storageSupabase.storage
          .from(WEEKLY_PLAN_BUCKET)
          .createSignedUrl(weeklyPlan.file_path, 60 * 60, { download: weeklyPlan.file_name })
      ).data?.signedUrl
    : null;
  const weeklyScore = calculateWeeklyScore({
    dailyScores: selectedWeekDates.map((date) => selectedCheckinByDate.get(date)?.daily_score ?? 0),
    partnerRecitations: partnerRecitations ?? [],
    halaqaGrade: halaqaGrade ?? null
  });
  const status = weeklyStatus({ percentage: weeklyScore.percentage, complete: selectedWeekComplete });
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
        {resolvedSearchParams.status === "grade-saved" ? (
          <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Halaqa grade saved.</p>
        ) : null}
        {resolvedSearchParams.status === "grade-invalid" || resolvedSearchParams.status === "grade-error" ? (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Unable to save halaqa grade. If attended is yes, recitation points must be 10-50.
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
          <div className="mt-5 rounded-md border border-stone-200 p-4 text-sm text-stone-700">
            <p>
              Daily check-ins:{" "}
              <span className="font-semibold text-ink">
                {dailyProgress.submitted_days} / {dailyProgress.due_days}
              </span>{" "}
              due submitted
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
              Submitted, missing, and upcoming check-ins for {formatWeekRange(selectedWeekStart)}.
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
                            <p className="font-medium text-ink">Submitted {formatDateTimeInAppTimeZone(checkin.submitted_at)}</p>
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
                            ? "No check-in submitted yet today."
                            : "No check-in submitted for this day."}
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
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(["round_1", "round_2"] as PartnerRecitation["round"][]).map((round) => {
              const recitation = partnerRecitationByRound.get(round);

              return (
                <div className="rounded-md border border-stone-200 p-4" key={round}>
                  <p className="text-sm font-medium text-ink">{partnerRoundLabel(round)}</p>
                  <p className={recitation ? "mt-1 text-sm text-green-700" : "mt-1 text-sm text-stone-600"}>
                    {recitation ? "Submitted" : "No submission"}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-ink">{recitation?.points ?? 0} / 75</p>
                  {recitation ? (
                    <p className="mt-1 text-xs text-stone-500">
                      Submitted {formatDateTimeInAppTimeZone(recitation.submitted_at)}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
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
              <p className="mt-1 text-sm text-stone-600">{formatPlanWeekRange(selectedPlanWeekStart)}</p>
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
            redirectWeek={selectedWeekStart}
            studentId={student.id}
          />
        </section>
      </main>
    </>
  );
}
