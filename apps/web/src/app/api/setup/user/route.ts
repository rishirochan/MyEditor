import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { createUser, findLocalUser } from "@/lib/db/queries/users";
import { createSession, setSessionCookie } from "@/lib/auth/session";

const bodySchema = z.object({ name: z.string().trim().min(1).max(255) });

/** Creates the local user on first launch. Refused once one exists. */
export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  }
  if (await findLocalUser()) {
    return NextResponse.json({ error: "MyEditor is already set up." }, { status: 409 });
  }

  const user = await createUser({
    // The schema wants a unique email; there are no accounts to tell apart.
    email: "me@myeditor.local",
    name: parsed.data.name,
    // Never checked: there is no password login.
    passwordHash: randomBytes(32).toString("hex"),
  });
  await setSessionCookie(await createSession(user.id));
  return NextResponse.json({ success: true });
}
