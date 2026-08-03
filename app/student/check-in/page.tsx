import Link from "next/link";
import { Diamond } from "@phosphor-icons/react/dist/ssr";
import { arabicFont } from "@/app/arabic-font";
import AppNav from "@/app/nav";
import AccountabilityGateActions from "@/app/student/check-in/accountability-gate-actions";
import CheckInChecklist from "@/app/student/check-in/check-in-checklist";
import { StudentPage } from "@/app/student/student-ui";
import { StudentSetupIncomplete, StudentWeekContextPanel } from "@/app/student/student-week-context";
import { attestAccountabilityPaid } from "@/app/student/actions";
import { ACCOUNTABILITY_GATE_COPY } from "@/lib/accountability";
import {
  checkInEffectiveDateString,
  friendlyDate,
  formatWeekRange,
  torontoCivilDateString,
  weekStartForDate
} from "@/lib/dates";
import { formatAmountCents } from "@/lib/incentives";
import { calculateDailySubmission, tasksForDate } from "@/lib/scoring";
import { loadStudentWeekContext, type StudentWeekScope, type StudentWeekTeacher } from "@/lib/student-scope";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import { findOrCreateBlockingAccountabilityObligation } from "@/lib/weekly-incentives";
import {
  WEEKLY_PLAN_GATE_COPY,
  weeklyPlanBlocksCheckIn,
  weeklyPlanRequiredWeekStart
} from "@/lib/weekly-plans";
import type { AccountabilityObligation, CheckIn, CheckInItem, WeeklyPlan } from "@/lib/types";

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
      className={`rounded-lg bg-forest text-white shadow-sm ${
        compact ? "p-4 sm:p-6" : "p-6 sm:p-7 lg:p-8"
      } ${className}`}
    >
      <h2
        id={titleId}
        className={`${compact ? "text-sm" : "text-base"} font-semibold text-gold-on-dark`}
      >
        Surah Aal-Imran 3:8
      </h2>
      <div
        aria-hidden="true"
        className={`${compact ? "my-3" : "my-5"} flex items-center text-gold-on-dark`}
      >
        <span className={`${compact ? "w-9" : "w-12"} h-px bg-current opacity-60`} />
        <Diamond className="mx-2" size={compact ? 12 : 14} weight="regular" />
        <span className={`${compact ? "w-9" : "w-12"} h-px bg-current opacity-60`} />
      </div>
      <p
        className={`${arabicFont.className} text-white ${
          compact
            ? "text-center text-2xl leading-[1.65]"
            : "text-right text-3xl leading-[1.9] lg:text-[2.15rem]"
        }`}
        dir="rtl"
        lang="ar"
      >
        رَبَّنَا لَا تُزِغْ قُلُوبَنَا بَعْدَ إِذْ هَدَيْتَنَا وَهَبْ لَنَا مِن لَّدُنكَ رَحْمَةً ۚ
        إِنَّكَ أَنتَ الْوَهَّابُ
      </p>
      <div aria-hidden="true" className={`${compact ? "my-3" : "my-5"} h-px bg-gold-on-dark/55`} />
      <p
        className={`${compact ? "text-center text-sm leading-5" : "text-base leading-7"} text-stone-100`}
      >
        “Our Lord, do not let our hearts deviate after You have guided us. Grant us mercy from Yourself. You are the
        Ever-Giving.”
      </p>
    </section>
  );
}

function CheckInSupportRail({
  scope,
  teacher
}: {
  scope: StudentWeekScope;
  teacher: StudentWeekTeacher | null;
}) {
  return (
    <aside aria-label="Halaqa and Quran guidance" className="space-y-6 lg:sticky lg:top-6">
      <StudentWeekContextPanel layout="stacked" scope={scope} teacher={teacher} />
      <GuidanceVerse />
    </aside>
  );
}

function AccountabilityGate({
  obligation,
  status,
  studentName,
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
    <>
      <AppNav role="student" name={studentName} />
      <StudentPage width="expanded">
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,2.05fr)_minmax(20rem,0.95fr)] xl:gap-10">
          <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm sm:p-6 lg:p-8">
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

            <div className="mt-6 grid gap-3 rounded-md bg-stone-50 p-4 text-sm text-stone-700">
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
          </section>
          <CheckInSupportRail scope={scope} teacher={teacher} />
        </div>
      </StudentPage>
    </>
  );
}

function WeeklyPlanGate({
  studentName,
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
    <>
      <AppNav role="student" name={studentName} />
      <StudentPage width="expanded">
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,2.05fr)_minmax(20rem,0.95fr)] xl:gap-10">
          <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm sm:p-6 lg:p-8">
            <div>
              <p className="text-sm font-medium uppercase text-moss">Weekly plan required</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                {WEEKLY_PLAN_GATE_COPY.heading}
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">{WEEKLY_PLAN_GATE_COPY.support}</p>
            </div>

            <div className="mt-6 rounded-md bg-stone-50 p-4 text-sm text-stone-700">
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
          </section>
          <CheckInSupportRail scope={scope} teacher={teacher} />
        </div>
      </StudentPage>
    </>
  );
}

export default async function StudentCheckInPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["student"]);
  const today = checkInEffectiveDateString();
  const civilToday = torontoCivilDateString();
  const currentWeekStart = weekStartForDate(today);
  const studentContext = await loadStudentWeekContext(supabase, profile.id, currentWeekStart);

  if (!studentContext.scope) {
    return <StudentSetupIncomplete name={profile.name} role={profile.role} weekStart={currentWeekStart} teacher={studentContext.teacher} />;
  }

  const requiredWeeklyPlanWeekStart = weeklyPlanRequiredWeekStart(civilToday);
  const { data: currentWeeklyPlan } = await supabase
    .from("weekly_plans")
    .select("week_start")
    .eq("student_id", profile.id)
    .eq("week_start", requiredWeeklyPlanWeekStart)
    .maybeSingle<Pick<WeeklyPlan, "week_start">>();

  if (weeklyPlanBlocksCheckIn(currentWeeklyPlan ?? null, civilToday)) {
    return (
      <WeeklyPlanGate
        studentName={profile.name}
        weekStart={requiredWeeklyPlanWeekStart}
        scope={studentContext.scope}
        teacher={studentContext.teacher}
      />
    );
  }

  const adminSupabase = createSupabaseAdminClient();
  const blockingObligation = await findOrCreateBlockingAccountabilityObligation({
    supabase: adminSupabase,
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

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <StudentPage width="expanded">
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,2.05fr)_minmax(20rem,0.95fr)] xl:gap-10">
          <div className="min-w-0">
            <section>
              <div className="flex items-start justify-between gap-3 sm:gap-4">
                <div className="min-w-0">
                  <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                    <span className="sm:hidden">Check-In</span>
                    <span className="hidden sm:inline">Today&apos;s Check-In</span>
                  </h1>
                  <p className="mt-2 hidden text-lg text-stone-600 sm:block">{profile.name}</p>
                  <p className="mt-1 text-sm text-stone-500 sm:text-base">{friendlyDate(today)}</p>
                </div>
                <div className="shrink-0 rounded-lg border border-green-100 bg-green-50 px-3 py-3 text-right sm:px-5 sm:py-4">
                  <p className="text-[0.65rem] font-medium uppercase tracking-wide text-green-700 sm:text-xs">
                    {checkin ? "Saved" : "Ready to save"}
                  </p>
                  <p className="mt-1 text-xl font-semibold text-ink sm:text-3xl">Today</p>
                </div>
              </div>
            </section>

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
              tasks={todayTasks}
            />
          </div>
          <aside aria-label="Halaqa and Quran guidance" className="space-y-6 lg:sticky lg:top-6">
            <StudentWeekContextPanel layout="stacked" scope={studentContext.scope} teacher={studentContext.teacher} />
            <GuidanceVerse className="hidden lg:block" titleId="check-in-guidance-verse-title-desktop" />
          </aside>
        </div>
      </StudentPage>
    </>
  );
}
