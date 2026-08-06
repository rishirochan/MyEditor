import { NextRequest } from "next/server";
import { z } from "zod";

export interface AiEdit {
  filePath: string;
  replaceFrom: number;
  replaceTo: number;
  newText: string;
}

export const aiEditSchema = z.object({
  filePath: z.string().trim().min(1).max(1000),
  replaceFrom: z.number().int().min(1),
  replaceTo: z.number().int().min(1),
  newText: z.string(),
});

export function normalizeFilePath(value: string): string {
  return value.trim().replace(/^\.\//, "");
}

export function applyLineEdits(content: string, edits: AiEdit[]): string {
  const lines = content.split("\n");
  const sorted = [...edits].sort((a, b) => b.replaceFrom - a.replaceFrom);

  for (const edit of sorted) {
    if (edit.replaceTo < edit.replaceFrom) {
      throw new Error(
        `Invalid range for ${edit.filePath}: ${edit.replaceFrom}-${edit.replaceTo}`
      );
    }

    if (edit.replaceTo > lines.length) {
      throw new Error(
        `Out-of-range edit for ${edit.filePath}: max line ${lines.length}, got ${edit.replaceTo}`
      );
    }

    const startIndex = edit.replaceFrom - 1;
    const deleteCount = edit.replaceTo - edit.replaceFrom + 1;
    const replacement = edit.newText.split("\n");
    lines.splice(startIndex, deleteCount, ...replacement);
  }

  return lines.join("\n");
}

export function buildAuthHeaders(request: NextRequest): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const auth = request.headers.get("authorization");
  if (auth) {
    headers.authorization = auth;
  }

  const cookie = request.headers.get("cookie");
  if (cookie) {
    headers.cookie = cookie;
  }

  return headers;
}

export async function updateFileViaExistingApi(
  request: NextRequest,
  projectId: string,
  fileId: string,
  content: string
): Promise<void> {
  const url = new URL(`/api/projects/${projectId}/files/${fileId}`, request.url);
  const res = await fetch(url, {
    method: "PUT",
    headers: buildAuthHeaders(request),
    body: JSON.stringify({ content, autoCompile: false }),
    cache: "no-store",
  });

  if (!res.ok) {
    const payload = await res.text().catch(() => "");
    throw new Error(
      `Failed to update ${fileId} through file API (${res.status}): ${payload || res.statusText}`
    );
  }
}
