import { test } from "node:test";
import assert from "node:assert/strict";
import { JobQueue } from "./jobQueue";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("JobQueue: concurrency limit, dedupe, cancel queued, cancel running", async () => {
  const started: string[] = [];
  const finish = new Map<string, () => void>();
  const aborted: string[] = [];

  const queue = new JobQueue<string>(2, (id, signal) => {
    started.push(id);
    return new Promise<void>((resolve) => {
      finish.set(id, resolve);
      signal.addEventListener("abort", () => {
        aborted.push(id);
        resolve();
      });
    });
  });

  queue.add("a", "a");
  queue.add("b", "b");
  queue.add("c", "c");
  queue.add("d", "d");
  queue.add("a", "a"); // duplicate of running job
  queue.add("c", "c"); // duplicate of queued job

  assert.deepEqual(started, ["a", "b"]);
  assert.equal(queue.active, 2);
  assert.equal(queue.waiting, 2);

  assert.deepEqual(queue.cancel("c"), { wasQueued: true, wasRunning: false });
  assert.equal(queue.waiting, 1);

  assert.deepEqual(queue.cancel("a"), { wasQueued: false, wasRunning: true });
  assert.deepEqual(aborted, ["a"]);
  await tick();
  assert.deepEqual(started, ["a", "b", "d"]); // c was removed, d took a's slot

  finish.get("b")!();
  finish.get("d")!();
  await tick();
  assert.equal(queue.active, 0);
  assert.equal(queue.waiting, 0);
  assert.deepEqual(queue.cancel("zzz"), { wasQueued: false, wasRunning: false });
});

test("JobQueue: a failing job frees its slot", async () => {
  const queue = new JobQueue<number>(1, async (n) => {
    if (n === 1) throw new Error("boom");
  });
  const origError = console.error;
  console.error = () => {};
  try {
    queue.add("1", 1);
    queue.add("2", 2);
    await tick();
    await tick();
    assert.equal(queue.active, 0);
    assert.equal(queue.waiting, 0);
  } finally {
    console.error = origError;
  }
});
