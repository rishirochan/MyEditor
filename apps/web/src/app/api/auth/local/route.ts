import { NextRequest, NextResponse } from "next/server";
import { findLocalUser } from "@/lib/db/queries/users";
import { createSession, setSessionCookie } from "@/lib/auth/session";

// Desktop app: there is one local user, so sign in as them without a password.
// No user yet means first launch: onboarding creates one.
export async function GET(request: NextRequest) {
  const user = await findLocalUser();
  if (!user) {
    return NextResponse.redirect(new URL("/welcome", request.url));
  }

  await setSessionCookie(await createSession(user.id));

  const redirect = request.nextUrl.searchParams.get("redirect");
  const target = redirect?.startsWith("/") && !redirect.startsWith("//")
    ? redirect
    : "/dashboard";
  return NextResponse.redirect(new URL(target, request.url));
}
