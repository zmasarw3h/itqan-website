import Link from "next/link";
import type { AdminStudentWorkspaceShell, AdminStudentWorkspaceView } from "@/lib/admin-student-workspace";
import { adminStudentWorkspaceHref } from "@/lib/admin-student-workspace-state";
import { WorkspaceSelectors } from "./workspace-navigation";
import { WORKSPACE_SECTIONS } from "./workspace-sections";

export default function WorkspaceShell({
  shell,
  view
}: {
  shell: AdminStudentWorkspaceShell;
  view: AdminStudentWorkspaceView;
}) {
  const identity = shell.student.phone || shell.student.email || "No contact information";

  return (
    <header className="border-b border-stone-200 pb-0">
      <div className="grid gap-8 pb-8 md:min-h-[190px] md:grid-cols-[1fr_auto] md:items-center md:gap-10 md:pb-10">
        <div className="min-w-0">
          <Link
            className="inline-flex min-h-11 items-center gap-2 py-2 text-sm font-semibold uppercase tracking-wide text-moss hover:text-ink"
            href="/admin"
            prefetch={false}
          >
            <span aria-hidden="true" className="text-xl leading-none">←</span>
            Back to students
          </Link>
          <h1 className="mt-1 break-words text-3xl font-semibold tracking-tight text-ink md:text-4xl">
            {shell.student.name}
          </h1>
          <p className="mt-1 break-words text-base text-ink">{identity}</p>
          <p className="mt-1 break-words text-base text-stone-600 [overflow-wrap:anywhere]" data-qa="student-scope-context">
            {shell.scope.cohortName} cohort · {shell.scope.groupName}
          </p>
        </div>
        <WorkspaceSelectors
          availableWeekStarts={shell.availableWeekStarts}
          selectedWeekStart={shell.selectedWeekStart}
          studentId={shell.student.id}
          view={view}
        />
      </div>

      <nav aria-label="Student workspace" className="hidden md:block">
        <ul className="flex items-stretch gap-5 lg:gap-10">
          {WORKSPACE_SECTIONS.map((section) => {
            const active = section.value === view;
            return (
              <li key={section.value}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-12 items-center border-b-2 px-4 text-base font-medium transition-colors motion-reduce:transition-none ${
                    active
                      ? "border-gold text-moss"
                      : "border-transparent text-ink hover:border-stone-300 hover:text-moss"
                  }`}
                  href={adminStudentWorkspaceHref({
                    studentId: shell.student.id,
                    weekStart: shell.selectedWeekStart,
                    view: section.value
                  })}
                  prefetch={false}
                >
                  {section.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
