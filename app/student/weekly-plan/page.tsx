import AppNav from "@/app/nav";
import { StudentSetupIncomplete, StudentWeekContextPanel } from "@/app/student/student-week-context";
import WeeklyPlanUploadForm from "@/app/student/weekly-plan/weekly-plan-upload-form";
import { formatDateTimeInAppTimeZone, formatWeekRange, todayDateString, weekStartForDate } from "@/lib/dates";
import { loadStudentWeekContext } from "@/lib/student-scope";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { requireProfile } from "@/lib/supabase-server";
import type { WeeklyPlan } from "@/lib/types";
import {
  WEEKLY_PLAN_BUCKET,
  WEEKLY_PLAN_MAX_SIZE_LABEL,
  weeklyPlanPathBelongsToStudent
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
  const weekStart = weekStartForDate(todayDateString());
  const studentContext = await loadStudentWeekContext(supabase, profile.id, weekStart);

  if (!studentContext.scope) {
    return <StudentSetupIncomplete name={profile.name} role={profile.role} weekStart={weekStart} />;
  }

  const { data: weeklyPlan } = await supabase
    .from("weekly_plans")
    .select("id,student_id,week_start,file_path,file_name,file_type,file_size,uploaded_at")
    .eq("student_id", profile.id)
    .eq("week_start", weekStart)
    .maybeSingle<WeeklyPlan>();

  const storageSupabase = createSupabaseAdminClient();

  const signedUrl = weeklyPlan && weeklyPlanPathBelongsToStudent(profile.id, weekStart, weeklyPlan.file_path)
    ? (
        await storageSupabase.storage
          .from(WEEKLY_PLAN_BUCKET)
          .createSignedUrl(weeklyPlan.file_path, 60 * 60, { download: weeklyPlan.file_name })
      ).data?.signedUrl
    : null;
  const status = resolvedSearchParams.status ? statusMessages[resolvedSearchParams.status] : null;

  return (
    <>
      <AppNav role={profile.role} name={profile.name} />
      <main className="mx-auto max-w-3xl px-4 py-8">
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
                {signedUrl ? (
                  <a className="inline-flex font-medium text-moss hover:text-ink" href={signedUrl}>
                    View/download
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="text-stone-600">No weekly plan uploaded yet.</p>
            )}
          </div>

          <WeeklyPlanUploadForm />
        </section>
      </main>
    </>
  );
}
