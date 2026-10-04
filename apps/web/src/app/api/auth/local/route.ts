import { NextRequest, NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { createUser } from "@/lib/db/queries/users";
import { createSession, setSessionCookie } from "@/lib/auth/session";

// Desktop app: there is one local user, so sign in as them without a password.
// ponytail: oldest user wins; add a picker if multi-user ever comes back.
export async function GET(request: NextRequest) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .orderBy(asc(users.createdAt))
    .limit(1);

  const userId = existing?.id ?? (await createUser({
    email: "me@myeditor.local",
    name: "Me",
    // Never checked: there is no password login anymore.
    passwordHash: randomBytes(32).toString("hex"),
  })).id;

  await setSessionCookie(await createSession(userId));

  const redirect = request.nextUrl.searchParams.get("redirect");
  const target = redirect?.startsWith("/") && !redirect.startsWith("//")
    ? redirect
    : "/dashboard";
  return NextResponse.redirect(new URL(target, request.url));
}
