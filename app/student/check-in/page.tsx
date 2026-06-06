import AppNav from "@/app/nav";
import AccountabilityGateActions from "@/app/student/check-in/accountability-gate-actions";
import CheckInChecklist from "@/app/student/check-in/check-in-checklist";
import { attestAccountabilityPaid } from "@/app/student/actions";
import { ACCOUNTABILITY_GATE_COPY } from "@/lib/accountability";
import { friendlyDate, formatWeekRange, todayDateString } from "@/lib/dates";
import { formatAmountCents } from "@/lib/incentives";
import { calculateDailySubmission, tasksForDate } from "@/lib/scoring";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import { findOrCreateBlockingAccountabilityObligation } from "@/lib/weekly-incentives";
import type { AccountabilityObligation, CheckIn, CheckInItem } from "@/lib/types";

export const dynamic = "force-dynamic";

function GuidanceVerse() {
  return (
    <section
      aria-labelledby="check-in-guidance-verse-title"
      className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm md:p-6"
    >
      <h2 id="check-in-guidance-verse-title" className="text-sm font-medium text-moss">
        Surah Aal-Imran 3:8
      </h2>
      <p className="mt-3 text-right font-serif text-2xl leading-loose text-ink md:mt-4 md:text-3xl" dir="rtl" lang="ar">
        رَبَّنَا لَا تُزِغْ قُلُوبَنَا بَعْدَ إِذْ هَدَيْتَنَا وَهَبْ لَنَا مِن لَّدُنكَ رَحْمَةً ۚ
        إِنَّكَ أَنتَ الْوَهَّابُ
      </p>
      <p className="mt-3 text-base leading-7 text-stone-700 md:mt-4">
        “Our Lord, do not let our hearts deviate after You have guided us, and grant us mercy from Yourself.
        Indeed, You are the Bestower.”
      </p>
    </section>
  );
}

function AccountabilityGate({
  obligation,
  status,
  studentName
}: {
  obligation: Pick<AccountabilityObligation, "id" | "week_start" | "weekly_percentage" | "amount_cents">;
  status?: string;
  studentName: string;
}) {
  const attestAction = attestAccountabilityPaid.bind(null, obligation.id);

  return (
    <>
      <AppNav role="student" name={studentName} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <div>
            <p className="text-sm font-medium uppercase text-moss">Accountability confirmation</p>
            <h1 className="mt-2 text-2xl font-semibold text-ink">{ACCOUNTABILITY_GATE_COPY.heading}</h1>
            <p className="mt-2 text-stone-600">{ACCOUNTABILITY_GATE_COPY.support}</p>
          </div>

          {status === "accountability-error" ? (
            <p className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Unable to save accountability confirmation.
            </p>
          ) : null}
          {status === "accountability-required" ? (
            <p className="mt-6 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
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

          <div className="mt-6 rounded-md border border-stone-200 p-4">
            <h2 className="text-lg font-semibold text-ink">{ACCOUNTABILITY_GATE_COPY.question}</h2>
            <AccountabilityGateActions>
              <form action={attestAction}>
                <button className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink">
                  {ACCOUNTABILITY_GATE_COPY.yesButton}
                </button>
              </form>
            </AccountabilityGateActions>
          </div>
        </section>
      </main>
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
  const today = todayDateString();
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
      <main className="mx-auto max-w-4xl px-4 py-8">
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-ink">Today&apos;s Check-In</h1>
              <p className="mt-1 text-stone-600">{profile.name}</p>
              <p className="mt-1 text-sm text-stone-500">{friendlyDate(today)}</p>
            </div>
            <div className="rounded-md bg-green-50 px-4 py-3 text-right">
              <p className="text-xs font-medium uppercase text-green-700">{checkin ? "Saved" : "Ready to save"}</p>
              <p className="mt-1 text-2xl font-semibold text-ink">Today</p>
            </div>
          </div>

          {resolvedSearchParams.status === "accountability-attested" ? (
            <p className="mt-6 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Sadaqa confirmation saved.
            </p>
          ) : null}
          {resolvedSearchParams.status === "accountability-error" ? (
            <p className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Unable to save accountability confirmation.
            </p>
          ) : null}
        </section>

        <GuidanceVerse />

        <CheckInChecklist
          initialCompletedTaskKeys={completedTaskKeys}
          initialDailyScore={Number(initialDailyScore)}
          initialEarnedWeight={initialEarnedWeight}
          initialNote={checkin?.note ?? ""}
          initialSavedAt={initialSavedAt}
          initialTotalWeight={initialTotalWeight}
          tasks={todayTasks}
        />
      </main>
    </>
  );
}
