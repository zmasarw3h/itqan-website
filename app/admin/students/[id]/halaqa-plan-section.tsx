"use client";

import { useState } from "react";
import { CalendarBlank, Medal } from "@phosphor-icons/react";
import { adminStudentHalaqaPlanContextKey } from "@/lib/admin-student-halaqa-plan";
import { formatWeekRange } from "@/lib/dates";
import type { HalaqaGrade, WeeklyPlan } from "@/lib/types";
import HalaqaGradeForm from "./halaqa-grade-form";
import WeeklyPlanPanel from "./weekly-plan-panel";

type HalaqaPlanSectionProps = {
  studentId: string;
  weekStart: string;
  grade: HalaqaGrade | null;
  plan: WeeklyPlan | null;
  planPreviewUrl: string | null;
  planDownloadUrl: string | null;
  status?: string;
};

function HalaqaPlanTaskSurface({
  studentId,
  weekStart,
  grade,
  plan,
  planPreviewUrl,
  planDownloadUrl,
  status
}: HalaqaPlanSectionProps) {
  const [gradeTotal, setGradeTotal] = useState(
    grade ? Number(grade.attendance_points) + Number(grade.recitation_points) : 0
  );
  const gradeRevision = grade
    ? `${grade.id}:${grade.updated_at ?? grade.graded_at}`
    : "not-graded";

  return (
    <section className="py-8" aria-labelledby="halaqa-plan-title">
      <h2 className="sr-only" id="halaqa-plan-title">Halaqa &amp; plan</h2>

      <div className="grid grid-cols-2 rounded-xl border border-stone-200 bg-white px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center justify-center gap-3 border-r border-stone-200 pr-4 sm:gap-5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-moss sm:size-14">
            <Medal aria-hidden="true" className="size-7 sm:size-8" />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-stone-600">Halaqa grade</p>
            <p className="mt-0.5 text-xl font-semibold text-ink sm:text-2xl">{gradeTotal} / 150</p>
          </div>
        </div>
        <div className="flex min-w-0 items-center justify-center gap-3 pl-4 sm:gap-5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-moss sm:size-14">
            <CalendarBlank aria-hidden="true" className="size-7 sm:size-8" />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-stone-600">Weekly plan</p>
            <p className="mt-0.5 break-words text-base font-semibold text-ink sm:text-xl">{plan ? "Uploaded" : "Not uploaded"}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.9fr)]">
        <section className="min-w-0 rounded-xl border border-stone-200 bg-white p-5 sm:p-6" aria-labelledby="halaqa-grade-title">
          <h3 className="text-xl font-semibold text-ink" id="halaqa-grade-title">Halaqa grade</h3>
          <p className="mt-1 text-sm text-stone-600">Saturday grade for {formatWeekRange(weekStart)}</p>
          <HalaqaGradeForm
            grade={grade}
            key={`${studentId}:${weekStart}:${gradeRevision}:${status ?? ""}`}
            onSummaryChange={setGradeTotal}
            redirectView="halaqa-plan"
            resultStatus={status}
            studentId={studentId}
            weekStart={weekStart}
          />
        </section>

        <section className="min-w-0 rounded-xl border border-stone-200 bg-white p-5 sm:p-6" aria-labelledby="weekly-plan-title">
          <h3 className="text-xl font-semibold text-ink" id="weekly-plan-title">Weekly plan</h3>
          <p className="mt-1 text-sm text-stone-600">{formatWeekRange(weekStart)}</p>
          <WeeklyPlanPanel
            downloadUrl={planDownloadUrl}
            plan={plan}
            previewUrl={planPreviewUrl}
          />
        </section>
      </div>
    </section>
  );
}

export default function HalaqaPlanSection(props: HalaqaPlanSectionProps) {
  return (
    <HalaqaPlanTaskSurface
      {...props}
      key={adminStudentHalaqaPlanContextKey(props.studentId, props.weekStart)}
    />
  );
}
