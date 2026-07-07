import AppNav from "@/app/nav";
import { StudentSetupIncomplete, StudentWeekContextPanel } from "@/app/student/student-week-context";
import { formatWeekRange, isValidDateString, todayDateString, weekDatesFromStart, weekStartForDate } from "@/lib/dates";
import {
  buildHalaqaFeedbackDisplay,
  buildStudentBelow70Streak,
  buildWeeklyGradeBreakdown,
  completedStudentGradeWeekStartsDescending,
  studentGradesScope
} from "@/lib/grades";
import { calculateDailyScoreProgress } from "@/lib/scoring";
import { loadStudentWeekContext } from "@/lib/student-scope";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn, HalaqaGrade, PartnerRecitation } from "@/lib/types";

export const dynamic = "force-dynamic";

type GradesSearchParams = {
  week?: string;
};

function validWeekStart(value: string | undefined, fallback: string) {
  if (!value || !isValidDateString(value)) {
    return fallback;
  }

  return weekStartForDate(value) === value ? value : fallback;
}

export default async function StudentGradesPage({
  searchParams
}: {
  searchParams: Promise<GradesSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["student"]);
  const today = todayDateString();
  const currentWeekStart = weekStartForDate(today);
  const selectedWeekStart = validWeekStart(resolvedSearchParams.week, currentWeekStart);
  const selectedWeekDates = weekDatesFromStart(selectedWeekStart);
  const scope = studentGradesScope(profile.id, selectedWeekStart, selectedWeekDates);
  const studentContext = await loadStudentWeekContext(supabase, profile.id, selectedWeekStart);

  if (!studentContext.scope) {
    return <StudentSetupIncomplete name={profile.name} role={profile.role} weekStart={selectedWeekStart} />;
  }

  const { data: checkinDates } = await supabase
    .from("checkins")
    .select("date")
    .eq("student_id", scope.studentId)
    .order("date", { ascending: false })
    .returns<Array<{ date: string }>>();
  const { data: partnerWeeks } = await supabase
    .from("partner_recitations")
    .select("week_start")
    .eq("student_id", scope.studentId)
    .order("week_start", { ascending: false })
    .returns<Array<{ week_start: string }>>();
  const { data: halaqaWeeks } = await supabase
    .from("halaqa_grades")
    .select("week_start")
    .eq("student_id", scope.studentId)
    .order("week_start", { ascending: false })
    .returns<Array<{ week_start: string }>>();
  const availableWeekStarts = [
    ...new Set([
      currentWeekStart,
      selectedWeekStart,
      ...(checkinDates ?? []).map((checkin) => weekStartForDate(checkin.date)),
      ...(partnerWeeks ?? []).map((week) => week.week_start),
      ...(halaqaWeeks ?? []).map((week) => week.week_start)
    ])
  ].sort((a, b) => b.localeCompare(a));
  const completedWeekStartsDescending = completedStudentGradeWeekStartsDescending({ selectedWeekStart, today });
  const streakDates = completedWeekStartsDescending.flatMap((weekStart) => weekDatesFromStart(weekStart));

  const { data: checkins } = await supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin")
    .eq("student_id", scope.studentId)
    .in("date", scope.weekDates)
    .returns<CheckIn[]>();
  const { data: partnerRecitations } = await supabase
    .from("partner_recitations")
    .select("id,student_id,week_start,round,points,submitted_at")
    .eq("student_id", scope.studentId)
    .eq("week_start", scope.weekStart)
    .returns<PartnerRecitation[]>();
  const { data: halaqaGrade } = await supabase
    .from("halaqa_grades")
    .select("id,student_id,week_start,attended,attendance_points,recitation_points,notes,graded_by,graded_at,updated_at")
    .eq("student_id", scope.studentId)
    .eq("week_start", scope.weekStart)
    .maybeSingle<HalaqaGrade>();
  const { data: streakCheckins } = streakDates.length
    ? await supabase
        .from("checkins")
        .select("date,daily_score")
        .eq("student_id", scope.studentId)
        .in("date", streakDates)
        .returns<Array<Pick<CheckIn, "date" | "daily_score">>>()
    : { data: [] };
  const { data: streakPartnerRecitations } = completedWeekStartsDescending.length
    ? await supabase
        .from("partner_recitations")
        .select("week_start,round,points")
        .eq("student_id", scope.studentId)
        .in("week_start", completedWeekStartsDescending)
        .returns<Array<Pick<PartnerRecitation, "week_start" | "round" | "points">>>()
    : { data: [] };
  const { data: streakHalaqaGrades } = completedWeekStartsDescending.length
    ? await supabase
        .from("halaqa_grades")
        .select("week_start,attendance_points,recitation_points")
        .eq("student_id", scope.studentId)
        .in("week_start", completedWeekStartsDescending)
        .returns<Array<Pick<HalaqaGrade, "week_start" | "attendance_points" | "recitation_points">>>()
    : { data: [] };
  const weeklyScore = buildWeeklyGradeBreakdown({
    weekDates: scope.weekDates,
    checkins: checkins ?? [],
    partnerRecitations: partnerRecitations ?? [],
    halaqaGrade: halaqaGrade ?? null
  });
  const below70Streak = buildStudentBelow70Streak({
    studentId: scope.studentId,
    completedWeekStartsDescending,
    minimumWeekStart: studentContext.scope.startsOn,
    checkins: streakCheckins ?? [],
    partnerRecitations: streakPartnerRecitations ?? [],
    halaqaGrades: streakHalaqaGrades ?? []
  });
  const streakCardClass =
    below70Streak >= 3 ? "rounded-lg bg-red-50 p-5" : below70Streak > 0 ? "rounded-lg bg-amber-50 p-5" : "rounded-lg bg-stone-50 p-5";
  const streakValueClass =
    below70Streak >= 3
      ? "mt-2 text-4xl font-semibold text-red-900"
      : below70Streak > 0
        ? "mt-2 text-4xl font-semibold text-amber-900"
        : "mt-2 text-4xl font-semibold text-ink";
  const dailyScoreByDate = new Map((checkins ?? []).map((checkin) => [checkin.date, checkin.daily_score]));
  const dailyProgress = calculateDailyScoreProgress({
    weekDates: scope.weekDates,
    dailyScoresByDate: dailyScoreByDate,
    today
  });
  const halaqaDisplay = buildHalaqaFeedbackDisplay(halaqaGrade ?? null);

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-ink">Grades</h1>
              <p className="mt-1 text-stone-600">Week of {formatWeekRange(scope.weekStart)}</p>
            </div>
            <form>
              <label className="block min-w-56">
                <span className="text-sm font-medium text-ink">Week</span>
                <select
                  className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2"
                  defaultValue={scope.weekStart}
                  name="week"
                >
                  {availableWeekStarts.map((weekStart) => (
                    <option key={weekStart} value={weekStart}>
                      {formatWeekRange(weekStart)}
                    </option>
                  ))}
                </select>
              </label>
              <button className="mt-2 w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white">
                View week
              </button>
            </form>
          </div>
          <StudentWeekContextPanel scope={studentContext.scope} teacher={studentContext.teacher} />

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-lg bg-stone-50 p-5">
              <p className="text-sm font-medium uppercase text-stone-500">Daily progress so far</p>
              <p className="mt-2 text-4xl font-semibold text-ink">
                {dailyProgress.possible_points > 0
                  ? `${dailyProgress.earned_points} / ${dailyProgress.possible_points}`
                  : "Not due"}
              </p>
              <p className="mt-1 text-lg text-stone-700">
                {dailyProgress.percentage === null ? "No daily checklist is due yet" : `${dailyProgress.percentage}%`}
              </p>
            </div>
            <div className="rounded-lg bg-stone-50 p-5">
              <p className="text-sm font-medium uppercase text-stone-500">Full weekly score</p>
              <p className="mt-2 text-4xl font-semibold text-ink">
                {weeklyScore.total_points} / {weeklyScore.total_possible}
              </p>
              <p className="mt-1 text-lg text-stone-700">{weeklyScore.percentage}% in progress</p>
            </div>
            <div className={streakCardClass}>
              <p className="text-sm font-medium uppercase text-stone-500">Below 70% streak</p>
              <p className={streakValueClass}>
                {below70Streak} {below70Streak === 1 ? "week" : "weeks"}
              </p>
              <p className="mt-1 text-lg text-stone-700">Completed weeks only.</p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-stone-200 p-4">
              <p className="text-sm text-stone-600">Daily checklist</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{weeklyScore.daily_points} / 700</p>
            </div>
            <div className="rounded-md border border-stone-200 p-4">
              <p className="text-sm text-stone-600">Partner recitation</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{weeklyScore.partner_points} / 150</p>
            </div>
            <div className="rounded-md border border-stone-200 p-4">
              <p className="text-sm text-stone-600">Halaqa grade</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{weeklyScore.halaqa_points} / 150</p>
            </div>
          </div>

          <section className="mt-6 rounded-md border border-stone-200 p-4">
            <h2 className="text-lg font-semibold text-ink">Saturday Halaqa Grade</h2>
            {halaqaDisplay ? (
              <div className="mt-3 grid gap-3 text-sm text-stone-700">
                <p>
                  <span className="font-medium text-ink">Attendance:</span> {halaqaDisplay.attendanceLabel}
                </p>
                <p>
                  <span className="font-medium text-ink">Recitation:</span>{" "}
                  {halaqaDisplay.attended
                    ? `${halaqaDisplay.recitationMarkOutOf10} / 10 (${halaqaDisplay.recitationPoints} / 50)`
                    : "0 / 50"}
                </p>
                <p>
                  <span className="font-medium text-ink">Halaqa points:</span> {halaqaDisplay.halaqaPoints} / 150
                </p>
                {halaqaDisplay.notes ? (
                  <p>
                    <span className="font-medium text-ink">Feedback:</span> {halaqaDisplay.notes}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-stone-600">No halaqa grade has been entered for this week yet.</p>
            )}
          </section>
        </section>
      </main>
    </>
  );
}
