import { LIMITS } from "@myeditor/shared";
import type { Engine } from "@myeditor/shared";
import fs from "fs/promises";

import { runCompile } from "./latex";
import { parseLatexLog } from "./logParser";
import { JobQueue } from "./jobQueue";
import {
  computeAsyncCompileExpiryIso,
  deleteAsyncCompileJob,
  getAsyncCompileJobDir,
  getAsyncCompilePdfPath,
  isExpired,
  isTerminalStatus,
  listAsyncCompileJobIds,
  patchAsyncCompileMetadata,
  readAsyncCompileMetadata,
  writeAsyncCompileErrors,
  writeAsyncCompileLogs,
} from "./asyncCompileStore";

export interface AsyncCompileJobData {
  jobId: string;
  userId: string;
  engine: Engine;
  mainFile: string;
}

export interface AsyncCompileRunnerHealth {
  running: boolean;
  activeJobs: number;
  waitingJobs: number;
  maxConcurrent: number;
  totalProcessed: number;
  totalErrors: number;
  uptimeMs: number;
}

const MAX_CONCURRENT = parseInt(
  process.env.ASYNC_COMPILE_MAX_CONCURRENT_BUILDS ||
    process.env.MAX_CONCURRENT_BUILDS ||
    String(LIMITS.MAX_CONCURRENT_BUILDS_DEFAULT),
  10
);

class AsyncCompileRunner {
  readonly queue = new JobQueue<AsyncCompileJobData>(
    MAX_CONCURRENT,
    (data, signal) => this.processJob(data, signal)
  );
  private totalProcessed = 0;
  private totalErrors = 0;
  private startedAt = Date.now();

  constructor() {
    void cleanExpiredAsyncCompileJobs(new Date(this.startedAt).toISOString());
    console.log(`[AsyncCompileRunner] Started (concurrency=${MAX_CONCURRENT})`);
  }

  private async processJob(data: AsyncCompileJobData, signal: AbortSignal): Promise<void> {
    const { jobId, engine, mainFile } = data;
    const startTime = Date.now();

    try {
      const meta = await readAsyncCompileMetadata(jobId);
      if (!meta) {
        throw new Error("Async compile metadata not found");
      }

      await patchAsyncCompileMetadata(jobId, {
        status: "compiling",
        startedAt: new Date().toISOString(),
        message: undefined,
      });

      const jobDir = getAsyncCompileJobDir(jobId);
      const result = await runCompile({
        projectDir: jobDir,
        mainFile,
        engine,
        signal,
      });

      const durationMs = Date.now() - startTime;
      const parsedEntries = parseLatexLog(result.logs);
      const hasErrors = parsedEntries.some((e) => e.type === "error");
      const errorCount = parsedEntries.filter((e) => e.type === "error").length;
      const warningCount = parsedEntries.filter((e) => e.type === "warning").length;

      const logsFile = await writeAsyncCompileLogs(
        jobId,
        result.canceled ? "Build canceled by user." : result.logs
      );
      const errorsFile = await writeAsyncCompileErrors(jobId, parsedEntries);

      const pdfPath = getAsyncCompilePdfPath(jobId, mainFile);
      const pdfExists = await fs
        .access(pdfPath)
        .then(() => true)
        .catch(() => false);

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

      await patchAsyncCompileMetadata(jobId, {
        status: finalStatus,
        engineUsed: result.engineUsed,
        logsPath: logsFile,
        errorsPath: errorsFile,
        pdfPath: pdfExists ? "main.pdf" : undefined,
        errorCount,
        warningCount,
        durationMs,
        exitCode: result.exitCode,
        completedAt: new Date().toISOString(),
        expiresAt: computeAsyncCompileExpiryIso(),
        message: result.canceled
          ? "Build canceled by user."
          : undefined,
      });

      this.totalProcessed++;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);
      await patchAsyncCompileMetadata(jobId, {
        status: "error",
        message: `Compilation infrastructure error: ${errorMessage}`,
        durationMs,
        exitCode: -1,
        completedAt: new Date().toISOString(),
        expiresAt: computeAsyncCompileExpiryIso(),
      });
      this.totalErrors++;
      console.error(`[AsyncCompileRunner] Job ${jobId} failed: ${errorMessage}`);
    }
  }

  getHealth(): AsyncCompileRunnerHealth {
    return {
      running: true,
      activeJobs: this.queue.active,
      waitingJobs: this.queue.waiting,
      maxConcurrent: MAX_CONCURRENT,
      totalProcessed: this.totalProcessed,
      totalErrors: this.totalErrors,
      uptimeMs: Date.now() - this.startedAt,
    };
  }
}

async function cleanExpiredAsyncCompileJobs(startedAtIso: string): Promise<void> {
  try {
    const ids = await listAsyncCompileJobIds();
    for (const id of ids) {
      const meta = await readAsyncCompileMetadata(id);
      if (!meta) {
        await deleteAsyncCompileJob(id);
        continue;
      }
      // The queue is in-memory: unfinished jobs from a previous process are gone.
      if (!isTerminalStatus(meta.status) && meta.createdAt < startedAtIso) {
        await patchAsyncCompileMetadata(id, {
          status: "error",
          message: "Compile interrupted — server restarted. Please resubmit.",
          exitCode: -1,
          completedAt: new Date().toISOString(),
          expiresAt: computeAsyncCompileExpiryIso(),
        });
        continue;
      }
      if (isTerminalStatus(meta.status) && isExpired(meta)) {
        await deleteAsyncCompileJob(id);
      }
    }
  } catch (err) {
    console.error(
      "[AsyncCompileRunner] Failed to clean expired async compile jobs:",
      err instanceof Error ? err.message : err
    );
  }
}

const globalForRunner = globalThis as typeof globalThis & {
  __myeditorAsyncCompileRunner?: AsyncCompileRunner;
};

export function startAsyncCompileRunner(): AsyncCompileRunner {
  globalForRunner.__myeditorAsyncCompileRunner ??= new AsyncCompileRunner();
  return globalForRunner.__myeditorAsyncCompileRunner;
}

export async function enqueueAsyncCompileJob(data: AsyncCompileJobData): Promise<void> {
  startAsyncCompileRunner().queue.add(data.jobId, data);
}

export async function requestAsyncCompileCancel(
  jobId: string
): Promise<{ wasQueued: boolean; wasRunning: boolean }> {
  return startAsyncCompileRunner().queue.cancel(jobId);
}

export function getAsyncCompileRunnerHealth(): AsyncCompileRunnerHealth | null {
  return globalForRunner.__myeditorAsyncCompileRunner?.getHealth() ?? null;
}
