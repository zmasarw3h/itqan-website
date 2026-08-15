import type { ReactNode } from "react";
import ProgressNavigation from "@/app/student/progress-navigation";

const pageWidths = {
  narrow: "max-w-3xl",
  focused: "max-w-4xl",
  standard: "max-w-5xl",
  wide: "max-w-6xl",
  expanded: "max-w-[86rem]"
} as const;

export function StudentPage({
  children,
  width = "standard"
}: {
  children: ReactNode;
  width?: keyof typeof pageWidths;
}) {
  return (
    <main
      className={`student-page mx-auto w-full ${pageWidths[width]} px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10`}
      id="main-content"
    >
      <ProgressNavigation />
      {children}
    </main>
  );
}

export function StudentPageHeader({
  eyebrow,
  title,
  description
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
}) {
  return (
    <header>
      {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.12em] text-moss">{eyebrow}</p> : null}
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
      {description ? <div className="mt-3 max-w-3xl text-base leading-7 text-stone-600">{description}</div> : null}
    </header>
  );
}

export function StudentSurface({
  children,
  emphasis = "standard",
  className = ""
}: {
  children: ReactNode;
  emphasis?: "primary" | "standard" | "inset";
  className?: string;
}) {
  const surfaceClass = {
    primary: "border-moss/25 bg-surface shadow-sm",
    standard: "border-stone-200 bg-surface shadow-sm",
    inset: "border-stone-200 bg-stone-50"
  }[emphasis];

  return <section className={`rounded-lg border p-5 sm:p-6 ${surfaceClass} ${className}`}>{children}</section>;
}

export function StudentNotice({
  children,
  tone = "neutral",
  className = ""
}: {
  children: ReactNode;
  tone?: "success" | "warning" | "error" | "info" | "neutral";
  className?: string;
}) {
  const toneClass = {
    success: "border-green-200 bg-green-50 text-green-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-900",
    info: "border-blue-200 bg-blue-50 text-blue-900",
    neutral: "border-stone-200 bg-stone-50 text-stone-700"
  }[tone];

  return (
    <div
      className={`rounded-md border px-4 py-3 text-sm leading-6 ${toneClass} ${className}`}
      role={tone === "error" ? "alert" : tone === "neutral" ? undefined : "status"}
    >
      {children}
    </div>
  );
}
