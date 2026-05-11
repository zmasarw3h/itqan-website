import { notFound } from "next/navigation";
import AppNav from "@/app/nav";
import CorrectionForm from "./correction-form";
import {
  currentWeekDates,
  formatPlanWeekRange,
  friendlyDate,
  planWeekStartForDate,
  todayDateString
} from "@/lib/dates";
import { calculateWeeklyAverage, formatScore } from "@/lib/scoring";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import type { CheckIn, CheckInItem, Profile, WeeklyPlan } from "@/lib/types";
import { WEEKLY_PLAN_BUCKET } from "@/lib/weekly-plans";

export const dynamic = "force-dynamic";

export default async function AdminStudentPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["admin"]);
  const storageSupabase = createSupabaseAdminClient();
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
  const itemsByCheckInId = new Map<string, CheckInItem[]>();

  for (const item of items ?? []) {
    itemsByCheckInId.set(item.checkin_id, [...(itemsByCheckInId.get(item.checkin_id) ?? []), item]);
  }

  const today = todayDateString();
  const weekDates = currentWeekDates(today);
  const checkinByDate = new Map((checkins ?? []).map((checkin) => [checkin.date, checkin]));
  const pastOrCurrentWeekDates = weekDates.filter((date) => date <= today);
  const currentWeekCheckins = weekDates
    .map((date) => checkinByDate.get(date))
    .filter((checkin): checkin is CheckIn => Boolean(checkin));
  const submittedCheckinsSoFar = pastOrCurrentWeekDates
    .map((date) => checkinByDate.get(date))
    .filter((checkin): checkin is CheckIn => Boolean(checkin));
  const submittedDaysThisWeek = currentWeekCheckins.length;
  const missingDaysSoFar = pastOrCurrentWeekDates.filter((date) => !checkinByDate.has(date)).length;
  const averageSoFar = calculateWeeklyAverage(submittedCheckinsSoFar.map((checkin) => checkin.daily_score));
  const latestSubmitted = (checkins ?? []).reduce<CheckIn | null>(
    (latest, checkin) =>
      !latest || new Date(checkin.submitted_at).getTime() > new Date(latest.submitted_at).getTime()
      ? checkin
      : latest,
    null
  );
  const weekStart = planWeekStartForDate(today);
  const { data: weeklyPlan } = await supabase
    .from("weekly_plans")
    .select("id,student_id,week_start,file_path,file_name,file_type,file_size,uploaded_at")
    .eq("student_id", student.id)
    .eq("week_start", weekStart)
    .maybeSingle<WeeklyPlan>();
  const weeklyPlanUrl = weeklyPlan
    ? (
        await storageSupabase.storage
          .from(WEEKLY_PLAN_BUCKET)
          .createSignedUrl(weeklyPlan.file_path, 60 * 60, { download: weeklyPlan.file_name })
      ).data?.signedUrl
    : null;

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        {resolvedSearchParams.status === "corrected" ? (
          <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            Correction saved.
          </p>
        ) : null}
        {resolvedSearchParams.status === "correction-error" ? (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Unable to save correction.
          </p>
        ) : null}

        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-ink">{student.name}</h1>
              <p className="mt-1 text-stone-600">{student.phone || student.email}</p>
            </div>
            <div className="rounded-md bg-stone-50 px-4 py-3 text-right">
              <p className="text-xs font-medium uppercase text-stone-500">Latest submitted score</p>
              <p className="text-2xl font-semibold text-ink">{formatScore(latestSubmitted?.daily_score) || "None"}</p>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-stone-200 p-4">
              <p className="text-sm text-stone-600">Submitted days this week</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{submittedDaysThisWeek}</p>
            </div>
            <div className="rounded-md border border-stone-200 p-4">
              <p className="text-sm text-stone-600">Missing days so far</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{missingDaysSoFar}</p>
            </div>
            <div className="rounded-md border border-stone-200 p-4">
              <p className="text-sm text-stone-600">Average so far</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{formatScore(averageSoFar) || "None"}</p>
            </div>
            <div className="rounded-md border border-stone-200 p-4">
              <p className="text-sm text-stone-600">Phone</p>
              <p className="mt-1 break-words text-lg font-semibold text-ink">{student.phone || "Not set"}</p>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink">Current Week</h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
            <div className="divide-y divide-stone-200">
              {weekDates.map((date) => {
                const checkin = checkinByDate.get(date);

                return (
                  <div className="grid gap-3 px-4 py-3 md:grid-cols-[1.2fr_1fr_1fr]" key={date}>
                    <div>
                      <p className="font-medium text-ink">{friendlyDate(date)}</p>
                    </div>
                    <div>
                      <span className={checkin ? "font-medium text-green-700" : "font-medium text-amber-700"}>
                        {checkin ? `Submitted - ${formatScore(checkin.daily_score)}` : "Missing"}
                      </span>
                    </div>
                    <div className="text-stone-600">
                      {checkin ? `${checkin.earned_weight ?? 0}/${checkin.total_weight ?? 0}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Weekly Plan</h2>
              <p className="mt-1 text-sm text-stone-600">{formatPlanWeekRange(weekStart)}</p>
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
              <p className="font-medium text-ink">{weeklyPlan.file_name}</p>
              <p className="mt-1 text-sm text-stone-600">
                Uploaded {new Date(weeklyPlan.uploaded_at).toLocaleString()}
              </p>
            </div>
          ) : (
            <p className="mt-4 rounded-md bg-stone-50 p-4 text-stone-600">No plan uploaded for this week.</p>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink">History</h2>
          <div className="mt-3 space-y-4">
            {(checkins ?? []).map((checkin) => (
              <article className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm" key={checkin.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-ink">{friendlyDate(checkin.date)}</h3>
                    <p className="mt-1 text-sm text-stone-600">
                      Submitted {new Date(checkin.submitted_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-ink">{formatScore(checkin.daily_score)}</p>
                    <p className="text-sm text-stone-600">
                      {checkin.earned_weight ?? 0}/{checkin.total_weight ?? 0}
                    </p>
                  </div>
                </div>
                {checkin.note ? <p className="mt-3 text-sm text-stone-700">Note: {checkin.note}</p> : null}
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {(itemsByCheckInId.get(checkin.id) ?? []).map((item) => (
                    <div
                      className="flex items-start justify-between gap-4 rounded-md bg-stone-50 px-3 py-2 text-sm"
                      key={item.id}
                    >
                      <span className={item.completed ? "text-ink" : "text-stone-500"}>
                        {item.completed ? "Done" : "Missed"}: {item.task_label}
                      </span>
                      <span className="shrink-0 text-stone-600">{item.weight}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
            {checkins?.length ? null : (
              <div className="rounded-lg border border-stone-200 bg-white p-6 text-stone-600 shadow-sm">
                No check-ins yet.
              </div>
            )}
          </div>
        </section>

        <section className="mt-8 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">Manual Correction</h2>
          <CorrectionForm studentId={student.id} today={today} />
        </section>
      </main>
    </>
  );
}
