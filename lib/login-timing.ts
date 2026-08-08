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
  const entries: Array<[string, number | null]> = [
    ["login-total", timings.totalRequestMs],
    ["login-identifier", timings.identifierAccountResolutionMs],
    ["login-password", timings.passwordAuthenticationMs],
    ["login-profile", timings.profileRoleResolutionMs]
  ];

  return entries
    .filter(([, duration]) => duration !== null)
    .map(([name, duration]) => `${name};dur=${duration}`)
    .join(", ");
}
