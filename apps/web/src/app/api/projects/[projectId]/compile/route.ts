import { db } from "@/lib/db";
import { projects, projectFiles, builds } from "@/lib/db/schema";
import { resolveProjectAccess } from "@/lib/auth/project-access";
import { enqueueCompileJob } from "@/lib/compiler/runner";
import { broadcastBuildUpdate } from "@/lib/websocket/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import type { Engine } from "@myeditor/shared";

const VALID_ENGINES: Engine[] = [
  "auto",
  "pdflatex",
  "xelatex",
  "lualatex",
  "latex",
];

function isValidEngine(value: string): value is Engine {
  return VALID_ENGINES.includes(value as Engine);
}

// ─── POST /api/projects/[projectId]/compile ────────
// Trigger compilation for a project. Owner and editors can compile.

export async function POST(
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

    const project = access.project;
    const storageUserId = project.userId;
    const actorUserId = access.user?.id ?? null;
    const buildUserId = access.user?.id ?? storageUserId;
    let compileEngine: Engine = project.engine;
    let mainFile = project.mainFile;

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }

      if (body && typeof body === "object" && "engine" in body) {
        const requestedEngine = (body as Record<string, unknown>).engine;
        if (typeof requestedEngine !== "string" || !isValidEngine(requestedEngine)) {
          return NextResponse.json(
            {
              error:
                "Invalid engine. Use one of: auto, pdflatex, xelatex, lualatex, latex",
            },
            { status: 400 }
          );
        }
        compileEngine = requestedEngine;
      }

      if (body && typeof body === "object" && "mainFile" in body) {
        const requestedMainFile = (body as Record<string, unknown>).mainFile;
        if (typeof requestedMainFile !== "string") {
          return NextResponse.json({ error: "Invalid document" }, { status: 400 });
        }
        mainFile = requestedMainFile;
      }
    }

    const [document] = await db
      .select({ id: projectFiles.id })
      .from(projectFiles)
      .where(
        and(
          eq(projectFiles.projectId, projectId),
          eq(projectFiles.path, mainFile),
          eq(projectFiles.isDocument, true)
        )
      )
      .limit(1);

    if (!document) {
      return NextResponse.json(
        { error: "Document root not found" },
        { status: 400 }
      );
    }

    const buildId = uuidv4();

    // Create a build record with status "queued"
    await db.insert(builds).values({
      id: buildId,
      projectId,
      userId: buildUserId,
      status: "queued",
      engine: compileEngine,
      mainFile,
    });

    await db
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    // Enqueue compile job
    await enqueueCompileJob({
      buildId,
      projectId,
      userId: buildUserId,
      storageUserId,
      triggeredByUserId: actorUserId,
      engine: compileEngine,
      mainFile,
    });

    broadcastBuildUpdate(buildUserId, {
      projectId,
      buildId,
      mainFile,
      status: "queued",
      triggeredByUserId: actorUserId,
    });

    return NextResponse.json(
      {
        buildId,
        status: "queued",
        message: "Compilation queued",
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("Error triggering compilation:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
