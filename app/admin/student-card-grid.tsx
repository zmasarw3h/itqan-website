"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type StudentCardSummary = {
  id: string;
  name: string;
  contact: string;
  scoreLabel: string;
};

export default function StudentCardGrid({ students }: { students: StudentCardSummary[] }) {
  const [search, setSearch] = useState("");
  const visibleStudents = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return students;
    }

    return students.filter((student) => student.name.trim().toLowerCase().startsWith(normalizedSearch));
  }, [search, students]);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Students</h2>
          <p className="text-sm text-stone-600">Cards show only the week-so-far percentage.</p>
        </div>
        <label className="w-full min-w-0 sm:w-72">
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
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {visibleStudents.map((student) => (
          <Link
            className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm hover:border-moss"
            href={`/admin/students/${student.id}`}
            key={student.id}
          >
            <p className="font-medium text-ink">{student.name}</p>
            <p className="text-sm text-stone-600">{student.contact}</p>
            <p className="mt-4 text-3xl font-semibold text-ink">{student.scoreLabel}</p>
            <p className="mt-1 text-xs text-stone-500">Current week so far</p>
          </Link>
        ))}
        {visibleStudents.length ? null : (
          <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-600 shadow-sm">
            No student cards match this search.
          </div>
        )}
      </div>
    </section>
  );
}
