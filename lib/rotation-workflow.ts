export const rotationWorkflowSteps = [
  { id: "student-availability", label: "Student availability" },
  { id: "session-group-setup", label: "Session group setup" },
  { id: "teacher-responsibilities", label: "Teacher responsibilities" },
  { id: "assignment-review", label: "Review & publish" }
] as const;

type RotationSectionElement = Pick<HTMLElement, "focus" | "scrollIntoView">;

export function focusRotationSection(
  documentRef: Pick<Document, "getElementById">,
  sectionId: (typeof rotationWorkflowSteps)[number]["id"]
) {
  const section = documentRef.getElementById(sectionId) as RotationSectionElement | null;

  section?.scrollIntoView({ behavior: "smooth", block: "start" });
  section?.focus({ preventScroll: true });
}
