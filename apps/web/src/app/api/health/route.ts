import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getRunnerHealth, type RunnerHealth } from "@/lib/compiler/runner";
import { getAsyncCompileRunnerHealth } from "@/lib/compiler/asyncCompileRunner";

// ─── GET /api/health ────────────────────────────────
// Diagnostic endpoint — checks the database and the in-process compile runners.

function describeRunner(health: RunnerHealth | null): { ok: boolean; detail: string } {
  return health
    ? {
        ok: true,
        detail: `active=${health.activeJobs}/${health.maxConcurrent} waiting=${health.waitingJobs} processed=${health.totalProcessed} errors=${health.totalErrors}`,
      }
    : { ok: false, detail: "Runner not started" };
}

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  try {
    await db.execute(sql`select 1`);
    checks.database = { ok: true };
  } catch (err) {
    checks.database = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  checks.compile_runner = describeRunner(getRunnerHealth());
  checks.async_compile_runner = describeRunner(getAsyncCompileRunnerHealth());

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    { status: allOk ? "healthy" : "unhealthy", checks },
    { status: allOk ? 200 : 503 }
  );
}
