import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { resolveProjectAccess } from "@/lib/auth/project-access";
import { parseLatexLog } from "@/lib/compiler/logParser";
import { and, eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// ─── GET /api/projects/[projectId]/logs ────────────
// Get the latest build logs with parsed error entries.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    const access = await resolveProjectAccess(request, projectId);
    if (!access.access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const mainFile = request.nextUrl.searchParams.get("mainFile") ?? access.project.mainFile;
    const requestedBuildId = request.nextUrl.searchParams.get("buildId");
    const parsedBuildId = requestedBuildId
      ? z.string().uuid().safeParse(requestedBuildId)
      : null;
    if (parsedBuildId && !parsedBuildId.success) {
      return NextResponse.json({ error: "Invalid build ID" }, { status: 400 });
    }

    const [build] = await db
      .select()
      .from(builds)
      .where(
        and(
          eq(builds.projectId, projectId),
          eq(builds.mainFile, mainFile),
          parsedBuildId?.success ? eq(builds.id, parsedBuildId.data) : undefined
        )
      )
      .orderBy(desc(builds.createdAt))
      .limit(1);

    if (!build) {
      return NextResponse.json(
        { error: "No builds found for this project" },
        { status: 404 }
      );
    }

    const errors = parseLatexLog(build.logs ?? "");

    return NextResponse.json({
      build,
      errors,
    });
  } catch (error) {
    console.error("Error fetching build logs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
