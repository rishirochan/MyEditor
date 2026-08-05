import { withAuth } from "@/lib/auth/middleware";
import { detectCliStatus } from "@/lib/ai/cliDetect";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  return withAuth(request, async () => {
    const status = await detectCliStatus();
    return NextResponse.json({ status });
  });
}
