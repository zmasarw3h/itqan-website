"use client";

import { focusRotationSection, rotationWorkflowSteps } from "@/lib/rotation-workflow";

export default function RotationStepIndicator() {
  function moveToStep(id: (typeof rotationWorkflowSteps)[number]["id"]) {
    focusRotationSection(document, id);
  }

  return (
    <nav aria-label="Rotation sections" className="mt-6 overflow-x-auto">
      <ol className="flex min-w-[760px] items-center gap-3 px-1">
        {rotationWorkflowSteps.map((step, index) => (
          <li className="flex min-w-0 flex-1 items-center gap-3" key={step.id}>
            <button
              className={`inline-flex shrink-0 items-center gap-2 text-left text-sm font-medium ${
                index === 0 ? "text-moss" : "text-stone-600 hover:text-ink"
              }`}
              onClick={() => moveToStep(step.id)}
              type="button"
            >
              <span className={`grid size-8 place-items-center rounded-full border text-sm ${
                index === 0 ? "border-moss bg-moss text-white" : "border-stone-300 bg-white text-stone-700"
              }`}>
                {index + 1}
              </span>
              <span>{step.label}</span>
            </button>
            {index < rotationWorkflowSteps.length - 1 ? <span aria-hidden="true" className="h-px min-w-8 flex-1 bg-stone-300" /> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
