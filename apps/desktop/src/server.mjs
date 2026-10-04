export async function waitForServer(url, child) {
  let exited = false;
  child.once("exit", () => { exited = true; });
  for (let i = 0; i < 240 && !exited; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // Retry connection failures and timeouts while the child is running.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(exited ? "The app server exited during startup." : "The app server did not start in time.");
}
