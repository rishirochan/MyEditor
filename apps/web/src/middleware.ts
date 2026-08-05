import { NextRequest, NextResponse } from "next/server";
import { verifySessionJwt } from "@/lib/auth/jwt";

const PUBLIC_PATHS = new Set(["/", "/login", "/register", "/forgot"]);
const AUTH_PATHS = new Set(["/login", "/register", "/forgot"]);

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/reset/")
  );
}

function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.has(pathname) || pathname.startsWith("/reset/");
}

function loginRedirect(request: NextRequest, pathname: string): NextResponse {
  const loginUrl = new URL("/login", request.url);
  if (pathname && pathname !== "/login") {
    loginUrl.searchParams.set("redirect", pathname);
  }
  const response = NextResponse.redirect(loginUrl);
  // Drop a stale/invalid cookie so the next request is clean.
  // Path must match the one used when setting it, or the cookie survives.
  response.cookies.delete({ name: "session", path: "/" });
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip API routes and static files
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get("session")?.value || null;
  const hasValidSession = sessionToken
    ? Boolean(await verifySessionJwt(sessionToken))
    : false;

  if (!hasValidSession && !isPublic(pathname)) {
    return loginRedirect(request, pathname);
  }

  // Redirect authenticated users away from auth pages
  if (hasValidSession && isAuthPath(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Cookie present but invalid on a public/auth page — clear it.
  if (sessionToken && !hasValidSession) {
    const response = NextResponse.next();
    // Path must match the one used when setting it, or the cookie survives.
  response.cookies.delete({ name: "session", path: "/" });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
