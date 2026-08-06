export type StudentRotationAvailabilityInput = {
  student_id: string;
  reason: string | null;
};

export type StudentRotationAvailabilityDraft = {
  studentId: string;
  available: boolean;
  reason: string;
};

const MAX_REASON_LENGTH = 240;

export function normalizedAvailabilityReason(reason: string | null | undefined) {
  const normalized = reason?.trim() ?? "";

  if (normalized.length > MAX_REASON_LENGTH) {
    throw new Error(`Availability reasons must be ${MAX_REASON_LENGTH} characters or fewer.`);
  }

  return normalized || null;
}

export function absencePayloadFromDrafts(drafts: StudentRotationAvailabilityDraft[]) {
  return drafts
    .filter((draft) => !draft.available)
    .map((draft) => ({
      student_id: draft.studentId,
      reason: normalizedAvailabilityReason(draft.reason)
    }));
}

export function parseStudentRotationAbsences(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    throw new Error("Availability changes are missing.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Availability changes are invalid.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Availability changes are invalid.");
  }

  const seenStudentIds = new Set<string>();

  return parsed.map((item): StudentRotationAvailabilityInput => {
    if (!item || typeof item !== "object") {
      throw new Error("Availability changes are invalid.");
    }

    const studentId = "student_id" in item ? item.student_id : null;
    const reason = "reason" in item ? item.reason : null;

    if (typeof studentId !== "string" || !studentId || seenStudentIds.has(studentId)) {
      throw new Error("Availability changes are invalid.");
    }

    if (reason !== null && typeof reason !== "string") {
      throw new Error("Availability changes are invalid.");
    }

    seenStudentIds.add(studentId);

    return {
      student_id: studentId,
      reason: normalizedAvailabilityReason(reason)
    };
  });
}

export function absenceCount(drafts: StudentRotationAvailabilityDraft[]) {
  return drafts.filter((draft) => !draft.available).length;
}
