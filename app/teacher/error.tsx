"use client";

import RoleErrorFallback from "@/app/error-fallback";

export default function TeacherError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RoleErrorFallback
      dashboardHref="/teacher"
      dashboardLabel="Return to teaching dashboard"
      error={error}
      reset={reset}
      tone="teacher"
      workspaceLabel="Teaching workspace"
    />
  );
}
