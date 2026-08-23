import { withAuth } from "@/lib/auth/middleware";
import { detectCliProviderStatus } from "@/lib/ai/cliDetect";
import {
  getUserAiSettings,
  resolveAiApiKey,
  resolveAiBaseUrl,
} from "@/lib/ai/settings";
import { isCliProvider } from "@/lib/ai/types";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, user) => {
    try {
      const { latexWriter } = await getUserAiSettings(user.id);

      if (isCliProvider(latexWriter.provider)) {
        const status = await detectCliProviderStatus(latexWriter.provider);
        return NextResponse.json({
          configured: status.installed && status.authenticated,
        });
      }

      return NextResponse.json({
        configured: Boolean(
          resolveAiApiKey(latexWriter) && resolveAiBaseUrl(latexWriter)
        ),
      });
    } catch {
      return NextResponse.json({ configured: false });
    }
  });
}
