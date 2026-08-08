export const rotationWizardSteps = ["students", "teachers", "groups", "review"] as const;

export type RotationWizardStep = (typeof rotationWizardSteps)[number];

export const rotationWizardStepLabels: Record<RotationWizardStep, string> = {
  students: "Students",
  teachers: "Teachers",
  groups: "Groups",
  review: "Review"
};

export function parseRotationWizardStep(value: string | undefined): RotationWizardStep {
  return rotationWizardSteps.includes(value as RotationWizardStep)
    ? value as RotationWizardStep
    : "students";
}

export type RotationWizardPrerequisites = {
  studentsSaved: boolean;
  availableTeacherCount: number;
  groupsGenerated: boolean;
  groupsValid: boolean;
};

export function rotationWizardUnlockedSteps(input: RotationWizardPrerequisites) {
  return {
    students: true,
    teachers: input.studentsSaved,
    groups: input.studentsSaved && input.availableTeacherCount > 0,
    review: input.studentsSaved && input.availableTeacherCount > 0 && input.groupsGenerated && input.groupsValid
  } satisfies Record<RotationWizardStep, boolean>;
}

export function clampRotationWizardStep(
  requested: RotationWizardStep,
  unlocked: Record<RotationWizardStep, boolean>
): RotationWizardStep {
  if (unlocked[requested]) return requested;
  const requestedIndex = rotationWizardSteps.indexOf(requested);
  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const candidate = rotationWizardSteps[index]!;
    if (unlocked[candidate]) return candidate;
  }
  return "students";
}
