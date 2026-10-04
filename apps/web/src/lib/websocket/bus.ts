import { EventEmitter } from "events";

export const BUILD_EVENT = "build:updates";
export const FILE_EVENT = "file:updates";

// Route handlers and instrumentation are separate webpack bundles in one
// process, so module-level state isn't shared — globalThis is.
const globalForBus = globalThis as typeof globalThis & {
  __myeditorBus?: EventEmitter;
};

export function getEventBus(): EventEmitter {
  return (globalForBus.__myeditorBus ??= new EventEmitter());
}
