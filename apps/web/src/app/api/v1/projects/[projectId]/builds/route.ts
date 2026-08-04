import { db } from "@/lib/db";
import { projects, builds } from "@/lib/db/schema";
import { withApiKey } from "@/lib/auth/apikey";
import { parseLatexLog } from "@/lib/compiler/logParser";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// ─── GET /api/v1/projects/[projectId]/builds ────────
// Get the latest build with parsed logs.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withApiKey(request, async (_req, user) => {
    try {
      const { projectId } = await params;

      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!project || project.userId !== user.id) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }

      const [latestBuild] = await db
        .select()
        .from(builds)
        .where(eq(builds.projectId, projectId))
        .orderBy(desc(builds.createdAt))
        .limit(1);

      if (!latestBuild) {
        return NextResponse.json(
          { error: "No builds found for this project" },
          { status: 404 }
        );
      }

      const errors = parseLatexLog(latestBuild.logs ?? "");

      return NextResponse.json({
        build: latestBuild,
        errors,
      });
    } catch (error) {
      console.error("[API v1] Error fetching builds:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
