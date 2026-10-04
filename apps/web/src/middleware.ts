import { NextRequest, NextResponse } from "next/server";
import { verifySessionJwt } from "@/lib/auth/jwt";

// Desktop app: no login. "/" (marketing page) and the old auth pages go
// straight to the dashboard; a missing session signs in the local user.
const DASHBOARD_REDIRECTS = new Set(["/", "/login", "/register", "/forgot"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function isPublic(pathname: string): boolean {
  return pathname.startsWith("/share/");
}

function localLoginRedirect(request: NextRequest, pathname: string): NextResponse {
  const url = new URL("/api/auth/local", request.url);
  url.searchParams.set("redirect", pathname);
  const response = NextResponse.redirect(url);
  // Path must match the one used when setting it, or the cookie survives.
  response.cookies.delete({ name: "session", path: "/" });
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The server is bound to loopback, but a DNS-rebinding page could still
  // reach it under its own hostname. Anything not addressed to localhost is
  // refused, since this server can run AI CLIs on the user's machine.
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Skip API routes and static files
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  if (DASHBOARD_REDIRECTS.has(pathname) || pathname.startsWith("/reset/")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (isPublic(pathname)) return NextResponse.next();

  const sessionToken = request.cookies.get("session")?.value || null;
  const hasValidSession = sessionToken
    ? Boolean(await verifySessionJwt(sessionToken))
    : false;

  return hasValidSession
    ? NextResponse.next()
    : localLoginRedirect(request, pathname);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
