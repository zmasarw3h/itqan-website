import Link from "next/link";
import AppNav from "@/app/nav";
import { formatWeekRange } from "@/lib/dates";
import { formatAmountCents } from "@/lib/incentives";
import { requireProfile } from "@/lib/supabase-server";
import {
  loadWeeklyIncentiveReportData,
  type WeeklyIncentiveScoreRow
} from "@/lib/weekly-incentives";

export const dynamic = "force-dynamic";

type IncentiveReportSearchParams = {
  week?: string;
  view?: string;
};

type ReportView = "badges" | "below70" | "two-week" | "three-week";

const reportViews: Array<{
  key: ReportView;
  title: string;
  description: string;
  emptyText: string;
  columns: Array<"badges" | "score" | "sadaqa">;
}> = [
  {
    key: "badges",
    title: "Most badges this week",
    description: "One badge is earned for each percentage point above 90%.",
    emptyText: "No students earned badges for this week.",
    columns: ["score", "badges"]
  },
  {
    key: "below70",
    title: "Below 70% this week",
    description: "Students who need sadaqa follow-up for this week.",
    emptyText: "No students were below 70% for this week.",
    columns: ["score", "sadaqa"]
  },
  {
    key: "two-week",
    title: "Below 70% two weeks straight",
    description: "Students below 70% for the selected week and the previous completed week.",
    emptyText: "No two-week below-70 streaks for this report.",
    columns: ["score", "sadaqa"]
  },
  {
    key: "three-week",
    title: "70%+ three weeks straight",
    description: "Students at or above 70% for three consecutive completed weeks.",
    emptyText: "No three-week 70%+ streaks for this report.",
    columns: ["score"]
  }
];

function selectedReportView(value: string | undefined): ReportView {
  return reportViews.some((view) => view.key === value) ? (value as ReportView) : "below70";
}

function EmptyReportMessage({ text }: { text: string }) {
  return <p className="mt-4 rounded-md bg-stone-50 p-4 text-sm text-stone-600">{text}</p>;
}

function StudentScoreTable({
  rows,
  columns
}: {
  rows: WeeklyIncentiveScoreRow[];
  columns: Array<"badges" | "score" | "sadaqa">;
}) {
  if (!rows.length) {
    return null;
  }

  return (
    <div className="mt-4 max-h-[520px] overflow-auto">
      <table className="min-w-full divide-y divide-stone-200 text-sm">
        <thead className="sticky top-0 bg-white">
          <tr className="text-left text-stone-600">
            <th className="px-3 py-2 font-medium">Student</th>
            {columns.includes("score") ? <th className="px-3 py-2 font-medium">Weekly score</th> : null}
            {columns.includes("badges") ? <th className="px-3 py-2 font-medium">Badges</th> : null}
            {columns.includes("sadaqa") ? <th className="px-3 py-2 font-medium">Required sadaqa</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((row) => (
            <tr key={`${row.studentId}:${row.weekStart}`}>
              <td className="px-3 py-3">
                <p className="font-medium text-ink">{row.studentName}</p>
                <p className="mt-1 text-xs text-stone-500">{row.studentPhone || row.studentEmail}</p>
              </td>
              {columns.includes("score") ? (
                <td className="px-3 py-3 text-stone-700">{row.weeklyPercentage}%</td>
              ) : null}
              {columns.includes("badges") ? (
                <td className="px-3 py-3 font-semibold text-ink">{row.badgesAwarded}</td>
              ) : null}
              {columns.includes("sadaqa") ? (
                <td className="px-3 py-3 font-semibold text-ink">
                  {formatAmountCents(row.accountabilityAmountCents)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminIncentivesPage({
  searchParams
}: {
  searchParams: Promise<IncentiveReportSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["admin"]);
  const activeView = selectedReportView(resolvedSearchParams.view);
  const data = await loadWeeklyIncentiveReportData({
    supabase,
    week: resolvedSearchParams.week
  });
  const activeViewMeta = reportViews.find((view) => view.key === activeView) ?? reportViews[1];
  const activeRows = data.report
    ? {
        badges: data.report.mostBadgesThisWeek,
        below70: data.report.below70ThisWeek,
        "two-week": data.report.below70TwoWeeksStraight,
        "three-week": data.report.passingThreeWeeksStraight
      }[activeView]
    : [];

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Weekly Incentive Report</h1>
            <p className="mt-1 text-sm text-stone-600">
              Generate a completed-week report for badges, sadaqa follow-up, and score streaks.
            </p>
          </div>

          {data.selectedWeekStart ? (
            <form className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="text-sm font-medium text-ink">Completed week</span>
                <select
                  className="mt-1 min-w-56 rounded-md border border-stone-300 px-3 py-2"
                  defaultValue={data.selectedWeekStart}
                  name="week"
                >
                  {data.availableWeekStarts.map((weekStart) => (
                    <option key={weekStart} value={weekStart}>
                      {formatWeekRange(weekStart)}
                    </option>
                  ))}
                </select>
              </label>
              <input name="view" type="hidden" value={activeView} />
              <button className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white">View report</button>
            </form>
          ) : null}
        </div>

        {data.report ? (
          <>
            <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-ink">{data.report.selectedWeekLabel}</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <Link
                  className={
                    activeView === "badges"
                      ? "rounded-md border border-moss bg-green-50 p-4"
                      : "rounded-md border border-transparent bg-stone-50 p-4 hover:border-stone-300"
                  }
                  href={`/admin/incentives?week=${data.report.selectedWeekStart}&view=badges`}
                >
                  <p className="text-sm text-stone-600">Badge earners</p>
                  <p className="mt-1 text-2xl font-semibold text-ink">{data.report.mostBadgesThisWeek.length}</p>
                </Link>
                <Link
                  className={
                    activeView === "below70"
                      ? "rounded-md border border-moss bg-green-50 p-4"
                      : "rounded-md border border-transparent bg-stone-50 p-4 hover:border-stone-300"
                  }
                  href={`/admin/incentives?week=${data.report.selectedWeekStart}&view=below70`}
                >
                  <p className="text-sm text-stone-600">Below 70%</p>
                  <p className="mt-1 text-2xl font-semibold text-ink">{data.report.below70ThisWeek.length}</p>
                </Link>
                <Link
                  className={
                    activeView === "two-week"
                      ? "rounded-md border border-moss bg-green-50 p-4"
                      : "rounded-md border border-transparent bg-stone-50 p-4 hover:border-stone-300"
                  }
                  href={`/admin/incentives?week=${data.report.selectedWeekStart}&view=two-week`}
                >
                  <p className="text-sm text-stone-600">Two-week below 70%</p>
                  <p className="mt-1 text-2xl font-semibold text-ink">{data.report.below70TwoWeeksStraight.length}</p>
                </Link>
                <Link
                  className={
                    activeView === "three-week"
                      ? "rounded-md border border-moss bg-green-50 p-4"
                      : "rounded-md border border-transparent bg-stone-50 p-4 hover:border-stone-300"
                  }
                  href={`/admin/incentives?week=${data.report.selectedWeekStart}&view=three-week`}
                >
                  <p className="text-sm text-stone-600">Three-week 70%+</p>
                  <p className="mt-1 text-2xl font-semibold text-ink">{data.report.passingThreeWeeksStraight.length}</p>
                </Link>
              </div>
              <div className="mt-3 rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-600">
                Pending sadaqa rows for this week: <span className="font-medium text-ink">{data.pendingAccountabilityCount}</span>
              </div>
            </section>

            <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-ink">{activeViewMeta.title}</h2>
                  <p className="mt-1 text-sm text-stone-600">{activeViewMeta.description}</p>
                </div>
                <div className="rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-700">
                  {activeRows.length} {activeRows.length === 1 ? "student" : "students"}
                </div>
              </div>

              {activeRows.length ? (
                <StudentScoreTable rows={activeRows} columns={activeViewMeta.columns} />
              ) : (
                <EmptyReportMessage text={activeViewMeta.emptyText} />
              )}
            </section>

            <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-ink">Report guide</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-md bg-stone-50 p-4">
                  <p className="font-medium text-ink">Badges</p>
                  <p className="mt-1 text-sm text-stone-600">Students earn one badge for each percentage point above 90%.</p>
                </div>
                <div className="rounded-md bg-stone-50 p-4">
                  <p className="font-medium text-ink">Sadaqa follow-up</p>
                  <p className="mt-1 text-sm text-stone-600">Students below 70% are shown with the required sadaqa amount.</p>
                </div>
                <div className="rounded-md bg-stone-50 p-4">
                  <p className="font-medium text-ink">Two-week watchlist</p>
                  <p className="mt-1 text-sm text-stone-600">Shows students below 70% in both the selected week and previous completed week.</p>
                </div>
                <div className="rounded-md bg-stone-50 p-4">
                  <p className="font-medium text-ink">Three-week consistency</p>
                  <p className="mt-1 text-sm text-stone-600">Shows students at or above 70% for three completed weeks in a row.</p>
                </div>
              </div>
            </section>
          </>
        ) : (
          <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-stone-600">No completed tracker weeks are available yet.</p>
          </section>
        )}
      </main>
    </>
  );
}
