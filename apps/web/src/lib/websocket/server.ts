import type { ParsedLogEntry } from "@myeditor/shared";
import { getEventBus, BUILD_EVENT, FILE_EVENT } from "./bus";

// ─── Build Update Payloads ─────────────────────────

/**
 * Payload for status-only build updates (queued, compiling).
 */
export interface BuildStatusPayload {
  projectId: string;
  buildId: string;
  mainFile: string;
  status: "queued" | "compiling";
  triggeredByUserId?: string | null;
}

/**
 * Payload for completed build updates (success, error, timeout).
 */
export interface BuildCompletePayload {
  projectId: string;
  buildId: string;
  mainFile: string;
  status: "success" | "error" | "timeout" | "canceled";
  pdfUrl: string | null;
  logs: string;
  durationMs: number;
  errors: ParsedLogEntry[];
  triggeredByUserId?: string | null;
}

export type BuildUpdatePayload = BuildStatusPayload | BuildCompletePayload;

/**
 * Type guard — returns true when the payload represents a completed build.
 */
export function isBuildComplete(
  payload: BuildUpdatePayload
): payload is BuildCompletePayload {
  return (
    payload.status === "success" ||
    payload.status === "error" ||
    payload.status === "timeout" ||
    payload.status === "canceled"
  );
}

// ─── Room Naming ───────────────────────────────────

export function getUserRoom(userId: string): string {
  return `user:${userId}`;
}

export function getProjectRoom(projectId: string): string {
  return `project:${projectId}`;
}

// ─── Broadcast via in-process bus ──────────────────

/**
 * Hands a build update to the socket server (socketServer.ts), which
 * broadcasts it to the appropriate client rooms.
 */
export function broadcastBuildUpdate(
  userId: string,
  payload: BuildUpdatePayload
): void {
  try {
    getEventBus().emit(BUILD_EVENT, JSON.stringify({ userId, payload }));
  } catch (err) {
    console.error(
      "[Broadcast] Failed to publish build update:",
      err instanceof Error ? err.message : err
    );
  }
}

// ─── File Events ───────────────────────────────────

export interface FileEventPayload {
  type: "file:created" | "file:deleted" | "file:saved";
  projectId: string;
  userId: string;
  fileId: string;
  path: string;
  isDirectory?: boolean;
}

/**
 * Hands a file event to the socket server, which forwards it to the
 * project room.
 */
export function broadcastFileEvent(payload: FileEventPayload): void {
  try {
    getEventBus().emit(FILE_EVENT, JSON.stringify(payload));
  } catch (err) {
    console.error(
      "[Broadcast] Failed to publish file event:",
      err instanceof Error ? err.message : err
    );
  }
}
