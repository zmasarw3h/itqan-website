import Link from "next/link";
import AppNav from "@/app/nav";
import StudentCardGrid, { type StudentCardSummary } from "@/app/admin/student-card-grid";
import { buildCompletionRows } from "@/lib/checkins";
import {
  addDays,
  formatDateTimeInAppTimeZone,
  formatWeekRange,
  friendlyDate,
  isValidDateString,
  todayDateString,
  weekDatesFromStart,
  weekStartForDate
} from "@/lib/dates";
import { calculateDailyScoreProgress, formatScore } from "@/lib/scoring";
import { requireProfile } from "@/lib/supabase-server";
import type {
  CheckIn,
  CheckInItem,
  CompletionStatus,
  DashboardFilters,
  Profile
} from "@/lib/types";

export const dynamic = "force-dynamic";

type AdminSearchParams = {
  student?: string;
  date?: string;
  week?: string;
  status?: CompletionStatus;
};

function validWeekStart(value: string | undefined, fallback: string) {
  if (!value || !isValidDateString(value)) {
    return fallback;
  }

  return weekStartForDate(value) === value ? value : fallback;
}

function cleanFilters(searchParams: AdminSearchParams, currentWeekStart: string): DashboardFilters {
  return {
    studentId: searchParams.student || undefined,
    date: searchParams.date && isValidDateString(searchParams.date) ? searchParams.date : undefined,
    weekStart: validWeekStart(searchParams.week, currentWeekStart),
    status:
      searchParams.status === "submitted" || searchParams.status === "missing" || searchParams.status === "upcoming"
        ? searchParams.status
        : undefined
  };
}

function csvHref(filters: DashboardFilters) {
  const params = new URLSearchParams();
  if (filters.studentId) params.set("student", filters.studentId);
  if (filters.date) params.set("date", filters.date);
  if (filters.weekStart) params.set("week", filters.weekStart);
  if (filters.status) params.set("status", filters.status);
  const query = params.toString();
  return query ? `/admin/export?${query}` : "/admin/export";
}

function currentWeekHref(filters: DashboardFilters, currentWeekStart: string) {
  const params = new URLSearchParams();
  if (filters.studentId) params.set("student", filters.studentId);
  if (filters.status) params.set("status", filters.status);
  params.set("week", currentWeekStart);
  return `/admin?${params.toString()}`;
}

function progressTodayForCard(weekDates: string[], dailyScoresByDate: Map<string, number | null | undefined>, today: string) {
  if (!weekDates.includes(today) || dailyScoresByDate.has(today)) {
    return today;
  }

  return addDays(today, -1);
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["admin"]);
  const today = todayDateString();
  const currentWeekStart = weekStartForDate(today);
  const filters = cleanFilters(resolvedSearchParams, currentWeekStart);
  const selectedWeekStart = filters.weekStart ?? currentWeekStart;
  const selectedWeekDates = weekDatesFromStart(selectedWeekStart);
  const dates = filters.date ? [filters.date] : selectedWeekDates;

  const { data: students } = await supabase
    .from("profiles")
    .select("id,name,email,phone,role,active,created_at")
    .eq("role", "student")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Profile[]>();

  const { data: checkinDates } = await supabase
    .from("checkins")
    .select("date")
    .order("date", { ascending: false })
    .returns<Array<{ date: string }>>();
  const availableWeekStarts = [
    ...new Set([
      currentWeekStart,
      selectedWeekStart,
      ...(checkinDates ?? []).map((checkin) => weekStartForDate(checkin.date))
    ])
  ].sort((a, b) => b.localeCompare(a));

  let checkinQuery = supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin")
    .in("date", dates);

  if (filters.studentId) {
    checkinQuery = checkinQuery.eq("student_id", filters.studentId);
  }

  const { data: checkins } = await checkinQuery.returns<CheckIn[]>();
  const checkinIds = (checkins ?? []).map((checkin) => checkin.id);
  const { data: items } = checkinIds.length
    ? await supabase
        .from("checkin_items")
        .select("id,checkin_id,student_id,date,task_key,task_label,weight,completed,created_at")
        .in("checkin_id", checkinIds)
        .returns<CheckInItem[]>()
    : { data: [] };
  const rows = buildCompletionRows(students ?? [], checkins ?? [], dates, filters, items ?? []);
  let scoreCheckinQuery = supabase
    .from("checkins")
    .select("id,student_id,date,completed,note,earned_weight,total_weight,daily_score,submitted_at,updated_at,updated_by_admin")
    .in("date", selectedWeekDates);

  if (filters.studentId) {
    scoreCheckinQuery = scoreCheckinQuery.eq("student_id", filters.studentId);
  }

  const { data: scoreCheckins } = await scoreCheckinQuery.returns<CheckIn[]>();
  const scoreCheckinsByStudent = new Map<string, CheckIn[]>();

  for (const checkin of scoreCheckins ?? []) {
    scoreCheckinsByStudent.set(checkin.student_id, [...(scoreCheckinsByStudent.get(checkin.student_id) ?? []), checkin]);
  }

  const studentCards = (students ?? [])
    .filter((student) => !filters.studentId || student.id === filters.studentId)
    .map<StudentCardSummary>((student) => {
      const checkinsForStudent = scoreCheckinsByStudent.get(student.id) ?? [];
      const checkinScoreByDate = new Map(checkinsForStudent.map((checkin) => [checkin.date, checkin.daily_score]));
      const dailyProgress = calculateDailyScoreProgress({
        weekDates: selectedWeekDates,
        dailyScoresByDate: checkinScoreByDate,
        today: progressTodayForCard(selectedWeekDates, checkinScoreByDate, today)
      });

      return {
        id: student.id,
        name: student.name,
        contact: student.phone || student.email,
        scoreLabel: dailyProgress.percentage === null ? "No score yet" : formatScore(dailyProgress.percentage)
      };
    });

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Admin Dashboard</h1>
          </div>
          <Link
            className="rounded-md bg-moss px-4 py-2.5 text-sm font-medium text-white hover:bg-ink"
            href={csvHref(filters)}
          >
            Export CSV
          </Link>
        </div>

        <form className="mt-6 grid grid-cols-1 gap-4 rounded-lg border border-stone-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
          <label className="block min-w-0">
            <span className="text-sm font-medium text-ink">Student</span>
            <select
              className="mt-1 w-full min-w-0 rounded-md border border-stone-300 px-3 py-2"
              defaultValue={filters.studentId ?? ""}
              name="student"
            >
              <option value="">All students</option>
              {(students ?? []).map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="text-sm font-medium text-ink">Week</span>
            <select
              className="mt-1 w-full min-w-0 rounded-md border border-stone-300 px-3 py-2"
              defaultValue={selectedWeekStart}
              name="week"
            >
              {availableWeekStarts.map((weekStart) => (
                <option key={weekStart} value={weekStart}>
                  {formatWeekRange(weekStart)}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="text-sm font-medium text-ink">Date</span>
            <input
              className="mt-1 w-full min-w-0 rounded-md border border-stone-300 px-3 py-2"
              defaultValue={filters.date ?? ""}
              name="date"
              type="date"
            />
          </label>
          <label className="block min-w-0">
            <span className="text-sm font-medium text-ink">Status</span>
            <select
              className="mt-1 w-full min-w-0 rounded-md border border-stone-300 px-3 py-2"
              defaultValue={filters.status ?? ""}
              name="status"
            >
              <option value="">All statuses</option>
              <option value="submitted">Submitted</option>
              <option value="missing">Missing</option>
              <option value="upcoming">Upcoming</option>
            </select>
          </label>
          <div className="flex min-w-0 flex-wrap items-end gap-2 self-end sm:col-span-2 lg:col-span-1">
            <button className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-white sm:w-auto">
              Apply
            </button>
            <Link
              className="w-full rounded-md border border-stone-300 px-4 py-2.5 text-center text-sm font-medium sm:w-auto"
              href={currentWeekHref(filters, currentWeekStart)}
            >
              Current Week
            </Link>
            <Link
              className="w-full rounded-md border border-stone-300 px-4 py-2.5 text-center text-sm font-medium sm:w-auto"
              href="/admin"
            >
              Clear
            </Link>
          </div>
        </form>

        <StudentCardGrid students={studentCards} />

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink">
            {filters.date ? `${friendlyDate(filters.date)} Completion` : `Week of ${formatWeekRange(selectedWeekStart)}`}
          </h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-stone-50 text-ink">
                <tr>
                  <th className="px-4 py-3 font-medium">Student</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Daily score</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                  <th className="px-4 py-3 font-medium">History</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {rows.map((row) => (
                  <tr key={`${row.studentId}-${row.date}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{row.studentName}</p>
                      <p className="text-xs text-stone-500">{row.studentPhone || row.studentEmail}</p>
                    </td>
                    <td className="px-4 py-3">{friendlyDate(row.date)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          row.status === "submitted"
                            ? "text-green-700"
                            : row.status === "upcoming"
                              ? "text-stone-500"
                              : "text-amber-700"
                        }
                      >
                        {row.status === "submitted" ? "Submitted" : row.status === "upcoming" ? "Upcoming" : "Missing"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-stone-700">{formatScore(row.checkin?.daily_score)}</td>
                    <td className="px-4 py-3 text-stone-600">
                      {formatDateTimeInAppTimeZone(row.checkin?.submitted_at)}
                    </td>
                    <td className="px-4 py-3 text-stone-600">{row.checkin?.note ?? ""}</td>
                    <td className="px-4 py-3">
                      <Link className="font-medium text-moss hover:text-ink" href={`/admin/students/${row.studentId}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
                {rows.length ? null : (
                  <tr>
                    <td className="px-4 py-6 text-stone-600" colSpan={7}>
                      No rows match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
