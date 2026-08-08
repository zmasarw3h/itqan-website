export type LoginTimingFields = {
  totalRequestMs: number | null;
  identifierAccountResolutionMs: number | null;
  passwordAuthenticationMs: number | null;
  profileRoleResolutionMs: number | null;
};

export type LoginTimingPhase = Exclude<keyof LoginTimingFields, "totalRequestMs">;

export function createLoginTiming(): LoginTimingFields {
  return {
    totalRequestMs: null,
    identifierAccountResolutionMs: null,
    passwordAuthenticationMs: null,
    profileRoleResolutionMs: null
  };
}

export function elapsedMilliseconds(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export async function measureLoginPhase<T>(
  timings: LoginTimingFields,
  phase: LoginTimingPhase,
  operation: () => Promise<T>
) {
  const startedAt = performance.now();

  try {
    return await operation();
  } finally {
    timings[phase] = elapsedMilliseconds(startedAt);
  }
}

export function formatLoginServerTiming(timings: LoginTimingFields) {
  return timings.totalRequestMs === null ? "" : `login-total;dur=${timings.totalRequestMs}`;
}
