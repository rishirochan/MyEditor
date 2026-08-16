import { withAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { projectFiles } from "@/lib/db/schema";
import { checkProjectAccess } from "@/lib/db/queries/projects";
import { completeStrictJson } from "@/lib/ai/client";
import { getUserAiSettings } from "@/lib/ai/settings";
import {
  aiEditSchema,
  applyLineEdits,
  normalizeFilePath,
  updateFileViaExistingApi,
  type AiEdit,
} from "@/lib/ai/editApply";
import { validateFilePath } from "@/lib/utils/validation";
import * as storage from "@/lib/storage";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import path from "path";

const requestSchema = z.object({
  projectId: z.string().uuid(),
  filePath: z.string().trim().min(1).max(1000),
  fileContent: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      })
    )
    .min(1)
    .max(30),
  selection: z
    .object({
      fromLine: z.number().int().min(1),
      toLine: z.number().int().min(1),
      text: z.string().max(20000),
    })
    .optional(),
});

const aiResponseSchema = z.object({
  reply: z.string().trim().min(1).max(8000),
  edits: z.array(aiEditSchema).max(40),
});

const systemPrompt = [
  "You are a senior LaTeX writing assistant embedded in a LaTeX editor.",
  "Return ONLY valid JSON matching this exact schema:",
  "{ reply: string, edits: [{ filePath: string, replaceFrom: number, replaceTo: number, newText: string }] }",
  "Rules:",
  "1) edits are optional: return an empty array when the user just asks a question.",
  "2) replaceFrom/replaceTo are 1-based inclusive line numbers in filePath.",
  "3) Line numbers refer to the activeFile content exactly as provided (1-based, split on \"\\n\").",
  "4) filePath must be one of the provided project files.",
  "5) Keep edits minimal and focused.",
  "6) When a selection is provided, the user's concerns are about those lines; prefer editing within or near that range.",
  "7) reply is a concise conversational answer describing what was done or answering the question.",
  "8) Do not include markdown or extra keys.",
].join("\n");

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

    const { projectId, messages, selection } = parsed.data;

    const access = await checkProjectAccess(user.id, projectId);
    if (!access.access) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (access.role === "viewer") {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    const aiSettings = await getUserAiSettings(user.id);
    const project = access.project;
    const projectDir = storage.getProjectDir(project.userId, projectId);

    const files = await db
      .select({
        id: projectFiles.id,
        path: projectFiles.path,
        isDirectory: projectFiles.isDirectory,
      })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));

    const editableFiles = files.filter((file) => !file.isDirectory);

    const activeFilePath = normalizeFilePath(parsed.data.filePath);
    const activeFile = editableFiles.find(
      (file) => file.path === activeFilePath
    );
    if (!activeFile) {
      return NextResponse.json(
        { error: "File not found in project" },
        { status: 400 }
      );
    }

    const activeFileContent =
      typeof parsed.data.fileContent === "string"
        ? parsed.data.fileContent
        : await storage
            .readFile(path.join(projectDir, activeFile.path))
            .catch(() => "");

    const userPrompt = JSON.stringify(
      {
        projectFiles: editableFiles.map((file) => file.path),
        activeFile: {
          path: activeFile.path,
          content: activeFileContent.slice(0, 32_000),
        },
        ...(selection ? { selection } : {}),
        conversation: messages,
      },
      null,
      2
    );

    let aiPayload: unknown;
    try {
      aiPayload = await completeStrictJson({
        modelSettings: aiSettings.latexWriter,
        systemPrompt,
        userPrompt,
        temperature: 0.2,
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "AI provider request failed",
        },
        { status: 502 }
      );
    }

    const aiResult = aiResponseSchema.safeParse(aiPayload);
    if (!aiResult.success) {
      return NextResponse.json(
        {
          error: "AI response schema validation failed",
          details: aiResult.error.flatten().fieldErrors,
        },
        { status: 502 }
      );
    }

    const normalizedEdits = aiResult.data.edits
      .map((edit) => ({
        filePath: normalizeFilePath(edit.filePath),
        replaceFrom: edit.replaceFrom,
        replaceTo: edit.replaceTo,
        newText: edit.newText,
      }))
      .filter((edit) => {
        const validPath = validateFilePath(edit.filePath);
        return validPath.valid && edit.replaceTo >= edit.replaceFrom;
      });

    const editsByFile = new Map<string, AiEdit[]>();
    for (const edit of normalizedEdits) {
      const next = editsByFile.get(edit.filePath) ?? [];
      next.push(edit);
      editsByFile.set(edit.filePath, next);
    }

    const applied: Array<{
      filePath: string;
      replaceFrom: number;
      replaceTo: number;
    }> = [];
    const skipped: Array<{ filePath: string; reason: string }> = [];

    for (const [filePath, edits] of editsByFile.entries()) {
      const file = editableFiles.find((entry) => entry.path === filePath);
      if (!file) {
        skipped.push({ filePath, reason: "File not found in project" });
        continue;
      }

      try {
        // The editor buffer is newer than disk for the active file.
        const current =
          filePath === activeFilePath &&
          typeof parsed.data.fileContent === "string"
            ? parsed.data.fileContent
            : await storage.readFile(path.join(projectDir, file.path));
        const nextContent = applyLineEdits(current, edits);
        if (nextContent === current) {
          continue;
        }

        await updateFileViaExistingApi(request, projectId, file.id, nextContent);
        for (const edit of edits) {
          applied.push({
            filePath,
            replaceFrom: edit.replaceFrom,
            replaceTo: edit.replaceTo,
          });
        }
      } catch (error) {
        skipped.push({
          filePath,
          reason:
            error instanceof Error ? error.message : "Failed to apply edit",
        });
      }
    }

    return NextResponse.json({
      reply: aiResult.data.reply,
      appliedEdits: applied,
      skippedEdits: skipped,
    });
  });
}
