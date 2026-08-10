import { BELOW70_RESET_NOTE_MAX_LENGTH, normalizeBelow70ResetNote } from "@/lib/below70-streak";

export type Below70ResetActionStatus = "unauthorized" | "ineligible" | "invalid" | "error";

export function below70StreakAdminStatus(streakLength: number) {
  if (streakLength === 0) {
    return {
      canReset: false,
      description: "No active below-70% streak is recorded through the latest completed week."
    };
  }

  if (streakLength >= 3) {
    return {
      canReset: true,
      description: "This 3+-week streak is the intervention and test trigger. After passed-test confirmation, it can be reset."
    };
  }

  return {
    canReset: true,
    description: "This positive below-70% streak can be reset after passed-test confirmation."
  };
}

export function validateBelow70ResetForm(input: { passedTest: boolean; note: string }) {
  if (!input.passedTest) {
    return { valid: false as const, message: "Confirm that the student passed the test before resetting the streak." };
  }

  try {
    return { valid: true as const, note: normalizeBelow70ResetNote(input.note) };
  } catch {
    return {
      valid: false as const,
      message: `Admin notes may be up to ${BELOW70_RESET_NOTE_MAX_LENGTH} characters and cannot contain control characters.`
    };
  }
}

export function below70ResetErrorMessage(status: Below70ResetActionStatus) {
  switch (status) {
    case "unauthorized":
      return "You are no longer authorized to reset this student's streak.";
    case "ineligible":
      return "This student no longer has a positive below-70% streak to reset. The status has been refreshed.";
    case "invalid":
      return "Review the confirmation and note, then try again.";
    default:
      return "The reset could not be completed. Your request ID has been kept so you can safely retry.";
  }
}

export function below70ResetSuccessMessage(status: "reset" | "replayed") {
  return status === "replayed"
    ? "This streak reset was already recorded. The current status has been refreshed."
    : "Below-70% streak reset. Historical grades remain unchanged.";
}

export function createBelow70ResetAttempt(createRequestId: () => string) {
  let requestId: string | null = null;

  return {
    requestIdForSubmission() {
      requestId ??= createRequestId();
      return requestId;
    },
    complete() {
      requestId = null;
    },
    resetForNewAction() {
      requestId = null;
    }
  };
}
