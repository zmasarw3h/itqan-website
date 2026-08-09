import { Check, LockSimple } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import {
  rotationWizardStepLabels,
  rotationWizardSteps,
  type RotationWizardStep
} from "@/lib/rotation-workflow";

export default function RotationStepIndicator({
  activeStep,
  hrefFor,
  unlocked
}: {
  activeStep: RotationWizardStep;
  hrefFor: (step: RotationWizardStep) => string;
  unlocked: Record<RotationWizardStep, boolean>;
}) {
  const activeIndex = rotationWizardSteps.indexOf(activeStep);
  return <nav aria-label="Rotation progress" className="mt-5 rounded-lg border border-stone-200 bg-white px-3 py-3 sm:px-6">
    <ol className="grid grid-cols-4 gap-1 sm:gap-3">
      {rotationWizardSteps.map((step, index) => {
        const nextStep = rotationWizardSteps[index + 1];
        const completed = step !== activeStep && Boolean(nextStep && unlocked[nextStep]);
        const enabled = unlocked[step];
        const content = <>
          <span className={`grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold ${index === activeIndex ? "border-moss bg-moss text-white" : completed ? "border-moss bg-moss text-white" : "border-stone-300 bg-white text-stone-700"}`}>
            {completed ? <Check aria-hidden="true" className="size-4" weight="bold" /> : index + 1}
          </span>
          <span className={`hidden text-sm font-semibold sm:inline ${index === activeIndex ? "text-moss" : "text-stone-700"}`}>{rotationWizardStepLabels[step]}</span>
          {!enabled ? <LockSimple aria-hidden="true" className="hidden size-4 text-stone-400 sm:block" /> : null}
        </>;
        return <li className="flex min-w-0 items-center gap-2" key={step}>
          {enabled ? <Link aria-current={step === activeStep ? "step" : undefined} className="flex min-h-11 items-center gap-2 rounded-md px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss" href={hrefFor(step)}>{content}</Link> : <span aria-disabled="true" className="flex min-h-11 items-center gap-2 px-1">{content}</span>}
          {index < rotationWizardSteps.length - 1 ? <span aria-hidden="true" className={`hidden h-px min-w-4 flex-1 lg:block ${completed ? "bg-moss" : "bg-stone-300"}`} /> : null}
        </li>;
      })}
    </ol>
    <p className="mt-1 text-center text-xs text-stone-500 sm:hidden">Step {activeIndex + 1} of 4 · {rotationWizardStepLabels[activeStep]}</p>
  </nav>;
}
