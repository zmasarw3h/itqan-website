"use client";

import RoleErrorFallback from "@/app/error-fallback";

export default function RotationError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RoleErrorFallback
      dashboardHref="/admin"
      dashboardLabel="Return to admin dashboard"
      error={error}
      reset={reset}
      tone="admin"
      workspaceLabel="Rotation workspace"
    />
  );
}
