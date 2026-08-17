import { randomUUID } from "crypto";
import path from "path";
import { withAuth } from "@/lib/auth/middleware";
import { completeStrictJson } from "@/lib/ai/client";
import {
  aiTextEditSchema,
  applyTextEdit,
  normalizeFilePath,
  updateFileViaExistingApi,
  type AiTextEdit,
} from "@/lib/ai/editApply";
import { getUserAiSettings } from "@/lib/ai/settings";
import { db } from "@/lib/db";
import { checkProjectAccess } from "@/lib/db/queries/projects";
import { projectFiles } from "@/lib/db/schema";
import * as storage from "@/lib/storage";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const MAX_AI_FILE_CHARS = 200_000;
const MAX_PROMPT_FILE_CHARS = 32_000;
const MAX_REASONING_SUMMARY_CHARS = 4_000;

const undoEditSchema = aiTextEditSchema.extend({
  startIndex: z.number().int().min(0),
});

const requestSchema = z
  .object({
    projectId: z.string().uuid(),
    filePath: z.string().trim().min(1).max(1000),
    fileContent: z.string().max(MAX_AI_FILE_CHARS).optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(8000),
        })
      )
      .min(1)
      .max(30)
      .optional(),
    selection: z
      .object({
        fromLine: z.number().int().min(1),
        toLine: z.number().int().min(1),
        text: z.string().max(20000),
      })
      .optional(),
    undoEdits: z.array(undoEditSchema).min(1).max(40).optional(),
  })
  .refine((value) => Boolean(value.messages) !== Boolean(value.undoEdits), {
    message: "Provide either messages or undoEdits",
  });

const aiResponseSchema = z.object({
  reply: z.string().trim().min(1).max(8000),
  edits: z.array(aiTextEditSchema).max(40),
});

const systemPrompt = [
  "You are a senior LaTeX writing assistant embedded in a LaTeX editor.",
  "Return ONLY valid JSON matching this exact schema:",
  "{ reply: string, edits: [{ filePath: string, oldText: string, newText: string }] }",
  "Rules:",
  "1) edits are optional: return an empty array when the user just asks a question.",
  "2) filePath must exactly equal activeFile.path. You can edit only the active file.",
  "3) oldText must be copied verbatim from activeFile.content, including whitespace.",
  "4) oldText must identify exactly one location. Include nearby source context when the short text repeats.",
  "5) newText is the complete replacement for oldText. Keep edits minimal and focused.",
  "6) When a selection is provided, prefer editing that exact selected text.",
  "7) If asked to undo and prior applied-edit metadata is present in the conversation, reverse that exact edit.",
  "8) Never claim an edit succeeded; only describe the edit you are proposing.",
  "9) Do not include markdown or extra keys.",
].join("\n");

interface AppliedEdit {
  filePath: string;
  oldText: string;
  newText: string;
  startIndex: number;
  line: number;
}

interface SkippedEdit {
  filePath: string;
  reason: string;
}

type StreamEvent =
  | { type: "activity"; message: string; append?: boolean }
  | {
      type: "result";
      reply: string;
      appliedEdits: AppliedEdit[];
      skippedEdits: SkippedEdit[];
    }
  | { type: "error"; message: string };

function streamResponse(
  requestId: string,
  run: (emit: (event: StreamEvent) => void) => Promise<void>
): NextResponse {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        await run(emit);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "AI request failed";
        console.error(`[ai/chat:${requestId}] ${message}`);
        emit({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Request-Id": requestId,
    },
  });
}

async function applyRequestedEdits(params: {
  request: NextRequest;
  projectId: string;
  file: { id: string; path: string };
  content: string;
  edits: Array<AiTextEdit & { startIndex?: number }>;
  emit: (event: StreamEvent) => void;
}): Promise<{ applied: AppliedEdit[]; skipped: SkippedEdit[] }> {
  const { request, projectId, file, edits, emit } = params;
  const applied: AppliedEdit[] = [];
  const skipped: SkippedEdit[] = [];
  let content = params.content;

  for (const edit of edits) {
    const filePath = normalizeFilePath(edit.filePath);
    if (filePath !== file.path) {
      skipped.push({ filePath, reason: "Only the active file can be edited" });
      continue;
    }
    if (edit.oldText === edit.newText) {
      skipped.push({ filePath, reason: "Replacement is unchanged" });
      continue;
    }

    const result = applyTextEdit(content, { ...edit, filePath });
    if (!result.applied) {
      skipped.push({
        filePath,
        reason:
          edit.startIndex === undefined
            ? `${result.reason} (${result.matchCount} matches)`
            : "Undo target changed since the edit was applied",
      });
      continue;
    }

    content = result.content;
    applied.push({
      filePath,
      oldText: result.edit.originalText,
      newText: result.edit.replacementText,
      startIndex: result.edit.startIndex,
      line: result.edit.resultingLine,
    });
  }

  if (applied.length === 0) return { applied, skipped };

  emit({
    type: "activity",
    message: `Applying ${applied.length} validated edit${applied.length === 1 ? "" : "s"}`,
  });
  try {
    await updateFileViaExistingApi(request, projectId, file.id, content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "File update failed";
    return {
      applied: [],
      skipped: [
        ...skipped,
        ...applied.map((edit) => ({ filePath: edit.filePath, reason })),
      ],
    };
  }

  emit({ type: "activity", message: `Verified ${file.path}` });
  return { applied, skipped };
}

export async function POST(request: NextRequest) {
  return withAuth(request, async (req, user) => {
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { projectId } = parsed.data;
    const access = await checkProjectAccess(user.id, projectId);
    if (!access.access) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (access.role === "viewer") {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    const activeFilePath = normalizeFilePath(parsed.data.filePath);
    const [activeFile] = await db
      .select({
        id: projectFiles.id,
        path: projectFiles.path,
        isDirectory: projectFiles.isDirectory,
      })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId))
      .then((files) =>
        files.filter(
          (file) => !file.isDirectory && file.path === activeFilePath
        )
      );

    if (!activeFile) {
      return NextResponse.json(
        { error: "File not found in project" },
        { status: 400 }
      );
    }

    const projectDir = storage.getProjectDir(access.project.userId, projectId);
    const activeFileContent =
      typeof parsed.data.fileContent === "string"
        ? parsed.data.fileContent
        : await storage
            .readFile(path.join(projectDir, activeFile.path))
            .catch(() => "");
    const requestId = randomUUID();

    console.info(
      `[ai/chat:${requestId}] file=${activeFile.path} action=${parsed.data.undoEdits ? "undo" : "chat"}`
    );

    return streamResponse(requestId, async (emit) => {
      emit({ type: "activity", message: `Reading ${activeFile.path}` });

      if (parsed.data.undoEdits) {
        emit({ type: "activity", message: "Validating inverse edit" });
        const { applied, skipped } = await applyRequestedEdits({
          request,
          projectId,
          file: activeFile,
          content: activeFileContent,
          edits: parsed.data.undoEdits,
          emit,
        });
        console.info(
          `[ai/chat:${requestId}] applied=${applied.length} skipped=${skipped.length}`
        );
        emit({
          type: "result",
          reply:
            applied.length > 0
              ? "Undid the last AI edit."
              : "The last AI edit could not be undone safely.",
          appliedEdits: applied,
          skippedEdits: skipped,
        });
        return;
      }

      const aiSettings = await getUserAiSettings(user.id);
      emit({
        type: "activity",
        message: `Analyzing with ${aiSettings.latexWriter.model}`,
      });
      const visibleContent = activeFileContent.slice(0, MAX_PROMPT_FILE_CHARS);
      let reasoningSummaryChars = 0;
      const aiPayload = await completeStrictJson({
        modelSettings: aiSettings.latexWriter,
        systemPrompt,
        userPrompt: JSON.stringify(
          {
            activeFile: {
              path: activeFile.path,
              content: visibleContent,
              truncated: visibleContent.length < activeFileContent.length,
            },
            ...(parsed.data.selection
              ? { selection: parsed.data.selection }
              : {}),
            conversation: parsed.data.messages,
          },
          null,
          2
        ),
        temperature: 0.2,
        onProgress: (event) => {
          if (event.type === "reasoning_summary") {
            if (reasoningSummaryChars === 0) {
              emit({ type: "activity", message: "Reasoning summary: " });
            }
            const chunk = event.text.slice(
              0,
              MAX_REASONING_SUMMARY_CHARS - reasoningSummaryChars
            );
            reasoningSummaryChars += chunk.length;
            if (chunk) {
              emit({ type: "activity", message: chunk, append: true });
            }
          }
        },
      });

      const aiResult = aiResponseSchema.safeParse(aiPayload);
      if (!aiResult.success) {
        throw new Error("AI response schema validation failed");
      }

      emit({ type: "activity", message: "Validating proposed edits" });
      const { applied, skipped } = await applyRequestedEdits({
        request,
        projectId,
        file: activeFile,
        content: activeFileContent,
        edits: aiResult.data.edits,
        emit,
      });
      console.info(
        `[ai/chat:${requestId}] provider=${aiSettings.latexWriter.provider} model=${aiSettings.latexWriter.model} applied=${applied.length} skipped=${skipped.length}`
      );
      emit({
        type: "result",
        reply:
          skipped.length > 0 && applied.length === 0
            ? "I found a possible edit, but refused to apply it because its target was not uniquely verified."
            : aiResult.data.reply,
        appliedEdits: applied,
        skippedEdits: skipped,
      });
    });
  });
}
