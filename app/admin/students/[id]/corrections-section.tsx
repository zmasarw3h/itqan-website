import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  correctionDatesForWeek,
  initialCorrectionDate
} from "@/lib/admin-student-workspace-sections";
import { formatWeekRange } from "@/lib/dates";
import type { AdminStudentWorkspaceShell } from "@/lib/admin-student-workspace";
import type { CheckIn, CheckInItem, PartnerRecitation } from "@/lib/types";
import CorrectionForm, { type CorrectionFormCheckIn } from "./correction-form";
import PartnerCorrectionForm from "./partner-correction-form";

function CorrectionStatus({ status, tool }: { status?: string; tool: "daily" | "partner" }) {
  const isDaily = tool === "daily";
  const success = isDaily ? status === "corrected" : status === "partner-corrected";
  const error = isDaily
    ? ["correction-error", "correction-future-date", "correction-outside-week"].includes(status ?? "")
    : ["partner-correction-invalid", "partner-correction-error"].includes(status ?? "");

  if (!success && !error) return null;

  const message = success
    ? isDaily ? "Daily correction saved." : "Partner recitation correction saved."
    : status === "correction-future-date"
      ? "Correction dates cannot be later than the operational date."
      : status === "correction-outside-week"
        ? "Choose a correction date inside the selected tracker week."
        : isDaily
          ? "The daily correction could not be saved. Your stored record is unchanged; review the fields and try again."
          : "The partner correction could not be saved. The stored rounds are unchanged; try again.";

  return (
    <p className={`mt-4 rounded-lg px-4 py-3 text-sm ${success ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`} role={success ? "status" : "alert"}>
      {message}
    </p>
  );
}

export default function CorrectionsSection({
  shell,
  effectiveDate,
  checkins,
  items,
  partnerRecitations,
  status
}: {
  shell: AdminStudentWorkspaceShell;
  effectiveDate: string;
  checkins: CheckIn[];
  items: CheckInItem[];
  partnerRecitations: PartnerRecitation[];
  status?: string;
}) {
  const itemsByCheckin = new Map<string, CheckInItem[]>();
  for (const item of items) itemsByCheckin.set(item.checkin_id, [...(itemsByCheckin.get(item.checkin_id) ?? []), item]);
  const existingCheckIns: CorrectionFormCheckIn[] = checkins.map((checkin) => ({
    date: checkin.date,
    status: checkin.completed ? "submitted" : "missing",
    note: checkin.note ?? "",
    completedTaskKeys: (itemsByCheckin.get(checkin.id) ?? []).filter((item) => item.completed).map((item) => item.task_key)
  }));
  const availableDates = correctionDatesForWeek(shell.selectedWeekStart, effectiveDate);
  const initialDate = initialCorrectionDate({
    weekStart: shell.selectedWeekStart,
    effectiveDate,
    savedDates: checkins.filter((checkin) => checkin.completed).map((checkin) => checkin.date)
  });

  return (
    <section className="py-8" aria-labelledby="corrections-title">
      <h2 className="text-2xl font-semibold text-ink" id="corrections-title">Corrections</h2>
      <p className="mt-1 text-sm text-stone-600">Correct student-entered records for {formatWeekRange(shell.selectedWeekStart)}.</p>
      <div className="mt-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <WarningCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" weight="fill" />
        <p>Corrections are for exceptions. Every save records an audited admin change; use the student’s reported information.</p>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
        <div className="min-w-0 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:p-6">
          <h3 className="text-lg font-semibold text-ink">Daily check-in correction</h3>
          <p className="mt-1 text-sm text-stone-600">Choose an eligible date to load its stored state and the checklist version effective on that date.</p>
          <CorrectionStatus status={status} tool="daily" />
          <CorrectionForm
            availableDates={availableDates}
            existingCheckIns={existingCheckIns}
            initialDate={initialDate}
            redirectWeek={shell.selectedWeekStart}
            redirectView="corrections"
            resultStatus={status}
            studentId={shell.student.id}
          />
        </div>

        <div className="min-w-0 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:p-6">
          <h3 className="text-lg font-semibold text-ink">Partner recitation correction</h3>
          <p className="mt-1 text-sm text-stone-600">Students normally record both rounds themselves. Admins should correct completion only when needed.</p>
          <CorrectionStatus status={status} tool="partner" />
          <PartnerCorrectionForm
            recitations={partnerRecitations}
            redirectView="corrections"
            resultStatus={status}
            studentId={shell.student.id}
            weekStart={shell.selectedWeekStart}
          />
        </div>
      </div>
    </section>
  );
}
