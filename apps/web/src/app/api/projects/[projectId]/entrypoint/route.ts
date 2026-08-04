import { db } from "@/lib/db";
import { projects, projectFiles } from "@/lib/db/schema";
import { resolveProjectAccess } from "@/lib/auth/project-access";
import { validateFilePath } from "@/lib/utils/validation";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import path from "path";

// ─── PUT /api/projects/[projectId]/entrypoint ─────
// Update the compile entrypoint (main .tex file).

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    const access = await resolveProjectAccess(request, projectId);
    if (!access.access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    if (access.role === "viewer") {
      return NextResponse.json(
        { error: "Permission denied" },
        { status: 403 }
      );
    }

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const mainFile =
      body && typeof body === "object" && typeof (body as { mainFile?: unknown }).mainFile === "string"
        ? (body as { mainFile: string }).mainFile.trim()
        : "";

    if (!mainFile) {
      return NextResponse.json(
        { error: "mainFile is required" },
        { status: 400 }
      );
    }

    const validation = validateFilePath(mainFile);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error ?? "Invalid main file path" },
        { status: 400 }
      );
    }

    if (path.extname(mainFile).toLowerCase() !== ".tex") {
      return NextResponse.json(
        { error: "Entrypoint must be a .tex file" },
        { status: 400 }
      );
    }

    const [file] = await db
      .select({
        id: projectFiles.id,
        isDirectory: projectFiles.isDirectory,
      })
      .from(projectFiles)
      .where(
        and(
          eq(projectFiles.projectId, projectId),
          eq(projectFiles.path, mainFile)
        )
      )
      .limit(1);

    if (!file || file.isDirectory) {
      return NextResponse.json(
        { error: "Entrypoint file not found" },
        { status: 404 }
      );
    }

    await db
      .update(projects)
      .set({
        mainFile,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    return NextResponse.json({ mainFile });
  } catch (error) {
    console.error("Error updating entrypoint:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
