import { ArrowRight, Medal, Star } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import AppNav from "@/app/nav";
import {
  adaptWeeklyFollowUpContract,
  weeklyFollowUpRows,
  type WeeklyFollowUpContract,
  type WeeklyFollowUpContractExtras
} from "@/lib/admin-report-contract";
import { formatWeekRange, torontoCivilDateString } from "@/lib/dates";
import { formatAmountCents } from "@/lib/incentives";
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
import { loadCompletedWeekStarts, loadComputedBadgeAwards, loadWeeklyIncentiveReportData } from "@/lib/weekly-incentives";

export const dynamic = "force-dynamic";

type ReportsParams = { tab?: string; week?: string; view?: string; month?: string };
type WeeklyView = "below70" | "pending" | "three-plus";

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
  const contractExtras = (weeklyData ?? {}) as WeeklyFollowUpContractExtras;
  const report = weeklyData?.report
    ? adaptWeeklyFollowUpContract(weeklyData.report, contractExtras)
    : null;
  const weeklyRows = report ? weeklyFollowUpRows(report, view) : [];
  const pendingCount = report?.pendingAccountabilityRows?.length ?? weeklyData?.pendingAccountabilityCount ?? 0;
  const threePlusCount = report ? weeklyFollowUpRows(report, "three-plus").length : 0;

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

function WeeklyReport({ pendingCount, report, rows, threePlusCount, view }: { pendingCount: number; report: WeeklyFollowUpContract | null; rows: ReturnType<typeof weeklyFollowUpRows>; threePlusCount: number; view: WeeklyView }) {
  if (!report) return <p className="mt-8 rounded-lg border border-stone-200 bg-white p-6 text-stone-600">No completed reporting week is available.</p>;
  const filters: Array<[WeeklyView, string, number]> = [["below70", "Below 70%", report.below70ThisWeek.length], ["pending", "Pending sadaqa", pendingCount], ["three-plus", "3+ weeks below 70%", threePlusCount]];
  const title = view === "pending" ? "Pending sadaqa" : view === "three-plus" ? "3+ weeks below 70%" : "Below 70% this week";
  return <>
    <div className="mt-7 grid grid-cols-3 overflow-hidden rounded-lg border border-stone-300">{filters.map(([key, label, count]) => <Link aria-current={view === key ? "page" : undefined} className={`flex min-h-16 items-center justify-center px-2 text-center text-sm font-medium sm:text-base ${view === key ? "bg-moss text-white" : "bg-white text-ink"}`} href={reportHref({ tab: "weekly", week: report.selectedWeekStart, view: key })} key={key}>{label} ({count})</Link>)}</div>
    <section className="mt-7 lg:rounded-lg lg:border lg:border-stone-200 lg:bg-white lg:p-6"><h2 className="text-2xl font-semibold text-moss">{title}</h2><p className="mt-2 text-stone-600">{rows.length} students · Completed week {report.selectedWeekLabel}</p>
      <div className="mt-6 overflow-hidden rounded-lg border border-stone-200"><div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem_6rem] gap-2 bg-stone-50 px-4 py-3 text-sm font-medium text-stone-600 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_10rem_2rem]"><span>Student</span><span className="text-center">Weekly score</span><span className="text-center">Below-70 streak</span><span className="text-center">Required sadaqa</span><span className="hidden sm:block" /></div><div className="divide-y divide-stone-200 bg-white">{rows.map((row) => <Link className="grid min-h-24 grid-cols-[minmax(0,1fr)_6rem_6rem_6rem] items-center gap-2 px-4 py-3 hover:bg-green-50 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_10rem_2rem]" href={row.canOpenCurrentProfile ? `/admin/students/${row.studentId}` : "#"} key={row.studentId} prefetch={false}><span className="min-w-0"><span className="block font-semibold">{row.studentName}</span><span className="mt-1 block text-sm text-stone-500">{row.groupName}</span></span><span className="text-center text-lg font-medium">{row.weeklyPercentage}%</span><span className="text-center text-lg">{row.below70Streak >= 3 ? "3+" : row.below70Streak}</span><span className="text-center text-lg font-medium">{formatAmountCents(row.accountabilityAmountCents)}</span><ArrowRight className="hidden size-5 sm:block" /></Link>)}</div>{!rows.length ? <p className="bg-white p-6 text-sm text-stone-600">No students match this follow-up view.</p> : null}</div>
    </section>
  </>;
}

function BadgeReport({ month, rows }: { month: string; rows: ReturnType<typeof buildMonthlyBadgeLeaderboard> }) {
  return <section className="mt-7 lg:rounded-lg lg:border lg:border-stone-200 lg:bg-white lg:p-6"><h2 className="text-3xl font-semibold tracking-tight text-ink">{formatMonthLabel(month)} badge leaderboard</h2><p className="mt-2 text-stone-600">One badge is earned for each percentage point above 90% in a completed week.</p>
    <div className="mt-7 overflow-hidden rounded-lg border border-stone-200"><div className="hidden grid-cols-[5rem_minmax(0,1fr)_10rem_10rem_16rem] gap-3 bg-moss px-4 py-4 text-sm font-medium text-white sm:grid"><span>Rank</span><span>Student</span><span>Month badges</span><span>Lifetime badges</span><span>Recent weekly awards</span></div><div className="divide-y divide-stone-200 bg-white">{rows.map((row) => <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 px-4 py-5 sm:grid-cols-[5rem_minmax(0,1fr)_10rem_10rem_16rem] sm:items-center" key={row.studentId}><span className="flex items-center gap-1 text-2xl font-semibold text-moss"><Medal className="size-7 text-gold" />{row.rank}</span><span className="min-w-0">{row.canOpenCurrentProfile ? <Link className="font-semibold text-ink hover:text-moss" href={`/admin/students/${row.studentId}`} prefetch={false}>{row.studentName}</Link> : <span className="font-semibold">{row.studentName}</span>}</span><span className="col-start-2 mt-2 grid grid-cols-3 gap-3 sm:contents"><span><span className="block text-xs text-stone-500 sm:hidden">Month</span><strong className="text-2xl">{row.monthBadges}</strong><span className="block text-xs text-stone-500">badges</span></span><span><span className="block text-xs text-stone-500 sm:hidden">Lifetime</span><strong className="text-2xl">{row.lifetimeBadges}</strong><span className="block text-xs text-stone-500">badges</span></span><span className="flex items-start gap-2 rounded-md bg-green-50 p-2 text-sm"><Star className="mt-0.5 size-5 shrink-0 text-moss" weight="fill" />{row.recentAwards[0] ? <span>{formatWeekRange(row.recentAwards[0].week_start)}<br />{row.recentAwards[0].badges_awarded} {row.recentAwards[0].badges_awarded === 1 ? "badge" : "badges"}</span> : <span>No awards yet</span>}</span></span></div>)}</div>{!rows.length ? <p className="bg-white p-6 text-sm text-stone-600">No badge awards are available for this month.</p> : null}</div>
  </section>;
}
