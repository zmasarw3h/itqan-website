import { NextResponse } from "next/server";
import {
  authenticateWithPhone,
  type SignInResult
} from "@/app/login/authenticate";

type LoginRequestBody = {
  identifier?: unknown;
  password?: unknown;
};

function json(result: SignInResult, status: number) {
  return NextResponse.json(result, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

export async function POST(request: Request) {
  let body: LoginRequestBody;

  try {
    body = await request.json() as LoginRequestBody;
  } catch {
    return json({ error: "Enter your phone number and password." }, 400);
  }

  if (typeof body.identifier !== "string" || typeof body.password !== "string") {
    return json({ error: "Enter your phone number and password." }, 400);
  }

  const result = await authenticateWithPhone(body.identifier, body.password);
  return json(result, result.error ? 401 : 200);
}
