import Link from "next/link";
import AppNav from "@/app/nav";
import { BadgeReport, WeeklyReport, type WeeklyView } from "@/app/admin/reports/report-sections";
import { formatWeekRange, torontoCivilDateString } from "@/lib/dates";
import {
  buildMonthlyBadgeLeaderboard,
  buildMonthlyRewardPopulation,
  formatMonthLabel,
  isValidMonthString,
  monthStartForDate,
  monthStartForMonthString
} from "@/lib/rewards";
import { loadHistoricalReportingStudentsForWeeks } from "@/lib/reporting-population";
import { requireProfile } from "@/lib/supabase-server";
import {
  loadCompletedWeekStarts,
  loadComputedBadgeAwards,
  loadWeeklyIncentiveReportData,
  type WeeklyFollowUpReport
} from "@/lib/weekly-incentives";

export const dynamic = "force-dynamic";

type ReportsParams = { tab?: string; week?: string; view?: string; month?: string };

function validView(value: string | undefined): WeeklyView {
  return value === "pending" || value === "three-plus" ? value : "below70";
}

function monthStart(value: string | undefined) {
  return value && isValidMonthString(value) ? monthStartForMonthString(value) : monthStartForDate(torontoCivilDateString());
}

function reportHref(input: { tab: "weekly" | "badges"; week?: string | null; view?: WeeklyView; month?: string }) {
  const params = new URLSearchParams({ tab: input.tab });
  if (input.week) params.set("week", input.week);
  if (input.view) params.set("view", input.view);
  if (input.month) params.set("month", input.month);
  return `/admin/reports?${params.toString()}`;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<ReportsParams> }) {
  const params = await searchParams;
  const { supabase, profile } = await requireProfile(["admin", "super_admin"]);
  const tab = params.tab === "badges" ? "badges" : "weekly";
  const view = validView(params.view);
  const completedWeekStarts = await loadCompletedWeekStarts(supabase);
  const weeklyData = tab === "weekly" ? await loadWeeklyIncentiveReportData({ supabase, week: params.week }) : null;
  const selectedMonthStart = monthStart(params.month);
  const population = tab === "badges" ? await loadHistoricalReportingStudentsForWeeks(supabase, completedWeekStarts) : [];
  const awards = tab === "badges" ? await loadComputedBadgeAwards({ supabase, weekStarts: completedWeekStarts, population }) : [];
  const badgeRows = tab === "badges" ? buildMonthlyBadgeLeaderboard({ students: buildMonthlyRewardPopulation({ population, monthStart: selectedMonthStart }), awards, monthStart: selectedMonthStart }) : [];
  const availableMonths = [...new Set([selectedMonthStart, monthStartForDate(torontoCivilDateString()), ...completedWeekStarts.map((week) => `${week.slice(0, 7)}-01`)])].sort((a, b) => b.localeCompare(a));
  const report: WeeklyFollowUpReport | null = weeklyData?.report ?? null;
  const weeklyRows = report
    ? view === "pending"
      ? report.pendingSadaqaRows
      : view === "three-plus"
        ? report.below70ThreePlusWeeks
        : report.below70ThisWeek
    : [];
  const pendingCount = report?.pendingSadaqaRows.length ?? 0;
  const threePlusCount = report?.below70ThreePlusWeeks.length ?? 0;

  return <>
    <AppNav activeHref="/admin/reports" role={profile.role} name={profile.name} />
    <main className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 lg:px-10">
      <header className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div><h1 className="text-4xl font-semibold tracking-tight text-moss">Reports</h1><p className="mt-2 text-stone-600">Review completed-week accountability and {tab === "badges" ? "monthly badge performance." : "student follow-up."}</p></div>
        {tab === "weekly" && weeklyData?.selectedWeekStart ? <form className="grid gap-3 sm:grid-cols-[minmax(14rem,1fr)_auto] sm:items-end"><input name="tab" type="hidden" value="weekly" /><input name="view" type="hidden" value={view} /><label><span className="text-sm font-medium">Completed week</span><select className="mt-1 min-h-12 w-full rounded-md border border-stone-300 bg-white px-3" defaultValue={weeklyData.selectedWeekStart} name="week">{weeklyData.availableWeekStarts.map((week) => <option key={week} value={week}>{formatWeekRange(week)}</option>)}</select></label><button className="min-h-12 rounded-md bg-moss px-6 font-medium text-white hover:bg-ink">View report</button></form> : null}
        {tab === "badges" ? <form className="grid gap-3 sm:grid-cols-[minmax(14rem,1fr)_auto] sm:items-end"><input name="tab" type="hidden" value="badges" /><label><span className="text-sm font-medium">Month</span><select className="mt-1 min-h-12 w-full rounded-md border border-stone-300 bg-white px-3" defaultValue={selectedMonthStart.slice(0, 7)} name="month">{availableMonths.map((month) => <option key={month} value={month.slice(0, 7)}>{formatMonthLabel(month)}</option>)}</select></label><button className="min-h-12 rounded-md bg-moss px-6 font-medium text-white hover:bg-ink">View month</button></form> : null}
      </header>

      <nav aria-label="Report type" className="mt-7 grid grid-cols-2 overflow-hidden rounded-lg border border-stone-300 sm:max-w-md lg:rounded-none lg:border-x-0 lg:border-t-0">
        <Link aria-current={tab === "weekly" ? "page" : undefined} className={`flex min-h-14 items-center justify-center px-4 text-center font-medium lg:border-b-2 ${tab === "weekly" ? "bg-moss text-white lg:border-moss lg:bg-transparent lg:text-moss" : "bg-white text-ink lg:border-transparent"}`} href={reportHref({ tab: "weekly", week: weeklyData?.selectedWeekStart ?? params.week, view })}>Weekly follow-up</Link>
        <Link aria-current={tab === "badges" ? "page" : undefined} className={`flex min-h-14 items-center justify-center px-4 text-center font-medium lg:border-b-2 ${tab === "badges" ? "bg-moss text-white lg:border-moss lg:bg-transparent lg:text-moss" : "bg-white text-ink lg:border-transparent"}`} href={reportHref({ tab: "badges", month: selectedMonthStart.slice(0, 7) })}>Badge rewards</Link>
      </nav>

      {tab === "weekly" ? <WeeklyReport report={report ?? null} rows={weeklyRows} view={view} pendingCount={pendingCount} threePlusCount={threePlusCount} /> : <BadgeReport month={selectedMonthStart} rows={badgeRows} />}
    </main>
  </>;
}
