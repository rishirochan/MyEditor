export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Schema first: the runners clean up stale builds on start.
    const { runMigrations } = await import("@/lib/db/migrate");
    await runMigrations();
    await import("@/lib/websocket/socketServer");

    try {
      const { startCompileRunner } = await import("@/lib/compiler/runner");
      const { startAsyncCompileRunner } = await import(
        "@/lib/compiler/asyncCompileRunner"
      );
      startCompileRunner();
      startAsyncCompileRunner();
      console.log("[Instrumentation] Compile runners started");
    } catch (err) {
      console.error(
        "[Instrumentation] Failed to start compile runners:",
        err instanceof Error ? err.message : err
      );
    }
  }
}
