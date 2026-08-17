import { NextRequest } from "next/server";
import { z } from "zod";

const MAX_AI_EDIT_CHARS = 50_000;

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

export const aiTextEditSchema = z.object({
  filePath: z.string().trim().min(1).max(1000),
  oldText: z.string().min(1).max(MAX_AI_EDIT_CHARS),
  newText: z.string().max(MAX_AI_EDIT_CHARS),
});

export type AiTextEdit = z.infer<typeof aiTextEditSchema>;

export interface AppliedTextEdit {
  filePath: string;
  originalText: string;
  replacementText: string;
  startIndex: number;
  resultingLine: number;
}

export type ApplyTextEditResult =
  | { applied: true; content: string; edit: AppliedTextEdit }
  | {
      applied: false;
      content: string;
      reason:
        | "Target text is empty"
        | "Target text not found"
        | "Target text is ambiguous"
        | "Target text changed";
      matchCount: number;
    };

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

export function applyTextEdit(
  content: string,
  edit: AiTextEdit & { startIndex?: number }
): ApplyTextEditResult {
  if (!edit.oldText) {
    return {
      applied: false,
      content,
      reason: "Target text is empty",
      matchCount: 0,
    };
  }

  if (
    edit.startIndex !== undefined &&
    content.slice(edit.startIndex, edit.startIndex + edit.oldText.length) !==
      edit.oldText
  ) {
    return {
      applied: false,
      content,
      reason: "Target text changed",
      matchCount: 0,
    };
  }

  let matchCount = edit.startIndex === undefined ? 0 : 1;
  const matchIndex = edit.startIndex ?? content.indexOf(edit.oldText);
  if (edit.startIndex !== undefined) {
    return applyUniqueTextEdit(content, edit, matchIndex);
  }

  for (
    let index = matchIndex;
    index !== -1;
    index = content.indexOf(edit.oldText, index + 1)
  ) {
    matchCount += 1;
  }

  if (matchCount !== 1) {
    return {
      applied: false,
      content,
      reason:
        matchCount === 0 ? "Target text not found" : "Target text is ambiguous",
      matchCount,
    };
  }

  return applyUniqueTextEdit(content, edit, matchIndex);
}

function applyUniqueTextEdit(
  content: string,
  edit: AiTextEdit,
  matchIndex: number
): ApplyTextEditResult {
  return {
    applied: true,
    content:
      content.slice(0, matchIndex) +
      edit.newText +
      content.slice(matchIndex + edit.oldText.length),
    edit: {
      filePath: edit.filePath,
      originalText: edit.oldText,
      replacementText: edit.newText,
      startIndex: matchIndex,
      resultingLine: content.slice(0, matchIndex).split("\n").length,
    },
  };
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
