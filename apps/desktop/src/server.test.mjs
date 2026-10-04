import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { waitForServer } from "./server.mjs";

test("startup retries HTTP errors and stalled responses until healthy", async (t) => {
  let requests = 0;
  const server = createServer((_, res) => {
    requests++;
    if (requests === 1) res.writeHead(503).end();
    if (requests === 3) res.writeHead(200).end();
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await waitForServer(`http://127.0.0.1:${server.address().port}`, new EventEmitter());
  assert.equal(requests, 3);
});

test("startup fails when the child exits", async () => {
  const child = new EventEmitter();
  const waiting = waitForServer("http://127.0.0.1:0", child);
  child.emit("exit", 1);
  await assert.rejects(waiting, /exited during startup/);
});
