import { db } from "@/lib/db";
import { projects, projectFiles, builds } from "@/lib/db/schema";
import { withApiKey } from "@/lib/auth/apikey";
import { updateProjectSchema } from "@/lib/utils/validation";
import * as storage from "@/lib/storage";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// ─── GET /api/v1/projects/[projectId] ───────────────
// Get project details with files and last build.

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

      const files = await db
        .select()
        .from(projectFiles)
        .where(eq(projectFiles.projectId, projectId));

      const [lastBuild] = await db
        .select()
        .from(builds)
        .where(eq(builds.projectId, projectId))
        .orderBy(desc(builds.createdAt))
        .limit(1);

      return NextResponse.json({
        project,
        files,
        lastBuild: lastBuild ?? null,
      });
    } catch (error) {
      console.error("[API v1] Error fetching project:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// ─── PUT /api/v1/projects/[projectId] ───────────────
// Update project settings.

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  return withApiKey(request, async (req, user) => {
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

      const body = await req.json();
      const parsed = updateProjectSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 }
        );
      }

      const [updatedProject] = await db
        .update(projects)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(projects.id, projectId))
        .returning();

      return NextResponse.json({ project: updatedProject });
    } catch (error) {
      console.error("[API v1] Error updating project:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}

// ─── DELETE /api/v1/projects/[projectId] ────────────
// Delete a project.

export async function DELETE(
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

      await db.delete(projects).where(eq(projects.id, projectId));

      const projectDir = storage.getProjectDir(user.id, projectId);
      await storage.deleteDirectory(projectDir);

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("[API v1] Error deleting project:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
