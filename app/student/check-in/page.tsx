import Link from "next/link";
import { CheckCircle, Circle, MinusCircle } from "@phosphor-icons/react/dist/ssr";
import AccountabilityGateActions from "@/app/student/check-in/accountability-gate-actions";
import CheckInChecklist from "@/app/student/check-in/check-in-checklist";
import { StudentPage } from "@/app/student/student-ui";
import { StudentSetupIncomplete } from "@/app/student/student-week-context";
import { attestAccountabilityPaid } from "@/app/student/actions";
import { ACCOUNTABILITY_GATE_COPY } from "@/lib/accountability";
import { friendlyDate, formatWeekRange, weekDatesFromStart } from "@/lib/dates";
import { buildWeeklyGradeBreakdown, completedStudentGradeWeekStartsDescending } from "@/lib/grades";
import { parseBelow70StreakReadRows, type Below70StreakReadRow } from "@/lib/below70-streak";
import { formatAmountCents } from "@/lib/incentives";
import { calculateDailySubmission, tasksForDate } from "@/lib/scoring";
import { loadStudentWeekContext, type StudentWeekScope, type StudentWeekTeacher } from "@/lib/student-scope";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import { findOrCreateBlockingAccountabilityObligation } from "@/lib/weekly-incentives";
import {
  WEEKLY_PLAN_GATE_COPY,
  currentWeeklyPlanContext,
  weeklyPlanBlocksCheckIn
} from "@/lib/weekly-plans";
import type { AccountabilityObligation, CheckIn, CheckInItem, HalaqaGrade, PartnerRecitation, WeeklyPlan } from "@/lib/types";

export const dynamic = "force-dynamic";

function GuidanceVerse({
  className = "",
  compact = false,
  titleId = "check-in-guidance-verse-title"
}: {
  className?: string;
  compact?: boolean;
  titleId?: string;
}) {
  return (
    <section
      aria-labelledby={titleId}
      className={`rounded-lg border border-gold bg-[#0d382c] text-white shadow-sm ${
        compact ? "p-3 sm:p-5" : "p-6 sm:p-7 lg:p-8"
      } ${className}`}
    >
      <h2
        id={titleId}
        className={`${compact ? "text-sm" : "text-base"} font-semibold text-gold-on-dark`}
      >
        Surah Aal-Imran 3:8
      </h2>
      <p
        className={`mt-3 text-white ${
          compact
            ? "text-center text-lg leading-[1.65]"
            : "text-right text-3xl leading-[1.9] lg:text-[2.15rem]"
        }`}
        dir="rtl"
        lang="ar"
      >
        رَبَّنَا لَا تُزِغْ قُلُوبَنَا بَعْدَ إِذْ هَدَيْتَنَا وَهَبْ لَنَا مِن لَّدُنكَ رَحْمَةً ۚ
        إِنَّكَ أَنتَ الْوَهَّابُ
      </p>
      <p
        className={`${compact ? "mt-2 text-center text-xs leading-4" : "mt-5 text-base leading-7"} text-stone-100`}
      >
        Our Lord, do not let our hearts deviate after You have guided us, and grant us mercy from Yourself. Indeed, You are the Ever-Giving.
      </p>
    </section>
  );
}

function GateContext({ scope, teacher }: { scope: StudentWeekScope; teacher: StudentWeekTeacher | null }) {
  return (
    <div className="today-gate-context">
      <span>{scope.cohortName} · {scope.groupName}</span>
      <span>This week&apos;s teacher: <strong>{teacher?.teacher_name ?? "Not assigned yet"}</strong></span>
    </div>
  );
}

function WeekStatusStrip({ weekStart, today, checkins }: { weekStart: string; today: string; checkins: CheckIn[] }) {
  const savedDates = new Set(checkins.map((checkin) => checkin.date));
  return (
    <section className="today-week-strip" aria-labelledby="today-week-heading">
      <div className="today-week-heading-row">
        <h2 id="today-week-heading">This week <span>•</span> {formatWeekRange(weekStart)}</h2>
        <div className="today-week-legend" aria-label="Day status legend">
          <span><CheckCircle aria-hidden="true" className="is-saved" weight="fill" />Saved</span><span><MinusCircle aria-hidden="true" className="is-missing" weight="fill" />Missing</span><span><Circle aria-hidden="true" className="is-today" weight="duotone" />Today</span><span><Circle aria-hidden="true" className="is-upcoming" weight="fill" />Upcoming</span>
        </div>
      </div>
      <ol>
        {weekDatesFromStart(weekStart).map((date) => {
          const state = date === today ? "today" : date > today ? "upcoming" : savedDates.has(date) ? "saved" : "missing";
          const parsed = new Date(`${date}T00:00:00Z`);
          const StateIcon = state === "saved" ? CheckCircle : state === "missing" ? MinusCircle : Circle;
          return (
            <li key={date} aria-label={`${friendlyDate(date)}: ${state}`}>
              <span>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(parsed)}</span>
              <small>{new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", timeZone: "UTC" }).format(parsed)}</small>
              <StateIcon className={`is-${state}`} aria-hidden="true" weight={state === "today" ? "duotone" : "fill"} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function AccountabilityGate({
  obligation,
  status,
  scope,
  teacher
}: {
  obligation: Pick<AccountabilityObligation, "id" | "week_start" | "weekly_percentage" | "amount_cents">;
  status?: string;
  studentName: string;
  scope: StudentWeekScope;
  teacher: StudentWeekTeacher | null;
}) {
  const attestAction = attestAccountabilityPaid.bind(null, obligation.id);

  return (
    <StudentPage width="expanded">
        <div className="today-gate-wrap">
          <section className="today-gate">
            <div>
              <p className="text-sm font-medium uppercase text-moss">Accountability confirmation</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                {ACCOUNTABILITY_GATE_COPY.heading}
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
                {ACCOUNTABILITY_GATE_COPY.support}
              </p>
            </div>

            {status === "accountability-error" ? (
              <p
                className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                role="alert"
              >
                Unable to save accountability confirmation.
              </p>
            ) : null}
            {status === "accountability-required" ? (
              <p
                className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                role="status"
              >
                Confirm the required sadaqa before opening today&apos;s checklist.
              </p>
            ) : null}

            <div className="today-gate-details">
              <p>
                <span className="font-medium text-ink">Week:</span> {formatWeekRange(obligation.week_start)}
              </p>
              <p>
                <span className="font-medium text-ink">Weekly score:</span> {Number(obligation.weekly_percentage)}%
              </p>
              <p>
                <span className="font-medium text-ink">{ACCOUNTABILITY_GATE_COPY.requiredLabel}:</span>{" "}
                {formatAmountCents(obligation.amount_cents)}
              </p>
            </div>

            <div className="mt-6 border-t border-stone-200 pt-6">
              <h2 className="text-lg font-semibold text-ink">{ACCOUNTABILITY_GATE_COPY.question}</h2>
              <AccountabilityGateActions>
                <form action={attestAction}>
                  <button className="min-h-12 rounded-md bg-action px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink">
                    {ACCOUNTABILITY_GATE_COPY.yesButton}
                  </button>
                </form>
              </AccountabilityGateActions>
            </div>
            <GateContext scope={scope} teacher={teacher} />
          </section>
        </div>
    </StudentPage>
  );
}

function WeeklyPlanGate({
  weekStart,
  scope,
  teacher
}: {
  studentName: string;
  weekStart: string;
  scope: StudentWeekScope;
  teacher: StudentWeekTeacher | null;
}) {
  return (
    <StudentPage width="expanded">
        <div className="today-gate-wrap">
          <section className="today-gate">
            <div>
              <p className="text-sm font-medium uppercase text-moss">Weekly plan required</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                {WEEKLY_PLAN_GATE_COPY.heading}
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">{WEEKLY_PLAN_GATE_COPY.support}</p>
            </div>

            <div className="today-gate-details">
              <p>
                <span className="font-medium text-ink">{WEEKLY_PLAN_GATE_COPY.weekLabel}:</span>{" "}
                {formatWeekRange(weekStart)}
              </p>
            </div>

            <div className="mt-6">
              <Link
                className="inline-flex min-h-12 items-center rounded-md bg-action px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink"
                href="/student/weekly-plan"
              >
                {WEEKLY_PLAN_GATE_COPY.actionLabel}
              </Link>
            </div>
            <p className="mt-4 text-sm text-stone-600">Your checklist will become available after the plan finishes uploading.</p>
            <GateContext scope={scope} teacher={teacher} />
          </section>
        </div>
    </StudentPage>
  );
}

export default async function StudentCheckInPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["student"]);
  const { effectiveDate: today, weekStart: currentWeekStart } = currentWeeklyPlanContext();
  const studentContext = await loadStudentWeekContext(supabase, profile.id, currentWeekStart);

  if (!studentContext.scope) {
    return <StudentSetupIncomplete name={profile.name} role={profile.role} weekStart={currentWeekStart} teacher={studentContext.teacher} />;
  }

  const { data: currentWeeklyPlan } = await supabase
    .from("weekly_plans")
    .select("week_start")
    .eq("student_id", profile.id)
    .eq("week_start", currentWeekStart)
    .maybeSingle<Pick<WeeklyPlan, "week_start">>();

  if (weeklyPlanBlocksCheckIn(currentWeeklyPlan ?? null, today)) {
    return (
      <WeeklyPlanGate
        studentName={profile.name}
        weekStart={currentWeekStart}
        scope={studentContext.scope}
        teacher={studentContext.teacher}
      />
    );
  }

  const adminSupabase = createSupabaseAdminClient();
  const blockingObligation = await findOrCreateBlockingAccountabilityObligation({
    supabase,
    adminSupabase,
    studentId: profile.id,
    today
  });

  if (blockingObligation) {
    return (
      <AccountabilityGate
        obligation={blockingObligation}
        status={resolvedSearchParams.status}
        studentName={profile.name}
        scope={studentContext.scope}
        teacher={studentContext.teacher}
      />
    );
  }

  const { data: checkin } = await supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin")
    .eq("student_id", profile.id)
    .eq("date", today)
    .maybeSingle<CheckIn>();

  const { data: items } = checkin
    ? await supabase
        .from("checkin_items")
        .select("id,checkin_id,student_id,date,task_key,task_label,weight,completed,created_at")
        .eq("checkin_id", checkin.id)
        .order("created_at", { ascending: true })
        .returns<CheckInItem[]>()
    : { data: [] };

  const todayTasks = tasksForDate(today);
  const completedTaskKeys = (items ?? []).filter((item) => item.completed).map((item) => item.task_key);
  const fallbackTotals = calculateDailySubmission(today, completedTaskKeys);
  const initialEarnedWeight = checkin?.earned_weight ?? fallbackTotals.earnedWeight;
  const initialTotalWeight = checkin?.total_weight ?? fallbackTotals.totalWeight;
  const initialDailyScore = checkin?.daily_score ?? fallbackTotals.dailyScore;
  const initialSavedAt = checkin?.updated_at ?? checkin?.submitted_at ?? null;
  const weekDates = weekDatesFromStart(currentWeekStart);
  const completedWeeks = completedStudentGradeWeekStartsDescending({ selectedWeekStart: currentWeekStart, today });
  const [weekCheckinsResult, partnerResult, halaqaResult, streakResult] = await Promise.all([
    supabase
      .from("checkins")
      .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin")
      .eq("student_id", profile.id)
      .in("date", weekDates)
      .returns<CheckIn[]>(),
    supabase
      .from("partner_recitations")
      .select("id,student_id,week_start,round,points,submitted_at")
      .eq("student_id", profile.id)
      .eq("week_start", currentWeekStart)
      .returns<PartnerRecitation[]>(),
    supabase
      .from("halaqa_grades")
      .select("id,student_id,week_start,attended,attendance_points,recitation_points,notes,graded_by,graded_at,updated_at")
      .eq("student_id", profile.id)
      .eq("week_start", currentWeekStart)
      .maybeSingle<HalaqaGrade>(),
    completedWeeks.length
      ? supabase.rpc("get_student_below70_streak", { input_student_id: profile.id, input_through_week_start: completedWeeks[0] }).returns<Below70StreakReadRow[]>()
      : Promise.resolve({ data: [] as Below70StreakReadRow[], error: null })
  ]);

  if (weekCheckinsResult.error || partnerResult.error || halaqaResult.error || streakResult.error) {
    throw new Error("Unable to load today's progress.");
  }

  const weekCheckins = weekCheckinsResult.data ?? [];
  const weeklyScore = buildWeeklyGradeBreakdown({
    weekDates,
    checkins: weekCheckins,
    partnerRecitations: partnerResult.data ?? [],
    halaqaGrade: halaqaResult.data ?? null
  });
  const below70Streak = parseBelow70StreakReadRows(streakResult.data)[0]?.active_streak_length ?? 0;

  return (
    <StudentPage width="expanded">
      <header className="today-greeting">
        <h1>Assalamu alaykum, {profile.name}</h1>
        <p>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${today}T00:00:00Z`))}</p>
      </header>
      <WeekStatusStrip weekStart={currentWeekStart} today={today} checkins={weekCheckins} />
      <GuidanceVerse className="mt-5 lg:hidden" compact titleId="check-in-guidance-verse-title-mobile" />
      <CheckInChecklist
              initialCompletedTaskKeys={completedTaskKeys}
              initialDailyScore={Number(initialDailyScore)}
              initialEarnedWeight={initialEarnedWeight}
              initialNote={checkin?.note ?? ""}
              initialNotice={
                resolvedSearchParams.status === "accountability-attested"
                  ? { tone: "success", message: "Sadaqa confirmation saved." }
                  : resolvedSearchParams.status === "accountability-error"
                    ? { tone: "error", message: "Unable to save accountability confirmation." }
                    : null
              }
              initialSavedAt={initialSavedAt}
              initialTotalWeight={initialTotalWeight}
              initialWeeklyDailyPoints={weeklyScore.daily_points}
              partnerPoints={weeklyScore.partner_points}
              halaqaPoints={weeklyScore.halaqa_points}
              halaqaLabel={studentContext.scope.groupName}
              below70Streak={below70Streak}
              tasks={todayTasks}
            />
    </StudentPage>
  );
}
