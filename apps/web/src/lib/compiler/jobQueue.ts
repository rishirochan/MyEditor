/**
 * In-process FIFO job queue with a concurrency limit. Jobs are keyed by id
 * (duplicates are ignored while queued or running); cancel removes a queued
 * job or aborts a running one via its AbortSignal.
 */
// ponytail: in-memory only, queued jobs are lost on restart (stale build cleanup covers the DB side)
export class JobQueue<T> {
  private pending = new Map<string, T>();
  private running = new Map<string, AbortController>();

  constructor(
    private readonly concurrency: number,
    private readonly handler: (data: T, signal: AbortSignal) => Promise<void>
  ) {}

  add(id: string, data: T): void {
    if (this.pending.has(id) || this.running.has(id)) return;
    this.pending.set(id, data);
    this.drain();
  }

  cancel(id: string): { wasQueued: boolean; wasRunning: boolean } {
    const wasQueued = this.pending.delete(id);
    const controller = this.running.get(id);
    controller?.abort();
    return { wasQueued, wasRunning: controller !== undefined };
  }

  get waiting(): number {
    return this.pending.size;
  }

  get active(): number {
    return this.running.size;
  }

  private drain(): void {
    for (const [id, data] of this.pending) {
      if (this.running.size >= this.concurrency) return;
      this.pending.delete(id);
      const controller = new AbortController();
      this.running.set(id, controller);
      this.handler(data, controller.signal)
        .catch((err) => {
          console.error(`[JobQueue] Job ${id} failed:`, err instanceof Error ? err.message : err);
        })
        .finally(() => {
          this.running.delete(id);
          this.drain();
        });
    }
  }
}
