"use client";

import { useEffect } from "react";
import type { RotationWizardStep } from "@/lib/rotation-workflow";

export default function RotationStepScroll({ step }: { step: RotationWizardStep }) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [step]);

  return null;
}
