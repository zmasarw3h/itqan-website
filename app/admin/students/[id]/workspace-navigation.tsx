"use client";

import { useRouter } from "next/navigation";
import type { AdminStudentWorkspaceView } from "@/lib/admin-student-workspace";
import { adminStudentWorkspaceHref } from "@/lib/admin-student-workspace-state";
import { formatWeekRange } from "@/lib/dates";
import { WORKSPACE_SECTIONS } from "./workspace-sections";

export function WorkspaceSelectors({
  studentId,
  availableWeekStarts,
  selectedWeekStart,
  view
}: {
  studentId: string;
  availableWeekStarts: string[];
  selectedWeekStart: string;
  view: AdminStudentWorkspaceView;
}) {
  const router = useRouter();

  return (
    <div className="grid gap-6 md:block md:w-[19rem]">
      <label className="block">
        <span className="text-sm font-medium text-ink">Week</span>
        <select
          aria-label="Tracker week"
          className="mt-2 min-h-12 w-full rounded-md border border-stone-300 bg-white px-4 py-3 text-base text-ink"
          onChange={(event) => router.push(adminStudentWorkspaceHref({
            studentId,
            weekStart: event.target.value,
            view
          }))}
          value={selectedWeekStart}
        >
          {availableWeekStarts.map((weekStart) => (
            <option key={weekStart} value={weekStart}>
              {formatWeekRange(weekStart)}
            </option>
          ))}
        </select>
      </label>

      <label className="block md:hidden">
        <span className="text-sm font-medium text-ink">Section</span>
        <select
          aria-label="Workspace section"
          className="mt-2 min-h-12 w-full rounded-md border border-stone-300 bg-white px-4 py-3 text-base text-ink"
          onChange={(event) => router.push(adminStudentWorkspaceHref({
            studentId,
            weekStart: selectedWeekStart,
            view: event.target.value as AdminStudentWorkspaceView
          }))}
          value={view}
        >
          {WORKSPACE_SECTIONS.map((section) => (
            <option key={section.value} value={section.value}>{section.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
