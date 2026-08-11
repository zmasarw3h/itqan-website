import "server-only";

export const SERVER_LOADER_PHASES = [
  "auth",
  "week_discovery",
  "aggregation",
  "scope",
  "shell",
  "view_data"
] as const;

export type ServerLoaderPhase = (typeof SERVER_LOADER_PHASES)[number];
export type ServerLoaderTiming = Record<ServerLoaderPhase, number | null>;

export function createServerLoaderTiming(): ServerLoaderTiming {
  return Object.fromEntries(
    SERVER_LOADER_PHASES.map((phase) => [phase, null])
  ) as ServerLoaderTiming;
}

export async function measureServerLoaderPhase<T>(
  timing: ServerLoaderTiming,
  phase: ServerLoaderPhase,
  operation: () => Promise<T>
) {
  const startedAt = performance.now();

  try {
    return await operation();
  } finally {
    timing[phase] = Math.max(0, Math.round(performance.now() - startedAt));
  }
}

export function recordServerLoaderTiming(
  loader: "admin_dashboard" | "admin_student_workspace",
  timing: ServerLoaderTiming,
  log: (message: string) => void = console.info
) {
  log(JSON.stringify({
    event: "server_loader_timing",
    loader,
    phases: Object.fromEntries(
      SERVER_LOADER_PHASES.map((phase) => [`${phase}_ms`, timing[phase]])
    )
  }));
}
