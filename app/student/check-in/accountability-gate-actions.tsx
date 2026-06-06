"use client";

import { useState, type ReactNode } from "react";
import { ACCOUNTABILITY_GATE_COPY } from "@/lib/accountability";

export default function AccountabilityGateActions({ children }: { children: ReactNode }) {
  const [showNotYetMessage, setShowNotYetMessage] = useState(false);

  return (
    <div>
      <div className="mt-4 flex flex-wrap gap-3">
        {children}
        <button
          className="rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-ink hover:bg-stone-50"
          onClick={() => setShowNotYetMessage(true)}
          type="button"
        >
          {ACCOUNTABILITY_GATE_COPY.notYetButton}
        </button>
      </div>
      {showNotYetMessage ? (
        <p className="mt-4 rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-600">
          {ACCOUNTABILITY_GATE_COPY.notYetMessage}
        </p>
      ) : null}
    </div>
  );
}
