import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabasePublicConfig, getSupabasePublicConfig } from "@/lib/config";
import {
  isStaleRefreshTokenError,
  isSupabaseAuthCookieName,
  SESSION_EXPIRED_STATUS
} from "@/lib/session-recovery";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export function recoverFromStaleSession(request: NextRequest) {
  const authCookieNames = request.cookies
    .getAll()
    .map(({ name }) => name)
    .filter(isSupabaseAuthCookieName);

  authCookieNames.forEach((name) => request.cookies.delete(name));

  const response =
    request.nextUrl.pathname === "/login" || request.nextUrl.pathname.startsWith("/api/")
      ? NextResponse.next({ request })
      : NextResponse.redirect(
          new URL(`/login?status=${SESSION_EXPIRED_STATUS}`, request.url)
        );

  authCookieNames.forEach((name) => response.cookies.delete(name));
  return response;
}

export async function proxy(request: NextRequest) {
  if (!hasSupabasePublicConfig()) {
    return NextResponse.next();
  }

  const { url, anonKey } = getSupabasePublicConfig();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      }
    }
  });

  try {
    const { error } = await supabase.auth.getUser();

    if (isStaleRefreshTokenError(error)) {
      return recoverFromStaleSession(request);
    }
  } catch (error) {
    if (isStaleRefreshTokenError(error)) {
      return recoverFromStaleSession(request);
    }

    throw error;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
