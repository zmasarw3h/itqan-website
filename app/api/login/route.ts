import { NextResponse } from "next/server";
import { authenticateWithPhone } from "@/app/login/authenticate";
import {
  loginFailure,
  type LoginErrorCode,
  type SignInResult
} from "@/lib/login-contract";
import {
  createLoginTiming,
  elapsedMilliseconds,
  formatLoginServerTiming,
  type LoginTimingFields
} from "@/lib/login-timing";

type LoginRequestBody = {
  identifier?: unknown;
  password?: unknown;
};

const LOGIN_STATUS_BY_ERROR: Record<LoginErrorCode, number> = {
  invalid_request: 400,
  invalid_identifier: 400,
  ambiguous_identifier: 400,
  invalid_credentials: 401,
  inactive_account: 401,
  rate_limited: 429,
  service_unavailable: 503
};

function recordLoginOutcome(
  result: SignInResult,
  status: number,
  requestId: string,
  timings: LoginTimingFields
) {
  const entry = {
    event: "login_attempt",
    outcome: result.ok ? "success" : result.error.code,
    requestId,
    status,
    totalRequestMs: timings.totalRequestMs,
    identifierAccountResolutionMs: timings.identifierAccountResolutionMs,
    passwordAuthenticationMs: timings.passwordAuthenticationMs,
    profileRoleResolutionMs: timings.profileRoleResolutionMs
  };

  if (status >= 500) {
    console.error(entry);
  } else if (status === 429) {
    console.warn(entry);
  } else {
    console.info(entry);
  }
}

function json(
  result: SignInResult,
  status: number,
  requestId: string,
  timings: LoginTimingFields,
  requestStartedAt: number
) {
  timings.totalRequestMs = elapsedMilliseconds(requestStartedAt);
  recordLoginOutcome(result, status, requestId, timings);

  const serverTiming = formatLoginServerTiming(timings);

  return NextResponse.json(result, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
      "Server-Timing": serverTiming
    }
  });
}

export async function POST(request: Request) {
  const requestStartedAt = performance.now();
  const requestId = request.headers.get("x-vercel-id") ?? crypto.randomUUID();
  const timings = createLoginTiming();
  let body: LoginRequestBody;

  try {
    body = await request.json() as LoginRequestBody;
  } catch {
    return json(loginFailure("invalid_request"), 400, requestId, timings, requestStartedAt);
  }

  if (
    typeof body.identifier !== "string" ||
    typeof body.password !== "string" ||
    !body.identifier.trim() ||
    !body.password ||
    body.identifier.length > 254 ||
    body.password.length > 1024
  ) {
    return json(loginFailure("invalid_request"), 400, requestId, timings, requestStartedAt);
  }

  let result: SignInResult;

  try {
    result = await authenticateWithPhone(body.identifier, body.password, timings);
  } catch {
    result = loginFailure("service_unavailable");
  }

  const status = result.ok ? 200 : LOGIN_STATUS_BY_ERROR[result.error.code];
  return json(result, status, requestId, timings, requestStartedAt);
}
