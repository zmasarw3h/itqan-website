import AppNav from "@/app/nav";
import AdminDashboard from "@/app/admin/admin-dashboard";
import { loadAdminDashboardStudentPreview } from "@/lib/admin-dashboard-preview";
import { requireProfile } from "@/lib/supabase-server";
import {
  createServerLoaderTiming,
  measureServerLoaderPhase,
  recordServerLoaderTiming
} from "@/lib/server-loader-timing";
import { loadLeaderboardData, type LeaderboardSearchParams } from "./leaderboard/data";

export const dynamic = "force-dynamic";

function leaderboardExportHref(weekStart: string) {
  const params = new URLSearchParams({ week: weekStart });
  return `/admin/export?${params.toString()}`;
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<LeaderboardSearchParams & { status?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const timing = createServerLoaderTiming();

  try {
    const { supabase, profile } = await measureServerLoaderPhase(
      timing,
      "auth",
      () => requireProfile(["admin", "super_admin"])
    );
    const data = await loadLeaderboardData(supabase, resolvedSearchParams, timing);
    const initialPreviewRow = data.rows.find((row) => row.canOpenCurrentProfile);
    const initialPreview = initialPreviewRow
      ? await loadAdminDashboardStudentPreview(supabase, {
          studentId: initialPreviewRow.studentId,
          selectedWeekStart: data.selectedWeekStart
        })
      : null;

    return (
      <>
        <AppNav activeHref="/admin" role={profile.role} name={profile.name} />
        <main className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 lg:px-10">
          {resolvedSearchParams.status === "student-deleted" ? (
            <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Student deleted.</p>
          ) : null}
          {resolvedSearchParams.status === "student-deleted-storage-cleanup-warning" ? (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Student identity and database records were deleted, but one or more weekly-plan files could not be cleaned
              up. Ask an operator to remove the orphaned private Storage objects.
            </p>
          ) : null}
          {resolvedSearchParams.status === "invalid-delete" || resolvedSearchParams.status === "student-delete-missing" ? (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Unable to delete student.
            </p>
          ) : null}
          {resolvedSearchParams.status === "student-scope-denied" ? (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              You do not have access to that student for the selected week.
            </p>
          ) : null}
          <AdminDashboard
            availableWeekStarts={data.availableWeekStarts}
            exportHref={leaderboardExportHref(data.selectedWeekStart)}
            initialFilter={resolvedSearchParams.below70 === "1" ? "below70" : "all"}
            initialPreview={initialPreview}
            rows={data.rows}
            selectedWeekLabel={data.selectedWeekLabel}
            selectedWeekStart={data.selectedWeekStart}
          />
        </main>
      </>
    );
  } finally {
    recordServerLoaderTiming("admin_dashboard", timing);
  }
}
