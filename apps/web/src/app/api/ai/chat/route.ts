import { randomUUID } from "crypto";
import path from "path";
import { withAuth } from "@/lib/auth/middleware";
import { isAbortError } from "@/lib/ai/abort";
import { completeStrictJson } from "@/lib/ai/client";
import {
  AI_IMAGE_MEDIA_TYPES,
  MAX_AI_IMAGE_TOTAL_BYTES,
  MAX_AI_IMAGES,
  base64ByteLength,
  isValidAiImage,
} from "@/lib/ai/imageInput";
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
const MAX_AI_CHAT_BODY_BYTES = 16 * 1024 * 1024;

const undoEditSchema = aiTextEditSchema.extend({
  startIndex: z.number().int().min(0),
});

const contextFileSchema = z.object({
  path: z.string().trim().min(1).max(1000),
  content: z.string().max(MAX_AI_FILE_CHARS).optional(),
});

const imageSchema = z
  .object({
    mediaType: z.enum(AI_IMAGE_MEDIA_TYPES),
    data: z.string().min(1),
  })
  .refine(isValidAiImage, { message: "Invalid image data" });

const requestSchema = z
  .object({
    projectId: z.string().uuid(),
    mode: z.enum(["contour", "carve"]).default("carve"),
    files: z.array(contextFileSchema).min(1).max(2),
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
    images: z.array(imageSchema).max(MAX_AI_IMAGES).optional(),
    undoEdits: z.array(undoEditSchema).min(1).max(40).optional(),
  })
  .refine((value) => Boolean(value.messages) !== Boolean(value.undoEdits), {
    message: "Provide either messages or undoEdits",
  })
  .superRefine((value, context) => {
    const imageBytes = value.images?.reduce(
      (total, image) => total + base64ByteLength(image.data),
      0
    );
    if ((imageBytes ?? 0) > MAX_AI_IMAGE_TOTAL_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["images"],
        message: "Images must total 10 MB or less",
      });
    }
    if (value.images?.length && !value.messages) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["images"],
        message: "Images require a chat message",
      });
    }
  });

const aiResponseSchema = z.object({
  reply: z.string().trim().min(1).max(8000),
  edits: z.array(aiTextEditSchema).max(40),
});

/* Contour is enforced below by discarding edits, not by trusting the model to
   obey this prompt. The schema stays identical so parsing is mode-agnostic. */
const contourSystemPrompt = [
  "You are a senior LaTeX writing assistant embedded in a LaTeX editor.",
  "You are in discussion mode: you can read the document but you cannot change it.",
  "Return ONLY valid JSON matching this exact schema:",
  "{ reply: string, edits: [] }",
  "Rules:",
  "1) edits must always be an empty array. The editor discards any edit you return.",
  "2) Answer the user's question about contextFiles[].content directly and concretely.",
  "3) Write the reply in plain language. Do not quote LaTeX source, commands, environments, or markup unless the user explicitly asks to see the source.",
  "4) When the user wants a change, explain what to change and why in prose. Never claim to have made it.",
  "5) contextFiles[].content is the sole source of truth for the document's current state.",
  "6) Do not include markdown or extra keys.",
].join("\n");

const carveSystemPrompt = [
  "You are a senior LaTeX writing assistant embedded in a LaTeX editor.",
  "Return ONLY valid JSON matching this exact schema:",
  "{ reply: string, edits: [{ filePath: string, oldText: string, newText: string }] }",
  "Rules:",
  "1) edits are optional: return an empty array when the user just asks a question.",
  "2) filePath must exactly equal one of contextFiles[].path. You can edit only those files.",
  "3) oldText must be copied verbatim from that file's content, including whitespace.",
  "4) oldText must identify exactly one location. Include nearby source context when the short text repeats.",
  "5) newText is the complete replacement for oldText. Keep edits minimal and focused.",
  "6) When writing or revising resume content, prefer \\& over the word \"and\" by default to keep lines compact. Keep \"and\" only when the user explicitly requests it or when using \\& would make the text unclear.",
  "7) contextFiles[].content is the sole source of truth for the document's current state. Conversation history and prior applied-edit metadata may explain intent, but they are not document content. Never restore, reapply, or overwrite text from chat history when the current file differs from it. Preserve all current wording, formatting, and structure unless the user's latest request explicitly changes it.",
  "8) Treat direct requests such as \"add X\", \"remove Y\", and \"replace X with Y\" as a closed scope. Make only the requested edit. Do not add stylistic, grammatical, content, formatting, or other improvement edits unless the user asks for broader revision.",
  "9) When a selection is provided, prefer editing that exact selected text.",
  "10) If asked to undo and prior applied-edit metadata is present in the conversation, reverse that exact edit.",
  "11) Never claim an edit succeeded; only describe the edit you are proposing.",
  "12) Do not include markdown or extra keys.",
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
  | {
      type: "activity";
      message: string;
      append?: boolean;
      label?: string;
      tool?: string;
    }
  | {
      type: "result";
      reply: string;
      appliedEdits: AppliedEdit[];
      skippedEdits: SkippedEdit[];
    }
  | { type: "error"; message: string };

function streamResponse(
  requestId: string,
  signal: AbortSignal,
  run: (emit: (event: StreamEvent) => void) => Promise<void>
): NextResponse {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: StreamEvent) => {
        if (signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Stream already closed after the client disconnected.
        }
      };

      try {
        await run(emit);
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        const message =
          error instanceof Error ? error.message : "AI request failed";
        console.error(`[ai/chat:${requestId}] ${message}`);
        emit({ type: "error", message });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
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
  files: Array<{ id: string; path: string; content: string }>;
  edits: Array<AiTextEdit & { startIndex?: number }>;
  emit: (event: StreamEvent) => void;
  signal?: AbortSignal;
}): Promise<{ applied: AppliedEdit[]; skipped: SkippedEdit[] }> {
  const { request, projectId, files, edits, emit, signal } = params;
  const buffers = new Map(files.map((file) => [file.path, { ...file }]));
  const applied: AppliedEdit[] = [];
  const skipped: SkippedEdit[] = [];

  for (const edit of edits) {
    if (signal?.aborted) break;
    const filePath = normalizeFilePath(edit.filePath);
    const file = buffers.get(filePath);
    if (!file) {
      skipped.push({
        filePath,
        reason: "File is not in the selected context",
      });
      continue;
    }
    if (edit.oldText === edit.newText) {
      skipped.push({ filePath, reason: "Replacement is unchanged" });
      continue;
    }

    const result = applyTextEdit(file.content, { ...edit, filePath });
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

    file.content = result.content;
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
    label: "Applying edits",
    tool: "apply_edits",
    message: `Applying ${applied.length} validated edit${applied.length === 1 ? "" : "s"}`,
  });

  const kept: AppliedEdit[] = [];
  for (const file of buffers.values()) {
    if (signal?.aborted) break;
    const fileEdits = applied.filter((edit) => edit.filePath === file.path);
    if (fileEdits.length === 0) continue;
    try {
      await updateFileViaExistingApi(request, projectId, file.id, file.content);
      emit({
        type: "activity",
        label: `Verifying ${path.basename(file.path)}`,
        message: `Verified ${file.path}`,
      });
      kept.push(...fileEdits);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "File update failed";
      skipped.push(
        ...fileEdits.map((edit) => ({ filePath: edit.filePath, reason }))
      );
    }
  }

  return { applied: kept, skipped };
}

export async function POST(request: NextRequest) {
  return withAuth(request, async (req, user) => {
    const contentLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_AI_CHAT_BODY_BYTES) {
      return NextResponse.json(
        { error: "AI chat request is too large" },
        { status: 413 }
      );
    }

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

    const requestedPaths = parsed.data.files.map((file) =>
      normalizeFilePath(file.path)
    );
    if (new Set(requestedPaths).size !== requestedPaths.length) {
      return NextResponse.json(
        { error: "Context files must be unique" },
        { status: 400 }
      );
    }
    if (
      requestedPaths.some((filePath) => !filePath.toLowerCase().endsWith(".tex"))
    ) {
      return NextResponse.json(
        { error: "Context files must be .tex documents" },
        { status: 400 }
      );
    }

    const projectFileRows = await db
      .select({
        id: projectFiles.id,
        path: projectFiles.path,
        isDirectory: projectFiles.isDirectory,
      })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));

    const projectDir = storage.getProjectDir(access.project.userId, projectId);
    const contextFiles: Array<{ id: string; path: string; content: string }> =
      [];
    for (const [index, filePath] of requestedPaths.entries()) {
      const row = projectFileRows.find(
        (file) => !file.isDirectory && file.path === filePath
      );
      if (!row) {
        return NextResponse.json(
          { error: `File not found in project: ${filePath}` },
          { status: 400 }
        );
      }
      const clientContent = parsed.data.files[index]?.content;
      const content =
        typeof clientContent === "string"
          ? clientContent
          : await storage
              .readFile(path.join(projectDir, row.path))
              .catch(() => "");
      contextFiles.push({ id: row.id, path: row.path, content });
    }

    const requestId = randomUUID();

    console.info(
      `[ai/chat:${requestId}] files=${contextFiles.map((file) => file.path).join(",")} action=${parsed.data.undoEdits ? "undo" : "chat"} mode=${parsed.data.mode}`
    );

    return streamResponse(requestId, req.signal, async (emit) => {
      emit({
        type: "activity",
        label: "Reading files",
        message: `Reading ${contextFiles.map((file) => file.path).join(", ")}`,
      });
      if (parsed.data.images?.length) {
        emit({
          type: "activity",
          label: "Reading screenshots",
          message: `Reading ${parsed.data.images.length} screenshot${parsed.data.images.length === 1 ? "" : "s"}`,
        });
      }

      if (parsed.data.undoEdits) {
        emit({
          type: "activity",
          label: "Validating edits",
          message: "Validating inverse edit",
        });
        const { applied, skipped } = await applyRequestedEdits({
          request,
          projectId,
          files: contextFiles,
          edits: parsed.data.undoEdits,
          emit,
          signal: req.signal,
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

      const contourMode = parsed.data.mode === "contour";
      const aiSettings = await getUserAiSettings(user.id);
      emit({
        type: "activity",
        label: "Analyzing",
        message: `Analyzing with ${aiSettings.latexWriter.model}`,
      });
      const visibleFiles = contextFiles.map((file) => {
        const visibleContent = file.content.slice(0, MAX_PROMPT_FILE_CHARS);
        return {
          path: file.path,
          content: visibleContent,
          truncated: visibleContent.length < file.content.length,
        };
      });
      let reasoningSummaryChars = 0;
      let progressPhase: "idle" | "thinking" | "tool" = "idle";
      let lastToolName = "";
      const aiPayload = await completeStrictJson({
        modelSettings: aiSettings.latexWriter,
        systemPrompt: contourMode ? contourSystemPrompt : carveSystemPrompt,
        userPrompt: JSON.stringify(
          {
            contextFiles: visibleFiles,
            ...(parsed.data.selection
              ? { selection: parsed.data.selection }
              : {}),
            conversation: parsed.data.messages,
            screenshotCount: parsed.data.images?.length ?? 0,
          },
          null,
          2
        ),
        temperature: 0.2,
        images: parsed.data.images,
        signal: req.signal,
        onProgress: (event) => {
          if (event.type === "status") return;
          if (event.type === "tool_call") {
            if (progressPhase === "tool" && lastToolName === event.name) return;
            progressPhase = "tool";
            lastToolName = event.name;
            emit({
              type: "activity",
              tool: event.name,
              label: `Calling ${event.name}`,
              message: `Calling ${event.name}`,
            });
            return;
          }
          if (event.type === "reasoning_summary") {
            if (progressPhase !== "thinking") {
              progressPhase = "thinking";
              lastToolName = "";
              emit({
                type: "activity",
                label: "Thinking",
                message: "Thinking: ",
              });
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

      if (req.signal.aborted) return;

      const aiResult = aiResponseSchema.safeParse(aiPayload);
      if (!aiResult.success) {
        throw new Error("AI response schema validation failed");
      }

      if (contourMode) {
        console.info(
          `[ai/chat:${requestId}] provider=${aiSettings.latexWriter.provider} model=${aiSettings.latexWriter.model} mode=contour discarded=${aiResult.data.edits.length}`
        );
        emit({
          type: "result",
          reply: aiResult.data.reply,
          appliedEdits: [],
          skippedEdits: [],
        });
        return;
      }

      emit({
        type: "activity",
        label: "Validating edits",
        message: "Validating proposed edits",
      });
      const { applied, skipped } = await applyRequestedEdits({
        request,
        projectId,
        files: contextFiles,
        edits: aiResult.data.edits,
        emit,
        signal: req.signal,
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
