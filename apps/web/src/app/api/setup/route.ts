import { NextResponse } from "next/server";
import { findLocalUser } from "@/lib/db/queries/users";
import {
  getTexInstallState,
  isTexInstalled,
  startTexInstall,
} from "@/lib/compiler/tex";

// First-run onboarding status. No auth: it runs before any user exists.
export async function GET() {
  const [user, texInstalled] = await Promise.all([findLocalUser(), isTexInstalled()]);
  return NextResponse.json({
    needsName: !user,
    tex: { installed: texInstalled, ...getTexInstallState() },
  });
}

/** Starts the LaTeX install unless some TeX is already there. */
export async function POST() {
  if (await isTexInstalled()) {
    return NextResponse.json({ tex: { installed: true, ...getTexInstallState() } });
  }
  return NextResponse.json({ tex: { installed: false, ...startTexInstall() } });
}
