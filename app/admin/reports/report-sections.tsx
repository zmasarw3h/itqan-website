import { ArrowRight, Medal, Star } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { formatWeekRange } from "@/lib/dates";
import { formatAmountCents } from "@/lib/incentives";
import { formatMonthLabel, type MonthlyBadgeLeaderboardRow } from "@/lib/rewards";
import type { WeeklyFollowUpReport, WeeklyFollowUpRow } from "@/lib/weekly-incentives";

export type WeeklyView = "below70" | "pending" | "three-plus";

function reportHref(input: { tab: "weekly" | "badges"; week?: string | null; view?: WeeklyView; month?: string }) {
  const params = new URLSearchParams({ tab: input.tab });
  if (input.week) params.set("week", input.week);
  if (input.view) params.set("view", input.view);
  if (input.month) params.set("month", input.month);
  return `/admin/reports?${params.toString()}`;
}

export function WeeklyReport({ pendingCount, report, rows, threePlusCount, view }: { pendingCount: number; report: WeeklyFollowUpReport | null; rows: WeeklyFollowUpRow[]; threePlusCount: number; view: WeeklyView }) {
  if (!report) return <p className="mt-8 rounded-lg border border-stone-200 bg-white p-6 text-stone-600">No completed reporting week is available.</p>;
  const filters: Array<[WeeklyView, string, number]> = [["below70", "Below 70%", report.below70ThisWeek.length], ["pending", "Pending sadaqa", pendingCount], ["three-plus", "3+ weeks below 70%", threePlusCount]];
  const title = view === "pending" ? "Pending sadaqa" : view === "three-plus" ? "3+ weeks below 70%" : "Below 70% this week";
  return <>
    <div className="mt-7 grid grid-cols-3 overflow-hidden rounded-lg border border-stone-300">{filters.map(([key, label, count]) => <Link aria-current={view === key ? "page" : undefined} className={`flex min-h-16 items-center justify-center px-2 text-center text-sm font-medium sm:text-base ${view === key ? "bg-moss text-white" : "bg-white text-ink"}`} href={reportHref({ tab: "weekly", week: report.selectedWeekStart, view: key })} key={key}>{label} ({count})</Link>)}</div>
    <section className="mt-7 lg:rounded-lg lg:border lg:border-stone-200 lg:bg-white lg:p-6"><h2 className="text-2xl font-semibold text-moss">{title}</h2><p className="mt-2 text-stone-600">{rows.length} students · Completed week {report.selectedWeekLabel}</p>
      <div className="mt-6 overflow-hidden rounded-lg border border-stone-200">
        <div className="hidden grid-cols-[minmax(0,1fr)_9rem_9rem_10rem_2rem] gap-2 bg-stone-50 px-4 py-3 text-sm font-medium text-stone-600 sm:grid"><span>Student</span><span className="text-center">Weekly score</span><span className="text-center">Below-70 streak</span><span className="text-center">Required sadaqa</span><span /></div>
        <div className="divide-y divide-stone-200 bg-white">{rows.map((row) => <Link className="block min-h-24 px-4 py-4 hover:bg-green-50 sm:grid sm:grid-cols-[minmax(0,1fr)_9rem_9rem_10rem_2rem] sm:items-center sm:gap-2 sm:py-3" href={row.canOpenCurrentProfile ? `/admin/students/${row.studentId}` : "#"} key={row.studentId} prefetch={false}><span className="flex min-w-0 items-center justify-between gap-3"><span><span className="block font-semibold">{row.studentName}</span><span className="mt-1 block text-sm text-stone-500">{row.groupName}</span></span><ArrowRight className="size-5 shrink-0 sm:hidden" /></span><span className="mt-4 grid grid-cols-3 divide-x divide-stone-200 text-center sm:contents"><span className="px-2 sm:px-0"><span className="block text-xs leading-4 text-stone-500 sm:hidden">Weekly score</span><span className="mt-1 block text-lg font-medium">{row.weeklyPercentage}%</span></span><span className="px-2 sm:px-0"><span className="block text-xs leading-4 text-stone-500 sm:hidden">Below-70 streak</span><span className="mt-1 block text-lg">{row.below70Streak >= 3 ? "3+" : row.below70Streak}</span></span><span className="px-2 sm:px-0"><span className="block text-xs leading-4 text-stone-500 sm:hidden">Required sadaqa</span><span className="mt-1 block text-lg font-medium">{formatAmountCents(row.requiredSadaqaCents)}</span></span></span><ArrowRight className="hidden size-5 sm:block" /></Link>)}</div>
        {!rows.length ? <p className="bg-white p-6 text-sm text-stone-600">No students match this follow-up view.</p> : null}
      </div>
    </section>
  </>;
}

export function BadgeReport({ month, rows }: { month: string; rows: MonthlyBadgeLeaderboardRow[] }) {
  return <section className="mt-7 lg:rounded-lg lg:border lg:border-stone-200 lg:bg-white lg:p-6"><h2 className="text-3xl font-semibold tracking-tight text-ink">{formatMonthLabel(month)} badge leaderboard</h2><p className="mt-2 text-stone-600">One badge is earned for each percentage point above 90% in a completed week.</p>
    <div className="mt-7 overflow-hidden rounded-lg border border-stone-200"><div className="hidden grid-cols-[5rem_minmax(0,1fr)_10rem_10rem_16rem] gap-3 bg-moss px-4 py-4 text-sm font-medium text-white sm:grid"><span>Rank</span><span>Student</span><span>Month badges</span><span>Lifetime badges</span><span>Recent weekly awards</span></div><div className="divide-y divide-stone-200 bg-white">{rows.map((row) => <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 px-4 py-5 sm:grid-cols-[5rem_minmax(0,1fr)_10rem_10rem_16rem] sm:items-center" key={row.studentId}><span className="flex items-center gap-1 text-2xl font-semibold text-moss"><Medal className="size-7 text-gold" />{row.rank}</span><span className="min-w-0">{row.canOpenCurrentProfile ? <Link className="font-semibold text-ink hover:text-moss" href={`/admin/students/${row.studentId}`} prefetch={false}>{row.studentName}</Link> : <span className="font-semibold">{row.studentName}</span>}</span><span className="col-start-2 mt-2 grid grid-cols-3 gap-3 sm:contents"><span><span className="block text-xs text-stone-500 sm:hidden">Month</span><strong className="text-2xl">{row.monthBadges}</strong><span className="block text-xs text-stone-500">badges</span></span><span><span className="block text-xs text-stone-500 sm:hidden">Lifetime</span><strong className="text-2xl">{row.lifetimeBadges}</strong><span className="block text-xs text-stone-500">badges</span></span><span className="space-y-2">{row.recentAwards.length ? row.recentAwards.map((award) => <span className="flex items-start gap-2 rounded-md bg-green-50 p-2 text-sm" data-testid="recent-award" key={award.id}><Star className="mt-0.5 size-5 shrink-0 text-moss" weight="fill" /><span>{formatWeekRange(award.week_start)}<br />{award.badges_awarded} {award.badges_awarded === 1 ? "badge" : "badges"}</span></span>) : <span className="block text-sm text-stone-500">No awards yet</span>}</span></span></div>)}</div>{!rows.length ? <p className="bg-white p-6 text-sm text-stone-600">No badge awards are available for this month.</p> : null}</div>
  </section>;
}
