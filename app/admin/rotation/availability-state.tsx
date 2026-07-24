"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from "react";
import { sameTeacherSelection } from "@/lib/rotation-availability";

type RotationAvailabilityState = {
  availableTeacherIds: Set<string>;
  isDirty: boolean;
  setAvailableTeacherIds: Dispatch<SetStateAction<Set<string>>>;
};

const RotationAvailabilityContext = createContext<RotationAvailabilityState | null>(null);

export function RotationAvailabilityProvider({
  children,
  initialAvailableTeacherIds
}: {
  children: ReactNode;
  initialAvailableTeacherIds: string[];
}) {
  const initialSelection = useMemo(
    () => new Set(initialAvailableTeacherIds),
    [initialAvailableTeacherIds]
  );
  const [availableTeacherIds, setAvailableTeacherIds] = useState(
    () => new Set(initialAvailableTeacherIds)
  );
  const isDirty = !sameTeacherSelection(initialSelection, availableTeacherIds);

  return (
    <RotationAvailabilityContext.Provider
      value={{ availableTeacherIds, isDirty, setAvailableTeacherIds }}
    >
      {children}
    </RotationAvailabilityContext.Provider>
  );
}

export function useRotationAvailability() {
  const context = useContext(RotationAvailabilityContext);

  if (!context) {
    throw new Error("Rotation availability controls must be inside their provider.");
  }

  return context;
}

export function RotationPublishButton({ baseDisabled }: { baseDisabled: boolean }) {
  const { isDirty } = useRotationAvailability();

  return (
    <button
      className="rounded-md bg-gold px-4 py-2.5 text-sm font-semibold text-ink hover:bg-moss hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      disabled={baseDisabled || isDirty}
      title={isDirty ? "Save teacher availability before publishing assignments." : undefined}
    >
      Publish assignments
    </button>
  );
}

export function RotationPreviewGuard({ children }: { children: ReactNode }) {
  const { isDirty } = useRotationAvailability();

  if (isDirty) {
    return (
      <p
        aria-live="polite"
        className="mt-4 border-l-4 border-amber-500 bg-amber-50 px-3 py-3 text-sm text-amber-950"
        role="status"
      >
        Assignment preview paused. Save teacher availability to recalculate the proposed assignments before publishing.
      </p>
    );
  }

  return children;
}
