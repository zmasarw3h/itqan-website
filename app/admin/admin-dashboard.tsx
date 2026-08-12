"use client";

import { ArrowLeft, ArrowRight, DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatWeekRange } from "@/lib/dates";
import { leaderboardStatusLabel, type LeaderboardRow } from "@/lib/leaderboard";

export type DashboardFilter = "all" | "below70" | "streaks" | "missing";

export function dashboardRowsForFilter(rows: LeaderboardRow[], filter: DashboardFilter) {
  if (filter === "below70") return rows.filter((row) => row.score.percentage < 70);
  if (filter === "streaks") return rows.filter((row) => row.below70Streak > 0);
  if (filter === "missing") {
    return rows.filter((row) => row.score.daily_points === 0 && row.score.partner_points === 0 && row.score.halaqa_points === 0);
  }
  return rows;
}

function matchesSearch(row: LeaderboardRow, value: string) {
  const search = value.trim().toLocaleLowerCase();
  return !search || row.studentName.toLocaleLowerCase().includes(search) || row.studentPhone?.includes(search) || row.studentEmail?.toLocaleLowerCase().includes(search);
}

function Status({ row }: { row: LeaderboardRow }) {
  const below = row.status === "below_70" || row.status === "below_70_so_far";
  return <span className={below ? "rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-600" : "text-sm font-medium text-green-700"}>{leaderboardStatusLabel(row.status)}</span>;
}

function StudentDetail({ onBack, row, selectedWeekLabel }: { onBack: () => void; row: LeaderboardRow; selectedWeekLabel: string }) {
  return <section aria-label="Selected student" className="min-w-0 lg:rounded-lg lg:border lg:border-stone-200 lg:bg-white lg:p-5">
    <button className="mb-8 inline-flex min-h-11 items-center gap-2 font-semibold text-moss lg:hidden" onClick={onBack} type="button"><ArrowLeft className="size-5" />Back to dashboard</button>
    <p className="text-sm text-stone-500">Selected student</p>
    <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{row.studentName}</h2>
    {row.canViewCurrentContact && (row.studentPhone || row.studentEmail) ? <p className="mt-1 text-stone-700">{row.studentPhone || row.studentEmail}</p> : null}
    <p className="mt-1 text-sm text-stone-500">{row.masjidName} · {row.cohortName} · {row.groupName}</p>

    <div className="mt-6 rounded-xl border border-stone-200 p-5">
      <p className="text-base text-stone-700">Week score so far</p>
      <div className="mt-2 flex flex-wrap items-center gap-3"><p className="text-5xl font-semibold tracking-tight text-ink">{row.score.percentage}%</p><span className="rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-moss">{row.status === "in_progress" || row.status === "below_70_so_far" ? "In progress" : "Completed"}</span></div>
      <p className="mt-2 text-stone-500">Week of {selectedWeekLabel}</p>
      <div className="mt-5 grid grid-cols-3 divide-x divide-stone-200 border-t border-stone-200 pt-5 text-center">
        <div><p className="text-sm text-stone-600">Daily</p><p className="mt-2 text-lg font-semibold">{row.score.daily_points} / 700</p></div>
        <div><p className="text-sm text-stone-600">Partner</p><p className="mt-2 text-lg font-semibold">{row.score.partner_points} / 150</p></div>
        <div><p className="text-sm text-stone-600">Halaqa</p><p className="mt-2 text-lg font-semibold">{row.score.halaqa_points} / 150</p></div>
      </div>
    </div>

    <div className="mt-6">
      <p className="text-sm font-semibold text-ink">Quick actions</p>
      {row.canOpenCurrentProfile ? <Link className="mt-2 flex min-h-12 items-center justify-between rounded-md bg-moss px-4 font-medium text-white hover:bg-ink" href={`/admin/students/${row.studentId}`} prefetch={false}>Open student workspace<ArrowRight className="size-5" /></Link> : <p className="mt-2 rounded-md bg-stone-100 p-3 text-sm text-stone-600">This historical student profile is not currently available.</p>}
      <p className="mt-2 text-sm text-stone-500">Review full progress, plan, and settings.</p>
    </div>
  </section>;
}

export default function AdminDashboard({ availableWeekStarts, exportHref, initialFilter = "all", rows, selectedWeekLabel, selectedWeekStart }: { availableWeekStarts: string[]; exportHref: string; initialFilter?: DashboardFilter; rows: LeaderboardRow[]; selectedWeekLabel: string; selectedWeekStart: string }) {
  const router = useRouter();
  const [filter, setFilter] = useState<DashboardFilter>(initialFilter);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(rows[0]?.studentId ?? "");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const counts = useMemo(() => ({ all: rows.length, below70: dashboardRowsForFilter(rows, "below70").length, streaks: dashboardRowsForFilter(rows, "streaks").length, missing: dashboardRowsForFilter(rows, "missing").length }), [rows]);
  const visible = useMemo(() => dashboardRowsForFilter(rows, filter).filter((row) => matchesSearch(row, search)), [filter, rows, search]);
  const selected = rows.find((row) => row.studentId === selectedId) ?? visible[0] ?? rows[0];
  const filters: Array<[DashboardFilter, string]> = [["all", "All students"], ["below70", "Below 70%"], ["streaks", "Active streaks"], ["missing", "Missing activity"]];

  if (mobileDetailOpen && selected) return <div className="lg:hidden"><StudentDetail onBack={() => setMobileDetailOpen(false)} row={selected} selectedWeekLabel={selectedWeekLabel} /></div>;

  return <>
    <header className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
      <div><h1 className="text-4xl font-semibold tracking-tight text-ink">Admin Dashboard</h1><h2 className="mt-2 text-xl font-medium text-ink">Weekly student overview</h2><p className="mt-1 text-stone-500">Review student performance and weekly status at a glance.</p></div>
      <div className="grid gap-3 sm:grid-cols-[minmax(14rem,1fr)_auto] sm:items-end">
        <label><span className="text-sm font-medium text-ink">Week</span><select className="mt-1 min-h-12 w-full rounded-md border border-stone-300 bg-white px-3" onChange={(event) => router.replace(`/admin?week=${event.target.value}`)} value={selectedWeekStart}>{availableWeekStarts.map((week) => <option key={week} value={week}>{formatWeekRange(week)}</option>)}</select></label>
        <Link className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-moss px-5 font-medium text-moss hover:bg-green-50 sm:bg-moss sm:text-white sm:hover:bg-ink" href={exportHref} prefetch={false}><DownloadSimple className="size-5" />Export CSV</Link>
      </div>
    </header>

    <div className="mt-7 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(21rem,0.95fr)]">
      <section className="min-w-0 lg:rounded-lg lg:border lg:border-stone-200 lg:bg-white lg:p-4">
        <div className="hidden lg:block"><h2 className="font-semibold">Students</h2><p className="mt-2 text-sm text-stone-600">Week of {selectedWeekLabel} · {rows.length} students</p></div>
        <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-lg border border-stone-300 sm:grid-cols-4 lg:mt-4">
          {filters.map(([key, label]) => <button aria-pressed={filter === key} className={`min-h-12 border-stone-300 px-2 text-sm font-medium sm:border-l first:border-l-0 ${filter === key ? "bg-moss text-white" : "bg-white text-ink hover:bg-stone-50"}`} key={key} onClick={() => setFilter(key)} type="button">{label} ({counts[key]})</button>)}
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block sm:max-w-sm sm:flex-1"><MagnifyingGlass className="pointer-events-none absolute left-3 top-3.5 size-5 text-stone-500" /><span className="sr-only">Search students</span><input className="min-h-12 w-full rounded-md border border-stone-300 pl-10 pr-3" onChange={(event) => setSearch(event.target.value)} placeholder="Search students..." type="search" value={search} /></label>
          <p className="text-sm text-stone-600">Showing {visible.length} of {dashboardRowsForFilter(rows, filter).length} students</p>
        </div>
        <h2 className="mt-5 text-lg font-semibold lg:hidden">Students</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-stone-200">
          <div className="hidden grid-cols-[4rem_minmax(0,1fr)_7rem_9rem_7rem_2rem] items-center gap-2 bg-stone-50 px-4 py-3 text-sm font-medium text-stone-600 lg:grid"><span>Rank</span><span>Student</span><span>Week %</span><span>Status</span><span>Below-70 streak</span><span /></div>
          <div className="divide-y divide-stone-200 bg-white">{visible.map((row) => <button className={`grid w-full grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 text-left hover:bg-green-50 lg:grid-cols-[4rem_minmax(0,1fr)_7rem_9rem_7rem_2rem] ${selected?.studentId === row.studentId ? "lg:bg-green-50" : ""}`} key={row.studentId} onClick={() => { setSelectedId(row.studentId); setMobileDetailOpen(true); }} type="button"><span className="font-medium">#{row.rank}</span><span className="min-w-0"><span className="block font-semibold text-ink">{row.studentName}</span><span className="mt-1 block text-sm text-stone-500">{row.masjidName} · {row.cohortName} · {row.groupName}</span><span className="mt-3 grid grid-cols-3 divide-x divide-stone-200 text-center lg:hidden"><span><span className="block text-xs text-stone-500">Week %</span><span className="mt-1 block text-lg font-semibold">{row.score.percentage}%</span></span><span><span className="block text-xs text-stone-500">Status</span><span className="mt-2 block"><Status row={row} /></span></span><span><span className="block text-xs text-stone-500">Streak</span><span className="mt-1 block text-lg">{row.below70Streak}</span></span></span></span><span className="hidden text-xl font-semibold lg:block">{row.score.percentage}%</span><span className="hidden lg:block"><Status row={row} /></span><span className="hidden lg:block">{row.below70Streak}</span><ArrowRight className="size-5 text-stone-500" /></button>)}</div>
          {!visible.length ? <p className="bg-white p-6 text-sm text-stone-600">No students match this view.</p> : null}
        </div>
      </section>
      {selected ? <div className="hidden lg:block"><StudentDetail onBack={() => {}} row={selected} selectedWeekLabel={selectedWeekLabel} /></div> : null}
    </div>
  </>;
}
