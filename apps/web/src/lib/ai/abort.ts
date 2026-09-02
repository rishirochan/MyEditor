export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function abortError(message = "Aborted"): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function createTimeoutSignal(
  timeoutMs: number,
  external?: AbortSignal
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) {
      controller.abort();
    } else {
      external.addEventListener("abort", onExternalAbort);
    }
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}
