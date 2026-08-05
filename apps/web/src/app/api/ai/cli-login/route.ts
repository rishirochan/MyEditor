import { withAuth } from "@/lib/auth/middleware";
import { startCliLogin } from "@/lib/ai/cliDetect";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  provider: z.enum(["claude-cli", "codex-cli"]),
});

export async function POST(request: NextRequest) {
  return withAuth(request, async (req) => {
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const result = await startCliLogin(parsed.data.provider);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, message: result.message });
  });
}
