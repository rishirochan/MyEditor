import { and, eq, inArray, lt } from "drizzle-orm";
import { LIMITS } from "@myeditor/shared";
import type { Engine } from "@myeditor/shared";

import fs from "fs/promises";
import path from "path";

import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import {
  ensureBuildStatusEnumCompat,
  isBuildStatusEnumValueError,
} from "@/lib/db/compat";
import { getProjectDir, getPdfPath, fileExists } from "@/lib/storage";
import { runCompile } from "./latex";
import { parseLatexLog } from "./logParser";
import { injectMissingPackages } from "./preamble";
import { JobQueue } from "./jobQueue";
import { broadcastBuildUpdate } from "@/lib/websocket/server";

const STORAGE_PATH = process.env.STORAGE_PATH || "/data";

// ─── Types ───────────────────────────────────────────

export interface CompileJobData {
  buildId: string;
  projectId: string;
  /** User notified about this build */
  userId: string;
  /** Owner storage root. Project files are read/written from this user scope. */
  storageUserId?: string;
  /** Actual user who triggered this build (for attribution and direct notifications). */
  triggeredByUserId?: string | null;
  engine: Engine;
  mainFile: string;
}

export interface RunnerHealth {
  running: boolean;
  activeJobs: number;
  waitingJobs: number;
  maxConcurrent: number;
  totalProcessed: number;
  totalErrors: number;
  uptimeMs: number;
}

// ─── Configuration ───────────────────────────────────

const MAX_CONCURRENT_BUILDS = parseInt(
  process.env.MAX_CONCURRENT_BUILDS ||
    String(LIMITS.MAX_CONCURRENT_BUILDS_DEFAULT),
  10
);
const STALE_BUILD_TTL_MINUTES = parseInt(
  process.env.STALE_BUILD_TTL_MINUTES || "60",
  10
);

// ─── CompileRunner Class ─────────────────────────────

class CompileRunner {
  readonly queue = new JobQueue<CompileJobData>(
    MAX_CONCURRENT_BUILDS,
    (data, signal) => this.processJob(data, signal)
  );
  private totalProcessed = 0;
  private totalErrors = 0;
  private startedAt = Date.now();

  constructor() {
    // Clean stale builds from previous instance (fire-and-forget)
    void cleanStaleBuildRecords();
    console.log(`[Runner] Compile runner started (concurrency=${MAX_CONCURRENT_BUILDS})`);
  }

  private async processJob(data: CompileJobData, signal: AbortSignal): Promise<void> {
    const { buildId, projectId, userId, engine, mainFile } = data;
    const storageUserId = data.storageUserId ?? userId;
    const notifyUserId = userId;
    const actorUserId = data.triggeredByUserId ?? null;
    const startTime = Date.now();

    // Isolated build directory to prevent race conditions between concurrent builds
    const buildDir = path.join(STORAGE_PATH, "builds", buildId);

    try {
      // Step 1: Mark as compiling (no-op if cancel API already finalized the row)
      const markedCompiling = await updateBuildStatus(buildId, "compiling");
      if (!markedCompiling) {
        // Cancel API already finalized the row — don't broadcast or compile.
        return;
      }

      broadcastBuildUpdate(notifyUserId, {
        projectId,
        buildId,
        mainFile,
        status: "compiling",
        triggeredByUserId: actorUserId,
      });

      // Step 2: Copy project files to isolated build directory
      const projectDir = getProjectDir(storageUserId, projectId);
      await copyDir(projectDir, buildDir);
      console.log(`[Runner] Copied project files to build dir: ${buildDir}`);

      // Step 2.5: Auto-inject missing LaTeX packages into the build copy
      await injectMissingPackages(buildDir, mainFile);

      // Step 3: Run latexmk against the isolated build dir
      const result = await runCompile({
        projectDir: buildDir,
        mainFile,
        engine,
        signal,
      });

      const durationMs = Date.now() - startTime;

      const parsedEntries = parseLatexLog(result.logs);
      const hasErrors = parsedEntries.some((e) => e.type === "error");
      const buildErrors = result.canceled
        ? []
        : parsedEntries.filter((e) => e.type === "error");
      let pdfExists = false;
      const pdfOutputPath = getPdfPath(storageUserId, projectId, mainFile);

      if (!result.canceled) {
        // Check for PDF in the build directory
        const pdfName = mainFile.replace(/\.tex$/, ".pdf");
        const buildPdfPath = path.join(buildDir, pdfName);
        const pdfInBuild = await fileExists(buildPdfPath);

        // Copy PDF back to project directory if it was generated
        if (pdfInBuild) {
          await fs.mkdir(path.dirname(pdfOutputPath), { recursive: true });
          await fs.copyFile(buildPdfPath, pdfOutputPath);
        }

        pdfExists = await fileExists(pdfOutputPath);
      }

      // Determine final status
      let finalStatus: "success" | "error" | "timeout" | "canceled";
      if (result.canceled) {
        finalStatus = "canceled";
      } else if (result.timedOut) {
        finalStatus = "timeout";
      } else if (result.exitCode !== 0 || hasErrors || !pdfExists) {
        finalStatus = "error";
      } else {
        finalStatus = "success";
      }

      // Step 4: Update database
      const completionPatch = {
        engine: result.engineUsed,
        status: finalStatus,
        logs: result.canceled
          ? "Build canceled by user."
          : result.logs,
        durationMs,
        exitCode: result.exitCode,
        pdfPath: pdfExists ? pdfOutputPath : null,
        completedAt: new Date(),
      };

      // Don't overwrite a row the cancel API already finalized.
      const nonTerminal = and(
        eq(builds.id, buildId),
        inArray(builds.status, ["queued", "compiling"])
      );

      try {
        await db.update(builds).set(completionPatch).where(nonTerminal);
      } catch (updateErr) {
        if (isBuildStatusEnumValueError(updateErr)) {
          await ensureBuildStatusEnumCompat();
          await db.update(builds).set(completionPatch).where(nonTerminal);
        } else {
          throw updateErr;
        }
      }

      // Step 5: Broadcast completion
      broadcastBuildUpdate(notifyUserId, {
        projectId,
        buildId,
        mainFile,
        status: finalStatus,
        pdfUrl: pdfExists
          ? `/api/projects/${projectId}/pdf?mainFile=${encodeURIComponent(mainFile)}`
          : null,
        logs: result.canceled
          ? "Build canceled by user."
          : result.logs,
        durationMs,
        errors: buildErrors,
        triggeredByUserId: actorUserId,
      });

      this.totalProcessed++;
      console.log(`[Runner] Job ${buildId} completed with status=${finalStatus}`);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Update the build as errored
      await updateBuildError(buildId, errorMessage, durationMs);

      // Broadcast the error
      broadcastBuildUpdate(notifyUserId, {
        projectId,
        buildId,
        mainFile,
        status: "error",
        pdfUrl: null,
        logs: `Internal compilation error: ${errorMessage}`,
        durationMs,
        errors: [
          {
            type: "error",
            file: "system",
            line: 0,
            message: `Compilation infrastructure error: ${errorMessage}`,
          },
        ],
        triggeredByUserId: actorUserId,
      });

      this.totalErrors++;
      console.error(`[Runner] Job ${buildId} failed: ${errorMessage}`);
    } finally {
      // Always clean up the isolated build directory
      try {
        await fs.rm(buildDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  getHealth(): RunnerHealth {
    return {
      running: true,
      activeJobs: this.queue.active,
      waitingJobs: this.queue.waiting,
      maxConcurrent: MAX_CONCURRENT_BUILDS,
      totalProcessed: this.totalProcessed,
      totalErrors: this.totalErrors,
      uptimeMs: Date.now() - this.startedAt,
    };
  }
}

// ─── File Helpers ───────────────────────────────────

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// ─── Database Helpers ────────────────────────────────

async function updateBuildStatus(
  buildId: string,
  status: "queued" | "compiling"
): Promise<boolean> {
  const updated = await db
    .update(builds)
    .set({ status })
    .where(
      and(
        eq(builds.id, buildId),
        inArray(builds.status, ["queued", "compiling"])
      )
    )
    .returning({ id: builds.id });

  return updated.length > 0;
}

async function updateBuildError(
  buildId: string,
  errorMessage: string,
  durationMs: number
): Promise<void> {
  await db
    .update(builds)
    .set({
      status: "error",
      logs: `Internal compilation error: ${errorMessage}`,
      durationMs,
      exitCode: -1,
      completedAt: new Date(),
    })
    .where(eq(builds.id, buildId));
}

async function cleanStaleBuildRecords(): Promise<void> {
  try {
    const cutoff = new Date(
      Date.now() - Math.max(STALE_BUILD_TTL_MINUTES, 1) * 60_000
    );
    const stale = await db
      .update(builds)
      .set({
        status: "error",
        logs: "Build interrupted — server restarted. Please recompile.",
        completedAt: new Date(),
      })
      .where(
        and(
          inArray(builds.status, ["queued", "compiling"]),
          lt(builds.createdAt, cutoff)
        )
      )
      .returning({ id: builds.id });

    if (stale.length > 0) {
      console.log(`[Runner] Cleaned ${stale.length} stale build(s) from previous instance`);
    }
  } catch (err) {
    console.error("[Runner] Failed to clean stale builds:", err instanceof Error ? err.message : err);
  }
}

// ─── Singleton (survives Next.js hot-reloads) ────────

const globalForRunner = globalThis as typeof globalThis & {
  __myeditorCompileRunner?: CompileRunner;
};

// ─── Public API ──────────────────────────────────────

export function startCompileRunner(): CompileRunner {
  globalForRunner.__myeditorCompileRunner ??= new CompileRunner();
  return globalForRunner.__myeditorCompileRunner;
}

export async function enqueueCompileJob(data: CompileJobData): Promise<void> {
  startCompileRunner().queue.add(data.buildId, data);
}

export async function requestCompileCancel(
  buildId: string
): Promise<{ wasQueued: boolean; wasRunning: boolean }> {
  return startCompileRunner().queue.cancel(buildId);
}

export function getRunnerHealth(): RunnerHealth | null {
  return globalForRunner.__myeditorCompileRunner?.getHealth() ?? null;
}
