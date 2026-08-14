import { StudentPage } from "@/app/student/student-ui";
import { StudentSetupIncomplete, StudentWeekContextPanel } from "@/app/student/student-week-context";
import WeeklyPlanUploadForm from "@/app/student/weekly-plan/weekly-plan-upload-form";
import { formatDateTimeInAppTimeZone, formatWeekRange } from "@/lib/dates";
import { loadStudentWeekContext } from "@/lib/student-scope";
import { requireProfile } from "@/lib/supabase-server";
import type { WeeklyPlan } from "@/lib/types";
import {
  WEEKLY_PLAN_MAX_SIZE_LABEL,
  currentWeeklyPlanContext,
  weeklyPlanPathMatchesExactContext
} from "@/lib/weekly-plans";

export const dynamic = "force-dynamic";

const statusMessages: Record<string, { text: string; className: string }> = {
  uploaded: {
    text: "Weekly plan uploaded.",
    className: "bg-green-50 text-green-800"
  },
  invalid: {
    text: "Upload a PNG, JPG, or PDF file.",
    className: "bg-red-50 text-red-700"
  },
  "too-large": {
    text: `Weekly plan files must be ${WEEKLY_PLAN_MAX_SIZE_LABEL} or smaller.`,
    className: "bg-red-50 text-red-700"
  },
  "upload-error": {
    text: "Unable to upload the file. Please try again.",
    className: "bg-red-50 text-red-700"
  },
  "save-error": {
    text: "Unable to save the weekly plan. Please try again.",
    className: "bg-red-50 text-red-700"
  },
  "setup-incomplete": {
    text: "Your halaqa assignment is not ready yet.",
    className: "bg-amber-50 text-amber-800"
  }
};

export default async function StudentWeeklyPlanPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["student"]);
  const { weekStart } = currentWeeklyPlanContext();
  const studentContext = await loadStudentWeekContext(supabase, profile.id, weekStart);

  if (!studentContext.scope) {
    return <StudentSetupIncomplete weekStart={weekStart} />;
  }

  const { data: weeklyPlan } = await supabase
    .from("weekly_plans")
    .select("id,student_id,week_start,file_path,file_name,file_type,file_size,uploaded_at")
    .eq("student_id", profile.id)
    .eq("week_start", weekStart)
    .maybeSingle<WeeklyPlan>();

  const hasValidPlanPath = Boolean(
    weeklyPlan
    && weeklyPlanPathMatchesExactContext(profile.id, weekStart, weeklyPlan.file_path, weeklyPlan.file_name)
  );
  const status = resolvedSearchParams.status ? statusMessages[resolvedSearchParams.status] : null;

  return (
    <StudentPage width="narrow">
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Weekly Plan</h1>
            <p className="mt-1 text-stone-600">{formatWeekRange(weekStart)}</p>
          </div>
          <StudentWeekContextPanel scope={studentContext.scope} teacher={studentContext.teacher} />

          {status ? (
            <p className={`mt-5 rounded-md px-3 py-2 text-sm ${status.className}`}>{status.text}</p>
          ) : null}

          <div className="mt-6 rounded-md bg-stone-50 p-4">
            {weeklyPlan ? (
              <div className="space-y-2">
                <p className="break-words font-medium text-ink">{weeklyPlan.file_name}</p>
                <p className="text-sm text-stone-600">
                  Uploaded {formatDateTimeInAppTimeZone(weeklyPlan.uploaded_at)}
                </p>
                {hasValidPlanPath ? (
                  <div className="flex flex-wrap gap-4">
                    <a
                      className="inline-flex font-medium text-moss hover:text-ink"
                      href={`/student/weekly-plan/preview?week=${encodeURIComponent(weekStart)}`}
                    >
                      Preview
                    </a>
                    <a
                      className="inline-flex font-medium text-moss hover:text-ink"
                      href={`/student/weekly-plan/download?week=${encodeURIComponent(weekStart)}`}
                    >
                      Download
                    </a>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-stone-600">No weekly plan uploaded yet.</p>
            )}
          </div>

          <WeeklyPlanUploadForm />
        </section>
    </StudentPage>
  );
}
