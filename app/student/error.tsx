"use client";

import RoleErrorFallback from "@/app/error-fallback";

export default function StudentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RoleErrorFallback
      dashboardHref="/student/check-in"
      dashboardLabel="Return to today’s check-in"
      error={error}
      reset={reset}
      tone="student"
      workspaceLabel="Student dashboard"
    />
  );
}
