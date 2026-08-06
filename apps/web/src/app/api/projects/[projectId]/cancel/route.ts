import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  ensureBuildStatusEnumCompat,
  isBuildStatusEnumValueError,
} from "@/lib/db/compat";
import { builds, projects } from "@/lib/db/schema";
import { resolveProjectAccess } from "@/lib/auth/project-access";
import { requestCompileCancel } from "@/lib/compiler/compileQueue";
import { broadcastBuildUpdate } from "@/lib/websocket/server";

// ─── POST /api/projects/[projectId]/cancel ─────────
// Cancel the latest queued/compiling build for a project.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const requestedBuildId = request.nextUrl.searchParams.get("buildId");

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

    const [build] = await db
      .select({
        id: builds.id,
        mainFile: builds.mainFile,
        status: builds.status,
        createdAt: builds.createdAt,
      })
      .from(builds)
      .where(
        and(
          eq(builds.projectId, projectId),
          inArray(builds.status, ["queued", "compiling"]),
          ...(requestedBuildId ? [eq(builds.id, requestedBuildId)] : [])
        )
      )
      .orderBy(desc(builds.createdAt))
      .limit(1);

    if (!build) {
      return NextResponse.json(
        { error: "No running build found" },
        { status: 404 }
      );
    }

    const actorUserId = access.user?.id ?? null;
    const notifyUserId = access.user?.id ?? access.project.userId;

    // Signal the worker / remove queued jobs. For active jobs this only sets a
    // Redis cancel flag — the worker may still take time to abort Docker.
    await requestCompileCancel(build.id);

    // Always mark the build canceled in the DB immediately so remount / polling
    // cannot re-lock the Compile button if the worker never finishes.
    const durationMs = build.createdAt
      ? Date.now() - build.createdAt.getTime()
      : 0;

    const canceledPatch = {
      status: "canceled" as const,
      logs: "Build canceled by user.",
      durationMs,
      exitCode: -1,
      completedAt: new Date(),
    };

    try {
      await db
        .update(builds)
        .set(canceledPatch)
        .where(
          and(
            eq(builds.id, build.id),
            inArray(builds.status, ["queued", "compiling"])
          )
        );
    } catch (updateErr) {
      if (isBuildStatusEnumValueError(updateErr)) {
        await ensureBuildStatusEnumCompat();
        await db
          .update(builds)
          .set(canceledPatch)
          .where(
            and(
              eq(builds.id, build.id),
              inArray(builds.status, ["queued", "compiling"])
            )
          );
      } else {
        throw updateErr;
      }
    }

    await db
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    broadcastBuildUpdate(notifyUserId, {
      projectId,
      buildId: build.id,
      mainFile: build.mainFile,
      status: "canceled",
      pdfUrl: null,
      logs: "Build canceled by user.",
      durationMs,
      errors: [],
      triggeredByUserId: actorUserId,
    });

    return NextResponse.json(
      {
        buildId: build.id,
        status: "canceled",
        message: "Cancel request accepted",
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("Error canceling build:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
