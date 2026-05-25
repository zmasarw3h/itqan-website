"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { leaderboardStatusLabel, type LeaderboardRow } from "@/lib/leaderboard";

function statusClass(status: string) {
  if (status === "passing") return "text-green-700";
  if (status === "below_70" || status === "below_70_so_far") return "text-red-700";
  return "text-stone-600";
}

function matchesSearch(row: LeaderboardRow, search: string) {
  const normalizedSearch = search.trim().toLowerCase();

  if (!normalizedSearch) {
    return true;
  }

  return (
    row.studentName.toLowerCase().startsWith(normalizedSearch) ||
    row.studentPhone?.toLowerCase().includes(normalizedSearch) ||
    row.studentEmail.toLowerCase().includes(normalizedSearch)
  );
}

export default function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  const [search, setSearch] = useState("");
  const visibleRows = useMemo(() => rows.filter((row) => matchesSearch(row, search)), [rows, search]);

  return (
    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <label className="w-full min-w-0 sm:w-80">
          <span className="sr-only">Search students</span>
          <input
            autoComplete="off"
            className="w-full rounded-md border border-stone-300 px-3 py-2"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search students"
            type="search"
            value={search}
          />
        </label>
        <p className="text-sm text-stone-600">
          Showing {visibleRows.length} of {rows.length} students
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-stone-50 text-ink">
            <tr>
              <th className="px-4 py-3 font-medium">Rank</th>
              <th className="px-4 py-3 font-medium">Student</th>
              <th className="px-4 py-3 font-medium">Week %</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Below-70 Streak</th>
              <th className="px-4 py-3 font-medium">Daily</th>
              <th className="px-4 py-3 font-medium">Partner</th>
              <th className="px-4 py-3 font-medium">Halaqa</th>
              <th className="px-4 py-3 font-medium">Student Page</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {visibleRows.map((row) => (
              <tr key={row.studentId}>
                <td className="px-4 py-3 font-medium text-ink">#{row.rank}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">{row.studentName}</p>
                  <p className="text-xs text-stone-500">{row.studentPhone || row.studentEmail}</p>
                </td>
                <td className="px-4 py-3 text-xl font-semibold text-ink">{row.score.percentage}%</td>
                <td className={`px-4 py-3 font-medium ${statusClass(row.status)}`}>
                  {leaderboardStatusLabel(row.status)}
                </td>
                <td className="px-4 py-3 text-stone-700">{row.below70Streak}</td>
                <td className="px-4 py-3 text-stone-700">{row.score.daily_points} / 700</td>
                <td className="px-4 py-3 text-stone-700">{row.score.partner_points} / 150</td>
                <td className="px-4 py-3 text-stone-700">{row.score.halaqa_points} / 150</td>
                <td className="px-4 py-3">
                  <Link className="font-medium text-moss hover:text-ink" href={`/admin/students/${row.studentId}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {visibleRows.length ? null : (
              <tr>
                <td className="px-4 py-6 text-stone-600" colSpan={9}>
                  No students match this leaderboard view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
