"use client";

import RoleErrorFallback from "@/app/error-fallback";

export default function SuperAdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RoleErrorFallback
      dashboardHref="/super-admin"
      dashboardLabel="Return to super admin overview"
      error={error}
      reset={reset}
      tone="super-admin"
      workspaceLabel="Super admin workspace"
    />
  );
}
