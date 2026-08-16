import { DownloadSimple, FileArrowUp, LockKey, User, UsersThree, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { StudentNotice, StudentPage } from "@/app/student/student-ui";
import { StudentSetupIncomplete } from "@/app/student/student-week-context";
import WeeklyPlanUploadForm from "@/app/student/weekly-plan/weekly-plan-upload-form";
import WeeklyPlanViewer from "@/app/student/weekly-plan/weekly-plan-viewer";
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

const statusMessages = {
  uploaded: { text: "Weekly plan uploaded.", tone: "success" as const },
  invalid: { text: "Upload a PNG, JPG, or PDF file.", tone: "error" as const },
  "too-large": { text: `Weekly plan files must be ${WEEKLY_PLAN_MAX_SIZE_LABEL} or smaller.`, tone: "error" as const },
  "upload-error": { text: "Unable to upload the file. Please try again.", tone: "error" as const },
  "save-error": { text: "Unable to save the weekly plan. Please try again.", tone: "error" as const },
  "setup-incomplete": { text: "Your halaqa assignment is not ready yet.", tone: "warning" as const }
};

function fileTypeLabel(fileType: string) {
  if (fileType === "application/pdf") return "PDF";
  if (fileType === "image/png") return "PNG";
  return "JPG";
}

export default async function StudentWeeklyPlanPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const { supabase, profile } = await requireProfile(["student"]);
  const { weekStart } = currentWeeklyPlanContext();
  const weekLabel = formatWeekRange(weekStart);
  const studentContext = await loadStudentWeekContext(supabase, profile.id, weekStart);

  if (!studentContext.scope) {
    return <StudentSetupIncomplete name={profile.name} role={profile.role} weekStart={weekStart} teacher={studentContext.teacher} />;
  }

  const { data: weeklyPlan, error: weeklyPlanError } = await supabase
    .from("weekly_plans")
    .select("id,student_id,week_start,file_path,file_name,file_type,file_size,uploaded_at")
    .eq("student_id", profile.id)
    .eq("week_start", weekStart)
    .maybeSingle<WeeklyPlan>();
  const hasValidPlanPath = Boolean(
    weeklyPlan && weeklyPlanPathMatchesExactContext(profile.id, weekStart, weeklyPlan.file_path, weeklyPlan.file_name)
  );
  const status = resolvedSearchParams.status && resolvedSearchParams.status in statusMessages
    ? statusMessages[resolvedSearchParams.status as keyof typeof statusMessages]
    : null;
  const previewUrl = `/student/weekly-plan/preview?week=${encodeURIComponent(weekStart)}`;
  const downloadUrl = `/student/weekly-plan/download?week=${encodeURIComponent(weekStart)}`;

  return (
    <StudentPage width="standard">
      <section className="weekly-plan-page">
        <header className="weekly-plan-header">
          <h1>Weekly Plan</h1>
          <p>{weekLabel}</p>
          <div className="student-context-inline">
            <span><UsersThree aria-hidden="true" size={20} />{studentContext.scope.cohortName} · {studentContext.scope.groupName}</span>
            <span><User aria-hidden="true" size={20} />This week&apos;s teacher: {studentContext.teacher?.teacher_name ?? "Not assigned yet"}</span>
          </div>
        </header>

        {status ? (
          <StudentNotice className="weekly-plan-notice" tone={status.tone}>
            {status.text}{weeklyPlan && (resolvedSearchParams.status === "upload-error" || resolvedSearchParams.status === "save-error") ? " Your current plan has not changed." : ""}
          </StudentNotice>
        ) : null}
        {weeklyPlanError ? (
          <StudentNotice className="weekly-plan-notice" tone="error">
            We couldn&apos;t load your current weekly plan. Refresh this page to try again.
          </StudentNotice>
        ) : null}

        {weeklyPlan ? (
          <>
            <p className="weekly-plan-intro">Keep one current plan for this halaqa week.</p>
            <section className="weekly-plan-current" aria-labelledby="weekly-plan-current-title">
              <div className="weekly-plan-thumbnail" aria-hidden="true">
                {hasValidPlanPath ? <object data={`${previewUrl}#toolbar=0&navpanes=0`} title="Weekly plan thumbnail" type={weeklyPlan.file_type}><span>Plan preview</span></object> : <WarningCircle size={44} />}
              </div>
              <div className="weekly-plan-file-details">
                <h2 id="weekly-plan-current-title">{weeklyPlan.file_name}</h2>
                <p>{fileTypeLabel(weeklyPlan.file_type)}</p>
                <p>Uploaded {formatDateTimeInAppTimeZone(weeklyPlan.uploaded_at)}</p>
                {hasValidPlanPath ? (
                  <div className="weekly-plan-file-actions">
                    <WeeklyPlanViewer downloadUrl={downloadUrl} fileName={weeklyPlan.file_name} fileType={weeklyPlan.file_type} previewUrl={previewUrl} weekLabel={weekLabel} />
                    <a href={downloadUrl}><DownloadSimple aria-hidden="true" size={22} />Download</a>
                  </div>
                ) : <p className="weekly-plan-file-unavailable">This plan is temporarily unavailable.</p>}
              </div>
            </section>

            <section className="weekly-plan-replace" aria-labelledby="weekly-plan-replace-title">
              <h2 id="weekly-plan-replace-title">Replace this week&apos;s plan</h2>
              <p>Uploading a new file replaces the current plan for {weekLabel}.</p>
              <WeeklyPlanUploadForm replacement />
              <p className="weekly-plan-preserved"><WarningCircle aria-hidden="true" size={20} />Your current plan stays available until the replacement finishes uploading.</p>
            </section>
          </>
        ) : (
          <>
            <p className="weekly-plan-intro">Upload one plan for this halaqa week.</p>
            <section className="weekly-plan-missing" aria-labelledby="weekly-plan-missing-title">
              <FileArrowUp aria-hidden="true" size={64} />
              <h2 id="weekly-plan-missing-title">No weekly plan uploaded yet</h2>
              <p>Upload your plan before the week&apos;s check-ins become available.</p>
              <WeeklyPlanUploadForm />
            </section>
            <p className="weekly-plan-privacy"><LockKey aria-hidden="true" size={22} />Your plan is private to you, your assigned teachers, and authorized admins.</p>
          </>
        )}
      </section>
    </StudentPage>
  );
}
