import { db } from "@/lib/db";
import { projects, projectFiles } from "@/lib/db/schema";
import { withApiKey } from "@/lib/auth/apikey";
import { validateFilePath } from "@/lib/utils/validation";
import * as storage from "@/lib/storage";
import { MIME_TYPES, LIMITS } from "@backslash/shared";
import { eq, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// ─── POST /api/v1/projects/[projectId]/files/upload ─
// Upload files via FormData.

export async function POST(
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

      const formData = await req.formData();
      const entries = formData.getAll("files") as File[];
      const paths = formData.getAll("paths") as string[];

      if (entries.length === 0) {
        return NextResponse.json(
          { error: "No files provided" },
          { status: 400 }
        );
      }

      const created = [];

      for (let i = 0; i < entries.length; i++) {
        const file = entries[i];
        const filePath = paths[i] || file.name;

        const pathValidation = validateFilePath(filePath);
        if (!pathValidation.valid) continue;

        if (file.size > LIMITS.MAX_FILE_SIZE) continue;

        const [existing] = await db
          .select({ id: projectFiles.id })
          .from(projectFiles)
          .where(
            and(
              eq(projectFiles.projectId, projectId),
              eq(projectFiles.path, filePath)
            )
          )
          .limit(1);

        const projectDir = storage.getProjectDir(user.id, projectId);
        const fullPath = path.join(projectDir, filePath);
        const buffer = Buffer.from(await file.arrayBuffer());

        if (existing) {
          await storage.writeFileBinary(fullPath, buffer);
          const [updatedFile] = await db
            .update(projectFiles)
            .set({ sizeBytes: file.size, updatedAt: new Date() })
            .where(eq(projectFiles.id, existing.id))
            .returning();
          created.push(updatedFile);
          continue;
        }

        await storage.writeFileBinary(fullPath, buffer);

        const ext = path.extname(filePath).toLowerCase();
        const mimeType =
          MIME_TYPES[ext] || file.type || "application/octet-stream";

        const [dbFile] = await db
          .insert(projectFiles)
          .values({
            id: uuidv4(),
            projectId,
            path: filePath,
            mimeType,
            sizeBytes: file.size,
            isDirectory: false,
          })
          .returning();

        created.push(dbFile);
      }

      return NextResponse.json({ files: created }, { status: 201 });
    } catch (error) {
      console.error("[API v1] Upload error:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  });
}
