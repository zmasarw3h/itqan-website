"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type CorrectionDateContextValue = {
  selectedDate: string;
  setSelectedDate: (date: string) => void;
};

const CorrectionDateContext = createContext<CorrectionDateContextValue | null>(null);

export function CorrectionDateProvider({ initialDate, children }: { initialDate: string; children?: ReactNode }) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  return (
    <CorrectionDateContext.Provider value={{ selectedDate, setSelectedDate }}>
      {children}
    </CorrectionDateContext.Provider>
  );
}

export function useCorrectionDisplayDate() {
  const context = useContext(CorrectionDateContext);
  if (!context) throw new Error("Correction date controls must be inside CorrectionDateProvider.");
  return context;
}
