import { notFound, redirect } from "next/navigation";
import AppNav from "@/app/nav";
import {
  AdminStudentWorkspaceError,
  adminStudentWorkspaceHref,
  isAdminStudentWorkspaceView,
  loadAdminStudentOverview,
  loadAdminStudentWorkspaceShell,
  normalizeAdminStudentWorkspaceView
} from "@/lib/admin-student-workspace";
import { checkInEffectiveDateString, isValidDateString, weekStartForDate } from "@/lib/dates";
import { requireProfile } from "@/lib/supabase-server";
import OverviewSection from "./overview-section";
import PreservedSection from "./preserved-sections";
import WorkspaceShell from "./workspace-shell";

export const dynamic = "force-dynamic";

type AdminStudentSearchParams = {
  status?: string;
  week?: string;
  view?: string;
};

function canonicalWeek(value: string | undefined, fallback: string) {
  if (!value || !isValidDateString(value)) return fallback;
  return weekStartForDate(value) === value ? value : fallback;
}

function WorkspaceStatusNotice({ status }: { status?: string }) {
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
  const selectedWeekStart = canonicalWeek(query.week, currentWeek);
  const view = normalizeAdminStudentWorkspaceView(query.view);

  if (query.week !== selectedWeekStart || (query.view !== undefined && !isAdminStudentWorkspaceView(query.view))) {
    redirect(adminStudentWorkspaceHref({ studentId, weekStart: selectedWeekStart, view }));
  }

  const { supabase, profile } = await requireProfile(["admin"]);
  let shell: Awaited<ReturnType<typeof loadAdminStudentWorkspaceShell>>;

  try {
    shell = await loadAdminStudentWorkspaceShell(supabase, { studentId, selectedWeekStart });
  } catch (error) {
    if (error instanceof AdminStudentWorkspaceError && ["scope-denied", "not-found", "invalid-context"].includes(error.code)) {
      notFound();
    }
    throw error;
  }

  const overview = view === "overview" ? await loadAdminStudentOverview(supabase, shell) : null;

  return (
    <>
      <AppNav activeHref="/admin" name={profile.name} role={profile.role} variant="workspace" />
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8 md:py-8">
        <WorkspaceShell shell={shell} view={view} />
        <WorkspaceStatusNotice status={query.status} />
        {view === "overview" && overview
          ? <OverviewSection overview={overview} shell={shell} />
          : <PreservedSection shell={shell} supabase={supabase} view={view as Exclude<typeof view, "overview">} />}
      </main>
    </>
  );
}
