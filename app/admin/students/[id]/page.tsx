import { notFound, redirect } from "next/navigation";
import AppNav from "@/app/nav";
import {
  AdminStudentWorkspaceError,
  adminStudentWorkspaceHref,
  loadAdminStudentOverview,
  loadAdminStudentWorkspaceSectionData,
  loadAdminStudentWorkspaceShell
} from "@/lib/admin-student-workspace";
import { canonicalAdminStudentWorkspaceState } from "@/lib/admin-student-workspace-state";
import { checkInEffectiveDateString, weekStartForDate } from "@/lib/dates";
import { requireProfile } from "@/lib/supabase-server";
import {
  createServerLoaderTiming,
  measureServerLoaderPhase,
  withServerLoaderTiming
} from "@/lib/server-loader-timing";
import OverviewSection from "./overview-section";
import PreservedSection from "./preserved-sections";
import WorkspaceShell from "./workspace-shell";

export const dynamic = "force-dynamic";

type AdminStudentSearchParams = {
  correction_date?: string;
  status?: string;
  week?: string;
  view?: string;
};

function WorkspaceStatusNotice({ status, view }: { status?: string; view: string }) {
  if (view === "corrections" && ["corrected", "partner-corrected", "correction-error", "correction-future-date", "correction-outside-week", "partner-correction-invalid", "partner-correction-error"].includes(status ?? "")) return null;
  if (view === "halaqa-plan" && ["grade-saved", "grade-invalid", "grade-error"].includes(status ?? "")) return null;
  const successMessages: Record<string, string> = {
    corrected: "Correction saved.",
    "partner-corrected": "Partner recitation correction saved.",
    "grade-saved": "Halaqa grade saved.",
    "score-start-changed": "Official scoring start updated. Pending pre-boundary obligations were waived with an audit note, not marked paid."
  };
  const errorMessages: Record<string, string> = {
    "correction-error": "Unable to save correction.",
    "correction-future-date": "Correction dates cannot be later than today.",
    "partner-correction-invalid": "Unable to save partner recitation correction.",
    "partner-correction-error": "Unable to save partner recitation correction.",
    "grade-invalid": "Unable to save halaqa grade. If attended is yes, recitation points must be 10–50.",
    "grade-error": "Unable to save halaqa grade. If attended is yes, recitation points must be 10–50.",
    "delete-name-mismatch": "Student deletion was not confirmed. Type the student name exactly before deleting.",
    "student-delete-error": "Unable to delete this student."
  };
  const message = status ? successMessages[status] ?? errorMessages[status] : null;
  if (!message) return null;
  const success = Boolean(status && successMessages[status]);
  return (
    <p
      className={`mt-5 rounded-md px-4 py-3 text-sm ${success ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
      role={success ? "status" : "alert"}
    >
      {message}
    </p>
  );
}

export default async function AdminStudentPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<AdminStudentSearchParams>;
}) {
  const [{ id: studentId }, query] = await Promise.all([params, searchParams]);
  const currentWeek = weekStartForDate(checkInEffectiveDateString());
  const canonicalState = canonicalAdminStudentWorkspaceState({
    week: query.week,
    view: query.view,
    currentWeekStart: currentWeek
  });
  const selectedWeekStart = canonicalState.weekStart;
  const view = canonicalState.view;

  if (canonicalState.shouldRedirect) {
    redirect(adminStudentWorkspaceHref({
      studentId,
      weekStart: selectedWeekStart,
      view,
      status: query.status
    }));
  }

  const timing = createServerLoaderTiming();

  return withServerLoaderTiming("admin_student_workspace", timing, async () => {
    const { supabase, profile } = await measureServerLoaderPhase(
      timing,
      "auth",
      () => requireProfile(["admin"])
    );
    let shell: Awaited<ReturnType<typeof loadAdminStudentWorkspaceShell>>;

    try {
      shell = await measureServerLoaderPhase(timing, "shell", () =>
        loadAdminStudentWorkspaceShell(supabase, { studentId, selectedWeekStart }, timing)
      );
    } catch (error) {
      if (error instanceof AdminStudentWorkspaceError && ["scope-denied", "not-found", "invalid-context"].includes(error.code)) {
        notFound();
      }
      throw error;
    }

    const overview = view === "overview"
      ? await measureServerLoaderPhase(timing, "view_data", () =>
        loadAdminStudentOverview(supabase, shell)
      )
      : null;
    const sectionData = view === "overview"
      ? null
      : await loadAdminStudentWorkspaceSectionData(supabase, shell, view, timing);

    return (
      <>
        <AppNav activeHref="/admin" name={profile.name} role={profile.role} variant="workspace" />
        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8 md:py-8">
          <WorkspaceShell shell={shell} view={view} />
          <WorkspaceStatusNotice status={query.status} view={view} />
          {view === "overview" && overview
            ? <OverviewSection overview={overview} shell={shell} />
            : sectionData
              ? <PreservedSection correctionDate={query.correction_date} shell={shell} status={query.status} sectionData={sectionData} />
              : null}
        </main>
      </>
    );
  });
}
